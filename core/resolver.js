/* ============================================================
 * core/resolver.js —— 统一立绘 / 背景查找器
 *
 * 数据契约（由 resource/ 下的包注入 window.RESOURCE）：
 *   characters[角色] = { default_outfit: "常服", outfits: { 服装: { 表情: [url, ...] } } }
 *   scenes[地点]     = { 时段: url }
 *
 * 天青原来的扁平写法（"演出服wink"）和 juus 的三层写法在这里统一。
 * 每次查找都返回 via 字段说明走了哪一级兜底，便于在调试面板里暴露问题。
 * ============================================================ */
(function (global) {
  'use strict';

  var R = global.RESOURCE = global.RESOURCE || { characters: {}, scenes: {}, defaults: {} };
  R.defaults = R.defaults || {};

  /* ---------- 工具 ---------- */
  function hash(s) {
    var h = 0, i;
    s = String(s || '');
    for (i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  function pickFrom(list, mode, seed) {
    if (!list || !list.length) return null;
    if (list.length === 1) return list[0];
    if (mode === 'stable') return list[hash(seed) % list.length];
    return list[Math.floor(Math.random() * list.length)];
  }
  function firstKey(o) { for (var k in o) if (o.hasOwnProperty(k)) return k; return null; }

  /* 二元组重合度：给"重樱学院"这类模型自创地名找最近的真实场景 */
  function bigrams(s) {
    s = String(s || '').replace(/[()（）·\s]/g, '');
    var out = [], i;
    if (s.length === 1) return [s];
    for (i = 0; i < s.length - 1; i++) out.push(s.substr(i, 2));
    return out;
  }
  function similarity(a, b) {
    var A = bigrams(a), B = bigrams(b);
    if (!A.length || !B.length) return 0;
    var set = {}, hit = 0;
    B.forEach(function (g) { set[g] = (set[g] || 0) + 1; });
    A.forEach(function (g) { if (set[g] > 0) { set[g]--; hit++; } });
    return 2 * hit / (A.length + B.length);
  }

  /* 用户别名表：看到 hash 兜底时可以手工登记，持久化在 localStorage */
  var ALIAS_KEY = 'gal_scene_alias';
  var aliases = (function () {
    try { return JSON.parse(global.localStorage.getItem(ALIAS_KEY) || '{}'); }
    catch (e) { return {}; }
  })();
  function setAlias(from, to) {
    aliases[String(from).trim()] = String(to).trim();
    try { global.localStorage.setItem(ALIAS_KEY, JSON.stringify(aliases)); } catch (e) {}
  }
  function getAliases() { return JSON.parse(JSON.stringify(aliases)); }
  function clearAlias(from) {
    delete aliases[from];
    try { global.localStorage.setItem(ALIAS_KEY, JSON.stringify(aliases)); } catch (e) {}
  }

  /* ---------- 立绘 ---------- */
  /**
   * @param {string} who   角色名
   * @param {string} expr  表情名（允许是 "演出服wink" 这种老式拼接）
   * @param {object} [opt] { outfit, pick:'random'|'stable', fallbackExpr }
   * @returns {{url,urls,who,outfit,expr,via}|null}
   *   via: exact | other-outfit | legacy-prefix | default-expr | any
   */
  /* 卡里自带的「默认立绘」：761 个角色都有，远多于有表情差分的 73 个。
     数组第一张是常服，其余按服装名哈希稳定挑 —— 与原卡 defSprite() 一致。 */
  function defaultSprite(who, outfit, skin) {
    var a = R.defaults[who];
    if (!a || !a.length) return null;
    /* 显式指定了第几张就用第几张（0 = 原皮），玩家在皮肤面板里选的就走这条 */
    if (skin != null && skin >= 0 && skin < a.length) return a[skin];
    if (!outfit || outfit === '常服' || a.length === 1) return a[0];
    return a[1 + (hash(outfit) % (a.length - 1))];
  }

  /** 某个角色可选的皮肤列表：[{index, url, isBase}] */
  function skinsOf(who) {
    var a = R.defaults[who] || [];
    return a.map(function (u, i) {
      return { index: i, url: u, isBase: i === 0 };
    });
  }

  /** 某个角色可选的（有表情差分的）服装名 */
  function outfitsOf(who) {
    var c = R.characters[who];
    return c ? Object.keys(c.outfits || {}) : [];
  }

  function sprite(who, expr, opt) {
    opt = opt || {};
    var ch = R.characters[who];

    /* 没有表情差分的角色（六百多个）直接给默认立绘，别返回 null */
    if (!ch) {
      var only = defaultSprite(who, opt.outfit, opt.skin);
      if (!only) return null;
      return { url: only, urls: R.defaults[who], who: who,
               outfit: opt.outfit || '常服', expr: expr || '',
               skin: opt.skin == null ? 0 : opt.skin, via: 'default-sprite' };
    }

    var outfits = ch.outfits || {};
    var want = opt.outfit || ch.default_outfit || firstKey(outfits);
    var seed = who + '|' + expr;
    var mode = opt.pick || 'random';

    function make(outfit, e, via) {
      var urls = outfits[outfit] && outfits[outfit][e];
      if (!urls || !urls.length) return null;
      return { url: pickFrom(urls, mode, seed), urls: urls,
               who: who, outfit: outfit, expr: e, via: via };
    }

    /* 0. 玩家在皮肤面板里点了某张皮肤 —— 这是明确意愿，优先级最高 */
    if (opt.skin != null && opt.skin >= 0) {
      var chosen = defaultSprite(who, want, opt.skin);
      if (chosen) {
        return { url: chosen, urls: R.defaults[who], who: who, outfit: want,
                 expr: expr, skin: opt.skin, via: 'skin-picked' };
      }
    }

    /* 1. 当前服装里精确命中 */
    var hit = make(want, expr, 'exact');
    if (hit) return hit;

    /* 2. 其它服装里有同名表情 —— 立绘对不上衣服，但总比没有强 */
    for (var o in outfits) {
      if (o === want) continue;
      hit = make(o, expr, 'other-outfit');
      if (hit) return hit;
    }

    /* 3. 老式拼接名："演出服wink" -> 服装=演出服, 表情=wink */
    for (var o2 in outfits) {
      if (expr && expr.indexOf(o2) === 0 && expr.length > o2.length) {
        hit = make(o2, expr.slice(o2.length), 'legacy-prefix');
        if (hit) return hit;
      }
    }

    /* 4. 退回该服装的默认表情 */
    var fb = opt.fallbackExpr || '平静';
    hit = make(want, fb, 'default-expr') ||
          make(want, '普通', 'default-expr') ||
          make(want, '微笑', 'default-expr');
    if (hit) return hit;

    /* 5. 卡里给这个角色配了默认立绘就用它，比乱挑一个表情靠谱 */
    var dft = defaultSprite(who, want, opt.skin);
    if (dft) {
      return { url: dft, urls: R.defaults[who], who: who,
               outfit: want, expr: expr, via: 'default-sprite' };
    }

    /* 6. 该服装里随便找一张，按角色名哈希保证同一角色恒定 */
    var pool = outfits[want] || outfits[firstKey(outfits)];
    var ek = pool && Object.keys(pool);
    if (ek && ek.length) {
      var chosen = ek[hash(who) % ek.length];
      return make(want in outfits ? want : firstKey(outfits), chosen, 'any');
    }
    return null;
  }

  /* ---------- 背景 ---------- */
  /**
   * @returns {{url,loc,period,via}|null}
   *   via: exact | other-period | fuzzy | hash
   */
  function scene(loc, period) {
    var keys = Object.keys(R.scenes);
    if (!keys.length) return null;
    loc = String(loc || '').trim();
    period = String(period || '白日').trim();

    function take(k, p, via, extra) {
      var t = R.scenes[k];
      if (!t) return null;
      var use = (p && t[p]) ? p : firstKey(t);
      if (!use || !t[use]) return null;
      var r = { url: t[use], loc: k, period: use, via: via };
      if (extra) r.matchedFrom = extra;
      return r;
    }

    /* 0. 用户自己登记的别名，优先级最高 */
    if (aliases[loc] && R.scenes[aliases[loc]]) {
      return take(aliases[loc], period, 'alias', loc);
    }
    /* 0b. 预置映射表（resource/aliases.js），随包发布，用户登记的能覆盖它 */
    var preset = global.SCENE_ALIASES;
    if (preset && preset[loc] && R.scenes[preset[loc]]) {
      return take(preset[loc], period, 'alias', loc + '（预置）');
    }

    /* 1. 地点 + 时段精确命中 */
    var t = R.scenes[loc];
    if (t) return t[period] ? take(loc, period, 'exact') : take(loc, null, 'other-period');

    /* 2. 互相包含，取最短（最贴近） */
    var contain = keys.filter(function (k) {
      return k.indexOf(loc) !== -1 || (loc.length > 1 && loc.indexOf(k) !== -1);
    });
    if (contain.length) {
      contain.sort(function (a, b) { return a.length - b.length; });
      return take(contain[0], period, 'fuzzy', loc);
    }

    /* 3. 二元组相似度，超过阈值才认 */
    var best = null, bestScore = 0;
    keys.forEach(function (k) {
      var sc = similarity(loc, k);
      if (sc > bestScore) { bestScore = sc; best = k; }
    });
    if (best && bestScore >= 0.28) return take(best, period, 'similar', loc + ' ~' + bestScore.toFixed(2));

    /* 4. 哈希兜底：同一个未知地点永远落在同一张图，不会闪 */
    return take(keys[hash(loc) % keys.length], period, 'hash', loc);
  }

  /* ============================================================
     自动登记别名

     预置表再全也盖不住模型的想象力。落到 hash / similar 这两级时，
     说明这个地名我们完全不认识 —— 这时候花一次独立请求，
     把全部真实场景名给模型，让它自己挑一个最贴切的，然后**永久登记**。

     一个地名只问一次（登记后走 alias 级，再也不会进来），
     所以这笔开销是一次性的，不会每轮都花。
     ============================================================ */
  var asking = {};          // 正在问的，避免同一轮重复发请求
  var refused = {};         // 问过但模型没给出有效答案的，不再问第二次

  function needsAlias(via) {
    return via === 'hash' || via === 'similar';
  }

  function aliasPrompt(loc) {
    var keys = Object.keys(R.scenes);
    return [
      '[独立任务 · 地名归一，忽略之前的角色扮演格式]',
      '剧情里出现了一个地点：「' + loc + '」，但素材库里没有这个名字的背景图。',
      '请从下面的真实场景名单里挑出**最贴近**它的那一个。',
      '',
      '只输出那个场景名本身，一个字都不要多，不要解释，不要加引号或标点。',
      '如果实在没有任何一个沾边的，就输出：无',
      '',
      '[可选场景名单]',
      keys.join('、')
    ].join('\n');
  }

  /**
   * 问模型并登记。quiet(prompt, opt) => Promise<string>
   * 返回登记成的场景名，或 null。
   */
  async function autoAlias(loc, quiet) {
    loc = String(loc || '').trim();
    if (!loc || typeof quiet !== 'function') return null;
    if (aliases[loc] || refused[loc] || asking[loc]) return null;
    var preset = global.SCENE_ALIASES;
    if (preset && preset[loc] && R.scenes[preset[loc]]) return null;

    asking[loc] = true;
    try {
      var raw = await quiet(aliasPrompt(loc), { maxTokens: 40, temperature: 0 });
      /* 模型常会带上标点、引号或多写一句，只取第一行再清干净 */
      var ans = String(raw || '').trim().split(/\r?\n/)[0]
        .replace(/^[「『"'\s]+|[」』"'。，,.\s]+$/g, '').trim();
      if (!ans || ans === '无' || !R.scenes[ans]) {
        refused[loc] = true;
        return null;
      }
      setAlias(loc, ans);
      return ans;
    } catch (e) {
      refused[loc] = true;
      return null;
    } finally {
      delete asking[loc];
    }
  }

  /* ---------- 盘点 ---------- */
  function stats() {
    var chars = Object.keys(R.characters), imgs = 0, outfits = 0, exprs = 0;
    var defNames = Object.keys(R.defaults || {});
    chars.forEach(function (c) {
      var o = R.characters[c].outfits || {};
      outfits += Object.keys(o).length;
      for (var k in o) {
        exprs += Object.keys(o[k]).length;
        for (var e in o[k]) imgs += o[k][e].length;
      }
    });
    var locs = Object.keys(R.scenes), simgs = 0;
    locs.forEach(function (l) { simgs += Object.keys(R.scenes[l]).length; });
    return { characters: chars.length, outfits: outfits, expressions: exprs,
             sprites: imgs, locations: locs.length, backgrounds: simgs,
             defaultChars: defNames.length,
             defaultSprites: defNames.reduce(function (s2, n) {
               return s2 + (R.defaults[n] || []).length; }, 0) };
  }

  global.Resolver = {
    sprite: sprite, scene: scene, stats: stats, defaultSprite: defaultSprite,
    skinsOf: skinsOf, outfitsOf: outfitsOf,
    setAlias: setAlias, getAliases: getAliases, clearAlias: clearAlias,
    similarity: similarity, _hash: hash,
    autoAlias: autoAlias, needsAlias: needsAlias, aliasPrompt: aliasPrompt
  };
})(typeof window !== 'undefined' ? window : globalThis);
