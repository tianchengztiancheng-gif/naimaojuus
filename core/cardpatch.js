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
 *     addSprites:{ 角色: { 服装: { 表情: [url…] } } },   // 只往里加：同名表情追加图片，原有的表情不动（没有就新建）
 *     diffEntries: true,                                 // 按最终的立绘表重写 sprites / addSprites 里那些人的「X差分」条目
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
 *
 * 卡里 data.extensions.gal_builtin.merged_patches 列出的修订包视为已打过，跳过（v5.30）。
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
  /* 已经合进卡里的修订包（内置卡 resource/juus-card.js 带这个标记，见 tools/build-juus-builtin.mjs）。
     再打一遍不是无害的：修订包里旧的同名世界书条目会盖掉卡里新的，开场会重复，
     swapDefaults 会把已经对调好的原皮又换回去。 */
  function merged(card) {
    var d = (card && (card.data || card)) || {};
    var b = d.extensions && d.extensions.gal_builtin;
    return (b && Array.isArray(b.merged_patches)) ? b.merged_patches : [];
  }
  function matching(card) {
    var done = merged(card);
    return LIST.filter(function (p) {
      if (done.indexOf(p.id) >= 0) return false;
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

  /** 「X差分」条目的正文，和卡里的写法一样：角色一层、服装两层、表情一行一条 */
  function diffText(who, table) {
    var lines = [who + ':'];
    Object.keys(table.outfits || {}).forEach(function (of) {
      lines.push('  ' + of + ':');
      Object.keys(table.outfits[of] || {}).forEach(function (ex) { lines.push('    - ' + ex); });
    });
    return lines.join('\n');
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
      /* 只加不换（v5.30）：比如给贾维斯补一个「掀起裙子」，她原来那 34 种表情不用在修订包里再抄一遍 */
      Object.keys(p.addSprites || {}).forEach(function (who) {
        var cur = R.characters[who];
        var merged = {};
        Object.keys((cur && cur.outfits) || {}).forEach(function (of) {
          merged[of] = {};
          Object.keys(cur.outfits[of] || {}).forEach(function (ex) { merged[of][ex] = (cur.outfits[of][ex] || []).slice(); });
        });
        var add = p.addSprites[who] || {};
        Object.keys(add).forEach(function (of) {
          merged[of] = merged[of] || {};
          Object.keys(add[of] || {}).forEach(function (ex) {
            var v = add[of][ex];
            merged[of][ex] = (merged[of][ex] || []).concat(Array.isArray(v) ? v : [v]);
          });
        });
        var t = charTable(merged);
        if (cur && cur.default_outfit && t.outfits[cur.default_outfit]) t.default_outfit = cur.default_outfit;
        R.characters[who] = t;          // 新对象（CustomSprites 按对象认）
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
        /* 「X差分」条目跟着立绘表走：AI 只会挑这条里列出来的表情，名单和图对不上，加了图也触发不到 */
        if (p.diffEntries) {
          var who2 = Array.isArray(p.diffEntries) ? p.diffEntries
            : Object.keys(p.sprites || {}).concat(Object.keys(p.addSprites || {}));
          /* 新建的照卡里已有的差分条目设置（@深度、顺序），找不到就用 juus 卡的惯例：@深度 1，顺序 102 */
          var tpl = eng.pool.filter(function (e) { return /差分$/.test(e.comment || '') && e.enabled; })[0];
          who2.forEach(function (who) {
            var t = R.characters[who];
            if (!t) return;
            var comment = who + '差分', text = diffText(who, t);
            var old = eng.pool.filter(function (e) { return e.comment === comment; });
            if (old.length) {
              old.forEach(function (e) { e.content = text; e.enabled = true; });
            } else {
              eng.pool = eng.pool.concat(global.Worldbook.fromCard({ data: { character_book: { entries: [{
                id: 'diff:' + who, keys: [who], secondary_keys: [], comment: comment, content: text,
                constant: false, selective: true, insertion_order: tpl ? tpl.order : 102, enabled: true,
                position: 'after_char',
                extensions: { position: tpl ? tpl.position : 4, depth: tpl ? tpl.depth : 1,
                              probability: 100, useProbability: true, selectiveLogic: 0 }
              }] } } }, { uidPrefix: 'patch:' + p.id + ':' }));
            }
            st.worldbook++;
          });
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
