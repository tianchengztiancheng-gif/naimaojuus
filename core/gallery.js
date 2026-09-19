/* ============================================================
 * core/gallery.js —— 生成图的存放与相册
 *
 * 为什么单独一层：生成的图是 dataURL，一张 1~2MB。每轮出 1~2 张，
 * 几十轮就是上百 MB —— **绝对不能塞进存档**，否则存档几轮就废了
 * （开拓轶事专门有个 saveImageCompactor.ts 干这件事，教训在前）。
 *
 * 所以：
 *   · 图片本体各自一条 IndexedDB 记录（img:<id>），按需读取
 *   · 一份不含图片本体的索引（gallery:index），列表只读这一条
 *   · 存档里只存 id，读档时按 id 回查
 *
 * 容量兜底：超过上限时淘汰最旧的；玩家收藏（pinned）的永不淘汰 ——
 * 这条和手机动态的「种子内容永远保留」是同一个道理。
 * ============================================================ */
(function (global) {
  'use strict';

  var IDX = 'gallery:index';
  var PREFIX = 'img:';
  var MAX = 200;                 // 图片条数上限
  var index = null;              // [{id, at, turn, title, prompt, model, backend, seed, bytes, pinned, source}]
  var memBlobs = {};             // 降级到 localStorage/内存时，图片只留在这一轮会话里
  var loading = null;

  function store() { return global.GalStore; }
  function idbOK() {
    var s = store();
    return !!(s && typeof s.backend === 'function' && s.backend() === 'idb');
  }

  function newId() {
    return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /** dataURL 的大致字节数（base64 4 字符 = 3 字节） */
  function sizeOf(src) {
    var s = String(src || '');
    var i = s.indexOf(',');
    if (i < 0) return s.length;
    return Math.floor((s.length - i - 1) * 3 / 4);
  }

  function load() {
    if (index) return Promise.resolve(index);
    if (loading) return loading;
    var s = store();
    if (!s) { index = []; return Promise.resolve(index); }
    loading = s.get(IDX).then(function (v) {
      index = Array.isArray(v) ? v : [];
      return index;
    }).catch(function () { index = []; return index; });
    return loading;
  }

  function flush() {
    var s = store();
    if (!s) return Promise.resolve();
    return s.set(IDX, index || []).catch(function () {});
  }

  /* ============================================================
     写入
     ============================================================ */

  /**
   * 存一张图。rec = { src, mimeType, prompt, negativePrompt, model, backend,
   *                  seed, title, turn, logIndex, source, context }
   * 返回 id。src 不会进索引，只进 img:<id>。
   */
  async function put(rec) {
    rec = rec || {};
    await load();
    var id = rec.id || newId();
    var meta = {
      id: id,
      at: Date.now(),
      turn: rec.turn == null ? -1 : rec.turn,
      logIndex: rec.logIndex == null ? -1 : rec.logIndex,
      title: String(rec.title || '').slice(0, 40),
      prompt: String(rec.prompt || '').slice(0, 900),
      negativePrompt: String(rec.negativePrompt || '').slice(0, 600),
      model: rec.model || '',
      backend: rec.backend || '',
      seed: rec.seed == null ? -1 : rec.seed,
      source: rec.source || '',          // model | inline | local
      mimeType: rec.mimeType || 'image/png',
      bytes: sizeOf(rec.src),
      pinned: !!rec.pinned
    };

    if (idbOK()) {
      await store().set(PREFIX + id, { src: rec.src, at: meta.at });
    } else {
      /* IndexedDB 不可用时不往 localStorage 里塞图（5MB 一张就满），
         只在内存里留着，刷新即失。索引照常记，这样界面行为一致。 */
      memBlobs[id] = rec.src;
      meta.volatile = true;
    }

    index.unshift(meta);
    await gc();
    await flush();
    return id;
  }

  /** 超上限时淘汰最旧的非收藏图 */
  async function gc(max) {
    max = max || MAX;
    await load();
    if (index.length <= max) return 0;
    var keep = [], drop = [];
    /* index 是新的在前，所以从后往前数着留 */
    var kept = 0;
    for (var i = 0; i < index.length; i++) {
      var m = index[i];
      if (m.pinned) { keep.push(m); continue; }
      if (kept < max) { keep.push(m); kept++; }
      else drop.push(m);
    }
    if (!drop.length) return 0;
    keep.sort(function (a, b) { return b.at - a.at; });
    index = keep;
    var s = store();
    for (var j = 0; j < drop.length; j++) {
      delete memBlobs[drop[j].id];
      if (s) { try { await s.del(PREFIX + drop[j].id); } catch (e) {} }
    }
    return drop.length;
  }

  /* ============================================================
     读取
     ============================================================ */

  async function get(id) {
    await load();
    var meta = index.filter(function (m) { return m.id === id; })[0];
    if (!meta) return null;
    if (memBlobs[id]) return Object.assign({}, meta, { src: memBlobs[id] });
    var s = store();
    if (!s) return null;
    var row = await s.get(PREFIX + id).catch(function () { return null; });
    if (!row || !row.src) return null;
    return Object.assign({}, meta, { src: row.src });
  }

  /** 只要 URL，界面渲染用这个 */
  async function src(id) {
    var r = await get(id);
    return r ? r.src : null;
  }

  async function meta(id) {
    await load();
    return index.filter(function (m) { return m.id === id; })[0] || null;
  }

  /** 列表（不含图片本体）。opt = { turn, pinned, limit } */
  async function list(opt) {
    opt = opt || {};
    await load();
    var out = index.slice();
    if (opt.turn != null) out = out.filter(function (m) { return m.turn === opt.turn; });
    if (opt.pinned) out = out.filter(function (m) { return m.pinned; });
    if (opt.limit) out = out.slice(0, opt.limit);
    return out;
  }

  async function byTurn(turn) { return list({ turn: turn }); }

  async function remove(id) {
    await load();
    index = index.filter(function (m) { return m.id !== id; });
    delete memBlobs[id];
    var s = store();
    if (s) { try { await s.del(PREFIX + id); } catch (e) {} }
    await flush();
    return true;
  }

  async function pin(id, on) {
    await load();
    var m = index.filter(function (x) { return x.id === id; })[0];
    if (!m) return false;
    m.pinned = on !== false;
    await flush();
    return m.pinned;
  }

  async function stats() {
    await load();
    var bytes = 0, pinned = 0, volatile = 0;
    index.forEach(function (m) {
      bytes += m.bytes || 0;
      if (m.pinned) pinned++;
      if (m.volatile) volatile++;
    });
    return {
      count: index.length, max: MAX, pinned: pinned, volatile: volatile,
      bytes: bytes, mb: Math.round(bytes / 1048576 * 10) / 10,
      persistent: idbOK()
    };
  }

  /** 清空（相册面板的「全部删除」） */
  async function clear() {
    await load();
    var s = store();
    for (var i = 0; i < index.length; i++) {
      delete memBlobs[index[i].id];
      if (s) { try { await s.del(PREFIX + index[i].id); } catch (e) {} }
    }
    index = [];
    await flush();
  }

  /** 存档只存 id —— 这个函数就是「别把图塞进存档」那条规矩的落地点 */
  async function forSave() {
    await load();
    return index.filter(function (m) { return !m.volatile; })
                .map(function (m) { return { id: m.id, turn: m.turn, logIndex: m.logIndex, title: m.title }; });
  }

  global.Gallery = {
    put: put, get: get, src: src, meta: meta, list: list, byTurn: byTurn,
    remove: remove, pin: pin, stats: stats, clear: clear, gc: gc, forSave: forSave,
    sizeOf: sizeOf,
    _reset: function () { index = null; loading = null; memBlobs = {}; },
    MAX: MAX
  };
})(typeof window !== 'undefined' ? window : globalThis);
