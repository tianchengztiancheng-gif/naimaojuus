/* ============================================================
 * core/script.js —— 剧本解析（两种字段顺序自动识别）
 *
 *   Larimar : <角色|表情|台词>        角色在前
 *   juus    : 台词|角色|表情          台词在前，无尖括号，一行一句
 *
 * 两边的差异只有字段顺序，这里归一成同一种事件流：
 *   { type:'say',  who, expr, text }
 *   { type:'stage', cast:[{name,expr}] }
 *   { type:'bg',   loc, period }
 *   { type:'choice', options:[] }
 *   { type:'env',  text }
 * ============================================================ */
(function (global) {
  'use strict';

  var NARRATORS = { '旁白': 1, '-': 1, '': 1 };

  /* 时刻 -> 时段。两套素材的时段词都能对上（白日/朝/午/夜…） */
  function bandOf(hhmm) {
    var m = /(\d{1,2})\s*[:：]/.exec(String(hhmm || ''));
    if (!m) return '';
    var h = parseInt(m[1], 10);
    if (h < 5) return '夜';
    if (h < 8) return '清晨';
    if (h < 11) return '朝';
    if (h < 16) return '午';
    if (h < 19) return '黄昏';
    return '夜';
  }

  /**
   * 解析『✨ 2081/09/17 · 星期三 · 22:47 · 港区商业街 · 天气：微风晴夜 ✨』
   * 段数和顺序在不同卡里会变，所以不按固定下标取，
   * 而是让每一段去场景表里试，挑匹配得最好的那个当地点。
   */
  function parseHeader(text) {
    var m = /^\s*『([\s\S]*?)』\s*$/.exec(String(text || ''));
    if (!m) return null;
    var segs = m[1].replace(/[✨★☆]/g, '').split(/[·•・]/)
      .map(function (s) { return s.replace(/^(天气|地点|时间)\s*[:：]\s*/, '').trim(); })
      .filter(Boolean);

    var period = '';
    segs.forEach(function (s) { if (!period) period = bandOf(s); });

    var loc = '', bestRank = 99;
    var RANK = { exact: 0, alias: 1, 'other-period': 2, fuzzy: 3, similar: 4, hash: 9 };
    var R = global.Resolver;
    segs.forEach(function (s, i) {
      if (!s || /^\d/.test(s) || /^(星期|周|[月火水木金土日]曜日)/.test(s)) return;
      if (!R) { if (!loc && i >= 2) loc = s; return; }
      var hit = R.scene(s, period);
      var rank = hit ? (RANK[hit.via] == null ? 9 : RANK[hit.via]) : 9;
      if (rank < bestRank) { bestRank = rank; loc = s; }
    });
    /* 全都匹配不上时，退回倒数第二段（多数卡的地点位） */
    if (!loc && segs.length >= 2) loc = segs[segs.length - 2];
    return { loc: loc, period: period, raw: m[1].trim(), segs: segs };
  }

  /** 靠"哪一段像人名"来判断顺序：人名短且不含句读 */
  function looksLikeName(s) {
    s = String(s || '').trim();
    if (!s || s.length > 12) return false;
    return !/[。，！？、；：""''…]/.test(s);
  }

  /**
   * 自动判定字段顺序。
   * @returns {'who-first'|'text-first'}
   */
  function detectOrder(lines) {
    var whoFirst = 0, textFirst = 0;
    lines.forEach(function (parts) {
      if (parts.length < 3) return;
      if (looksLikeName(parts[0]) && !looksLikeName(parts[parts.length - 1])) whoFirst++;
      if (looksLikeName(parts[parts.length - 2]) && !looksLikeName(parts[0])) textFirst++;
    });
    return textFirst > whoFirst ? 'text-first' : 'who-first';
  }

  /**
   * @param {string} raw
   * @param {object} [opt] { order:'auto'|'who-first'|'text-first', roster }
   */
  function parse(raw, opt) {
    opt = opt || {};
    var src = String(raw == null ? '' : raw);
    var events = [];

    var wrap = src.match(/<Gal>([\s\S]*?)<\/Gal>/);
    if (wrap) src = wrap[1];

    src = src.replace(/<env>([\s\S]*?)<\/env>/g, function (m, g) {
      events.push({ type: 'env', text: g.trim() }); return '';
    });
    src = src.replace(/<choice>([\s\S]*?)<\/choice>/g, function (m, g) {
      var opts = (g.match(/\[([^\[\]]*)\]/g) || []).map(function (s) { return s.slice(1, -1); });
      events.push({ type: 'choice', options: opts }); return '';
    });
    src = src.replace(/<\/?(?:juus_cot|Gal_cot|thinking)>[\s\S]*?(?=<|$)/g, '');

    /* 先把 <...> 包起来的和裸行统一成 parts 数组 */
    var rows = [];
    src.split('\n').forEach(function (ln) {
      ln = ln.trim();
      if (!ln) return;
      var m = ln.match(/^<([\s\S]+)>$/);
      var body = m ? m[1] : ln;
      body = body.replace(/\|\s*$/, '');

      if (/^背景\s*\|/.test(body)) {
        var b = body.split('|').map(function (s) { return s.trim(); });
        rows.push({ special: { type: 'bg', loc: b[1] || '', period: b[2] || '' } });
        return;
      }
      if (/^立绘\s*\|?/.test(body)) {
        var cast = body.replace(/^立绘\s*\|?/, '').split('|').map(function (seg) {
          var kv = seg.split(':').map(function (s) { return s.trim(); });
          return { name: kv[0], expr: kv[1] || '' };
        }).filter(function (c) { return c.name; });
        rows.push({ special: { type: 'stage', cast: cast } });
        return;
      }
      /* 退场：<退场|角色名> 或 <退场|A|B>，也认「离场」「下场」 */
      if (/^(退场|离场|下场|exit)\s*\|/i.test(body)) {
        var gone = body.split('|').slice(1).map(function (x) { return x.trim(); })
                       .filter(Boolean);
        rows.push({ special: { type: 'exit', cast: gone } });
        return;
      }
      /* 登场：<登场|角色名:表情>，也认「入场」「上场」 */
      if (/^(登场|入场|上场|enter)\s*\|/i.test(body)) {
        var come = body.split('|').slice(1).map(function (seg) {
          var kv = seg.split(':').map(function (x) { return x.trim(); });
          return { name: kv[0], expr: kv[1] || '' };
        }).filter(function (c) { return c.name; });
        rows.push({ special: { type: 'enter', cast: come } });
        return;
      }
      if (/^\/?CG/i.test(body)) return;

      rows.push({ parts: body.split('|').map(function (s) { return s.trim(); }) });
    });

    var partRows = rows.filter(function (r) { return r.parts; }).map(function (r) { return r.parts; });
    var order = opt.order && opt.order !== 'auto' ? opt.order : detectOrder(partRows);

    rows.forEach(function (r) {
      if (r.special) { events.push(r.special); return; }
      var p = r.parts;
      var who, expr, text;
      if (p.length >= 3) {
        if (order === 'text-first') {
          expr = p[p.length - 1]; who = p[p.length - 2];
          text = p.slice(0, p.length - 2).join('|');
        } else {
          who = p[0]; expr = p[1]; text = p.slice(2).join('|');
        }
      } else if (p.length === 2) {
        if (order === 'text-first') { who = p[1]; expr = '-'; text = p[0]; }
        else { who = p[0]; expr = '-'; text = p[1]; }
      } else {
        who = '旁白'; expr = '-'; text = p[0];
      }
      text = String(text || '').trim();
      if (!text) return;
      who = String(who || '旁白').trim() || '旁白';
      var hdr = parseHeader(text);
      if (hdr && hdr.loc) {
        events.push({ type: 'bg', loc: hdr.loc, period: hdr.period, fromHeader: true });
      }
      events.push({
        type: 'say', who: who, expr: String(expr || '-').trim(),
        text: text, narration: !!NARRATORS[who], header: hdr || undefined
      });
    });

    return { events: events, order: order };
  }

  /** 把事件流展开成逐句模块，并为每句算好舞台状态（供渲染器直接消费） */
  function toModules(events, opt) {
    opt = opt || {};
    /* 「这个人有没有立绘」要同时看表情差分表和默认立绘表 ——
       只看前者的话，六百多个只有默认立绘的舰娘永远上不了台。 */
    var roster = opt.roster;
    if (!roster) {
      var R = global.RESOURCE || {};
      roster = {};
      Object.keys(R.characters || {}).forEach(function (n) { roster[n] = 1; });
      Object.keys(R.defaults || {}).forEach(function (n) { roster[n] = 1; });
    }
    var outfitOf = opt.outfitOf || function () { return null; };
    var skinOf = opt.skinOf || function () { return null; };
    var lockedOf = opt.lockedOf || function () { return null; };
    var maxStage = opt.maxStage || 4;
    var modules = [], stage = [], explicit = false;
    var bg = { loc: opt.loc || '', period: opt.period || '' };
    var env = '', pendingChoices = null;
    var tick = 0;                 // 单调递增的"发言时刻"，用来决定谁最久没说话

    /* 隐式上台：说话人进台上，超过上限就把最久没说话的挤下去。
       刻意不随机挑：随机有可能把刚说过两句的人踢掉，而留下沉默了二十句的，
       画面会闪。按最久未发言淘汰，效果稳定且可预期。
       当前说话人永远不会被挤掉。 */
    function joinStage(name, expr) {
      var slot = null;
      for (var i = 0; i < stage.length; i++) if (stage[i].name === name) slot = stage[i];
      if (slot) {
        if (expr && expr !== '-') slot.expr = expr;
        slot.last = ++tick;
        return;
      }
      if (stage.length >= maxStage) {
        var victim = 0;
        for (var j = 1; j < stage.length; j++) {
          if (stage[j].name !== name && stage[j].last < stage[victim].last) victim = j;
        }
        stage.splice(victim, 1);
      }
      stage.push({ name: name, expr: (expr && expr !== '-') ? expr : '', last: ++tick });
    }

    events.forEach(function (ev) {
      if (ev.type === 'bg') {
        /* 换了地点就清台 —— 上一个场景的人不该跟着到新地方。
           同地点只换时段（白天→夜晚）不清。 */
        var moved = ev.loc && bg.loc && ev.loc !== bg.loc;
        bg = { loc: ev.loc, period: ev.period || bg.period };
        modules._lastBg = { loc: bg.loc, period: bg.period };
        if (moved) { stage = []; explicit = false; }
        return;
      }
      if (ev.type === 'env') { env = ev.text; return; }
      if (ev.type === 'choice') { pendingChoices = ev.options; return; }
      if (ev.type === 'exit') {
        /* 全员退场：<退场|全部> / <退场|all> */
        if (ev.cast.some(function (n) { return /^(全部|全员|所有人|all)$/i.test(n); })) {
          stage = [];
        } else {
          stage = stage.filter(function (c) { return ev.cast.indexOf(c.name) < 0; });
        }
        explicit = true;
        return;
      }
      if (ev.type === 'enter') {
        explicit = true;
        ev.cast.forEach(function (c) {
          if (!roster[c.name]) return;
          var exist = stage.filter(function (x) { return x.name === c.name; })[0];
          if (exist) { if (c.expr) exist.expr = c.expr; exist.last = ++tick; return; }
          if (stage.length >= maxStage) {
            var victim = 0;
            for (var j = 1; j < stage.length; j++) {
              if (stage[j].last < stage[victim].last) victim = j;
            }
            stage.splice(victim, 1);
          }
          stage.push({ name: c.name, expr: c.expr || '', last: ++tick });
        });
        return;
      }
      if (ev.type === 'stage') {
        explicit = true;
        stage = ev.cast.filter(function (c) { return roster[c.name]; })
                       .slice(0, maxStage)
                       .map(function (c) { return { name: c.name, expr: c.expr, last: ++tick }; });
        return;
      }
      if (ev.type !== 'say') return;

      if (roster[ev.who]) {
        if (explicit) {
          var slot = stage.filter(function (c) { return c.name === ev.who; })[0];
          if (slot && ev.expr && ev.expr !== '-') slot.expr = ev.expr;
        } else {
          joinStage(ev.who, ev.expr);
        }
      }
      modules.push({
        who: ev.who, expr: ev.expr, text: ev.text, narration: ev.narration,
        bg: { loc: bg.loc, period: bg.period }, env: env,
        stage: stage.map(function (c) {
          return { name: c.name, expr: c.expr || '', outfit: outfitOf(c.name),
                   skin: skinOf(c.name), skinLocked: lockedOf(c.name) };
        })
      });
    });

    if (pendingChoices && modules.length) {
      modules[modules.length - 1].choices = pendingChoices;
    }
    return modules;
  }

  global.ScriptParser = {
    parse: parse, toModules: toModules, detectOrder: detectOrder,
    parseHeader: parseHeader, bandOf: bandOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
