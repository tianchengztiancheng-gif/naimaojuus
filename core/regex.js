/* ============================================================
 * core/regex.js —— 酒馆（SillyTavern）正则脚本的独立实现
 *
 * 为什么要有这一层：
 *   酒馆的预设常常自带正则（preset.extensions.regex_scripts），
 *   最典型的就是「隐藏思维链」—— 预设让模型先写 <thinking>…</thinking>
 *   再写正文，然后靠一条正则把思维链从显示和后续提示词里摘掉。
 *   以前我们只复制了预设的提示词块，没接它的正则，于是思维链整段漏到台词里，
 *   还每轮原样发回给模型，越滚越长。
 *
 * 语义与酒馆保持一致：
 *   placement   1 = 用户输入  2 = AI 输出  5 = 世界书  6 = 推理块
 *   markdownOnly / promptOnly 都不勾 → 直接改消息本身（显示和提示词都生效）
 *   只勾 markdownOnly               → 只改显示
 *   只勾 promptOnly                 → 只改发给模型的提示词
 *   两个都勾                         → 显示和提示词都改，存档原文不动
 *   minDepth / maxDepth             → 按「距最新消息几条」筛选（0 = 最新一条）
 *   trimStrings                     → 先从匹配里删掉这些字符串再替换
 *   {{match}} / $1 / $<name>        → 整段匹配 / 捕获组
 *
 * 和酒馆唯一的不同：我们的舞台不渲染 HTML。
 *   替换成 <details> 折叠块的（「折叠思维链」那类）→ 当作隐藏，直接删掉；
 *   替换成其它 HTML 的（美化、状态栏渲染器）→ 跳过，否则标签会混进剧本行。
 * ============================================================ */
