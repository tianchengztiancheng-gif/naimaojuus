/* ============================================================
 * core/cardres.js —— 载入角色卡时，**从卡里直接读出素材表**
 *
 * 为什么有这个文件
 * ----------------
 * 以前立绘表/场景表/手机资源是靠 tools/build-juus.py 这个 Python 脚本
 * **离线**从卡里抽出来，生成 resource/juus/*.js，再由 index.html 静态加载。
 * 于是出现一个很别扭的局面：用户在开场引导里把角色卡载进去了，
 * 引擎却只从卡里读了世界书和正则，立绘一张都没读 —— 因为那一步压根不存在。
 * 没有预生成文件的话（比如刚从 git 克隆下来），舞台就是空的。
 *
 * 数据本来就在卡里，没有任何理由非要先跑一遍 Python。这个模块把那套抽取逻辑
 * 搬到运行时，载卡时跑一遍，几十毫秒的事。
 *
 * resource/juus/*.js 现在是**纯可选的加速项**：有就先装上，
 * 载卡后卡里抽出来的会覆盖同名条目（以卡为准，它才是真源）。
 *
 * 数据在卡里的什么位置
 * --------------------
 *   立绘 / 场景   data.extensions.regex_scripts[] 里 scriptName 含「gal MVU」那条，
 *                 它的 replaceString 是一段 JS 源码，里面有：
 *                   var EXPRESSION_MAP = { 角色: { 服装: { 表情: url|[url...] } } }
 *                   var SCENE_MAP      = { "地点(时段)": url }
 *                   var DEFAULT_SPRITES= { 角色: url|[url...] }
 *   手机资源      data.extensions.tavern_helper.scripts[] 里 name 为「juus小手机」那条，
 *                 content 里有 AVATARS / STICKERS / DEFAULT_AVATARS /
 *                 GROUP_META / FACTION_MEMBERS / BASE_POSTS / BASE_TRENDS / BASE_AREA
 *
 * 这些是 juus 卡的约定。**按名字找不到就按内容找**（见 findSource），
 * 所以改过脚本名的分叉卡也能认；完全没有这些变量的卡就返回 0，不报错。
 *
 * ⚠ 关于「执行卡里的代码」
 * ------------------------
 * 抽出来的是一段对象字面量。解析顺序是：
 *   1) JSON.parse —— 严格 JSON，绝大多数情况走这条，不执行任何代码
 *   2) 放宽后再 JSON.parse —— 去注释、补引号、删尾逗号，仍然不执行代码
 *   3) new Function 求值 —— 只有前两条都失败才用
 * 第 3 条确实是在执行卡里的代码。之所以留着，是因为 GROUP_META 这类字面量里会
 * **引用别的变量**（FACTION_MEMBERS），前两条解析不了。
 * 权衡：卡是用户自己从本机选的文件，而且引擎本来就会跑卡自带的正则脚本，
 * 信任级别是一样的。介意的话把 opt.evalFallback 设成 false，
 * 那样第 3 条会被跳过，解析不了的条目直接丢掉。
 * ============================================================ */
