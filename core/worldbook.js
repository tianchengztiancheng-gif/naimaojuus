/* ============================================================
 * core/worldbook.js —— 世界书激活（蓝灯 / 绿灯）
 *
 * 对齐 SillyTavern World Info 的检索语义：
 *   constant(蓝灯)        —— 恒定注入
 *   selective(绿灯)       —— 关键词命中才注入
 *   key / keysecondary    —— 主词 + 次词
 *   selectiveLogic        —— 0 AND_ANY / 1 NOT_ALL / 2 NOT_ANY / 3 AND_ALL
 *   probability           —— 概率触发
 *   order                 —— 插入排序（大的在后）
 *   position              —— 0..6 七个插入位置
 *   depth                 —— position=4 时的插入深度
 *   scanDepth             —— 往回扫几条消息
 *   recursion             —— 已激活条目的正文继续参与扫描
 *
 * 参考 Larimar backend/prompt-builder.js 的 entryActivated 实现，
 * 补上了 ST 的 NOT_ANY、matchWholeWords、递归与预算裁剪。
 * ============================================================ */
(function (global) {
  'use strict';

  var POS = {
    BEFORE_CHAR: 0, AFTER_CHAR: 1, AN_TOP: 2, AN_BOTTOM: 3,
    AT_DEPTH: 4, EM_TOP: 5, EM_BOTTOM: 6
  };
  var LOGIC = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 };

  function asArray(v) {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === 'string' && v.trim()) {
      return v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }
    return [];
  }
  function num(v, d) { var n = Number(v); return isNaN(n) ? d : n; }

  /* /正则/标志 形式的 key 按正则处理，其余按子串 */
  function keyHits(text, key, caseSensitive, wholeWords) {
    var m = /^\/(.+)\/([gimsuy]*)$/.exec(String(key));
    if (m) {
      try { return new RegExp(m[1], m[2].replace('g', '')).test(text); }
      catch (e) { /* 坏正则退化成子串 */ }
    }
    var hay = caseSensitive ? text : text.toLowerCase();
    var needle = caseSensitive ? String(key) : String(key).toLowerCase();
    if (!needle) return false;
    if (!wholeWords || /[\u4e00-\u9fa5]/.test(needle)) return hay.indexOf(needle) !== -1;
    var esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { return new RegExp('\\b' + esc + '\\b', caseSensitive ? '' : 'i').test(text); }
    catch (e) { return hay.indexOf(needle) !== -1; }
  }
  function anyKey(text, keys, cs, ww) {
    return keys.some(function (k) { return keyHits(text, k, cs, ww); });
  }
  function allKeys(text, keys, cs, ww) {
    return keys.length > 0 && keys.every(function (k) { return keyHits(text, k, cs, ww); });
  }

  /** 单条是否激活。rng 可注入以便测试可重现。 */
  function entryActivated(entry, scanText, rng) {
    if (!entry) return false;
    if (entry.enabled === false || entry.disable === true) return false;
    if (!String(entry.content || '').trim()) return false;

    if (entry.constant) return true;

    var primary = asArray(entry.key || entry.keys);
    var secondary = asArray(entry.keysecondary || entry.secondary_keys);
    if (!primary.length && !secondary.length) return false;

    var cs = !!entry.caseSensitive;
    var ww = !!entry.matchWholeWords;
    var hitP = anyKey(scanText, primary, cs, ww);
    if (!hitP) return false;                       // ST：主词不中直接出局

    if (secondary.length) {
      switch (num(entry.selectiveLogic, LOGIC.AND_ANY)) {
        case LOGIC.AND_ANY: if (!anyKey(scanText, secondary, cs, ww)) return false; break;
        case LOGIC.NOT_ALL: if (allKeys(scanText, secondary, cs, ww)) return false; break;
        case LOGIC.NOT_ANY: if (anyKey(scanText, secondary, cs, ww)) return false; break;
        case LOGIC.AND_ALL: if (!allKeys(scanText, secondary, cs, ww)) return false; break;
      }
    }

    var prob = entry.useProbability === false ? 100 : num(entry.probability, 100);
    if (prob < 100 && (rng || Math.random)() * 100 >= prob) return false;
    return true;
  }

  /**
   * 激活并分桶。
   * @param {Array} pool    世界书条目
   * @param {Array} history [{role, content}]，用于按 scanDepth 取扫描文本
   * @param {object} [opt]  { scanDepth=2, recursion=true, maxRecursion=3, budgetChars=0, rng }
   * @returns {{buckets, active, trace}}
   */
  function activate(pool, history, opt) {
    opt = opt || {};
    var scanDepth = num(opt.scanDepth, 2);
    var maxRec = opt.recursion === false ? 0 : num(opt.maxRecursion, 3);
    var rng = opt.rng || Math.random;

    var recent = (history || []).slice(-Math.max(1, scanDepth));
    var scanText = recent.map(function (m) { return String(m.content || ''); }).join('\n');

    var remaining = (pool || []).slice();
    var active = [], trace = [], step = 0;

    /* 第 0 轮扫历史，之后每轮把新激活条目的正文并入扫描文本（ST 的递归） */
    while (step <= maxRec) {
      var fired = [];
      remaining = remaining.filter(function (e) {
        if (e.excludeRecursion && step > 0) return true;
        if (entryActivated(e, scanText, rng)) { fired.push(e); return false; }
        return true;
      });
      if (!fired.length) break;
      fired.forEach(function (e) {
        active.push(e);
        trace.push({ uid: e.uid, comment: e.comment || '', step: step,
                     via: e.constant ? 'constant' : 'key' });
      });
      var add = fired.filter(function (e) { return !e.preventRecursion; })
                     .map(function (e) { return String(e.content || ''); }).join('\n');
      if (!add) break;
      scanText += '\n' + add;
      step++;
    }

    active.sort(function (a, b) { return num(a.order, 100) - num(b.order, 100); });

    /* 预算裁剪：order 大的先被砍（ST 是按优先级保留）
     *
     * 两种计量单位：
     *   budgetChars  —— 按字符数（老行为，默认）
     *   budgetTokens —— 按真实 token（需要 core/tokens.js 把分词器加载好）
     * 按字符裁是有偏差的：中文标点和短剧本行的字符/token 比差得远，
     * 实测短句能低估三成多，等于「以为还有空间」结果发超。有 token 计数时优先用它。 */
    var tokenBudget = num(opt.budgetTokens, 0);
    var budget = tokenBudget > 0 ? tokenBudget : num(opt.budgetChars, 0);
    var byToken = tokenBudget > 0 && global.Tokens && global.Tokens.mode(opt.model) === 'exact';
    var used = 0, dropped = [];
    if (budget > 0) {
      var kept = [];
      for (var i = 0; i < active.length; i++) {
        var body = String(active[i].content || '');
        var len = byToken ? global.Tokens.count(body, opt.model) : body.length;
        if (used + len > budget) { dropped.push(active[i]); continue; }
        used += len; kept.push(active[i]);
      }
      active = kept;
    }

    /* 语义检索补的条目（core/vector.js 算好后由 engine 传进来）。
       放在关键词命中**之后**追加 —— 关键词是作者写死的意图，
       语义相似只是补充，永远不该把前者挤掉。
       预算已经在上面裁过了，所以这些是额外的，各自也受 order 排序。 */
    var semantic = (opt.semantic || []).filter(function (s2) {
      return s2 && s2.entry && active.indexOf(s2.entry) < 0;
    });
    semantic.forEach(function (s2) {
      active.push(s2.entry);
      trace.push({
        uid: s2.entry.uid, comment: s2.entry.comment || '', step: -1, via: 'vector',
        score: Math.round(s2.score * 1000) / 1000,
        raw: Math.round(s2.raw * 1000) / 1000,
        decay: Math.round(s2.decay * 100) / 100
      });
    });
    if (semantic.length) {
      active.sort(function (a, b) { return num(a.order, 100) - num(b.order, 100); });
    }

    var buckets = { before: [], after: [], anTop: [], anBottom: [], atDepth: [], emTop: [], emBottom: [] };
    var byPos = [buckets.before, buckets.after, buckets.anTop, buckets.anBottom,
                 buckets.atDepth, buckets.emTop, buckets.emBottom];
    active.forEach(function (e) {
      (byPos[num(e.position, POS.BEFORE_CHAR)] || buckets.before).push(e);
    });

    return {
      buckets: buckets, active: active, trace: trace,
      stats: { pool: (pool || []).length, activated: active.length,
               semantic: semantic.length,
               chars: used || active.reduce(function (s, e) { return s + String(e.content || '').length; }, 0),
               dropped: dropped.length, recursionSteps: step }
    };
  }

  function render(entries) {
    return (entries || []).map(function (e) {
      var head = e.comment ? '【' + e.comment + '】\n' : '';
      return head + String(e.content || '').trim();
    }).filter(Boolean).join('\n\n');
  }

  /** 从角色卡 / 世界书 JSON 里取出条目池 */
  function fromCard(card, opt) {
    var d = (card && card.data) || card || {};
    var book = d.character_book || card.character_book;
    var entries = (book && book.entries) || [];
    if (!Array.isArray(entries) && typeof entries === 'object') {
      entries = Object.keys(entries).map(function (k) { return entries[k]; });
    }
    /* uid 前缀：额外导入的世界书（独立 World Info JSON）和卡内条目
       各自从 0 开始编号，不加前缀就会撞车 —— 实测 uid 变成 0,1,0,1，
       findEntry(1) 永远命中卡内那条，于是在界面上点导入的条目、
       改它的开关，操作全打到卡里另一条上去了。Vector 的索引也按 uid 存，
       同样互相覆盖。 */
    var pfx = (opt && opt.uidPrefix) || '';
    /* 两种格式都要认：
       卡内 character_book —— keys / insertion_order / position:'before_char' / 细节在 extensions 里；
       独立 World Info 文件（以及预设里附带的 world_info）—— 平铺的 key / order / position:数字 /
       disable / depth。以前只认前一种，独立导入的世界书位置、深度、顺序、禁用全丢了。 */
    function pick() {
      for (var k = 0; k < arguments.length; k++) {
        if (arguments[k] !== undefined && arguments[k] !== null) return arguments[k];
      }
      return undefined;
    }
    return entries.filter(function (e) { return e && typeof e === 'object'; }).map(function (e, i) {
      var ext = e.extensions || {};
      var posRaw = pick(ext.position, e.position);
      var position = typeof posRaw === 'number' ? posRaw
        : (posRaw === 'before_char' ? 0 : (posRaw != null && !isNaN(Number(posRaw)) ? Number(posRaw) : 1));
      return {
        uid: pfx + (e.id != null ? e.id : (e.uid != null ? e.uid : i)),
        comment: e.comment || e.name || '',
        content: e.content || '',
        key: e.keys || e.key || [],
        keysecondary: e.secondary_keys || e.keysecondary || [],
        constant: !!(e.constant || ext.constant),
        enabled: e.enabled !== false && ext.disable !== true && e.disable !== true,
        selectiveLogic: num(pick(ext.selectiveLogic, e.selectiveLogic), 0),
        order: num(pick(e.insertion_order, e.order), 100),
        position: position,
        depth: num(pick(ext.depth, e.depth), 4),
        probability: num(pick(ext.probability, e.probability), 100),
        useProbability: pick(ext.useProbability, e.useProbability) !== false,
        caseSensitive: !!(e.case_sensitive || ext.caseSensitive || e.caseSensitive),
        matchWholeWords: !!(ext.matchWholeWords || e.matchWholeWords),
        preventRecursion: !!(ext.preventRecursion || e.preventRecursion),
        excludeRecursion: !!(ext.exclude_recursion || e.excludeRecursion)
      };
    });
  }

  global.Worldbook = {
    POS: POS, LOGIC: LOGIC,
    entryActivated: entryActivated,
    activate: activate,
    render: render,
    fromCard: fromCard
  };
})(typeof window !== 'undefined' ? window : globalThis);
