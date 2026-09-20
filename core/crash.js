/* ============================================================
 * core/crash.js —— 全局错误兜底
 *
 * 为什么需要它
 * ------------
 * 这是个无框架的单页应用，一个没接住的异常不会被任何东西拦下。
 * 玩家看到的现象是「点了没反应」—— 舞台不动、按钮不响、连报错都看不到，
 * 因为错误只进了控制台，而玩家不会去开控制台。`submit()` 那个 try/catch
 * 只兜住 `eng.turn()`，渲染路径（play / renderPhone / syncCG / present）
 * 抛了就直接断在那儿，`busy` 还可能永远卡在 true。
 *
 * 所以这个文件干三件事：
 *   1. 接住 window 上的 error 和 unhandledrejection
 *   2. 弹一个说人话的兜底页，**把 message 和 stack 原样摊出来**
 *      —— 玩家报 bug 时能直接截图，不用教他开 F12
 *   3. 给一颗「导出存档」按钮。崩溃时玩家最怕的是进度没了，
 *      这颗按钮比「重新加载」更重要，所以放在前面。
 *
 * ⚠ 这个文件必须是 index.html 里**第一个**加载的脚本：
 *   它要能接住后面任何一个脚本的语法错误和初始化异常。
 *   它本身不依赖任何其它模块，出错了也只是少一层保护，不会连累别人。
 *
 * ⚠ 不要在这里 import 或引用 GalStore 之类的全局：崩溃时它们可能就是坏的那个。
 *   导出存档用的是原生 indexedDB，全程 try/catch，拿不到就退回「只导出内存里的」。
 * ============================================================ */
