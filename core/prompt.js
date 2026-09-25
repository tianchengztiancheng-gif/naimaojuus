/* ============================================================
 * core/prompt.js —— 按酒馆 Chat Completion 语义组装 messages
 *
 * 预设结构：prompts[] + prompt_order[].order（identifier / enabled）
 * marker 型条目是占位符，运行时替换：
 *   worldInfoBefore / charDescription / charPersonality / scenario /
 *   personaDescription / worldInfoAfter / dialogueExamples / chatHistory
 *
 * 本模块只处理"格式"：谁排在谁前面、哪段插在哪。
 * 预设正文原样透传，不读取、不改写。
 * ============================================================ */
(function (global) {
  'use strict';

  var MARKERS = {
    worldInfoBefore: 'wiBefore', charDescription: 'charDesc',
    charPersonality: 'charPers', scenario: 'scenario',
    personaDescription: 'persona', worldInfoAfter: 'wiAfter',
    dialogueExamples: 'examples', chatHistory: 'history'
  };

  function num(v, d) { var n = Number(v); return isNaN(n) ? d : n; }

  /**
   * 选出生效的那组 prompt_order。
   *
   * 酒馆导出的预设里 prompt_order 往往有**两组**：character_id 100000（旧的默认组，
   * 常常是很久以前的残留）和 100001（酒馆实际在用的那组）。以前一律取 [0]，
   * 拿到的多半是 100000 —— 于是开关、顺序全是旧的，预设作者后来调的都没生效。
   * 顺序：100001 → 条目最多的一组 → 第一组。返回的是原对象，编辑器改它就是改预设。
   */
  function orderOf(preset) {
    var list = (preset && Array.isArray(preset.prompt_order)) ? preset.prompt_order : [];
    var groups = list.filter(function (g) { return g && Array.isArray(g.order); });
    if (!groups.length) return null;
    var hit = groups.filter(function (g) { return Number(g.character_id) === 100001; })[0];
    if (hit) return hit;
    return groups.slice().sort(function (a, b) { return b.order.length - a.order.length; })[0];
  }

  /** 块正文：新版酒馆用 content，一些导出/旧版用 prompt */
  function textOf(p) {
    if (!p) return '';
    if (typeof p.content === 'string' && p.content !== '') return p.content;
    return typeof p.prompt === 'string' ? p.prompt : String(p.content || '');
  }

  /** 这个块在普通生成时该不该发。injection_trigger 为空 = 总是发；
      只写了 continue / impersonate / swipe 之类的，普通一轮不发 */
  function triggerOk(p, type) {
    var t = p && p.injection_trigger;
    if (!Array.isArray(t) || !t.length) return true;
    return t.map(function (x) { return String(x).toLowerCase(); }).indexOf(type || 'normal') !== -1;
  }

  /** 解析预设 → { params, order:[{identifier, content, role, marker, depth}] } */
  function parsePreset(preset, opt) {
    preset = preset || {};
    opt = opt || {};
    var byId = {};
    (preset.prompts || []).forEach(function (p) { if (p && p.identifier) byId[p.identifier] = p; });

    var og = orderOf(preset);
    var orderList = (og && og.order) || [];
    // 没有 prompt_order 时退化成 prompts 的自然顺序
    if (!orderList.length) {
      orderList = (preset.prompts || []).map(function (p) {
        return { identifier: p.identifier, enabled: p.enabled !== false };
      });
    }

    var order = orderList.filter(function (o) { return o && o.enabled !== false; })
      .filter(function (o) { return triggerOk(byId[o.identifier], opt.trigger); })
      .map(function (o) {
        var p = byId[o.identifier] || {};
        /* 占位块在 prompts 里可能缺定义（只在 prompt_order 里出现），按名字认 */
        var isMarker = !!p.marker || (!byId[o.identifier] && MARKERS.hasOwnProperty(o.identifier));
        var role = String(p.role || 'system').toLowerCase();
        if (role !== 'user' && role !== 'assistant') role = 'system';
        return {
          identifier: o.identifier,
          name: p.name || o.identifier,
          marker: isMarker,
          role: role,
          content: isMarker ? '' : textOf(p),
          injectionPosition: num(p.injection_position, 0),
          injectionDepth: num(p.injection_depth, 4),
          injectionOrder: num(p.injection_order, 100)
        };
      })
      .filter(function (p) { return p.marker || p.content.trim(); });

    return {
      order: order,
      params: {
        temperature: preset.temperature,
        topP: preset.top_p,
        topK: preset.top_k,
        frequencyPenalty: preset.frequency_penalty,
        presencePenalty: preset.presence_penalty,
        maxTokens: preset.openai_max_tokens,
        maxContext: preset.openai_max_context,
        stream: preset.stream_openai !== false,
        /* Claude 预设常把破限写在「助手预填」里，酒馆会把它作为最后一条 assistant 发出去 */
        assistantPrefill: String(preset.assistant_prefill || ''),
        squashSystem: preset.squash_system_messages !== false,
        wiFormat: preset.wi_format || '{0}',
        scenarioFormat: preset.scenario_format || '',
        personalityFormat: preset.personality_format || ''
      }
    };
  }

  function fmt(tpl, value) {
    if (!value) return '';
    if (!tpl || tpl.indexOf('{0}') === -1) return value;
    return tpl.replace('{0}', value);
  }

  /* ------------------------------------------------------------
     宏替换。以前只认 {{char}} {{user}} {{persona}} {{description}} 四个，
     可酒馆预设大量依赖 {{setvar::}} / {{getvar::}} 做开关、{{// 注释}} 写备注、
     {{trim}} 收空行、{{random::}} 抽样式。这些原样发出去，模型看到的就是一堆
     花括号咒语 —— 预设的开关一个都没生效，这是「预设没效果」的主因之一。
     求值顺序和酒馆一致：从最内层开始、从左到右，所以 setvar 在前的块里
     设的值，后面的块用 getvar 读得到。
     ------------------------------------------------------------ */
  var GLOBAL_VARS = {};

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function rollDice(spec) {
    var m = String(spec || '').trim().match(/^(\d*)d(\d+)([+-]\d+)?$/i);
    var n = 1, faces = 0, add = 0;
    if (m) { n = Number(m[1] || 1); faces = Number(m[2]); add = Number(m[3] || 0); }
    else if (/^\d+$/.test(String(spec).trim())) faces = Number(spec);
    if (!faces) return '';
    var t = add;
    for (var i = 0; i < Math.min(n, 100); i++) t += 1 + Math.floor(Math.random() * faces);
    return String(t);
  }

  function splitArgs(body, head) {
    /* {{random::a::b}} 与老式 {{random:a,b}} 两种写法都认 */
    var rest = body.slice(head.length);
    if (rest.indexOf('::') === 0) return rest.slice(2).split('::');
    if (rest.charAt(0) === ':') return rest.slice(1).split(',');
    return [];
  }

  function numOr(v, d) { var n = Number(v); return isNaN(n) ? d : n; }

  function macroOne(inner, ctx) {
    var raw = inner;
    var t = inner.trim();
    var low = t.toLowerCase();
    var vars = ctx.vars || (ctx.vars = {});
    var args;
    switch (low) {
      case 'char': return ctx.charName || '';
      case 'user': return ctx.userName || 'User';
      case 'persona': return ctx.personaDescription || '';
      case 'description': return ctx.charDescription || '';
      case 'personality': return ctx.charPersonality || '';
      case 'scenario': return ctx.scenario || '';
      case 'mesexamples': case 'mesexamplesraw': return ctx.mesExamples || '';
      case 'charprompt': return ctx.charPrompt || '';
      case 'charjailbreak': case 'charinstruction': return ctx.charInstruction || '';
      case 'model': return ctx.model || '';
      case 'lastusermessage': return ctx.lastUserMessage || '';
      case 'lastcharmessage': return ctx.lastCharMessage || '';
      case 'lastmessage': return ctx.lastMessage || '';
      case 'input': return ctx.input || '';
      case 'newline': return '\n';
      case 'noop': case 'original': return '';
      case 'idle_duration': return '刚刚';
      case 'maxprompt': return String(ctx.maxPrompt || '');
    }
    var now = ctx.now || new Date();
    if (low === 'time') return pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    if (low === 'date') return now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日';
    if (low === 'isotime') return pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    if (low === 'isodate') return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
    if (low === 'datetime') return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    if (low === 'messagecount' || low === 'turncount') return String(ctx.messageCount || 0);
    if (low === 'weekday') return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][now.getDay()];

    /* 变量：局部（这一局）与全局 */
    var mv = t.match(/^(set|get|add|inc|dec)(global)?var::([\s\S]*)$/i);
    if (mv) {
      var op = mv[1].toLowerCase();
      var store = mv[2] ? GLOBAL_VARS : vars;
      var parts = mv[3].split('::');
      var name = parts[0].trim();
      var val = parts.slice(1).join('::');
      if (op === 'get') return store[name] == null ? '' : String(store[name]);
      if (op === 'set') { store[name] = val; return ''; }
      if (op === 'add') {
        var cur = store[name];
        if (cur != null && cur !== '' && !isNaN(Number(cur)) && !isNaN(Number(val))) store[name] = String(Number(cur) + Number(val));
        else store[name] = String(cur == null ? '' : cur) + val;
        return '';
      }
      if (op === 'inc') { store[name] = String(numOr(store[name], 0) + 1); return store[name]; }
      if (op === 'dec') { store[name] = String(numOr(store[name], 0) - 1); return store[name]; }
    }

    if (/^random(::|:)/i.test(t)) {
      args = splitArgs(t, t.match(/^random/i)[0]);
      return args.length ? args[Math.floor(Math.random() * args.length)].trim() : '';
    }
    if (/^pick(::|:)/i.test(t)) {
      /* 酒馆的 pick 在同一聊天里稳定，这里按内容哈希固定一个，效果相同 */
      args = splitArgs(t, t.match(/^pick/i)[0]);
      if (!args.length) return '';
      var h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
      return args[Math.abs(h) % args.length].trim();
    }
    var mr = t.match(/^roll[: ]+(.+)$/i);
    if (mr) return rollDice(mr[1]);
    if (/^reverse:/i.test(t)) return t.slice(8).split('').reverse().join('');
    var mt = t.match(/^(trim|lower|upper)::([\s\S]*)$/i);
    if (mt) {
      var fn = mt[1].toLowerCase();
      return fn === 'trim' ? mt[2].trim() : fn === 'lower' ? mt[2].toLowerCase() : mt[2].toUpperCase();
    }
    var hv = t.match(/^(has|delete)(global)?var::([\s\S]+)$/i);
    if (hv) {
      var hs = hv[2] ? GLOBAL_VARS : vars;
      var hn = hv[3].trim();
      if (hv[1].toLowerCase() === 'has') return hs[hn] != null ? 'true' : 'false';
      delete hs[hn]; return '';
    }
    if (/^bias::/i.test(t)) return '';
    if (/^banned\s/i.test(t)) return '';
    return null;                                // 不认识的宏原样保留
  }

  /* 简写变量（酒馆 Macros 2.0 / KT 都支持）：
       {{.名字}} 读局部  {{.名字 = 值}} 写  {{.名字 += 值}} 加  {{.名字++}} {{.名字--}}
       {{$名字}} 同上，全局 */
  function shorthandVar(t, ctx) {
    var m = t.match(/^([.$])([^\s=+\-!<>]+)\s*(\+\+|--|\+=|-=|=)?\s*([\s\S]*)$/);
    if (!m) return null;
    var store = m[1] === '$' ? GLOBAL_VARS : (ctx.vars || (ctx.vars = {}));
    var name = m[2], op = m[3], val = m[4];
    if (!op) return m[4] ? null : (store[name] == null ? '' : String(store[name]));
    if (op === '=') { store[name] = val; return ''; }
    if (op === '++' || op === '--') { store[name] = String(numOr(store[name], 0) + (op === '++' ? 1 : -1)); return ''; }
    var cur = store[name];
    if (op === '-=') { store[name] = String(numOr(cur, 0) - numOr(val, 0)); return ''; }
    if (cur != null && cur !== '' && !isNaN(Number(cur)) && !isNaN(Number(val))) store[name] = String(Number(cur) + Number(val));
    else store[name] = String(cur == null ? '' : cur) + val;
    return '';
  }

  /** {{if 条件}} 的条件求值：支持 ! 取反、== != > < >= <=、裸变量名 */
  function truthy(cond, ctx) {
    var c = String(cond || '').trim();
    var neg = false;
    while (c.charAt(0) === '!') { neg = !neg; c = c.slice(1).trim(); }
    function val(x) {
      x = String(x).trim();
      var q = x.match(/^(['"])([\s\S]*)\1$/);
      if (q) return q[2];
      var sv = x.match(/^([.$])(\S+)$/);
      if (sv) {
        var st = sv[1] === '$' ? GLOBAL_VARS : (ctx.vars || {});
        return st[sv[2]] == null ? '' : String(st[sv[2]]);
      }
      var gv = x.match(/^get(global)?var::([\s\S]+)$/i);
      if (gv) {
        var st2 = gv[1] ? GLOBAL_VARS : (ctx.vars || {});
        return st2[gv[2].trim()] == null ? '' : String(st2[gv[2].trim()]);
      }
      return x;
    }
    var r;
    var cmp = c.match(/^([\s\S]+?)\s*(==|!=|>=|<=|>|<)\s*([\s\S]+)$/);
    if (cmp) {
      var a = val(cmp[1]), b = val(cmp[3]);
      var na = Number(a), nb = Number(b);
      var num2 = a !== '' && b !== '' && !isNaN(na) && !isNaN(nb);
      switch (cmp[2]) {
        case '==': r = num2 ? na === nb : a === b; break;
        case '!=': r = num2 ? na !== nb : a !== b; break;
        case '>': r = num2 && na > nb; break;
        case '<': r = num2 && na < nb; break;
        case '>=': r = num2 && na >= nb; break;
        case '<=': r = num2 && na <= nb; break;
      }
    } else {
      var v = val(c).trim();
      r = v !== '' && !/^(false|0|off|no|null|undefined)$/i.test(v);
    }
    return neg ? !r : r;
  }

  /** 找和 open 位置的 {{ 配对的 }}（中间可以嵌套 {{…}}） */
  function closeOf(s, open) {
    var depth = 0;
    for (var i = open; i < s.length - 1; i++) {
      if (s.charAt(i) === '{' && s.charAt(i + 1) === '{') { depth++; i++; continue; }
      if (s.charAt(i) === '}' && s.charAt(i + 1) === '}') { depth--; if (!depth) return i; i++; }
    }
    return -1;
  }

  /** 从 from 开始找本层的 {{else}} 与 {{/if}}（跳过嵌套的 if） */
  function ifBounds(s, from) {
    var level = 0, elseAt = -1, elseEnd = -1, i = from;
    while (i < s.length) {
      var j = s.indexOf('{{', i);
      if (j < 0) return null;
      var k = closeOf(s, j);
      if (k < 0) return null;
      var inner = s.slice(j + 2, k).trim();
      if (/^#?if\s/i.test(inner)) level++;
      else if (/^\/if$/i.test(inner)) {
        if (!level) return { elseAt: elseAt, elseEnd: elseEnd, endAt: j, endEnd: k + 2 };
        level--;
      } else if (/^else$/i.test(inner) && !level && elseAt < 0) { elseAt = j; elseEnd = k + 2; }
      i = k + 2;
    }
    return null;
  }

  /**
   * 顺序求值：从左到右，遇到宏先求它里面嵌套的宏，再求它自己。
   * {{if}} 只求被选中的分支 —— 没选中的分支里的 setvar 不会执行（KT 的实现在这点上会误执行）。
   */
  function evalMacros(s, ctx, depth) {
    if ((depth || 0) > 30) return s;
    var out = '', i = 0;
    while (i < s.length) {
      var j = s.indexOf('{{', i);
      if (j < 0) { out += s.slice(i); break; }
      out += s.slice(i, j);
      var k = closeOf(s, j);
      if (k < 0) { out += s.slice(j); break; }
      var inner = s.slice(j + 2, k);
      var t = inner.trim();
      if (t.indexOf('//') === 0) { i = k + 2; continue; }             // {{// 注释}}
      var mi = t.match(/^#?if\s+([\s\S]+)$/i);
      if (mi) {
        var b = ifBounds(s, k + 2);
        if (b) {
          var cond = evalMacros(mi[1], ctx, (depth || 0) + 1);
          var yes = s.slice(k + 2, b.elseAt >= 0 ? b.elseAt : b.endAt);
          var no = b.elseAt >= 0 ? s.slice(b.elseEnd, b.endAt) : '';
          out += evalMacros(truthy(cond, ctx) ? yes : no, ctx, (depth || 0) + 1);
          i = b.endEnd;
          continue;
        }
      }
      if (/^(else|\/if)$/i.test(t)) { i = k + 2; continue; }          // 落单的，吞掉
      if (/^trim$/i.test(t)) { out += '\u0001TRIM\u0001'; i = k + 2; continue; }
      var ev = evalMacros(inner, ctx, (depth || 0) + 1);
      var r = macroOne(ev, ctx);
      if (r == null && /^[.$]/.test(ev.trim())) r = shorthandVar(ev.trim(), ctx);
      out += r == null ? '{{' + ev + '}}' : r;
      i = k + 2;
    }
    return out;
  }

  /** 完整宏替换（预设块、卡字段用） */
  function macros(text, ctx) {
    var s = String(text || '');
    if (s.indexOf('{{') === -1) return s;
    s = evalMacros(s, ctx, 0);
    /* {{trim}}：连同两侧的空白行一起删掉 */
    s = s.replace(/\s*\u0001TRIM\u0001\s*/g, '');
    return s;
  }

  /** 历史消息只换 {{char}} {{user}} —— 酒馆也不在聊天记录里跑 setvar 这类宏 */
  function simpleMacros(text, ctx) {
    return String(text || '')
      .replace(/\{\{char\}\}/gi, ctx.charName || '')
      .replace(/\{\{user\}\}/gi, ctx.userName || 'User');
  }

  /**
   * 组装。
   * @param {object} o {
   *   preset, card, history:[{role,content}], userText,
   *   worldbook: {buckets} (来自 Worldbook.activate),
   *   charName, userName, personaDescription, extraSystem
   * }
   * @returns {{messages, report}}
   */
  function build(o) {
    o = o || {};
    var parsed = parsePreset(o.preset);
    var d = (o.card && (o.card.data || o.card)) || {};
    var histAll = o.history || [];
    function lastOf(role) {
      for (var i = histAll.length - 1; i >= 0; i--) {
        if (!role || histAll[i].role === role) return String(histAll[i].content || '');
      }
      return '';
    }
    var ctx = {
      charName: o.charName || d.name || '',
      userName: o.userName || 'User',
      personaDescription: o.personaDescription || '',
      charDescription: d.description || '',
      charPersonality: d.personality || '',
      scenario: d.scenario || '',
      mesExamples: d.mes_example || '',
      charPrompt: d.system_prompt || '',
      charInstruction: d.post_history_instructions || '',
      model: o.model || '',
      lastUserMessage: o.userText || lastOf('user'),
      lastCharMessage: lastOf('assistant'),
      lastMessage: o.userText || lastOf(null),
      input: o.userText || '',
      maxPrompt: parsed.params.maxContext,
      messageCount: histAll.length + (o.userText ? 1 : 0),
      /* 局部变量在引擎上持久（跨轮），和酒馆的聊天变量一样 */
      vars: o.macroVars || {}
    };
    /* 描述里的宏要先展开，{{description}} 引用到的才是展开后的 */
    ctx.charDescription = macros(ctx.charDescription, ctx);
    var wb = (o.worldbook && o.worldbook.buckets) || {};
    var W = global.Worldbook;
    var renderWI = function (list) {
      return W ? W.render(list) : (list || []).map(function (e) { return e.content; }).join('\n\n');
    };

    var history = (o.history || []).slice();
    if (o.userText) history = history.concat([{ role: 'user', content: o.userText, _macro: !!o.userTextMacro }]);

    var out = [], report = [];
    var histStart = -1, histEnd = -1;
    /* 预设块按 prompt_order 的顺序求值宏（包括稍后才插进历史的深度块），
       setvar/getvar 才能前后呼应 */
    parsed.order.forEach(function (p) {
      if (!p.marker) p.content = macros(p.content, ctx);
    });
    function push(role, content, tag, raw) {
      content = (raw ? String(content || '') : macros(content, ctx)).trim();
      if (!content) return;
      out.push({ role: role, content: content });
      report.push({ tag: tag, role: role, chars: content.length });
    }

    parsed.order.forEach(function (p) {
      if (!p.marker) {
        // injection_position 1 = 插进对话历史深处，这里先收集，稍后处理
        if (p.injectionPosition === 1) { p._deferred = true; return; }
        push(p.role, p.content, p.identifier, true);
        return;
      }
      switch (p.identifier) {
        case 'worldInfoBefore':
          push('system', fmt(parsed.params.wiFormat, renderWI(wb.before)), 'WI·before'); break;
        case 'charDescription':
          push('system', ctx.charDescription, 'charDescription'); break;
        case 'charPersonality':
          push('system', fmt(parsed.params.personalityFormat, d.personality), 'charPersonality'); break;
        case 'scenario':
          push('system', fmt(parsed.params.scenarioFormat, d.scenario), 'scenario'); break;
        case 'personaDescription':
          push('system', ctx.personaDescription, 'personaDescription'); break;
        case 'worldInfoAfter':
          push('system', fmt(parsed.params.wiFormat, renderWI(wb.after)), 'WI·after'); break;
        case 'dialogueExamples':
          push('system', d.mes_example || '', 'dialogueExamples'); break;
        case 'chatHistory':
          // 作者注释(AN)与深度注入都锚在历史上
          push('system', renderWI(wb.anTop), 'WI·AN顶');
          histStart = out.length;
          injectHistory(out, report, history, wb.atDepth, parsed, ctx);
          histEnd = out.length;
          push('system', renderWI(wb.anBottom), 'WI·AN底');
          break;
      }
    });

    /* 预设里 injection_position=1 的块，按 depth 插进**对话历史**里：
       深度从历史最后一条往前数（0 = 最新一条之后）。
       以前是从整个 messages 的末尾数，历史后面还有破限/后置指令块时位置就错了。 */
    parsed.order.filter(function (p) { return p._deferred; })
      .sort(function (a, b) { return a.injectionOrder - b.injectionOrder; })
      .forEach(function (p) {
        var at = histEnd >= 0
          ? Math.max(histStart, histEnd - p.injectionDepth)
          : Math.max(0, out.length - p.injectionDepth);
        var msg = { role: p.role, content: String(p.content || '').trim() };
        if (msg.content) {
          out.splice(at, 0, msg);
          if (histEnd >= 0 && at <= histEnd) histEnd++;
          report.push({ tag: p.identifier + '@depth' + p.injectionDepth,
                        role: p.role, chars: msg.content.length });
        }
      });

    if (o.extraSystem) push('system', o.extraSystem, 'extraSystem');

    var messages = parsed.params.squashSystem ? squash(out) : out;
    return {
      messages: messages,
      params: parsed.params,
      report: {
        blocks: report,
        totalChars: messages.reduce(function (s, m) { return s + m.content.length; }, 0),
        messageCount: messages.length,
        estTokens: Math.round(messages.reduce(function (s, m) {
          return s + estTokens(m.content); }, 0))
      }
    };
  }

  function injectHistory(out, report, history, atDepth, parsed, ctx) {
    var W = global.Worldbook;
    var depthMap = {};
    (atDepth || []).forEach(function (e) {
      var dp = Number(e.depth) || 4;
      (depthMap[dp] = depthMap[dp] || []).push(e);
    });
    var total = history.length;
    history.forEach(function (m, i) {
      var fromEnd = total - i;
      if (depthMap[fromEnd]) {
        var txt = W ? W.render(depthMap[fromEnd]) : '';
        if (txt) {
          out.push({ role: 'system', content: txt });
          report.push({ tag: 'WI@depth' + fromEnd, role: 'system', chars: txt.length });
        }
      }
      /* _macro：正则往这条消息里塞了宏（{{getvar::…}}），要完整展开；
         预设块已经先求值过，setvar 设的值这时都在了 */
      var c = (m._macro ? macros(m.content, ctx) : simpleMacros(m.content, ctx)).trim();
      if (!c) return;
      out.push({ role: m.role, content: c });
      report.push({ tag: 'history', role: m.role, chars: c.length });
    });
    if (depthMap[0]) {
      var t0 = W ? W.render(depthMap[0]) : '';
      if (t0) {
        out.push({ role: 'system', content: t0 });
        report.push({ tag: 'WI@depth0', role: 'system', chars: t0.length });
      }
    }
  }

  /** 相邻 system 合并，减少消息条数 */
  function squash(list) {
    var out = [];
    list.forEach(function (m) {
      var last = out[out.length - 1];
      if (last && last.role === 'system' && m.role === 'system') {
        last.content += '\n\n' + m.content;
      } else out.push({ role: m.role, content: m.content });
    });
    return out;
  }

  /** token 计数。core/tokens.js 把分词器加载好了就用真实 BPE，
      否则退回老的粗估（CJK 1 字 1 token，拉丁 4 字符 1 token）。
      实测粗估整体偏低约 11%，短剧本行能低估三成多。 */
  function estTokens(s, model) {
    if (global.Tokens) return global.Tokens.count(s, model);
    s = String(s || '');
    var cjk = (s.match(/[\u4e00-\u9fa5\u3040-\u30ff]/g) || []).length;
    return cjk + (s.length - cjk) / 4;
  }

  global.PromptBuilder = {
    MARKERS: MARKERS, parsePreset: parsePreset, build: build, macros: macros,
    orderOf: orderOf, textOf: textOf, triggerOk: triggerOk,
    estTokens: estTokens, squash: squash
  };
})(typeof window !== 'undefined' ? window : globalThis);
