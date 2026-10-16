/* ============================================================
 * core/thumbcache.js —— 图库缩略图的本地缓存（v5.29）
 *
 * 图库的封面和差分缩略图走 wsrv.nl 现拉现缩：wsrv 先得把 1MB 的原 PNG 从图床拉过去再压，
 * 没缓存过的图一张要好几秒，网慢的时候一页几十张就是「一直转圈」。
 * 以前拉到的图只存成内存里的 blob 地址，关掉页面就没了，下次打开又从头来一遍。
 *
 * 现在拉到的缩略图本体存一份 IndexedDB（单独一个库 gal_thumbs，不碰存档那个库）：
 *   · 第二次打开图库直接从本地读，不发请求
 *   · 只是缓存：丢了就重新拉，所以任何一步出错都当「没有」处理，绝不抛给上层
 *   · 超过 MAX_N 张或 MAX_BYTES 字节，按「最后用到的时间」淘汰最旧的
 *
 * 对外：window.ThumbCache
 *   get(key)        → Promise<Blob|null>   顺手记一下「刚用过」
 *   put(key, blob)  → Promise<void>        写完会在空闲时检查一次要不要淘汰
 *   clear()         → Promise<void>
 *   stats()         → Promise<{n, bytes}>
 *   prune([maxN, maxBytes]) 立刻按上限淘汰一次（平时 put 之后会自己排一次，不用手动调）
 *   available()     → 这个浏览器能不能用（隐私模式 / 不支持时为 false，图库照常工作，只是不缓存）
 * ============================================================ */
(function (root) {
  'use strict';

  var DB = 'gal_thumbs', STORE = 't', VER = 1;
  var MAX_N = 4000, MAX_BYTES = 80 * 1024 * 1024;
  var dbp = null, broken = false, pruneTimer = null, seq = 0;

  function open() {
    if (broken || !root.indexedDB) return Promise.resolve(null);
    if (dbp) return dbp;
    dbp = new Promise(function (res) {
      var req;
      try { req = root.indexedDB.open(DB, VER); } catch (e) { broken = true; return res(null); }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var s = db.createObjectStore(STORE, { keyPath: 'k' });
          s.createIndex('t', 't');
        }
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () { try { db.close(); } catch (e) {} dbp = null; };
        res(db);
      };
      req.onerror = req.onblocked = function () { broken = true; res(null); };
    });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        var t, out = null;
        try { t = db.transaction(STORE, mode); } catch (e) { return res(null); }
        t.oncomplete = function () { res(out); };
        t.onerror = t.onabort = function () { res(null); };
        try { fn(t.objectStore(STORE), function (v) { out = v; }); } catch (e) { try { t.abort(); } catch (e2) {} res(null); }
      });
    }, function () { return null; });
  }

  function get(key) {
    return tx('readwrite', function (s, set) {
      var r = s.get(key);
      r.onsuccess = function () {
        var v = r.result;
        if (!v || !v.b) return;
        set(v.b);
        /* 记一下「刚用过」：淘汰按这个时间来。一天之内用过的不重写，省得每次打开都写几十条 */
        if (Date.now() - (v.t || 0) > 864e5) { v.t = Date.now(); s.put(v); }
      };
    }).then(function (b) { return b || null; });
  }

  function put(key, blob) {
    if (!blob || !blob.size) return Promise.resolve();
    return tx('readwrite', function (s) {
      s.put({ k: key, b: blob, n: blob.size, t: Date.now() + (seq++ % 1000) / 1000 });   // 同一毫秒写的也分得出先后
    }).then(schedulePrune);
  }

  function stats() {
    return tx('readonly', function (s, set) {
      var n = 0, bytes = 0, c = s.openCursor();
      c.onsuccess = function () {
        var cur = c.result;
        if (!cur) return set({ n: n, bytes: bytes });
        n++; bytes += cur.value.n || 0;
        cur.continue();
      };
    }).then(function (r) { return r || { n: 0, bytes: 0 }; });
  }

  /** 超了就从最旧的删起，删到 90% 以下（留点余量，免得每写一张删一张）。maxN / maxBytes 不给就用默认上限（测试用） */
  function prune(maxN, maxBytes) {
    var LN = maxN || MAX_N, LB = maxBytes || MAX_BYTES;
    return stats().then(function (st) {
      if (st.n <= LN && st.bytes <= LB) return;
      var n = st.n, bytes = st.bytes;
      return tx('readwrite', function (s) {
        var c = s.index('t').openCursor();
        c.onsuccess = function () {
          var cur = c.result;
          if (!cur || (n <= LN * 0.9 && bytes <= LB * 0.9)) return;
          n--; bytes -= cur.value.n || 0;
          cur.delete();
          cur.continue();
        };
      });
    });
  }
  function schedulePrune() {
    if (pruneTimer) return;
    pruneTimer = setTimeout(function () { pruneTimer = null; prune(); }, 4000);
  }

  function clear() {
    return tx('readwrite', function (s) { s.clear(); }).then(function () {});
  }

  root.ThumbCache = {
    get: get, put: put, clear: clear, stats: stats, prune: prune,
    available: function () { return !broken && !!root.indexedDB; },
    MAX_N: MAX_N, MAX_BYTES: MAX_BYTES
  };
})(typeof window !== 'undefined' ? window : globalThis);