(function (global) {
  'use strict';

  var shown = false;          // 只弹一次：一个错误常常连带一串，全弹出来只会刷屏
  var seen = {};              // 同一条错误不重复计数
  var log = [];               // 收集所有错误，兜底页里一起列出来

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function record(kind, msg, stack, extra) {
    var key = kind + '|' + msg + '|' + String(stack || '').slice(0, 200);
    if (seen[key]) { seen[key].n++; return seen[key]; }
    var rec = { kind: kind, msg: String(msg || '(没有错误信息)'),
                stack: String(stack || ''), extra: extra || '',
                at: new Date(), n: 1 };
    seen[key] = rec;
    log.push(rec);
    return rec;
  }

  /* ---------- 导出存档 ----------
     不走 GalStore：崩溃时它可能就是坏掉的那个。直接读原生 IndexedDB。 */
  function dumpSaves() {
    return new Promise(function (res) {
      var out = { at: new Date().toISOString(), saves: {}, local: {}, note: '' };
      try {
        for (var i = 0; i < global.localStorage.length; i++) {
          var k = global.localStorage.key(i);
          if (k && k.indexOf('gal_') === 0 &&
              !/key|token|secret/i.test(k)) {          // 不导出密钥
            out.local[k] = global.localStorage.getItem(k);
          }
        }
      } catch (e) { out.note += '读 localStorage 失败：' + e.message + '；'; }

      var done = false;
      var finish = function () { if (!done) { done = true; res(out); } };
      global.setTimeout(finish, 3000);                 // IndexedDB 卡住就别等了

      try {
        var req = global.indexedDB.open('gal');
        req.onerror = function () { out.note += '打不开 IndexedDB；'; finish(); };
        req.onsuccess = function () {
          try {
            var db = req.result;
            if (!db.objectStoreNames.contains('kv')) { finish(); return; }
            var tx = db.transaction('kv', 'readonly').objectStore('kv');
            var all = tx.openCursor();
            all.onsuccess = function (ev) {
              var cur = ev.target.result;
              if (!cur) { finish(); return; }
              if (String(cur.key).indexOf('save:') === 0) out.saves[cur.key] = cur.value;
              cur.continue();
            };
            all.onerror = function () { finish(); };
          } catch (e2) { out.note += String(e2.message); finish(); }
        };
      } catch (e3) { out.note += '没有 IndexedDB；'; finish(); }
    });
  }

  function download(obj) {
    try {
      var blob = new global.Blob([JSON.stringify(obj, null, 2)],
                                 { type: 'application/json' });
      var a = global.document.createElement('a');
      a.href = global.URL.createObjectURL(blob);
      a.download = 'gal-存档备份-' + Date.now() + '.json';
      global.document.body.appendChild(a);
      a.click();
      global.setTimeout(function () {
        global.URL.revokeObjectURL(a.href);
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 1000);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- 兜底页 ---------- */
  function render() {
    var d = global.document;
    if (!d || !d.body) return;                 // 还没 body，等 DOMContentLoaded 再说
    var box = d.getElementById('gal-crash');
    if (!box) {
      box = d.createElement('div');
      box.id = 'gal-crash';
      d.body.appendChild(box);
    }
    var items = log.map(function (r) {
      return '<div class="cr-item"><div class="cr-h">' + esc(r.kind) +
        (r.n > 1 ? ' <i>×' + r.n + '</i>' : '') + '</div>' +
        '<div class="cr-m">' + esc(r.msg) + '</div>' +
        (r.extra ? '<div class="cr-x">' + esc(r.extra) + '</div>' : '') +
        (r.stack ? '<pre class="cr-s">' + esc(r.stack.slice(0, 1600)) + '</pre>' : '') +
        '</div>';
    }).join('');

    box.innerHTML =
      '<div class="cr-card">' +
        '<div class="cr-title">出错了</div>' +
        '<p class="cr-lead">引擎遇到了一个没接住的异常，界面可能已经不响应了。' +
        '<b>先把存档导出来</b>，再刷新页面。</p>' +
        '<div class="cr-acts">' +
          '<button id="cr-save">导出存档备份</button>' +
          '<button id="cr-reload">刷新页面</button>' +
          '<button id="cr-copy">复制错误信息</button>' +
          '<button id="cr-close" class="ghost">先关掉看看</button>' +
        '</div>' +
        '<div class="cr-note" id="cr-note"></div>' +
        '<div class="cr-list">' + items + '</div>' +
        '<p class="cr-foot">报 bug 时把上面这段一起贴出来。' +
        '导出的备份里不含 API 密钥。</p>' +
      '</div>';

    var note = d.getElementById('cr-note');
    var say = function (t) { if (note) note.textContent = t; };

    d.getElementById('cr-save').onclick = function () {
      say('正在读取存档…');
      dumpSaves().then(function (obj) {
        var n = Object.keys(obj.saves).length;
        say(download(obj) ? ('已导出 ' + n + ' 份存档。' + (obj.note || ''))
                          : '导出失败，浏览器不让下载。');
      });
    };
    d.getElementById('cr-reload').onclick = function () { global.location.reload(); };
    d.getElementById('cr-copy').onclick = function () {
      var txt = log.map(function (r) {
        return '[' + r.kind + '] ' + r.msg + (r.extra ? '\n' + r.extra : '') +
               (r.stack ? '\n' + r.stack : '');
      }).join('\n\n');
      try {
        global.navigator.clipboard.writeText(txt).then(
          function () { say('已复制。'); },
          function () { say('复制失败，手动选中上面的文字吧。'); });
      } catch (e) { say('复制失败，手动选中上面的文字吧。'); }
    };
    d.getElementById('cr-close').onclick = function () {
      box.hidden = true;
      shown = false;             // 关掉之后再出错还会再弹
    };
    box.hidden = false;
  }

  function show() {
    if (shown) { if (global.document.getElementById('gal-crash')) render(); return; }
    shown = true;
    if (global.document && global.document.body) render();
    else if (global.document) {
      global.document.addEventListener('DOMContentLoaded', render);
    }
  }

  /* ---------- 挂上去 ---------- */
  global.addEventListener('error', function (e) {
    /* 图片/脚本加载失败也会冒到这里（target 不是 window）。
       死链立绘是常态，swap() 自己处理了，不该为它弹兜底页。 */
    if (e && e.target && e.target !== global && e.target.tagName) {
      if (e.target.tagName === 'SCRIPT') {
        record('脚本没加载上', String(e.target.src || '(内联脚本)'), '',
               '这个文件缺失或路径不对，相关功能会失效。');
        show();
      }
      return;                                   // <img> 之类的忽略
    }
    var err = e && e.error;
    record('未捕获异常', (err && err.message) || (e && e.message),
           err && err.stack,
           e && e.filename ? e.filename + ':' + e.lineno + ':' + e.colno : '');
    show();
  }, true);

  global.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    record('Promise 没有 catch',
           (r && r.message) || String(r),
           r && r.stack);
    show();
  });

  global.GalCrash = {
    /* 给代码里主动上报用：catch 到但确实不该发生的错 */
    report: function (msg, err) {
      record('上报', msg, err && err.stack, err ? String(err.message || err) : '');
      show();
    },
    log: function () { return log.slice(); },
    dumpSaves: dumpSaves,
    _render: render
  };
})(typeof window !== 'undefined' ? window : globalThis);
