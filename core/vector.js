/* ============================================================
 * core/vector.js —— 世界书的语义检索（向量）+ 时间衰减
 *
 * 现有的激活靠**关键词字面命中**：条目写了「甜品厅」，正文里得真出现这三个字。
 * 玩家说「想吃点甜的」——一个关键词都不沾，那条就是捞不上来。
 * 这一层补的就是这个漏：把条目和最近的对话都转成向量，按语义相似度捞。
 *
 * ── 为什么是调 API 而不是在浏览器里跑模型 ──
 * 浏览器内嵌 embedding 模型（transformers.js）要下三十到一百多 MB 权重，
 * 对一个「双击 index.html 就能玩」的项目太重了。而用户配的 OpenAI 兼容端点
 * 多半自带 /v1/embeddings，复用它：
 *   · 建索引是**一次性**的 —— 166 条各算一次，之后按内容哈希缓存，改了才重算
 *   · 每轮只多一次「把当前这句话转成向量」的请求，极小极便宜
 * 端点不支持 embeddings 就自动关掉，退回纯关键词，不报错、不挡路。
 *
 * ── 时间衰减 ──
 * 光按相似度捞，会出现同样那几条反复霸占预算（它们语义上永远最近）。
 * 所以给「最近几轮已经注入过」的条目降权：刚注入过的压得最狠，
 * 隔的轮次越多恢复越多。蓝灯常驻条目不参与，它们本来就该每轮都在。
 *
 * ⚠ 这一层只**追加**候选，永远不会挤掉关键词已经命中的条目 ——
 *   关键词命中是作者的明确意图，语义相似只是补充。
 * ============================================================ */
