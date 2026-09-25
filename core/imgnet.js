/* ============================================================
 * core/imgnet.js —— 图片网络：直连 / 中转 / 预加载 / 诊断（v5.24）
 *
 * 卡里的立绘、背景几千张，全挂在第三方图床上（juus 是 files.catbox.moe，天青是 huggingface.co）。
 * 这两个在国内都得走代理。有人反馈「电脑上好好的，手机上同一个梯子图全裂」——
 * 手机代理常见的坑：规则模式没把图床算进去、分应用代理没勾浏览器、IPv6 / 私人 DNS 绕过了代理。
 * 这不是页面能修的，但页面能做三件事：
 *   1. 直连不通就自动改走图片中转（默认 wsrv.nl：开源的图片代理，顺手压成 webp，
 *      一张 4096 的背景 670KB → 110KB，手机上快得多）。也可以填自己的中转地址。
 *   2. 一轮剧情演之前，先把这一轮要用的背景和立绘都拉下来（有上限，不会一直干等）。
 *   3. 「测试图片网络」：分别测本站、图床直连、图床经中转，直接告诉玩家是哪一段不通。
 *
 * 对外：window.ImgNet
 *   config() / setConfig(patch)      设置（localStorage gal_imgnet）：mode auto|relay|direct|custom，tpl，wait（秒）
 *   srcFor(url)                      现在该用哪个地址（直连 / 中转）
 *   candidates(url)                  按顺序该试的地址
 *   next(failedSrc)                  这个地址挂了，下一个该试谁（没有了返回 null）
 *   note(src, ok)                    记一笔成败（按图床统计，直连一张都没成过就判「直连不通」）
 *   load(url, timeoutMs)             试到能用为止，resolve 能用的地址或 null
 *   preload(urls, {wait, onProgress, skip}) 一批一起拉，最多等 wait 秒
 *   diagnose(samples)                测网络，给出每一段的结果
 *   attach(document)                 页面里所有 <img> 挂了自动换中转；图床判了不通之后新插的 <img> 直接走中转
 *   on(fn)                           事件：('hostbad', host) 直连不通、已经靠中转拉到图了；('allbad', host) 中转也不通
 * ============================================================ */
