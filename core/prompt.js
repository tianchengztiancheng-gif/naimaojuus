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

  /** 解析预设 → { params, order:[{identifier, content, role, marker, depth}] } */
  function parsePreset(preset) {
    preset = preset || {};
    var byId = {};
    (preset.prompts || []).forEach(function (p) { byId[p.identifier] = p; });

    var orderList = (preset.prompt_order && preset.prompt_order[0] &&
                     preset.prompt_order[0].order) || [];
    // 没有 prompt_order 时退化成 prompts 的自然顺序
    if (!orderList.length) {
      orderList = (preset.prompts || []).map(function (p) {
        return { identifier: p.identifier, enabled: p.enabled !== false };
      });
    }

    var order = orderList.filter(function (o) { return o.enabled; })
      .map(function (o) {
        var p = byId[o.identifier] || {};
        return {
          identifier: o.identifier,
          name: p.name || o.identifier,
          marker: !!p.marker,
          role: p.role || 'system',
          content: p.marker ? '' : String(p.content || ''),
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

  /** 宏替换：{{char}} {{user}} {{persona}} 等 */
  function macros(text, ctx) {
    return String(text || '')
      .replace(/\{\{char\}\}/gi, ctx.charName || '')
      .replace(/\{\{user\}\}/gi, ctx.userName || 'User')
      .replace(/\{\{persona\}\}/gi, ctx.personaDescription || '')
      .replace(/\{\{description\}\}/gi, ctx.charDescription || '');
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
    var ctx = {
      charName: o.charName || d.name || '',
      userName: o.userName || 'User',
      personaDescription: o.personaDescription || '',
      charDescription: d.description || ''
    };
    var wb = (o.worldbook && o.worldbook.buckets) || {};
    var W = global.Worldbook;
    var renderWI = function (list) {
      return W ? W.render(list) : (list || []).map(function (e) { return e.content; }).join('\n\n');
    };

    var history = (o.history || []).slice();
    if (o.userText) history = history.concat([{ role: 'user', content: o.userText }]);

    var out = [], report = [];
    function push(role, content, tag) {
      content = macros(content, ctx).trim();
      if (!content) return;
      out.push({ role: role, content: content });
      report.push({ tag: tag, role: role, chars: content.length });
    }

    parsed.order.forEach(function (p) {
      if (!p.marker) {
        // injection_position 1 = 插进对话历史深处，这里先收集，稍后处理
        if (p.injectionPosition === 1) { p._deferred = true; return; }
        push(p.role, p.content, p.identifier);
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
          injectHistory(out, report, history, wb.atDepth, parsed, ctx);
          push('system', renderWI(wb.anBottom), 'WI·AN底');
          break;
      }
    });

    // 预设里 injection_position=1 的块，按 depth 插入历史尾部
    parsed.order.filter(function (p) { return p._deferred; })
      .sort(function (a, b) { return a.injectionOrder - b.injectionOrder; })
      .forEach(function (p) {
        var at = Math.max(0, out.length - p.injectionDepth);
        var msg = { role: p.role, content: macros(p.content, ctx).trim() };
        if (msg.content) {
          out.splice(at, 0, msg);
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
      var c = macros(m.content, ctx).trim();
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
    MARKERS: MARKERS, parsePreset: parsePreset, build: build,
    estTokens: estTokens, squash: squash
  };
})(typeof window !== 'undefined' ? window : globalThis);
