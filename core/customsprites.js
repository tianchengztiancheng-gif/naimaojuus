/* ============================================================
 * core/customsprites.js —— 玩家自己添加的立绘（v5.27）
 *
 * 卡里没有的角色、卡里有但想换成自己画的 / 找的图、想多加一个表情或一套衣服 —— 都在这里加。
 *
 *   数据：{ chars: { 角色: { 服装: { 表情: [图] } } } }
 *         图是 http(s) 地址，或者本地上传后压缩成的 data:image/webp
 *   存储：IndexedDB（GalStore.get/set，键 custom_sprites）。图大，不放 localStorage
 *   生效：apply() 就地合进 window.RESOURCE.characters ——
 *         同一个「角色 / 服装 / 表情」卡里也有的，用玩家的（原来的记下来，删掉时还原）；
 *         卡里没有这个角色的，新建一个，玩家加的第一套衣服当默认服装。
 *   载卡会整块重写 RESOURCE.characters，所以 Engine.loadCard 之后要 forget() + apply() 一次。
 *
 * 另外给提示词一段 note()：告诉模型这些角色有哪些表情可用，模型才会写出对得上的表情名。
 * ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'custom_sprites';
  var data = { chars: {} };
  var applied = [];          // 每一处改动：{name, outfit, expr, prev, newChar, newOutfit}
  var loaded = false;

  function R() {
    var r = global.RESOURCE = global.RESOURCE || { characters: {}, scenes: {}, defaults: {} };
    r.characters = r.characters || {}; r.defaults = r.defaults || {}; r.scenes = r.scenes || {};
    return r;
  }
  function clean(s) { return String(s == null ? '' : s).replace(/[|<>\[\]\n\r]/g, '').trim(); }
  function norm(d) {
    var out = { chars: {} };
    var cs = d && d.chars && typeof d.chars === 'object' ? d.chars : {};
    Object.keys(cs).forEach(function (n) {
      var name = clean(n); if (!name) return;
      Object.keys(cs[n] || {}).forEach(function (o) {
        var outfit = clean(o) || '常服';
        Object.keys(cs[n][o] || {}).forEach(function (e) {
          var expr = clean(e) || '平静';
          var urls = (Array.isArray(cs[n][o][e]) ? cs[n][o][e] : [cs[n][o][e]])
            .filter(function (u) { return typeof u === 'string' && /^(https?:|data:image\/)/i.test(u); });
          if (!urls.length) return;
          var c = out.chars[name] = out.chars[name] || {};
          var t = c[outfit] = c[outfit] || {};
          t[expr] = (t[expr] || []).concat(urls);
        });
      });
    });
    return out;
  }

  /* ---------------- 合进 / 撤出 RESOURCE ---------------- */
  /* 每条记录都记着当时那个角色对象（obj）。载卡会把卡里有的角色整个换成新对象 ——
     换掉了的就不用还原（新对象本来就是卡的原样）；没换掉的（卡里没有、或者来自预置素材包的）照常还原 */
  function unapply() {
    var r = R();
    for (var i = applied.length - 1; i >= 0; i--) {
      var a = applied[i], ch = r.characters[a.name];
      if (!ch || ch !== a.obj) continue;
      if (a.newChar) { delete r.characters[a.name]; continue; }
      if (a.newOutfit) { delete ch.outfits[a.outfit]; continue; }
      if (a.prev) ch.outfits[a.outfit][a.expr] = a.prev;
      else if (ch.outfits[a.outfit]) delete ch.outfits[a.outfit][a.expr];
    }
    applied = [];
  }
  /** 卡刚重新装过：被卡换掉的角色不用还原，没被换掉的还原（就是 unapply，靠 obj 判断） */
  function forget() { unapply(); }

  function apply() {
    unapply();
    var r = R();
    Object.keys(data.chars).forEach(function (name) {
      var outfits = data.chars[name];
      var ch = r.characters[name], newChar = false;
      if (!ch) {
        newChar = true;
        ch = r.characters[name] = { default_outfit: Object.keys(outfits)[0] || '常服', outfits: {} };
        applied.push({ name: name, newChar: true, obj: ch });
      }
      ch.outfits = ch.outfits || {};
      Object.keys(outfits).forEach(function (o) {
        var newOutfit = false;
        if (!ch.outfits[o]) {
          ch.outfits[o] = {}; newOutfit = true;
          if (!newChar) applied.push({ name: name, outfit: o, newOutfit: true, obj: ch });
        }
        Object.keys(outfits[o]).forEach(function (e) {
          if (!newChar && !newOutfit) applied.push({ name: name, outfit: o, expr: e, prev: ch.outfits[o][e], obj: ch });
          ch.outfits[o][e] = outfits[o][e].slice();
        });
      });
    });
    return count();
  }

  /* ---------------- 增删 ---------------- */
  function add(name, outfit, expr, url) {
    name = clean(name); outfit = clean(outfit) || '常服'; expr = clean(expr) || '平静';
    if (!name) throw new Error('没填角色名');
    if (!/^(https?:\/\/|data:image\/)/i.test(String(url || ''))) throw new Error('图片地址要以 http:// 或 https:// 开头');
    var c = data.chars[name] = data.chars[name] || {};
    var t = c[outfit] = c[outfit] || {};
    t[expr] = t[expr] || [];
    if (t[expr].indexOf(url) < 0) t[expr].push(url);
    return { name: name, outfit: outfit, expr: expr };
  }
  /** 删：给到哪一级删到哪一级（只给角色 = 删这个角色全部；再给 idx = 只删那一张） */
  function remove(name, outfit, expr, idx) {
    var c = data.chars[name]; if (!c) return 0;
    var n = 0;
    if (outfit == null) { n = list().filter(function (x) { return x.name === name; }).length; delete data.chars[name]; return n; }
    var t = c[outfit]; if (!t) return 0;
    if (expr == null) { n = Object.keys(t).reduce(function (s, e) { return s + t[e].length; }, 0); delete c[outfit]; }
    else if (t[expr]) {
      if (idx == null) { n = t[expr].length; delete t[expr]; }
      else if (idx >= 0 && idx < t[expr].length) { t[expr].splice(idx, 1); n = 1; if (!t[expr].length) delete t[expr]; }
      if (!Object.keys(t).length) delete c[outfit];
    }
    if (!Object.keys(c).length) delete data.chars[name];
    return n;
  }
  /** 扁平列表：[{name, outfit, expr, url, idx, isNew}] */
  function list() {
    var out = [], r = R();
    Object.keys(data.chars).forEach(function (n) {
      Object.keys(data.chars[n]).forEach(function (o) {
        Object.keys(data.chars[n][o]).forEach(function (e) {
          data.chars[n][o][e].forEach(function (u, i) {
            out.push({ name: n, outfit: o, expr: e, url: u, idx: i });
          });
        });
      });
    });
    return out;
  }
  function names() { return Object.keys(data.chars); }
  function count() { return list().length; }
  /** 这个角色是不是卡里本来没有、玩家新加的 */
  function isNew(name) {
    return applied.some(function (a) { return a.name === name && a.newChar; });
  }

  /** 给提示词：这些角色有哪些表情（模型照着写，表情才对得上） */
  function note() {
    var r = R(), ns = names();
    if (!ns.length) return '';
    var L = ['<自定义立绘>', '下面这些角色有玩家自己加的立绘。写她们的台词时，表情从对应服装后面列的里面挑（原样照抄），服装也只用列出来的：'];
    ns.forEach(function (n) {
      var ch = r.characters[n] || { outfits: data.chars[n] };
      var parts = Object.keys(ch.outfits || {}).map(function (o) {
        return o + '：' + Object.keys(ch.outfits[o] || {}).join('/');
      });
      L.push('- ' + n + '（' + parts.join('；') + '）');
    });
    L.push('</自定义立绘>');
    return L.join('\n');
  }

  /* ---------------- 存取 ---------------- */
  function load() {
    var S = global.GalStore;
    if (!S || !S.get) { loaded = true; return Promise.resolve(data); }
    return Promise.resolve(S.get(KEY)).then(function (v) {
      data = norm(v); loaded = true; return data;
    }).catch(function () { loaded = true; return data; });
  }
  function save() {
    var S = global.GalStore;
    if (!S || !S.set) return Promise.resolve(false);
    return Promise.resolve(S.set(KEY, data));
  }
  function exportJSON() { return { type: 'gal-custom-sprites', version: 1, chars: data.chars }; }
  /** 导入：和现有的合并（同一格追加，不重复） */
  function importJSON(j) {
    var add2 = norm(j), n = 0;
    Object.keys(add2.chars).forEach(function (name) {
      Object.keys(add2.chars[name]).forEach(function (o) {
        Object.keys(add2.chars[name][o]).forEach(function (e) {
          add2.chars[name][o][e].forEach(function (u) {
            var before = count(); add(name, o, e, u); if (count() > before) n++;
          });
        });
      });
    });
    return n;
  }

  global.CustomSprites = {
    KEY: KEY, load: load, save: save, apply: apply, unapply: unapply, forget: forget,
    add: add, remove: remove, list: list, names: names, count: count, isNew: isNew, note: note,
    exportJSON: exportJSON, importJSON: importJSON,
    get data() { return data; }, set data(v) { data = norm(v); },
    get loaded() { return loaded; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
