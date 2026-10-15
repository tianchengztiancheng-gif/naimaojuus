/* ============================================================
 * core/cardpatch.js —— 角色卡「修订包」：载卡后在引擎这边改素材 / 世界书 / 开场
 *
 * 为什么要有这个
 * --------------
 * 立绘表、世界书、开场白都在角色卡里（见 core/cardres.js）。卡发出去以后，
 * 想换几张立绘、删掉挂了的猫箱链接、补一条世界书、加一个开局，
 * 以前只能改卡再让所有人重新下载。修订包放在仓库里，玩家载入「认得出的卡」时自动打上，
 * GitHub Pages 一更新大家就都有了，卡本身不用动。
 *
 * 一个修订包长这样（数据放 resource/*-patch.js，这里只管怎么打）：
 *   CardPatch.register({
 *     id: 'juus',
 *     match: function (card) { return true/false },     // 认卡
 *     sprites:   { 角色: { 服装: { 表情: [url…] } } },   // 整个角色的表情差分换成这一套（没有就新建）
 *     dropSprites:  ['角色', …],                         // 删掉表情差分（之后用卡里的默认立绘）
 *     dropDefaults: ['角色', …],                         // 删掉默认立绘（没有图就不画，不会乱挑别人的）
 *     swapDefaults: [['甲', '甲·META'], …],              // 两个角色的原皮（默认立绘第 0 张）对调，其余皮肤不动
 *     worldbook: [ 卡格式的世界书条目 … ],                // 追加；comment 和卡里已有的同名就替换那条
 *     disableEntries: ['条目 comment', …],               // 关掉卡里的条目（比如删了差分的「X差分」）
 *     openings: [{ n: '列表里显示的名字', t: '开场原文' }] // 追加到开场白列表最后
 *   })
 *
 * 打补丁的时机：Engine.loadCard 里 CardRes.apply 之后、CustomSprites 之前 ——
 * 卡里抽出来的是底子，修订包盖在上面，玩家自己加的立绘再盖在最上面。
 * ============================================================ */
(function (global) {
  'use strict';
  var LIST = [];

  function register(p) {
    if (!p || !p.id) throw new Error('修订包缺 id');
    LIST = LIST.filter(function (x) { return x.id !== p.id; });
    LIST.push(p);
    return p;
  }
  function matching(card) {
    return LIST.filter(function (p) {
      try { return !p.match || !!p.match(card); } catch (e) { return false; }
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /** 把一个角色的立绘表规整成 { default_outfit, outfits: { 服装: { 表情: [url] } } } */
  function charTable(outfits) {
    var o = {};
    Object.keys(outfits || {}).forEach(function (of) {
      o[of] = {};
      Object.keys(outfits[of] || {}).forEach(function (ex) {
        var v = outfits[of][ex];
        var arr = (Array.isArray(v) ? v : [v]).filter(Boolean);
        var seen = {};
        o[of][ex] = arr.filter(function (u) { if (seen[u]) return false; seen[u] = 1; return true; });
      });
    });
    return { default_outfit: Object.keys(o)[0] || '常服', outfits: o };
  }

  /**
   * 载卡后打补丁。
   * @param card 角色卡
   * @param eng  引擎（改 eng.pool；没有就只改素材）
   * @returns {{ids:string[], sprites:number, dropped:number, swapped:number, worldbook:number, disabled:number, openings:number}}
   */
  function apply(card, eng) {
    var st = { ids: [], sprites: 0, dropped: 0, swapped: 0, worldbook: 0, disabled: 0, openings: 0 };
    var R = global.RESOURCE = global.RESOURCE || { characters: {}, scenes: {}, defaults: {} };
    R.characters = R.characters || {}; R.defaults = R.defaults || {};
    matching(card).forEach(function (p) {
      st.ids.push(p.id);
      /* 立绘：整个角色换成新的一套（新对象，CustomSprites 的还原逻辑认对象，不会被搅乱） */
      Object.keys(p.sprites || {}).forEach(function (who) {
        R.characters[who] = charTable(p.sprites[who]);
        st.sprites++;
      });
      (p.dropSprites || []).forEach(function (who) {
        if (R.characters[who]) { delete R.characters[who]; st.dropped++; }
      });
      (p.dropDefaults || []).forEach(function (who) {
        if (R.defaults[who]) { delete R.defaults[who]; st.dropped++; }
      });
      (p.swapDefaults || []).forEach(function (pair) {
        /* 只换原皮（第 0 张）：juus 卡里「飞龙」的第 0 张其实是 META 的图、「飞龙·META」那张才是原版，
           后面的换装皮肤是对的，不能跟着换走 */
        var a = pair[0], b = pair[1];
        var A = R.defaults[a], B = R.defaults[b];
        if (!A || !B || !A.length || !B.length) return;
        A = A.slice(); B = B.slice();
        var t = A[0]; A[0] = B[0]; B[0] = t;
        R.defaults[a] = A; R.defaults[b] = B;
        st.swapped++;
      });

      if (eng && eng.pool && global.Worldbook) {
        var off = {};
        (p.disableEntries || []).forEach(function (c) { off[c] = 1; });
        eng.pool.forEach(function (e) { if (off[e.comment] && e.enabled) { e.enabled = false; st.disabled++; } });
        if (p.worldbook && p.worldbook.length) {
          var add = global.Worldbook.fromCard({ data: { character_book: { entries: clone(p.worldbook) } } },
            { uidPrefix: 'patch:' + p.id + ':' });
          var names = {};
          add.forEach(function (e) { if (e.comment) names[e.comment] = 1; });
          /* 同名的（比如卡里那条短的「雅努斯差分」）换成修订包的 */
          eng.pool = eng.pool.filter(function (e) { return !names[e.comment]; }).concat(add);
          st.worldbook += add.length;
        }
      }
      st.openings += (p.openings || []).length;
    });
    return st;
  }

  /** 修订包给这张卡加的开场：[{ n, t, patch }] */
  function openings(card) {
    var out = [];
    matching(card).forEach(function (p) {
      (p.openings || []).forEach(function (o) { out.push({ n: o.n, t: o.t, patch: p.id }); });
    });
    return out;
  }

  global.CardPatch = { register: register, apply: apply, openings: openings, matching: matching, _list: function () { return LIST; } };
})(typeof window !== 'undefined' ? window : globalThis);