(function (global) {
  'use strict';

  var DEFAULTS = {
    enabled: false,
    model: 'text-embedding-3-small',
    dimensions: 512,        // 1536 维存起来约 1.8MB，512 维够用且小三倍
    topK: 4,                // 每轮最多补几条
    threshold: 0.32,        // 余弦相似度下限，低于这个不要
    queryLines: 4,          // 拿最近几条消息当查询
    decayTurns: 6,          // 多少轮内注入过就降权
    decayStrength: 0.45,    // 降权力度（0~1），刚注入过的乘以 1-这个值
    maxEntryChars: 1200,    // 每条只嵌入前这么多字（人设六千字全嵌没必要且贵）
    batch: 32
  };

  var cfg = Object.assign({}, DEFAULTS);
  var index = null;         // { uid: { hash, vec: [] } }
  var recent = {};          // uid → 最后一次注入的轮次
  var INDEX_KEY = 'vector:index';
  var lastError = '';

  function configure(patch) {
    cfg = Object.assign({}, DEFAULTS, cfg, patch || {});
    return cfg;
  }
  function config() { return Object.assign({}, cfg); }

  /* ---------- 小工具 ---------- */

  function hash(s) {
    var h = 5381, i;
    s = String(s || '');
    for (i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function bodyOf(e) {
    /* 条目名也参与嵌入 —— 「柴郡」这种条目正文里未必再出现自己的名字 */
    return (String(e.comment || '') + '\n' + String(e.content || ''))
      .trim().slice(0, cfg.maxEntryChars);
  }

  function cosine(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    var dot = 0, na = 0, nb = 0;
    for (var i = 0; i < a.length; i++) {
      dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
    }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  /* 存进 IndexedDB 前压到 4 位小数 —— 对余弦没有可感知影响，体积小一半多 */
  function shrink(v) {
    var out = new Array(v.length);
    for (var i = 0; i < v.length; i++) out[i] = Math.round(v[i] * 1e4) / 1e4;
    return out;
  }

  /* ---------- 调 embeddings ---------- */

  /**
   * 默认走 GalAPI 的配置（同一个 baseUrl / 密钥）。
   * embed(texts) => Promise<number[][]>
   */
  async function embed(texts, opt) {
    opt = opt || {};
    var api = global.GalAPI;
    var base = opt.baseUrl || (api && api.loadConfig && api.loadConfig().baseUrl) || '';
    var key = opt.apiKey || (api && api.loadConfig && api.loadConfig().apiKey) || '';
    if (!base) throw new Error('没有配置 API 地址。');

    var url = String(base).replace(/\/+$/, '');
    if (!/\/embeddings$/.test(url)) {
      url += /\/v\d+$/.test(url) ? '/embeddings' : '/v1/embeddings';
    }

    var body = { model: cfg.model, input: texts };
    /* dimensions 只有 text-embedding-3-* 支持，别的模型带上会 400 */
    if (cfg.dimensions && /embedding-3/.test(cfg.model)) body.dimensions = cfg.dimensions;

    var res = await global.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(body),
      signal: opt.signal
    });
    if (!res.ok) {
      var t = '';
      try { t = await res.text(); } catch (e) {}
      var msg = 'embeddings 接口错误 ' + res.status;
      if (res.status === 404) msg += '：这个端点没有 /v1/embeddings。多数中转只转发对话接口，不转嵌入接口 —— 语义检索用不了，会自动退回纯关键词。';
      else if (res.status === 401 || res.status === 403) msg += '：密钥无效或没有嵌入权限。';
      else if (t) msg += '：' + t.slice(0, 200);
      throw new Error(msg);
    }
    var data = await res.json();
    var rows = (data && data.data) || [];
    if (!rows.length) throw new Error('embeddings 接口没有返回向量。');
    /* 有些实现不保证顺序，按 index 排一遍 */
    rows.sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
    return rows.map(function (r) { return r.embedding; });
  }

  /* ---------- 索引 ---------- */

  async function loadIndex() {
    if (index) return index;
    var s = global.GalStore;
    if (!s) { index = {}; return index; }
    try {
      var v = await s.get(INDEX_KEY);
      index = (v && typeof v === 'object') ? v : {};
    } catch (e) { index = {}; }
    return index;
  }

  async function saveIndex() {
    var s = global.GalStore;
    if (!s) return;
    try { await s.set(INDEX_KEY, index || {}); } catch (e) {}
  }

  /**
   * 给条目池建索引。内容没变的条目直接复用缓存，**不重复花钱**。
   * onProgress({done, total, skipped})
   */
  async function buildIndex(pool, opt) {
    opt = opt || {};
    await loadIndex();
    var list = (pool || []).filter(function (e) {
      return e.enabled !== false && String(e.content || '').trim();
    });

    var todo = [], skipped = 0;
    list.forEach(function (e) {
      var body = bodyOf(e);
      var h = hash(cfg.model + '|' + cfg.dimensions + '|' + body);
      var got = index[e.uid];
      if (got && got.hash === h && got.vec && got.vec.length) { skipped++; return; }
      todo.push({ uid: e.uid, body: body, hash: h });
    });

    if (opt.onProgress) opt.onProgress({ done: 0, total: todo.length, skipped: skipped });
    if (!todo.length) return { built: 0, skipped: skipped, total: list.length };

    var done = 0;
    for (var i = 0; i < todo.length; i += cfg.batch) {
      var chunk = todo.slice(i, i + cfg.batch);
      var vecs;
      try {
        vecs = await embed(chunk.map(function (x) { return x.body; }), opt);
      } catch (e) {
        lastError = (e && e.message) || String(e);
        await saveIndex();          // 已经算出来的别浪费
        throw e;
      }
      chunk.forEach(function (x, j) {
        if (vecs[j]) index[x.uid] = { hash: x.hash, vec: shrink(vecs[j]) };
      });
      done += chunk.length;
      if (opt.onProgress) opt.onProgress({ done: done, total: todo.length, skipped: skipped });
    }
    await saveIndex();
    lastError = '';
    return { built: done, skipped: skipped, total: list.length };
  }

  async function clearIndex() {
    index = {};
    recent = {};
    var s = global.GalStore;
    if (s) { try { await s.del(INDEX_KEY); } catch (e) {} }
  }

  async function stats(pool) {
    await loadIndex();
    var n = Object.keys(index).length;
    var list = (pool || []).filter(function (e) {
      return e.enabled !== false && String(e.content || '').trim();
    });
    var stale = 0;
    list.forEach(function (e) {
      var h = hash(cfg.model + '|' + cfg.dimensions + '|' + bodyOf(e));
      if (!index[e.uid] || index[e.uid].hash !== h) stale++;
    });
    return { indexed: n, needed: list.length, stale: stale,
             dims: cfg.dimensions, model: cfg.model, lastError: lastError };
  }

  /* ---------- 时间衰减 ---------- */

  /** 一轮结束后登记这轮注入了哪些条目 */
  function noteActivated(entries, turn) {
    (entries || []).forEach(function (e) {
      if (e && e.uid != null && !e.constant) recent[e.uid] = turn;
    });
  }

  /**
   * 刚注入过的压得最狠，隔的轮次越多恢复越多。
   * decayTurns=6 / decayStrength=0.45 时：
   *   刚注入 → ×0.55　隔 3 轮 → ×0.78　隔 6 轮及以上 → ×1.0
   */
  function decayFactor(uid, turn) {
    var last = recent[uid];
    if (last == null) return 1;
    var gap = turn - last;
    if (gap >= cfg.decayTurns) return 1;
    if (gap < 0) return 1;
    return 1 - cfg.decayStrength * (1 - gap / cfg.decayTurns);
  }

  function resetDecay() { recent = {}; }

  /* ---------- 检索 ---------- */

  /**
   * query(history, pool, opt) → Promise<[{entry, score, raw, decay}]>
   * 只返回**关键词没命中**的那些（exclude 里的会被跳过）。
   */
  async function query(history, pool, opt) {
    opt = opt || {};
    if (!cfg.enabled) return [];
    await loadIndex();
    if (!Object.keys(index).length) return [];

    var lines = (history || []).slice(-Math.max(1, cfg.queryLines))
      .map(function (m) { return String(m.content || ''); })
      .filter(Boolean);
    var q = lines.join('\n').slice(0, 2000);
    if (!q.trim()) return [];

    var qv;
    try {
      qv = (await embed([q], opt))[0];
    } catch (e) {
      lastError = (e && e.message) || String(e);
      return [];        // 查询失败就当这一层不存在，绝不影响关键词激活
    }

    var exclude = {};
    (opt.exclude || []).forEach(function (e) { if (e && e.uid != null) exclude[e.uid] = 1; });
    var turn = opt.turn == null ? 0 : opt.turn;

    var out = [];
    (pool || []).forEach(function (e) {
      if (e.enabled === false || e.constant) return;      // 蓝灯本来就常驻
      if (exclude[e.uid]) return;                          // 关键词已经捞到了
      var row = index[e.uid];
      if (!row || !row.vec) return;
      var raw = cosine(qv, row.vec);
      if (raw < cfg.threshold) return;
      var d = decayFactor(e.uid, turn);
      out.push({ entry: e, raw: raw, decay: d, score: raw * d });
    });

    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, cfg.topK);
  }

  global.Vector = {
    DEFAULTS: DEFAULTS,
    configure: configure, config: config,
    embed: embed, cosine: cosine, hash: hash, bodyOf: bodyOf,
    buildIndex: buildIndex, clearIndex: clearIndex, stats: stats,
    query: query,
    noteActivated: noteActivated, decayFactor: decayFactor, resetDecay: resetDecay,
    _setIndex: function (i) { index = i; },
    _index: function () { return index; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