(function (global) {
  'use strict';

  /* 「游乐场(朝)」拆成 地点=游乐场 / 时段=朝；
     括号里不是时段词的（「卧室(床上)」）并进地点名。与 build-juus.py 保持一致。 */
  var PERIODS = {
    '朝': 1, '午': 1, '夜': 1, '清晨': 1, '早': 1, '晚': 1,
    '黄昏': 1, '白日': 1, '夜晚': 1, '日': 1, '傍晚': 1
  };
  var DEFAULT_PERIOD = '白日';

  /* ---------- 从一段 JS 源码里抠出 `var NAME = <字面量>` ---------- */

  /**
   * 括号配平地截出字面量。跳过字符串和注释里的括号 ——
   * 不跳的话，URL 里一个 `}` 就能把截取位置带歪。
   * @returns {string|null} 含首尾括号的源码片段
   */
  function literalAfter(src, name) {
    var re = new RegExp('(?:^|[^\\w$])(?:var|let|const)\\s+' +
                        name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=');
    var m = re.exec(src);
    if (!m) return null;
    var i = src.indexOf('=', m.index) + 1;

    var depth = 0, start = -1;
    var inStr = null, esc = false;
    for (var k = i; k < src.length; k++) {
      var c = src.charAt(k);

      if (inStr) {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '/' && src.charAt(k + 1) === '/') {
        k = src.indexOf('\n', k); if (k < 0) break; continue;
      }
      if (c === '/' && src.charAt(k + 1) === '*') {
        k = src.indexOf('*/', k); if (k < 0) break; k++; continue;
      }
      if (c === '{' || c === '[') {
        if (depth === 0) start = k;
        depth++;
      } else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0 && start >= 0) return src.slice(start, k + 1);
        if (depth < 0) return null;
      }
    }
    return null;
  }

  /** 把「差不多是 JSON」的源码放宽成 JSON：去注释、单引号转双引号、裸键补引号、删尾逗号 */
  function relax(src) {
    var out = '', inStr = null, esc = false;
    for (var i = 0; i < src.length; i++) {
      var c = src.charAt(i);
      if (inStr) {
        if (esc) { out += c; esc = false; continue; }
        if (c === '\\') { out += c; esc = true; continue; }
        if (c === inStr) { out += '"'; inStr = null; continue; }
        if (c === '"' && inStr === "'") { out += '\\"'; continue; }
        out += c;
        continue;
      }
      if (c === '"' || c === "'") { inStr = c; out += '"'; continue; }
      if (c === '/' && src.charAt(i + 1) === '/') {
        i = src.indexOf('\n', i); if (i < 0) break; out += '\n'; continue;
      }
      if (c === '/' && src.charAt(i + 1) === '*') {
        i = src.indexOf('*/', i); if (i < 0) break; i++; continue;
      }
      out += c;
    }
    /* 裸键补引号：{ foo: 1 } / , bar: 2 → { "foo": 1 } */
    out = out.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
    /* 尾逗号 */
    out = out.replace(/,(\s*[}\]])/g, '$1');
    return out;
  }

  /**
   * 解析一个字面量，三级降级。
   * @param {Object} [deps] 字面量里可能引用到的变量（名 → 源码片段），只给第 3 级用
   */
  function parseLiteral(src, deps, allowEval) {
    if (src == null) return null;
    try { return JSON.parse(src); } catch (e) { /* 下一级 */ }
    try { return JSON.parse(relax(src)); } catch (e2) { /* 下一级 */ }
    if (allowEval === false) return null;
    try {
      var names = [], vals = [], k;
      for (k in (deps || {})) {
        if (!deps.hasOwnProperty(k) || deps[k] == null) continue;
        names.push(k);
        vals.push(parseLiteral(deps[k], null, allowEval));
      }
      /* eslint-disable-next-line no-new-func */
      var f = new Function(names.join(','), 'return (' + src + ');');
      return f.apply(null, vals);
    } catch (e3) { return null; }
  }

  /* ---------- 在卡里定位那两段脚本 ---------- */

  function cardData(card) { return (card && (card.data || card)) || {}; }

  /**
   * 先按名字找，找不到就按内容找 —— 分叉卡常把脚本改名，
   * 但变量名是代码里到处引用的，不会随便改。
   */
  function findSource(list, getName, getBody, nameHint, probe) {
    var arr = Array.isArray(list) ? list : [];
    var i, body;
    for (i = 0; i < arr.length; i++) {
      if (String(getName(arr[i]) || '').indexOf(nameHint) >= 0) {
        body = String(getBody(arr[i]) || '');
        if (probe.test(body)) return body;
      }
    }
    for (i = 0; i < arr.length; i++) {
      body = String(getBody(arr[i]) || '');
      if (probe.test(body)) return body;
    }
    return '';
  }

  function galSource(card) {
    var d = cardData(card);
    return findSource((d.extensions && d.extensions.regex_scripts) || [],
      function (r) { return r.scriptName; },
      function (r) { return r.replaceString; },
      'gal MVU', /(?:var|let|const)\s+(?:EXPRESSION_MAP|DEFAULT_SPRITES|SCENE_MAP)\s*=/);
  }

  function phoneSource(card) {
    var d = cardData(card);
    var th = (d.extensions && d.extensions.tavern_helper) || {};
    return findSource(th.scripts || [],
      function (s) { return s.name; },
      function (s) { return s.content; },
      '小手机', /(?:var|let|const)\s+(?:AVATARS|STICKERS|DEFAULT_AVATARS)\s*=/);
  }

  /* ---------- 归一化 ---------- */

  function asList(v) {
    if (v == null) return [];
    if (Array.isArray(v)) return v.filter(function (x) { return !!x; });
    return [v];
  }

  /** EXPRESSION_MAP → { 角色: { default_outfit, outfits: { 服装: { 表情: [url] } } } } */
  function normChars(expr) {
    var out = {};
    if (!expr || typeof expr !== 'object') return out;
    Object.keys(expr).forEach(function (name) {
      var outfits = expr[name];
      if (!outfits || typeof outfits !== 'object') return;
      var norm = {}, first = null;
      Object.keys(outfits).forEach(function (o) {
        var table = outfits[o];
        if (!table || typeof table !== 'object') return;
        var e2 = {}, any = false;
        Object.keys(table).forEach(function (ex) {
          var urls = asList(table[ex]);
          if (urls.length) { e2[ex] = urls; any = true; }
        });
        if (any) { norm[o] = e2; if (first == null) first = o; }
      });
      if (first != null) out[name] = { default_outfit: first, outfits: norm };
    });
    return out;
  }

  /** SCENE_MAP「地点(时段)」→ { 地点: { 时段: url } } */
  function normScenes(sceneMap) {
    var out = {};
    if (!sceneMap || typeof sceneMap !== 'object') return out;
    Object.keys(sceneMap).forEach(function (key) {
      var url = sceneMap[key];
      if (!url) return;
      var k = String(key).trim();
      var m = /^(.*?)[（(]([^（()）]*)[)）]$/.exec(k);
      var loc = k, period = DEFAULT_PERIOD;
      if (m && PERIODS[m[2]]) { loc = m[1].trim(); period = m[2]; }
      if (!loc) return;
      if (!out[loc]) out[loc] = {};
      out[loc][period] = url;
    });
    return out;
  }

  function normDefaults(defs) {
    var out = {};
    if (!defs || typeof defs !== 'object') return out;
    Object.keys(defs).forEach(function (name) {
      var urls = asList(defs[name]);
      if (urls.length) out[name] = urls;
    });
    return out;
  }

  /* ---------- 对外 ---------- */

  /**
   * 只抽取，不改全局。想先看看卡里有什么就用它。
   * @returns {{resource:{characters,scenes,defaults}, phone:Object, stats:Object}}
   */
  function extract(card, opt) {
    opt = opt || {};
    var ev = opt.evalFallback !== false;

    var gal = galSource(card);
    var chars = normChars(parseLiteral(literalAfter(gal, 'EXPRESSION_MAP'), null, ev));
    var scenes = normScenes(parseLiteral(literalAfter(gal, 'SCENE_MAP'), null, ev));
    var defs = normDefaults(parseLiteral(literalAfter(gal, 'DEFAULT_SPRITES'), null, ev));

    var ph = phoneSource(card);
    var phone = {};
    if (ph) {
      /* GROUP_META 的字面量里会引用 FACTION_MEMBERS，求值时得把它带进作用域 */
      var deps = { FACTION_MEMBERS: literalAfter(ph, 'FACTION_MEMBERS') };
      [['avatars', 'AVATARS'], ['stickers', 'STICKERS'],
       ['defaultAvatars', 'DEFAULT_AVATARS'], ['groupMeta', 'GROUP_META'],
       ['basePosts', 'BASE_POSTS'], ['baseTrends', 'BASE_TRENDS'],
       ['baseArea', 'BASE_AREA']].forEach(function (pair) {
        var v = parseLiteral(literalAfter(ph, pair[1]), deps, ev);
        if (v != null) phone[pair[0]] = v;
      });
    }

    function count(o) { return o ? Object.keys(o).length : 0; }
    function sprites(o) {
      var n = 0;
      Object.keys(o || {}).forEach(function (k) {
        var ofs = o[k].outfits || {};
        Object.keys(ofs).forEach(function (f) {
          Object.keys(ofs[f]).forEach(function (e) { n += ofs[f][e].length; });
        });
      });
      return n;
    }
    function flat(o) {
      var n = 0;
      Object.keys(o || {}).forEach(function (k) { n += o[k].length; });
      return n;
    }
    function scn(o) {
      var n = 0;
      Object.keys(o || {}).forEach(function (k) { n += Object.keys(o[k]).length; });
      return n;
    }

    return {
      resource: { characters: chars, scenes: scenes, defaults: defs },
      phone: phone,
      stats: {
        found: !!(gal || ph),
        chars: count(chars), sprites: sprites(chars),
        defaultChars: count(defs), defaultSprites: flat(defs),
        locations: count(scenes), scenes: scn(scenes),
        avatars: count(phone.avatars), stickers: count(phone.stickers),
        groups: count(phone.groupMeta),
        posts: (phone.basePosts || []).length, trends: (phone.baseTrends || []).length
      }
    };
  }

  /**
   * 抽取并**就地合并**进 window.RESOURCE / window.PHONE_RES。
   *
   * 必须就地合并，不能整个替换 —— core/resolver.js 在加载时就抓住了
   * window.RESOURCE 的引用（`var R = global.RESOURCE = ...`），
   * 换掉对象它就看不见新数据了。
   *
   * 卡里的覆盖预生成文件里的同名条目：卡才是真源。
   */
  function apply(card, opt) {
    var got = extract(card, opt);

    var R = global.RESOURCE = global.RESOURCE ||
      { characters: {}, scenes: {}, defaults: {} };
    R.characters = R.characters || {};
    R.scenes = R.scenes || {};
    R.defaults = R.defaults || {};

    Object.assign(R.characters, got.resource.characters);
    Object.assign(R.defaults, got.resource.defaults);
    /* 场景要按地点合并，不能整个覆盖 —— 否则卡里有「食堂(朝)」
       就会把预生成文件里的「食堂(夜)」一起顶掉。 */
    Object.keys(got.resource.scenes).forEach(function (loc) {
      R.scenes[loc] = Object.assign({}, R.scenes[loc], got.resource.scenes[loc]);
    });

    var P = global.PHONE_RES = global.PHONE_RES || {};
    Object.keys(got.phone).forEach(function (k) {
      var v = got.phone[k];
      if (Array.isArray(v)) P[k] = v;
      else if (v && typeof v === 'object') P[k] = Object.assign({}, P[k], v);
      else P[k] = v;
    });

    return got.stats;
  }

  global.CardRes = {
    extract: extract, apply: apply,
    /* 下面这些导出只为单测，正常用不到 */
    _literalAfter: literalAfter, _relax: relax, _parseLiteral: parseLiteral,
    _normChars: normChars, _normScenes: normScenes, _normDefaults: normDefaults
  };
})(typeof window !== 'undefined' ? window : globalThis);
