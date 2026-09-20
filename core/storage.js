/* ============================================================
 * core/storage.js —— 存档与素材持久化
 *
 * localStorage 只有 5MB，装不下 2MB 的角色卡 + 历史，所以用 IndexedDB。
 * 小配置（API 设置、别名表）仍然走 localStorage，读写更快。
 * ============================================================ */
(function (global) {
  'use strict';

  var DB = 'gal_engine', VER = 1, STORE = 'kv';
  var dbp = null;
  var mode = 'idb';          // idb | local | memory
  var mem = {};              // 最后的退路，刷新即失

  /* file:// 下部分浏览器会禁用或隔离 IndexedDB，
     所以每一层都要能降级，而且要把降级结果告诉界面。 */
  function backend() { return mode; }
  function backendNote() {
    if (mode === 'idb') return '';
    if (mode === 'local') return '当前用 localStorage 存档（容量约 5MB，角色卡不会缓存）。';
    return '当前浏览器不允许本地存储，存档只在本次会话有效，刷新即失。';
  }

  function lsGet(k) {
    try { var v = global.localStorage.getItem('gal_kv:' + k); return v ? JSON.parse(v) : undefined; }
    catch (e) { return undefined; }
  }
  function lsSet(k, v) {
    try { global.localStorage.setItem('gal_kv:' + k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  }

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!global.indexedDB) return rej(new Error('浏览器不支持 IndexedDB'));
      var req = global.indexedDB.open(DB, VER);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(STORE, mode);
        var s = t.objectStore(STORE);
        var out = fn(s);
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }

  function fallback(e) {
    if (mode === 'idb') {
      mode = lsSet('__probe', 1) ? 'local' : 'memory';
      console.warn('[存档] IndexedDB 不可用，降级为 ' + mode, e && e.message);
    }
  }

  function get(k) {
    if (mode === 'idb') {
      return tx('readonly', function (s) { return s.get(k); })
        .catch(function (e) { fallback(e); return get(k); });
    }
    if (mode === 'local') return Promise.resolve(lsGet(k));
    return Promise.resolve(mem[k]);
  }
  function set(k, v) {
    if (mode === 'idb') {
      return tx('readwrite', function (s) { return s.put(v, k); })
        .catch(function (e) { fallback(e); return set(k, v); });
    }
    if (mode === 'local') {
      if (lsSet(k, v)) return Promise.resolve(v);
      mode = 'memory';
    }
    mem[k] = v;
    return Promise.resolve(v);
  }
  function del(k) {
    if (mode === 'idb') {
      return tx('readwrite', function (s) { return s.delete(k); })
        .catch(function (e) { fallback(e); return del(k); });
    }
    if (mode === 'local') {
      try { global.localStorage.removeItem('gal_kv:' + k); } catch (e) {}
      return Promise.resolve();
    }
    delete mem[k];
    return Promise.resolve();
  }
  function keys() {
    if (mode === 'idb') {
      return tx('readonly', function (s) { return s.getAllKeys(); })
        .catch(function (e) { fallback(e); return keys(); });
    }
    if (mode === 'local') {
      var out = [];
      try {
        for (var i = 0; i < global.localStorage.length; i++) {
          var k = global.localStorage.key(i);
          if (k && k.indexOf('gal_kv:') === 0) out.push(k.slice(7));
        }
      } catch (e) {}
      return Promise.resolve(out);
    }
    return Promise.resolve(Object.keys(mem));
  }

  /* ---------- 存档槽 ---------- */
  var SLOT = 'save:';

  function listSaves() {
    return keys().then(function (ks) {
      return Promise.all((ks || []).filter(function (k) { return String(k).indexOf(SLOT) === 0; })
        .map(function (k) {
          return get(k).then(function (v) {
            var id = String(k).slice(SLOT.length);
            return { id: id, at: v && v.at,
                     title: (v && v.title) || '',
                     turns: (v && v.history || []).length,
                     /* 下面三个给界面分组用：自动存档按周目各存各的，
                        列表要能说清"这是哪个开局的第几天" */
                     opening: (v && v.opening) || '',
                     runId: (v && v.runId) || '',
                     auto: id === 'auto' || id.indexOf('auto:') === 0 };
          });
        }));
    }).then(function (list) {
      return list.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    });
  }
  function saveSlot(id, data) {
    return set(SLOT + id, Object.assign({ at: Date.now() }, data));
  }
  function loadSlot(id) { return get(SLOT + id); }
  function deleteSlot(id) { return del(SLOT + id); }

  /* ---------- 素材（角色卡 / 预设） ---------- */
  function putCard(json, name) {
    if (mode !== 'idb') return Promise.resolve(null);   // 太大，localStorage 放不下
    return set('card', { json: json, name: name, at: Date.now() });
  }
  function getCard() { return get('card'); }
  function putPreset(json, name) { return set('preset', { json: json, name: name, at: Date.now() }); }
  function getPreset() { return get('preset'); }
  function clearAll() {
    return keys().then(function (ks) { return Promise.all((ks || []).map(del)); });
  }

  /* ---------- 小配置 ---------- */
  function local(k, v) {
    try {
      if (v === undefined) {
        var raw = global.localStorage.getItem(k);
        return raw ? JSON.parse(raw) : null;
      }
      global.localStorage.setItem(k, JSON.stringify(v));
      return v;
    } catch (e) { return null; }
  }

  global.GalStore = {
    get: get, set: set, del: del, keys: keys,
    listSaves: listSaves, saveSlot: saveSlot, loadSlot: loadSlot, deleteSlot: deleteSlot,
    putCard: putCard, getCard: getCard, putPreset: putPreset, getPreset: getPreset,
    clearAll: clearAll, local: local,
    backend: backend, backendNote: backendNote
  };
})(typeof window !== 'undefined' ? window : globalThis);
