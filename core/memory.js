/* ============================================================
 * core/memory.js —— 长期记忆（剧情自动总结）（v5.26）
 *
 * 以前：发给模型的历史只有最近 40 条（20 轮），再早的直接截掉 —— 玩到二三十轮，
 * 前面发生过什么、答应过谁什么，模型全忘了；原文堆得太长，模型也越写越糊。
 *
 * 现在：
 *   · 最近 N 轮（默认 12）原文照发
 *   · 更早的，每攒够 M 轮（默认 6）就让模型把这一段总结成要点，存成一块「记忆」
 *   · 记忆块按时间排好，放在对话历史前面一起发；块多了（字数超上限）再把最早的几块合并压缩
 *   · 另有一段「备忘」：玩家自己写、永远带上（约定、设定、不能忘的事）
 *
 * 记忆块记着它总结到主线历史的第几条（to）和那一条的指纹（sig）：
 * 撤回 / 重roll / 读了别的分支，指纹对不上的块自动作废，不会串线。
 *
 * 这里只有纯逻辑（好测）；发请求在 engine.js（memoryTick），界面在 app.js「记忆」一节。
 * ============================================================ */
(function (global) {
  'use strict';

  var DEFAULTS = { enabled: true, keepTurns: 12, chunkTurns: 6, maxChars: 3600, via: 'main' };

  function fresh() { return { chunks: [], notes: '' }; }
  function norm(mem) {
    mem = mem && typeof mem === 'object' ? mem : fresh();
    if (!Array.isArray(mem.chunks)) mem.chunks = [];
    if (typeof mem.notes !== 'string') mem.notes = '';
    return mem;
  }

  /** 主线历史：手机里单独生成的那些不算 */
  function mainHist(history) {
    return (history || []).filter(function (m) { return m && !m.phoneOnly; });
  }

  /** 一条消息的指纹：够区分分支就行，不求密码学 */
  function sig(m) {
    var s = String((m && m.role) || '') + '|' + String((m && m.content) || '');
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ':' + s.length;
  }

  /** 还对得上当前历史的记忆块（按顺序，第一块对不上的起全部作废） */
  function valid(mem, hist) {
    var out = [], at = 0;
    var cs = norm(mem).chunks;
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (c.from !== at || c.to > hist.length || c.to <= c.from || sig(hist[c.to - 1]) !== c.sig) break;
      out.push(c); at = c.to;
    }
    return out;
  }
  /** 前多少条主线历史已经被记忆覆盖了 */
  function covered(mem, hist) {
    var v = valid(mem, hist);
    return v.length ? v[v.length - 1].to : 0;
  }
  /** 把作废的块丢掉（撤回 / 重roll 后调一下） */
  function prune(mem, hist) {
    mem = norm(mem);
    var v = valid(mem, hist);
    var dropped = mem.chunks.length - v.length;
    mem.chunks = v;
    return dropped;
  }

  function cfgOf(cfg) {
    var c = Object.assign({}, DEFAULTS, cfg || {});
    c.keepTurns = Math.max(2, Math.min(60, +c.keepTurns || DEFAULTS.keepTurns));
    c.chunkTurns = Math.max(2, Math.min(20, +c.chunkTurns || DEFAULTS.chunkTurns));
    c.maxChars = Math.max(800, +c.maxChars || DEFAULTS.maxChars);
    return c;
  }

  /**
   * 这一次要发给模型的原文历史。
   * 没开记忆：老行为，最近 limit 条。
   * 开了：记忆没覆盖到的全发，但封个顶（总结失败 / 还没追上时别无限长）。
   */
  function windowOf(mem, hist, cfg, limit) {
    var c = cfgOf(cfg);
    if (!c.enabled) return hist.slice(-(limit || 40));
    var cap = (c.keepTurns + c.chunkTurns) * 2 + 2;
    return hist.slice(Math.max(covered(mem, hist), hist.length - cap));
  }

  /** 第几条主线历史是第几轮（按玩家发言数） */
  function turnAt(hist, idx) {
    var n = 0;
    for (var i = 0; i < idx && i < hist.length; i++) if (hist[i].role === 'user') n++;
    return n;
  }

  /**
   * 下一块该总结哪一段：{from, to} 或 null。
   * 没覆盖的超过「保留轮数 + 一块」才动手，总结完原文还剩「保留轮数」那么多。
   * 块的末尾对齐到一条 assistant（一轮的结尾），不把一轮拆成两半。
   */
  function plan(mem, hist, cfg) {
    var c = cfgOf(cfg);
    if (!c.enabled) return null;
    var from = covered(mem, hist);
    var keep = c.keepTurns * 2, chunk = c.chunkTurns * 2;
    if (hist.length - from <= keep + chunk - 1) return null;
    var to = alignEnd(hist, from, Math.min(from + chunk, hist.length - keep), hist.length - keep);
    return to ? { from: from, to: to } : null;
  }
  /** 块尾对齐到一轮的结尾（assistant）：能往后挪一条就往后（开场白占了一条时常见），不行再往前 */
  function alignEnd(hist, from, to, max) {
    if (to > from && hist[to - 1] && hist[to - 1].role === 'assistant') return to;
    if (to + 1 <= max && hist[to] && hist[to].role === 'assistant') return to + 1;
    while (to > from + 1 && hist[to - 1].role !== 'assistant') to--;
    return to > from + 1 ? to : 0;
  }
  /** 「现在整理」：不管够不够一块，把保留轮数之外的都总结掉 */
  function planNow(mem, hist, cfg) {
    var c = cfgOf(cfg);
    var from = covered(mem, hist), keep = c.keepTurns * 2, chunk = c.chunkTurns * 2;
    var to = alignEnd(hist, from, Math.min(from + chunk, hist.length - keep), hist.length - keep);
    return to ? { from: from, to: to } : null;
  }

  /* ---------------- 原文 → 可读的剧情记录 ---------------- */
  var PHONE_LINE = /^\s*\[(短信|群聊|小红书|评论|趋势)\|[^\n]*\]\s*$/gm;
  function cleanRaw(s) {
    return String(s || '')
      .replace(/<(think|thinking|juus_cot|Gal_cot)>[\s\S]*?<\/\1>/gi, '')
      .replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi, '')
      .replace(/<image>[\s\S]*?<\/image>/gi, '')
      .replace(PHONE_LINE, '')
      .trim();
  }
  function lineOf(ev) {
    if (ev.type === 'say') return ev.narration ? ev.text : ev.who + '：' + ev.text;
    if (ev.type === 'bg' && !ev.fromHeader) return '（场景：' + ev.loc + (ev.period ? ' · ' + ev.period : '') + '）';
    if (ev.type === 'enter' && ev.cast && ev.cast.length) return '（' + ev.cast.map(function (c) { return c.name || c; }).join('、') + ' 来了）';
    if (ev.type === 'exit' && ev.cast && ev.cast.length) return '（' + ev.cast.join('、') + ' 离开）';
    if (ev.type === 'env') return '（' + ev.text + '）';
    return '';
  }
  function transcript(msgs, opt) {
    opt = opt || {};
    var user = opt.userName || '指挥官';
    var P = global.ScriptParser;
    return msgs.map(function (m) {
      var t = cleanRaw(m.content);
      if (!t) return '';
      if (m.role === 'user') return '【' + user + '】' + t.replace(/\s*\n\s*/g, ' ');
      if (!P) return t;
      var lines = P.parse(t, opt.order ? { order: opt.order } : undefined).events.map(lineOf).filter(Boolean);
      return lines.length ? lines.join('\n') : t;
    }).filter(Boolean).join('\n');
  }

  /* ---------------- 给模型的指令 ---------------- */
  function summaryPrompt(mem, hist, range, opt) {
    opt = opt || {};
    var user = opt.userName || '指挥官';
    var prev = valid(mem, hist).slice(-2).map(function (c) { return c.text; }).join('\n');
    var t0 = turnAt(hist, range.from) + 1, t1 = turnAt(hist, range.to);
    var body = transcript(hist.slice(range.from, range.to), opt);
    var lim = opt.chunkChars || 450;
    return [
      '[独立任务 · 剧情记忆整理。忽略之前的剧本格式要求，这次不写 <Gal> 正文]',
      '下面是一段角色扮演故事的原文（第 ' + t0 + '～' + t1 + ' 轮）。把它整理成一块「剧情记忆」，之后的剧情会拿它代替原文，所以漏掉的东西就真的忘了。',
      '',
      prev ? '<之前的记忆（只作衔接参考，不要重复）>\n' + prev + '\n</之前的记忆>\n' : '',
      '<原文>',
      body,
      '</原文>',
      '',
      '整理要求：',
      '1. 按时间顺序写要点，每条一行，以「- 」开头；第一行写这段的时间和地点（第几天、时段、在哪）。',
      '2. 必须留下：发生了什么事、结果如何；' + user + '做过的选择、说过的重要的话；答应过的事、约定、没做完的事、埋下的伏笔；' +
        '每个舰娘对' + user + '的态度和关系变化（亲近了、生气了、表白、誓约、吵架和好……）；得到或失去的东西、知道的秘密。',
      '3. 写清楚是谁：用角色的名字，不用「她」「对方」。',
      '4. 不要景物描写、客套寒暄、心理独白的原句；不要评价，不要续写，不要编原文里没有的事。',
      '5. 总长不超过 ' + lim + ' 字。只输出要点本身。'
    ].filter(function (x) { return x !== ''; }).join('\n');
  }

  function mergePrompt(chunks, opt) {
    opt = opt || {};
    var lim = opt.mergeChars || 700;
    return [
      '[独立任务 · 剧情记忆压缩。忽略之前的剧本格式要求，这次不写 <Gal> 正文]',
      '下面是一个角色扮演故事较早几段的剧情记忆，按时间先后排列。把它们合并成一块更短的「前情提要」。',
      '',
      '<记忆>',
      chunks.map(function (c) { return '〔第 ' + c.fromTurn + '～' + c.toTurn + ' 轮〕\n' + c.text; }).join('\n\n'),
      '</记忆>',
      '',
      '要求：按时间顺序、每条一行以「- 」开头；保留对之后剧情还有影响的：关系变化、约定和承诺、没解决的事、伏笔、重要的物品和秘密；' +
        '已经了结、不再有影响的琐事可以删掉。总长不超过 ' + lim + ' 字。只输出要点本身。'
    ].join('\n');
  }

  function cleanOut(s) {
    return String(s || '')
      .replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, '')
      .replace(/^```[a-z]*\s*|\s*```$/g, '')
      .replace(/<\/?(Gal|记忆|剧情记忆)>/g, '')
      .trim();
  }

  /** 把总结结果做成一块 */
  function makeChunk(hist, range, text) {
    return { from: range.from, to: range.to, sig: sig(hist[range.to - 1]),
      fromTurn: turnAt(hist, range.from) + 1, toTurn: turnAt(hist, range.to),
      text: cleanOut(text), at: Date.now() };
  }

  /** 要不要合并压缩：总字数超上限、而且至少 3 块 → 合并最早的一半（至少 2 块） */
  function mergePlan(mem, cfg) {
    var c = cfgOf(cfg), cs = norm(mem).chunks;
    var total = cs.reduce(function (s, x) { return s + x.text.length; }, 0);
    if (total <= c.maxChars || cs.length < 3) return null;
    return { n: Math.max(2, Math.floor(cs.length / 2)) };
  }
  function applyMerge(mem, n, text) {
    var cs = norm(mem).chunks, pick = cs.slice(0, n);
    var last = pick[pick.length - 1];
    var merged = { from: pick[0].from, to: last.to, sig: last.sig, fromTurn: pick[0].fromTurn, toTurn: last.toTurn,
      text: cleanOut(text), at: Date.now(), merged: true };
    mem.chunks = [merged].concat(cs.slice(n));
    return merged;
  }

  /** 注入提示词的那一块 */
  function render(mem, hist, opt) {
    opt = opt || {};
    mem = norm(mem);
    var v = valid(mem, hist);
    var notes = mem.notes.trim();
    if (!v.length && !notes) return '';
    var L = ['<剧情记忆>', '下面是这个故事更早的经过（原文已经省略），接下来的剧情要和它保持一致：'];
    v.forEach(function (c) {
      L.push('〔' + (c.merged ? '前情提要 · ' : '') + '第 ' + c.fromTurn + '～' + c.toTurn + ' 轮〕');
      L.push(c.text);
    });
    if (notes) { L.push('〔备忘 · 必须记住〕'); L.push(notes); }
    L.push('</剧情记忆>');
    return L.join('\n');
  }

  global.Memory = {
    DEFAULTS: DEFAULTS, fresh: fresh, norm: norm, mainHist: mainHist, sig: sig,
    valid: valid, covered: covered, prune: prune, cfgOf: cfgOf, windowOf: windowOf, turnAt: turnAt,
    plan: plan, planNow: planNow, transcript: transcript, cleanRaw: cleanRaw,
    summaryPrompt: summaryPrompt, mergePrompt: mergePrompt, makeChunk: makeChunk,
    mergePlan: mergePlan, applyMerge: applyMerge, render: render, cleanOut: cleanOut
  };
})(typeof window !== 'undefined' ? window : globalThis);