(function (global) {
  'use strict';

  var PLACE = { USER: 1, AI: 2, SLASH: 3, WORLD_INFO: 5, REASONING: 6 };
  var MAX_REPLACE = 2000;

  /** "/body/flags" 或裸正则串 → RegExp。JS 不支持的旗标（x U A J X）丢掉 */
  function parseFind(find, forceGlobal) {
    find = String(find == null ? '' : find);
    if (!find.trim()) return null;           // 空正则会在每个字符缝隙匹配，见交接文档
    var body = find, flags = '';
    var m = find.match(/^\/([\s\S]+)\/([a-zA-Z]*)$/);
    if (m) { body = m[1]; flags = m[2]; }
    flags = flags.replace(/[^gimsuy]/g, '');
    flags = flags.split('').filter(function (c, i, a) { return a.indexOf(c) === i; }).join('');
    if (forceGlobal && flags.indexOf('g') === -1) flags += 'g';
    try { return new RegExp(body, flags); } catch (e) { return null; }
  }

  function pickF() {
    for (var i = 0; i < arguments.length; i++) if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
    return undefined;
  }

  function num(v) { var n = Number(v); return (v === null || v === '' || isNaN(n)) ? null : n; }

  /** 把一条原始脚本整理成内部格式。拿不到可用正则就返回 null */
  function normalize(r, source, idx, opt) {
    if (!r || typeof r !== 'object') return null;
    opt = opt || {};
    /* 字段名有驼峰（酒馆本体）和下划线（部分导出工具、KT）两套 */
    var findRaw = pickF(r.findRegex, r.find_regex, r.find);
    var repRaw = pickF(r.replaceString, r.replace_string, r.replace);
    var trimRaw = pickF(r.trimStrings, r.trim_strings);
    var re = parseFind(findRaw, opt.forceGlobal);
    var rep = String(repRaw == null ? '' : repRaw);
    var placement = Array.isArray(r.placement) ? r.placement.map(Number)
      : (r.placement != null && !isNaN(Number(r.placement)) ? [Number(r.placement)] : []);
    var s = {
      id: source + ':' + (r.id || idx),
      name: r.scriptName || r.script_name || r.name || '(无名正则)',
      source: source,
      find: String(findRaw || ''),
      re: re,
      rep: rep,
      /* 1 = 查找正则里的 {{宏}} 原样替换，2 = 替换后转义。酒馆里常用来写 {{char}} */
      substitute: Number(r.substituteRegex || 0),
      trim: Array.isArray(trimRaw) ? trimRaw.filter(Boolean).map(String) : [],
      placement: placement,
      markdownOnly: !!r.markdownOnly,
      promptOnly: !!r.promptOnly,
      minDepth: num(r.minDepth),
      maxDepth: num(r.maxDepth),
      disabled: r.disabled === true || r.disabled === 1 || r.disabled === 'true',
      skip: ''
    };
    if (!re && s.substitute && s.find.trim()) s.re = null;            // 要等宏替换后才编译
    else if (!re) s.skip = s.find.trim() ? '正则写法 JS 不支持' : '没有查找正则';
    else if (rep.length > MAX_REPLACE) s.skip = '替换内容是渲染器（' + rep.length + ' 字），我们有自己的舞台';
    else if (/<details[\s>]/i.test(rep)) s.hideHtml = true;        // 折叠块 = 隐藏
    else if (/<\/?[a-z][a-z0-9-]*(\s[^<>]*)?>/i.test(rep)) s.htmlOnly = true;
    return s;
  }

  /** 数组，或者 { id: 脚本 } 这种对象映射（一些导出是这样），都转成数组 */
  function asList(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object' && !('findRegex' in raw) && !('find_regex' in raw)) {
      return Object.keys(raw).map(function (k) {
        var v = raw[k];
        return v && typeof v === 'object' && v.id == null ? Object.assign({ id: k }, v) : v;
      });
    }
    return [];
  }

  function collect(list, source, opt) {
    return asList(list).map(function (r, i) {
      return normalize(r, source, i, opt);
    }).filter(Boolean);
  }

  /* 预设正则可能存放的位置。酒馆本体是 extensions.regex_scripts；
     社区扩展 SPreset 的「正则绑定」存在 extensions.SPreset.RegexBinding 下；
     也有导出工具直接放顶层。都找一遍，按内容去重。（路径表参考了 KaiTuoYiShi） */
  var PRESET_PATHS = [
    ['regex_scripts'], ['regexScripts'],
    ['extensions', 'regex_scripts'], ['extensions', 'regexScripts'],
    ['extensions', 'RegexBinding', 'regexes'], ['extensions', 'RegexBinding', 'regex_scripts'],
    ['extensions', 'RegexBinding', 'scripts'],
    ['extensions', 'SPreset', 'RegexBinding', 'regexes'], ['extensions', 'SPreset', 'RegexBinding', 'regex_scripts'],
    ['extensions', 'SPreset', 'RegexBinding', 'scripts'],
    ['extensions', 'SPreset', 'regex_scripts'], ['extensions', 'SPreset', 'regexScripts']
  ];

  function rawFromPreset(preset) {
    var out = [], seen = {};
    PRESET_PATHS.forEach(function (path) {
      var cur = preset;
      for (var i = 0; i < path.length && cur; i++) cur = cur[path[i]];
      asList(cur).forEach(function (r) {
        if (!r || typeof r !== 'object') return;
        var k = [r.id, r.scriptName || r.script_name, r.findRegex || r.find_regex, r.replaceString || r.replace_string].join('\u0000');
        if (seen[k]) return;
        seen[k] = 1; out.push(r);
      });
    });
    return out;
  }

  function fromPreset(preset) {
    return collect(rawFromPreset(preset || {}), 'preset');
  }

  function fromCard(card) {
    var d = (card && (card.data || card)) || {};
    return collect((d.extensions && d.extensions.regex_scripts) || [], 'card');
  }

  /** 单独导入的正则文件：酒馆导出的单条对象、数组、或 {regex_scripts:[…]} 都认 */
  function fromImport(json) {
    if (Array.isArray(json)) return json;
    if (json && (json.findRegex != null || json.find_regex != null)) return [json];
    /* 整份预设 / 角色卡拖进来也认：从里面把正则抠出来 */
    var fromP = rawFromPreset(json || {});
    if (fromP.length) return fromP;
    var d = json && (json.data || json);
    return (d && d.extensions && asList(d.extensions.regex_scripts)) || [];
  }

  /** 这条脚本在这个场合该不该跑 */
  function eligible(s, opt) {
    if (!s || s.disabled || s.skip || (!s.re && !s.substitute)) return false;
    if (opt.placement != null && s.placement.length && s.placement.indexOf(opt.placement) === -1) return false;
    var plain = !s.markdownOnly && !s.promptOnly;
    if (opt.mode === 'display' && !(plain || s.markdownOnly)) return false;
    if (opt.mode === 'prompt' && !(plain || s.promptOnly)) return false;
    if (opt.mode === 'display' && s.htmlOnly) return false;
    if (typeof opt.depth === 'number') {
      if (s.minDepth != null && s.minDepth >= -1 && opt.depth < s.minDepth) return false;
      if (s.maxDepth != null && s.maxDepth >= 0 && opt.depth > s.maxDepth) return false;
    }
    return true;
  }

  function simpleMacros(t, ctx) {
    ctx = ctx || {};
    return String(t)
      .replace(/\{\{char\}\}/gi, ctx.charName || '')
      .replace(/\{\{user\}\}/gi, ctx.userName || 'User');
  }

  function escRe(x) { return String(x).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

  function applyOne(text, s, ctx) {
    var rep = s.hideHtml ? '' : s.rep;
    var re = s.re;
    if (s.substitute) {
      var c2 = ctx || {};
      var f = String(s.find)
        .replace(/\{\{char\}\}/gi, s.substitute === 2 ? escRe(c2.charName || '') : (c2.charName || ''))
        .replace(/\{\{user\}\}/gi, s.substitute === 2 ? escRe(c2.userName || 'User') : (c2.userName || 'User'));
      re = parseFind(f, false);
      if (!re) return text;
    }
    re.lastIndex = 0;
    var out = String(text).replace(re, function () {
      var args = Array.prototype.slice.call(arguments);
      var named = typeof args[args.length - 1] === 'object' ? args.pop() : null;
      args.pop(); args.pop();                               // offset, 原串
      var match = args[0];
      function trimmed(v) {
        v = v == null ? '' : String(v);
        s.trim.forEach(function (t) { v = v.split(t).join(''); });
        return v;
      }
      var r = rep.replace(/\{\{match\}\}/gi, '$0');
      r = r.replace(/\$<([^>]+)>/g, function (m0, name) {
        return named && named[name] != null ? trimmed(named[name]) : '';
      });
      r = r.replace(/\$(\d{1,2})/g, function (m0, n) {
        n = Number(n);
        if (n === 0) return trimmed(match);
        return n < args.length ? trimmed(args[n]) : '';
      });
      return simpleMacros(r, ctx);
    });
    re.lastIndex = 0;
    return out;
  }

  /**
   * 跑一组脚本。
   * @param {string} text
   * @param {Array} scripts normalize 过的脚本
   * @param {object} opt { placement, mode:'display'|'prompt'|'store', depth, ctx, applied:[] }
   */
  function run(text, scripts, opt) {
    opt = opt || {};
    text = String(text == null ? '' : text);
    (scripts || []).forEach(function (s) {
      if (!eligible(s, opt)) return;
      try {
        var before = text;
        text = applyOne(text, s, opt.ctx);
        if (opt.applied && before !== text) opt.applied.push(s.name);
      } catch (e) {}
    });
    return text;
  }

  /* ------------------------------------------------------------
     思维链兜底：不靠预设，常见写法一律先剥掉。
     预设正则只认它自己那个标签名；模型偶尔换个名字、或者被截断没写闭合标签，
     整段推理就漏出来。这一层专门接住这些。
     ------------------------------------------------------------ */
  var COT_NAMES = '(?:think|thinking|thought|thoughts|reasoning|cot|[A-Za-z]+_cot|思考|思维链|思维|思考过程|内心思考)';
  var COT_PAIR = new RegExp('<(' + COT_NAMES + ')(?:\\s[^<>]*)?>[\\s\\S]*?<\\/\\1\\s*>', 'gi');
  var COT_OPEN = new RegExp('<' + COT_NAMES + '(?:\\s[^<>]*)?>', 'i');
  var COT_CLOSE = new RegExp('<\\/' + COT_NAMES + '\\s*>', 'gi');
  /* 正文开始的标志：<content>、『地点』抬头、剧本行「台词|角色|」、<Gal>、<背景|> */
  var BODY_START = /<content>|<Gal>|『|<背景\s*\||^[^\n|<>]{1,300}\|[^\n|]{1,40}\|/m;

  /**
   * @returns {{text, stripped:boolean, unclosed:boolean, onlyReasoning:boolean}}
   */
  function stripReasoning(text) {
    text = String(text == null ? '' : text);
    var orig = text;
    var unclosed = false;
    text = text.replace(COT_PAIR, '');
    /* 只有闭合标签没有开头（DeepSeek 一类经由某些中转时开头被吃掉）：闭合之前全是推理 */
    COT_CLOSE.lastIndex = 0;
    var lastClose = -1, m;
    while ((m = COT_CLOSE.exec(text))) lastClose = m.index + m[0].length;
    if (lastClose >= 0 && !COT_OPEN.test(text.slice(0, lastClose))) text = text.slice(lastClose);
    /* 开了没关：被截断或模型忘了闭合。找正文起点，找不到就整段都是推理 */
    var open = text.match(COT_OPEN);
    if (open) {
      unclosed = true;
      var at = open.index;
      var rest = text.slice(at + open[0].length);
      var b = rest.search(BODY_START);
      text = text.slice(0, at) + (b >= 0 ? rest.slice(b) : '');
    }
    var stripped = text !== orig;
    return {
      text: stripped ? text.replace(/^\s+/, '') : text,
      stripped: stripped,
      unclosed: unclosed,
      onlyReasoning: stripped && !text.trim()
    };
  }

  /* ------------------------------------------------------------
     预设里「注入 + 清理」配对的占位块。
     很多中文预设为了抗空回、抗截断，让模型在正文前后输出一段固定内容：
       <Q>…</WF>        抗空回的声明
       <math>…</math>   抗截断的「高数题」占位
       <!-- … -->       注释
     这些预设原本配了清理正则；没导入、或者正则没写对，就会原样演在台词里。
     这里兜底整段删掉。（规则参考了 KaiTuoYiShi 的 textSanitizer）
     ------------------------------------------------------------ */
  var PLACEHOLDER_BLOCKS = [
    { name: '抗空回声明', re: /<Q>[\s\S]*?<\/WF>/g },
    { name: '抗截断占位', re: /<math>[\s\S]*?<\/math>/gi },
    { name: 'HTML 注释', re: /<!--[\s\S]*?-->/g }
  ];
  /** keepComments：给模型看的历史里保留 HTML 注释 —— 有些预设拿注释藏状态给模型看，
      酒馆也只是在显示时隐藏注释，发给模型时是带着的 */
  function stripPlaceholders(text, applied, keepComments) {
    text = String(text == null ? '' : text);
    PLACEHOLDER_BLOCKS.forEach(function (b) {
      if (keepComments && b.name === 'HTML 注释') return;
      var before = text;
      text = text.replace(b.re, '');
      if (applied && before !== text) applied.push(b.name);
    });
    return text;
  }

  /** 试跑：不改任何状态，返回替换前后与命中次数。预设面板的「试跑」用 */
  function dryRun(s, sample, ctx) {
    var n = 0, after = String(sample || '');
    try {
      if (!s.re && !s.substitute) return { ok: false, error: s.skip || '没有可用的正则', after: after, matches: 0 };
      var probe = Object.assign({}, s, { rep: s.rep, re: s.re && new RegExp(s.re.source, s.re.flags.indexOf('g') < 0 ? s.re.flags + 'g' : s.re.flags) });
      if (probe.re) { var m = String(sample || '').match(probe.re); n = m ? m.length : 0; }
      after = applyOne(sample, s, ctx);
      return { ok: true, after: after, matches: n };
    } catch (e) { return { ok: false, error: e.message, after: after, matches: n }; }
  }

  global.GalRegex = {
    PLACE: PLACE, parseFind: parseFind, normalize: normalize, collect: collect,
    fromPreset: fromPreset, fromCard: fromCard, fromImport: fromImport,
    eligible: eligible, run: run, applyOne: applyOne, stripReasoning: stripReasoning,
    stripPlaceholders: stripPlaceholders, dryRun: dryRun, rawFromPreset: rawFromPreset, asList: asList
  };
})(typeof window !== 'undefined' ? window : globalThis);