(function (root) {
  'use strict';

  var RELAY = 'https://wsrv.nl/?url=';
  var KEY = 'gal_imgnet', HKEY = 'gal_imgnet_hosts';
  var BAD_TTL = 12 * 3600 * 1000;           // 「直连不通」记 12 小时，下次打开直接走中转
  var DEFAULTS = { mode: 'auto', tpl: '', wait: 12 };
  var MODES = ['auto', 'relay', 'direct', 'custom'];

  function lsGet(k) {
    try { return JSON.parse(root.localStorage.getItem(k) || 'null'); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function now() { return Date.now(); }

  var cfg = normalize(Object.assign({}, DEFAULTS, lsGet(KEY) || {}));
  function normalize(c) {
    if (MODES.indexOf(c.mode) < 0) c.mode = 'auto';
    if (c.mode === 'custom' && !/\{(url|raw|path)\}/.test(c.tpl || '')) c.mode = 'auto';
    c.wait = Math.max(0, Math.min(60, Number(c.wait) || 0));
    c.tpl = String(c.tpl || '').trim();
    return c;
  }

  /* 每个图床一份账：直连成 / 败，中转成 / 败，bad = 判了「直连不通」的时间 */
  var hosts = {};
  (function restore() {
    var h = lsGet(HKEY) || {}, t = now();
    Object.keys(h).forEach(function (k) {
      if (h[k] && t - h[k] < BAD_TTL) hosts[k] = { ok: 0, fail: 0, rok: 0, rfail: 0, bad: h[k] };
    });
  })();
  function persistHosts() {
    var o = {};
    Object.keys(hosts).forEach(function (k) { if (hosts[k].bad) o[k] = hosts[k].bad; });
    lsSet(HKEY, o);
  }
  function hostRec(h) {
    return hosts[h] || (hosts[h] = { ok: 0, fail: 0, rok: 0, rfail: 0, bad: 0 });
  }

  var origin = {};     // 候选地址 → 原图地址
  var tried = {};      // 原图地址 → { 试过且挂了的地址: 1 }
  var good = {};       // 原图地址 → 拉成功的那个地址
  var pending = {};    // 原图地址 → 正在拉的 Promise
  var maxEdge = 2048;  // 中转时长边上限（手机上 app 会调小）
  var listeners = [];
  var warned = {};

  function emit(type, a) {
    listeners.forEach(function (fn) { try { fn(type, a); } catch (e) {} });
  }
  function isRemote(u) { return /^https?:\/\//i.test(u || ''); }
  function hostOf(u) {
    var m = /^https?:\/\/([^\/?#:]+)/i.exec(u || '');
    return m ? m[1].toLowerCase() : '';
  }
  function isOwnRelay(u) {
    if (u.indexOf(RELAY) === 0) return true;
    return !!(cfg.tpl && origin[u] && origin[u] !== u);
  }

  /** 中转地址。自定义模板：{url} = 编码后的原地址，{raw} = 原样，{path} = 去掉 https:// */
  function relayOf(u) {
    if (cfg.mode === 'custom' && cfg.tpl) {
      return cfg.tpl.replace(/\{url\}/g, encodeURIComponent(u))
        .replace(/\{raw\}/g, u)
        .replace(/\{path\}/g, u.replace(/^https?:\/\//i, ''));
    }
    var gif = /\.gif(\?|#|$)/i.test(u);
    return RELAY + encodeURIComponent(u) + '&w=' + maxEdge + '&h=' + maxEdge +
      '&fit=inside&we' + (gif ? '&n=-1' : '') + '&output=webp&q=82';
  }

  /** 这个地址本来是哪张图（中转地址反推回原图） */
  function originOf(src) {
    if (!src) return '';
    if (origin[src]) return origin[src];
    if (src.indexOf(RELAY) === 0) {
      try { return decodeURIComponent(src.slice(RELAY.length).split('&')[0]); } catch (e) {}
    }
    return src;
  }

  function relayFirst(u) {
    if (cfg.mode === 'relay' || cfg.mode === 'custom') return true;
    if (cfg.mode === 'direct') return false;
    var h = hosts[hostOf(u)];
    return !!(h && h.bad);
  }

  function candidates(u) {
    if (!isRemote(u) || isOwnRelay(u)) return [u];
    origin[u] = u;
    if (cfg.mode === 'direct') return [u];
    var r = relayOf(u);
    origin[r] = u;
    return relayFirst(u) ? [r, u] : [u, r];
  }

  function srcFor(u) {
    if (!isRemote(u)) return u;
    if (good[u]) return good[u];
    var c = candidates(u), t = tried[u] || {};
    for (var i = 0; i < c.length; i++) if (!t[c[i]]) return c[i];
    return c[0];
  }

  function note(src, ok) {
    var u = originOf(src), h = hostOf(u);
    if (!h) return;
    var s = hostRec(h), relayed = src !== u;
    if (ok) {
      good[u] = src;
      if (relayed) {
        s.rok++;
        /* 判了直连不通、并且中转真拉到图了，才告诉玩家「已改走中转」——
           中转也不通的时候说这句是骗人 */
        if (s.bad && !s.told) { s.told = 1; emit('hostbad', h); }
      }
      else {
        s.ok++;
        if (s.bad) { s.bad = 0; persistHosts(); }
      }
      return;
    }
    (tried[u] || (tried[u] = {}))[src] = 1;
    if (good[u] === src) delete good[u];
    if (relayed) s.rfail++; else s.fail++;
    if (cfg.mode === 'auto' && !s.bad && s.ok === 0 && (s.fail >= 2 || (s.fail >= 1 && s.rok >= 1))) {
      s.bad = now();
      persistHosts();
    }
    if (!warned[h] && s.ok === 0 && s.rok === 0 && s.fail + s.rfail >= 4 &&
        (cfg.mode === 'direct' || s.rfail >= 2)) {
      warned[h] = 1;
      emit('allbad', h);
    }
  }

  /** 这个地址挂了：记账，给出下一个该试的（没有了 null） */
  function next(src) {
    var u = originOf(src);
    if (!isRemote(u)) return null;
    note(src, false);
    var c = candidates(u), t = tried[u] || {};
    for (var i = 0; i < c.length; i++) if (!t[c[i]]) return c[i];
    return null;
  }

  /** 用一个不挂在页面上的 Image 试一个地址。超时也算失败 */
  function probe(src, timeout) {
    return new Promise(function (res) {
      var Img = root.Image;
      if (!Img) return res(false);
      var im = new Img(), done = false;
      var timer = setTimeout(function () { fin(false); }, timeout || 8000);
      function fin(ok) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        im.onload = im.onerror = null;
        if (!ok) { try { im.src = ''; } catch (e) {} }
        res(ok);
      }
      im.onload = function () { fin(!(im.naturalWidth === 0 && im.width === 0)); };
      im.onerror = function () { fin(false); };
      try { im.decoding = 'async'; } catch (e) {}
      im.src = src;
    });
  }

  /** 挨个试到能用为止。同一张图同时只拉一次 */
  function load(u, timeout) {
    if (!isRemote(u)) return Promise.resolve(u || null);
    if (good[u]) return Promise.resolve(good[u]);
    if (pending[u]) return pending[u];
    var c = candidates(u).filter(function (s) { return !(tried[u] || {})[s]; });
    if (!c.length) c = candidates(u);
    var i = 0;
    var p = new Promise(function (res) {
      (function step() {
        if (i >= c.length) return res(null);
        var src = c[i++];
        probe(src, timeout || (cfg.mode === 'auto' && src === u ? 7000 : 12000)).then(function (ok) {
          if (ok) { note(src, true); res(src); } else { note(src, false); step(); }
        });
      })();
    });
    pending[u] = p;
    p.then(function () { delete pending[u]; });
    return p;
  }

  /**
   * 一批图一起拉。最多等 opt.wait 秒（默认用设置里的），到点就先 resolve，没拉完的继续在后台拉。
   * opt.onProgress(done, total)；opt.skip 是个 Promise，玩家点「跳过」就不等了。
   */
  function preload(urls, opt) {
    opt = opt || {};
    var seen = {}, list = [];
    (urls || []).forEach(function (u) {
      if (isRemote(u) && !seen[u]) { seen[u] = 1; list.push(u); }
    });
    var n = list.length, done = 0, okN = 0;
    var wait = opt.wait != null ? opt.wait : cfg.wait;
    return new Promise(function (res) {
      var finished = false, timer = null;
      function fin(timedOut, skipped) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        res({ total: n, ok: okN, done: done, failed: done - okN, timedOut: !!timedOut, skipped: !!skipped });
      }
      if (!n) return fin(false);
      list.forEach(function (u) {
        load(u).then(function (src) {
          done++;
          if (src) okN++;
          if (opt.onProgress && !finished) opt.onProgress(done, n, okN);
          if (done === n) fin(false);
        });
      });
      if (!(wait > 0)) return fin(false);
      timer = setTimeout(function () { fin(true); }, wait * 1000);
      if (opt.skip && opt.skip.then) opt.skip.then(function () { fin(false, true); });
    });
  }

  /* ---------------- 诊断 ---------------- */
  function timedFetch(url, ms) {
    var t0 = now();
    if (!root.fetch) return probe(url, ms).then(function (ok) { return { ok: ok, ms: now() - t0, via: 'img' }; });
    var ctl = root.AbortController ? new root.AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return root.fetch(url, { cache: 'no-store', mode: 'cors', signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        return r.blob().then(function (b) {
          clearTimeout(timer);
          return { ok: r.ok, status: r.status, ms: now() - t0, bytes: b.size };
        });
      })
      .catch(function (e) {
        clearTimeout(timer);
        var to = e && e.name === 'AbortError';
        if (to) return { ok: false, ms: now() - t0, err: 'timeout' };
        /* 不让跨域读（自定义中转常见）：退回用 <img> 试，能显示就算通 */
        var t1 = now();
        return probe(url + (url.indexOf('?') < 0 ? '?' : '&') + '_gal=' + t1, ms).then(function (ok) {
          return { ok: ok, ms: now() - t1, via: 'img', err: ok ? '' : String(e && e.message || e) };
        });
      });
  }

  /**
   * 测网络。samples：每个图床挑一张图的原地址。
   * 返回 { site, hosts: [{ host, sample, direct, relay }] }，每项 { ok, ms, bytes?, err? }
   */
  function diagnose(samples, opt) {
    opt = opt || {};
    var ms = opt.timeout || 10000;
    var siteUrl = opt.siteUrl || 'index.html';
    var list = [], seen = {};
    (samples || []).forEach(function (u) {
      var h = hostOf(u);
      if (h && !seen[h]) { seen[h] = 1; list.push(u); }
    });
    /* 双击 index.html 本地打开时 fetch 不了 file://，本站这一项不用测 */
    var local = root.location && root.location.protocol === 'file:';
    var siteP = local ? Promise.resolve({ ok: true, ms: 0, local: true })
      : timedFetch(siteUrl + (siteUrl.indexOf('?') < 0 ? '?' : '&') + '_gal=' + now(), ms);
    var hostPs = list.map(function (u) {
      var direct = timedFetch(u, ms);
      var relay = cfg.mode === 'direct' && !opt.forceRelay ? Promise.resolve(null)
        : timedFetch(relayOf(u), ms + 5000);
      return Promise.all([direct, relay]).then(function (r) {
        var h = hostOf(u), s = hostRec(h);
        /* 顺手更新账本：测出来直连通了就撤掉「直连不通」 */
        if (r[0].ok) { s.ok++; if (s.bad) { s.bad = 0; persistHosts(); } }
        else if (cfg.mode === 'auto' && r[1] && r[1].ok && !s.bad) { s.bad = now(); persistHosts(); }
        return { host: h, sample: u, direct: r[0], relay: r[1] };
      });
    });
    return Promise.all([siteP, Promise.all(hostPs)]).then(function (r) {
      return { site: r[0], hosts: r[1], mode: cfg.mode, relayName: cfg.mode === 'custom' ? '自定义中转' : 'wsrv.nl' };
    });
  }

  /* ---------------- 接到页面上 ---------------- */
  var attached = false;
  function attach(doc) {
    if (attached || !doc || !doc.addEventListener) return;
    attached = true;
    /* <img> 挂了：还有别的地址可试就换上，并且拦住这次 error，
       不让元素自己的 onerror（「挂了就藏掉」）先把它藏了。都试过了才放行。 */
    doc.addEventListener('error', function (e) {
      var el = e.target;
      if (!el || el.tagName !== 'IMG') return;
      var src = el.getAttribute('src') || '';
      if (!isRemote(src)) return;
      var alt = next(src);
      if (alt && alt !== src) {
        e.stopImmediatePropagation();
        el.setAttribute('src', alt);
      }
    }, true);
    doc.addEventListener('load', function (e) {
      var el = e.target;
      if (!el || el.tagName !== 'IMG') return;
      var src = el.getAttribute('src') || '';
      if (isRemote(src)) note(src, true);
    }, true);
    /* 已经判了直连不通（或设置成总走中转）：新插进来的 <img> 直接换成中转地址，
       不用先等直连超时 —— 墙掉的请求有时要挂几十秒才报错 */
    var MO = root.MutationObserver;
    if (!MO) return;
    var fix = function (el) {
      var src = el.getAttribute && el.getAttribute('src');
      if (!src || !isRemote(src) || isOwnRelay(src)) return;
      var want = srcFor(src);
      if (want && want !== src) el.setAttribute('src', want);
    };
    new MO(function (muts) {
      if (cfg.mode === 'direct') return;
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'attributes') { if (m.target.tagName === 'IMG') fix(m.target); continue; }
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'IMG') fix(n);
          else if (n.querySelectorAll) {
            var imgs = n.querySelectorAll('img[src]');
            for (var k = 0; k < imgs.length; k++) fix(imgs[k]);
          }
        }
      }
    }).observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  }

  function setConfig(patch) {
    var before = cfg.mode + '|' + cfg.tpl;
    cfg = normalize(Object.assign({}, cfg, patch || {}));
    lsSet(KEY, { mode: cfg.mode, tpl: cfg.tpl, wait: cfg.wait });
    if (before !== cfg.mode + '|' + cfg.tpl) { tried = {}; good = {}; warned = {}; }
    return config();
  }
  function config() { return { mode: cfg.mode, tpl: cfg.tpl, wait: cfg.wait }; }
  function stats() {
    var o = {};
    Object.keys(hosts).forEach(function (k) { o[k] = Object.assign({}, hosts[k]); });
    return o;
  }
  function resetHosts() { hosts = {}; tried = {}; good = {}; warned = {}; persistHosts(); }

  root.ImgNet = {
    DEFAULTS: DEFAULTS, RELAY: RELAY,
    config: config, setConfig: setConfig,
    isRemote: isRemote, hostOf: hostOf, relayOf: relayOf, originOf: originOf,
    candidates: candidates, srcFor: srcFor, next: next, note: note,
    load: load, preload: preload, probe: probe, diagnose: diagnose,
    attach: attach, stats: stats, resetHosts: resetHosts,
    setMaxEdge: function (n) { maxEdge = Math.max(512, Math.min(4096, n | 0)); },
    on: function (fn) { listeners.push(fn); }
  };
})(typeof window !== 'undefined' ? window : this);
