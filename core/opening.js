/* ============================================================
 * core/opening.js —— 自定义开场（v5.25）
 *
 * 卡里的开场白是写死的几段。自定义开场让玩家自己定：
 *   · 你是谁（身份预设 + 自己写的设定）
 *   · 在哪、什么时候（地点从场景表里挑，时段、第几天）
 *   · 谁在场（从全部有立绘的舰娘里挑，每人可调好感度、誓约、服装、当前状态、一句备注）
 *   · 发生了什么（事件预设 + 自己写）
 *   · 开场方式：让 AI 按这些设定写开场；或者直接开始，玩家先说话
 *
 * 这里只做纯逻辑（好测）：规整输入、生成初始变量、生成开场剧本、生成给 AI 的开场指令、
 * 模板的存取。界面在 app.js「自定义开场」一节。
 * ============================================================ */
(function (global) {
  'use strict';

  var TPL_KEY = 'gal_custom_openings';
  var MAX_CAST = 6;

  var IDENTITIES = [
    { k: 'new', t: '新上任的指挥官', d: '刚从学院毕业，今天第一天到港区报到。对港区的一切都很陌生，舰娘们也还不认识我。' },
    { k: 'vet', t: '港区老指挥官', d: '在这个港区当了好几年指挥官，和大家都很熟，港区的大事小事都有我一份。' },
    { k: 'back', t: '久别归来', d: '因为任务离开港区很久，今天刚回来。有人想念我，有人还在生我的气。' },
    { k: 'incog', t: '微服私访', d: '以普通后勤人员的身份混进港区，舰娘们还不知道我就是新来的指挥官。' },
    { k: 'custom', t: '自己写', d: '' }
  ];

  var EVENTS = [
    { t: '港区日常', d: '平平常常的一天，大家各忙各的，指挥官在港区里走动。' },
    { t: '出击归来', d: '舰队刚结束一场出击回港，有人受了点轻伤，大家都很累但很兴奋。' },
    { t: '节日庆典', d: '港区在办庆典，到处挂着彩灯，食堂和商店街都热闹起来。' },
    { t: '突发事件', d: '港区里出了点意外状况，需要指挥官马上处理。' },
    { t: '约会', d: '约好了一起出去，今天是两个人（或者几个人）的时间。' },
    { t: '演习', d: '今天有阵营间的演习，各舰队都在做准备，气氛有点紧张。' },
    { t: '新人报到', d: '有新舰娘今天到港区报到，大家都来看热闹。' },
    { t: '雨天', d: '外面下着大雨，出不了海，大家都窝在室内。' }
  ];

  var STATES = ['平静', '开心', '害羞', '期待', '紧张', '疲惫', '生气', '困倦', '伤心', '得意'];

  /* 时段 → 开场抬头里写的钟点（剧本解析按钟点定时段） */
  var PERIOD_TIME = { '清晨': '06:30', '朝': '09:00', '白日': '13:00', '午': '13:00', '黄昏': '17:30', '暮': '17:30', '夜': '21:00' };
  var PERIODS = ['清晨', '朝', '白日', '黄昏', '夜'];

  function R() { return global.RESOURCE || {}; }
  function clamp(n, a, b) { n = Number(n); if (!isFinite(n)) n = a; return Math.max(a, Math.min(b, n)); }

  /** 全部能上台的舰娘：有表情差分的排前面，其余按名字 */
  function roster() {
    var C = R().characters || {}, D = R().defaults || {};
    var withExpr = Object.keys(C);
    var rest = Object.keys(D).filter(function (n) { return !C[n]; });
    return withExpr.concat(rest);
  }
  function outfitsOf(name) {
    var c = (R().characters || {})[name];
    return c && c.outfits ? Object.keys(c.outfits) : [];
  }
  function defaultOutfit(name) {
    var c = (R().characters || {})[name];
    return (c && (c.default_outfit || Object.keys(c.outfits || {})[0])) || '常服';
  }
  function scenes() { return Object.keys(R().scenes || {}); }
  function periodsOf(loc) {
    var s = (R().scenes || {})[loc];
    var own = s ? Object.keys(s) : [];
    return own.length ? own : PERIODS.slice();
  }

  /** 把表单里读出来的东西规整一遍：默认值、上下限、去重、人数上限 */
  function normalize(spec) {
    spec = spec || {};
    var out = {
      identity: spec.identity || 'new',
      identityText: String(spec.identityText == null ? '' : spec.identityText).trim(),
      userName: String(spec.userName || '').trim() || '指挥官',
      loc: String(spec.loc || '').trim(),
      period: String(spec.period || '').trim(),
      day: clamp(spec.day == null ? 1 : spec.day, 1, 9999),
      event: String(spec.event || '').trim(),
      eventTitle: String(spec.eventTitle || '').trim(),
      aiOpening: spec.aiOpening !== false,
      cast: []
    };
    if (!out.identityText) {
      var id = IDENTITIES.filter(function (x) { return x.k === out.identity; })[0];
      out.identityText = id ? id.d : '';
    }
    if (!out.loc) out.loc = scenes()[0] || '指挥官办公室';
    if (!out.period) out.period = periodsOf(out.loc)[0] || '白日';
    var seen = {};
    (spec.cast || []).forEach(function (c) {
      var n = String((c && c.name) || '').trim();
      if (!n || seen[n] || out.cast.length >= MAX_CAST) return;
      seen[n] = 1;
      var oath = !!c.oath;
      out.cast.push({
        name: n,
        favor: Math.round(clamp(c.favor == null ? 60 : c.favor, 0, oath ? 200 : 100)),
        oath: oath,
        outfit: String(c.outfit || '').trim() || defaultOutfit(n),
        state: String(c.state || '').trim() || '平静',
        note: String(c.note || '').trim().slice(0, 120)
      });
    });
    return out;
  }

  /** 开局变量：时间 / 地点 / 人物（全员在场） */
  function vars(spec) {
    var s = normalize(spec), people = {};
    s.cast.forEach(function (c) {
      people[c.name] = { 好感度: c.favor, 是否誓约: c.oath, 服装: c.outfit, 当前状态: c.state, 在场: true };
      if (c.note) people[c.name].内心想法 = c.note;
    });
    return { 时间: { 天数: s.day, 时段: s.period }, 地点: s.loc, 人物: people };
  }

  /** 这个状态在她这套服装里有没有同名表情 —— 有就用，没有就让立绘自己挑 */
  function exprFor(c) {
    var ch = (R().characters || {})[c.name];
    var set = ch && ch.outfits && (ch.outfits[c.outfit] || ch.outfits[defaultOutfit(c.name)]);
    return set && set[c.state] ? c.state : '';
  }

  /**
   * 开场剧本（本地生成，不花请求）：抬头 + 背景 + 登场 + 事件旁白。
   * 选了「让 AI 写开场」的话，这一段先演出来，AI 接着往下写。
   */
  function script(spec) {
    var s = normalize(spec);
    var time = PERIOD_TIME[s.period] || '13:00';
    var lines = [];
    lines.push('『✨ 第' + s.day + '天 · ' + time + ' · ' + s.loc + ' ✨』|旁白|-|');
    lines.push('<背景|' + s.loc + '|' + s.period + '>');
    if (s.cast.length) {
      lines.push('<登场|' + s.cast.map(function (c) {
        var e = exprFor(c);
        return c.name + (e ? ':' + e : '');
      }).join('|') + '>');
    }
    var ev = s.event || (s.eventTitle ? s.eventTitle + '。' : '');
    String(ev || '').split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (p) {
      lines.push(p.replace(/\|/g, '｜') + '|旁白|-|');
    });
    if (!ev) lines.push(s.loc + '。' + (s.cast.length ? s.cast.map(function (c) { return c.name; }).join('、') + '都在。' : '') + '|旁白|-|');
    return '<Gal>\n' + lines.join('\n') + '\n</Gal>';
  }

  /** 给 AI 的开场指令：把设定原样交代清楚，让它按正文格式写第一段 */
  function directive(spec) {
    var s = normalize(spec);
    var L = [];
    L.push('【自定义开场 · 请按下面的设定写这个故事的开场】');
    L.push('');
    L.push('我的身份：' + s.userName + (s.identityText ? '。' + s.identityText : ''));
    L.push('时间地点：第' + s.day + '天 · ' + s.period + ' · ' + s.loc);
    if (s.cast.length) {
      L.push('在场的舰娘（都要有戏份，性格照各自设定）：');
      s.cast.forEach(function (c) {
        L.push('- ' + c.name + '：好感度 ' + c.favor + (c.oath ? '（已誓约）' : '') +
          '，服装「' + c.outfit + '」，现在的状态「' + c.state + '」' + (c.note ? '，' + c.note : ''));
      });
    } else {
      L.push('在场的舰娘：暂时没有人，按场景自然安排。');
    }
    if (s.eventTitle || s.event) L.push('发生的事：' + [s.eventTitle, s.event].filter(Boolean).join(' —— '));
    L.push('');
    L.push('要求：接着上面已经摆好的场景往下写开场，按正文格式输出 <Gal>…</Gal>；' +
      '每个在场的舰娘的言行要符合她的好感度和当前状态；结尾给出几个我可以做的选择。');
    return L.join('\n');
  }

  /* ---------------- 模板 ---------------- */
  function templates() {
    try { var a = JSON.parse(global.localStorage.getItem(TPL_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveTemplate(name, spec) {
    name = String(name || '').trim() || ('我的开场 ' + (templates().length + 1));
    var list = templates().filter(function (t) { return t.name !== name; });
    list.unshift({ name: name, spec: normalize(spec), at: Date.now() });
    try { global.localStorage.setItem(TPL_KEY, JSON.stringify(list.slice(0, 30))); } catch (e) {}
    return name;
  }
  function deleteTemplate(name) {
    var list = templates().filter(function (t) { return t.name !== name; });
    try { global.localStorage.setItem(TPL_KEY, JSON.stringify(list)); } catch (e) {}
    return list.length;
  }

  global.Opening = {
    IDENTITIES: IDENTITIES, EVENTS: EVENTS, STATES: STATES, PERIODS: PERIODS, MAX_CAST: MAX_CAST,
    roster: roster, outfitsOf: outfitsOf, defaultOutfit: defaultOutfit, scenes: scenes, periodsOf: periodsOf,
    normalize: normalize, vars: vars, script: script, directive: directive, exprFor: exprFor,
    templates: templates, saveTemplate: saveTemplate, deleteTemplate: deleteTemplate
  };
})(typeof window !== 'undefined' ? window : globalThis);
