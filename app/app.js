/* ============================================================
 * app/app.js —— 界面与流程
 * 渲染器消费 engine.processOutput() 产出的 modules，
 * 每句已经带好解析后的 sprites / scene，这里只负责画。
 * ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var PA2 = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
  var eng = new Engine();
  var qi = 0, typing = false, typer = null, pending = '', busy = false;
  var lastRaw = '', lastResult = null, currentOpening = null;
  var abortCtl = null, elapsedTimer = null;

  function startSpinner() {
    var t0 = Date.now();
    $('elapsed').textContent = '';
    $('spinner').hidden = false;
    clearInterval(elapsedTimer);
    elapsedTimer = setInterval(function () {
      $('elapsed').textContent = ' ' + ((Date.now() - t0) / 1000).toFixed(0) + 's';
    }, 500);
  }
  function stopSpinner() {
    clearInterval(elapsedTimer);
    $('spinner').hidden = true;
    $('spin-t').textContent = '生成中';
    $('btn-abort').textContent = '中断';
  }

  /* ============================================================
     图片网络（core/imgnet.js）：直连不通自动走中转；一轮演之前先把图拉好
     ============================================================ */
  ImgNet.attach(document);
  ImgNet.on(function (type, host) {
    if (type === 'hostbad') {
      toast('图床 ' + host + ' 直连加载不出来，已自动改走图片中转。想查是哪一段不通：' +
        '手机 → 设置 → 图片网络 → 测试。', 'warn', 9000);
    } else if (type === 'allbad') {
      toast('图片一张都加载不出来：' + host + ' 直连和中转都不通，多半是网络 / 代理的问题。' +
        '手机 → 设置 → 图片网络 → 测试，会告诉你卡在哪。', 'bad', 14000);
    }
  });
  function lineImgs(m) {
    var out = [];
    if (!m) return out;
    if (m.scene && m.scene.url) out.push(m.scene.url);
    (m.sprites || []).forEach(function (s) { if (s.url) out.push(s.url); });
    return out;
  }
  /**
   * 一轮剧情演之前：这一轮要用的背景和立绘先拉下来，拉好了再开演（设置里的「每轮最多等几秒」封顶，
   * 玩家也可以点「不等了」）。没拉完的继续在后台拉，演到那句时多半已经到了。
   */
  var imgSkip = null;
  function waitImages(mods) {
    var urls = [];
    (mods || []).forEach(function (m) { urls = urls.concat(lineImgs(m)); });
    urls = urls.filter(function (u, i) { return ImgNet.isRemote(u) && urls.indexOf(u) === i; });
    var todo = urls;
    if (!todo.length || !(ImgNet.config().wait > 0)) {
      ImgNet.preload(todo, { wait: 0 });
      return Promise.resolve(null);
    }
    clearInterval(elapsedTimer);
    $('spinner').hidden = false;
    $('spin-t').textContent = '加载立绘和背景';
    $('btn-abort').textContent = '不等了';
    $('elapsed').textContent = ' 0/' + todo.length;
    var skip = new Promise(function (r) { imgSkip = r; });
    return ImgNet.preload(todo, {
      skip: skip,
      onProgress: function (d, t) { $('elapsed').textContent = ' ' + d + '/' + t; }
    }).then(function (r) {
      imgSkip = null;
      $('spin-t').textContent = '生成中';
      $('btn-abort').textContent = '中断';
      return r;
    });
  }

  /* ============================================================
     背景（双缓冲交叉淡入）
     ============================================================ */
  var bgFront = $('bgA'), bgBack = $('bgB'), lastBgUrl = null;
  /* 背景是 CSS background，挂了没有 error 事件、只会黑屏。所以先用 ImgNet 拉到手
     （直连不通自动走中转），拉到了再交叉淡入；都拉不到就留着上一张，不黑屏。
     bgTok：连着翻几句时，只认最后一次。 */
  var bgTok = 0;
  function paintBG(url, instant) {
    if (!url || url === lastBgUrl) return;
    lastBgUrl = url;
    var tok = ++bgTok;
    ImgNet.load(url).then(function (src) {
      if (tok !== bgTok) return;
      if (!src) { noteImgFail('背景', url); return; }
      bgBack.style.backgroundImage = 'url("' + src + '")';
      if (instant) {
        bgBack.style.transition = 'none';
        requestAnimationFrame(function () { bgBack.style.transition = ''; });
      }
      bgBack.classList.add('show');
      bgFront.classList.remove('show');
      var t = bgFront; bgFront = bgBack; bgBack = t;
    });
  }

  /* ============================================================
     立绘舞台（每角色一个锚点，锚点内双缓冲换表情）
     ============================================================ */
  var spritesEl = $('sprites'), live = new Map(), stageNow = [];

  /* 出场 8 种、换表情 5 种（外加一次"不动"），随机挑一个。取自 juus 卡。 */
  var ENTER_FX = ['enter-rise', 'enter-left', 'enter-right', 'enter-drop',
                  'enter-zoom', 'enter-far', 'enter-tilt', 'enter-pop'];
  var CHANGE_FX = ['chg-bounce', 'chg-swayx', 'chg-swayy', 'chg-tilt', 'chg-perk', ''];
  var FX_ALL = ENTER_FX.concat(CHANGE_FX).filter(Boolean);

  function playFx(layerEl, pool) {
    if (!layerEl || !fxOn) return;
    var fx = pool[Math.floor(Math.random() * pool.length)];
    FX_ALL.forEach(function (c) { layerEl.classList.remove(c); });
    if (!fx) return;
    void layerEl.offsetWidth;            // 强制重启动画
    layerEl.classList.add(fx);
    setTimeout(function () { layerEl.classList.remove(fx); }, 700);
  }
  var fxOn = true;

  function makeChar(name) {
    var el = document.createElement('div');
    el.className = 'char entering';
    var a = document.createElement('div'), b = document.createElement('div');
    a.className = b.className = 'layer';
    [a, b].forEach(function (lay) {
      var im = document.createElement('img');
      /* 图挂了就把整层藏掉，别在舞台上留一个破图图标 */
      im.onerror = function () { lay.style.visibility = 'hidden'; };
      im.onload = function () { lay.style.visibility = ''; };
      lay.appendChild(im);
    });
    el.append(a, b);
    spritesEl.appendChild(el);
    /* name 要留着：swap() 记录死链时得知道是谁的图 */
    var rec = { el: el, front: a, back: b, url: null, name: name };
    live.set(name, rec);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.remove('entering'); });
    });
    return rec;
  }

  function layout() {
    var n = stageNow.length;
    stageNow.forEach(function (c, i) {
      var rec = live.get(c.who);
      if (rec) rec.el.style.left = ((i + 1) / (n + 1) * 100).toFixed(3) + '%';
    });
  }

  /* ============================================================
     设备模式：电脑 / 手机（手机再分竖屏、横屏）
     ============================================================
     有人反馈手机上没法玩：立绘挤成一团、小手机的返回键被系统栏挡住点不了、
     横屏时小手机被裁掉一半。手机端单独一套版式（app/mobile.css），开局界面可以选，
     默认按设备自动判断。<html> 上的类：
       m-pc                 电脑（就是原来的样子，一点不动）
       m-mobile m-port      手机竖屏：台上只站说话的那一个人，字和按钮放大
       m-mobile m-land      手机横屏：多人同台，对话框压扁，选项排两列
     index.html 的 <head> 里有一段内联脚本在第一帧之前就把类加上，免得先闪一下电脑版。 */
  var H = document.documentElement;
  var mqPort = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
  function autoDevice() {
    try {
      var coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
      var small = Math.min(screen.width || 9999, screen.height || 9999) <= 820;
      return coarse && small ? 'mobile' : 'pc';
    } catch (e) { return 'pc'; }
  }
  function devicePref() {
    try { return localStorage.getItem('gal_device') || 'auto'; } catch (e) { return 'auto'; }
  }
  function deviceNow() { return H.classList.contains('m-mobile') ? 'mobile' : 'pc'; }
  function isPortraitPhone() { return H.classList.contains('m-port'); }
  /* 横竖屏手动选：localStorage gal_orient = auto（跟着手机转）/ port / land。
     有人反馈「手机捣鼓半天切换不了横屏」—— 开了方向锁，或者浏览器压根不转。所以：
       · 选了横屏、手机却还竖着 → 整页转 90° 画（html.m-rot m-rot-cw）：body 按横过来的宽高
         摆好再旋转贴满屏幕，玩家把手机横过来拿就行，不用管系统转不转
       · 反过来（手机横着、选了竖屏）→ 逆时针转（m-rot-ccw）
       · 安卓 Chrome 顺手试一下真锁横屏（要先进全屏），锁上了手机真转过来，就不用 CSS 转
     --rw/--rh 是转过来之后 body 的宽和高（= 屏幕的高和宽）。电脑模式不管这个设置。 */
  function orientPref() {
    try {
      var v = localStorage.getItem('gal_orient');
      return v === 'port' || v === 'land' ? v : 'auto';
    } catch (e) { return 'auto'; }
  }
  function physPort() { return mqPort ? mqPort.matches : window.innerHeight >= window.innerWidth; }
  function applyDeviceClasses() {
    var pref = devicePref();
    var dev = pref === 'pc' || pref === 'mobile' ? pref : autoDevice();
    var mob = dev === 'mobile', phys = physPort(), o = orientPref();
    var port = o === 'auto' ? phys : o === 'port';
    var rot = mob && port !== phys;
    H.classList.toggle('m-mobile', mob);
    H.classList.toggle('m-pc', !mob);
    H.classList.toggle('m-port', mob && port);
    H.classList.toggle('m-land', mob && !port);
    H.classList.toggle('m-rot', rot);
    H.classList.toggle('m-rot-cw', rot && !port);
    H.classList.toggle('m-rot-ccw', rot && port);
    if (rot) {
      H.style.setProperty('--rw', window.innerHeight + 'px');
      H.style.setProperty('--rh', window.innerWidth + 'px');
    } else {
      H.style.removeProperty('--rw');
      H.style.removeProperty('--rh');
    }
    H.dataset.devAuto = autoDevice();
    /* 走中转时按屏幕压图：手机上长边 1600 足够，还省流量 */
    if (window.ImgNet) ImgNet.setMaxEdge(mob ? 1600 : 2048);
  }
  /** 版式变了（切设备 / 转屏）：把当前这句按新规则重摆一遍 */
  function onLayoutChange() {
    PA2('[data-dev]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-dev') === devicePref() ||
        (devicePref() === 'auto' && b.getAttribute('data-dev') === 'auto'));
    });
    PA2('[data-orient]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-orient') === orientPref());
    });
    var ob = $('btn-orient');
    if (ob) {
      ob.textContent = isPortraitPhone() ? '横' : '竖';
      ob.title = isPortraitPhone() ? '切到横屏（手机转不过来也行：页面自己转，把手机横着拿）'
                                   : '切回竖屏';
    }
    var hint = $('dev-auto');
    if (hint) hint.textContent = '自动识别：' + (autoDevice() === 'mobile' ? '手机' : '电脑') +
      (deviceNow() === 'mobile' ? (isPortraitPhone() ? ' · 竖屏' : ' · 横屏') +
        (orientPref() === 'auto' ? '' : '（手动）') : '');
    var ut = $('usertext');
    if (ut) ut.placeholder = deviceNow() === 'mobile' ? '你的行动或台词…'
      : '你的行动或台词…（Enter 发送，Shift+Enter 换行）';
    if (typeof eng !== 'undefined' && eng.log && eng.log[qi] && !$('dialogue').hidden) {
      applyStage(stageFor(eng.log[qi]));
      if (!eng.log[qi].narration) highlight(eng.log[qi].who);
    }
    if (typeof refreshDlgHeight === 'function') refreshDlgHeight();
  }
  function setDevice(pref) {
    try { localStorage.setItem('gal_device', pref); } catch (e) {}
    applyDeviceClasses();
    onLayoutChange();
  }
  var ourFs = false;
  function setOrient(o) {
    try { localStorage.setItem('gal_orient', o); } catch (e) {}
    applyDeviceClasses();
    onLayoutChange();
    realOrient(o);
  }
  /** 能真转就真转（安卓 Chrome：全屏后 screen.orientation.lock）。转不了也没关系，CSS 已经转好了。
      必须在点击里同步调用 —— 全屏只认用户手势。 */
  function realOrient(o) {
    var so = window.screen && screen.orientation;
    if (deviceNow() !== 'mobile' || !so || !so.lock) return;
    if (o !== 'land') {
      try { so.unlock(); } catch (e) {}
      if (ourFs && document.fullscreenElement && document.exitFullscreen) {
        try { document.exitFullscreen().catch(function () {}); } catch (e) {}
      }
      return;
    }
    if (!physPort()) return;
    var lock = function () {
      try { var p = so.lock('landscape'); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    };
    if (document.fullscreenElement || !H.requestFullscreen) { lock(); return; }
    try {
      var p = H.requestFullscreen({ navigationUI: 'hide' });
      if (p && p.then) p.then(function () { ourFs = true; lock(); }, function () {});
    } catch (e) {}
  }
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement) ourFs = false;
    applyDeviceClasses();
    onLayoutChange();
  });

  /* 右上角工具栏可以收起：一按整排滑回右边，只留一个小把手。收起时有新东西（手机消息、新 CG）
     把手上亮小红点。记在 gal_tb_hidden。 */
  function tbHidden() {
    try { return localStorage.getItem('gal_tb_hidden') === '1'; } catch (e) { return false; }
  }
  function refreshTbDot() {
    var d = $('tb-dot');
    if (!d) return;
    var news = ($('cg-dot') && !$('cg-dot').hidden) || ($('phone-dot') && !$('phone-dot').hidden);
    d.hidden = !(tbHidden() && news);
  }
  function applyTb() {
    var tb = $('toolbar'), on = tbHidden();
    if (!tb) return;
    tb.classList.toggle('collapsed', on);
    H.classList.toggle('tb-hidden', on);
    var items = $('tb-items');
    if (items) {
      if (on) items.setAttribute('inert', ''); else items.removeAttribute('inert');
      items.setAttribute('aria-hidden', on ? 'true' : 'false');
    }
    var b = $('btn-tbhide');
    if (b) {
      b.title = on ? '展开工具栏' : '收起工具栏';
      b.setAttribute('aria-expanded', on ? 'false' : 'true');
    }
    refreshTbDot();
  }
  function setTbHidden(on) {
    try { localStorage.setItem('gal_tb_hidden', on ? '1' : '0'); } catch (e) {}
    applyTb();
  }

  applyDeviceClasses();
  if (mqPort) {
    var onOrient = function () { applyDeviceClasses(); onLayoutChange(); };
    if (mqPort.addEventListener) mqPort.addEventListener('change', onOrient);
    else if (mqPort.addListener) mqPort.addListener(onOrient);
  }
  var resizeT = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      var before = H.className;
      applyDeviceClasses();
      if (H.className !== before) onLayoutChange();
    }, 120);
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-dev]') : null;
    if (b) { e.preventDefault(); setDevice(b.getAttribute('data-dev')); return; }
    var o = e.target.closest ? e.target.closest('[data-orient]') : null;
    if (o) { e.preventDefault(); setOrient(o.getAttribute('data-orient')); return; }
    if (e.target.closest && e.target.closest('#btn-orient')) {
      e.preventDefault(); setOrient(isPortraitPhone() ? 'land' : 'port'); return;
    }
    if (e.target.closest && e.target.closest('#btn-tbhide')) {
      e.preventDefault(); setTbHidden(!tbHidden());
    }
  });
  applyTb();

  /**
   * 这一句台上站谁。手机竖屏屏幕窄，三个人并排会挤成一团、脸全被对话框挡住 ——
   * 只站说话的那一个；旁白时留着刚才那个人。横屏和电脑照旧多人同台。
   */
  var lastSpeaker = '';
  function stageFor(m) {
    var sp = (m && m.sprites) || [];
    if (!isPortraitPhone() || sp.length <= 1) return sp;
    var who = m.narration ? lastSpeaker : m.who;
    var hit = sp.filter(function (s) { return String(who || '').indexOf(s.who) >= 0; })[0];
    if (hit) return [hit];
    var keep = stageNow[0] && sp.filter(function (s) { return s.who === stageNow[0].who; })[0];
    return [keep || sp[0]];
  }

  /* 加载失败的图，给调试面板用。卡里那几千个 URL 挂在第三方图床上，
     死链是常态，不该让玩家看见浏览器的破图图标。 */
  var imgFails = [];
  function noteImgFail(who, url) {
    if (imgFails.length < 200 &&
        !imgFails.some(function (f) { return f.url === url; })) {
      imgFails.push({ who: who, url: url, at: Date.now() });
    }
  }

  /**
   * 换一张立绘。
   * @param {string} [fallbackUrl] 主图挂了就退到这张（一般是原皮 index 0）；
   *        再挂就把整层藏掉 —— 绝不留破图图标。
   *
   * ⚠ 这里必须自己管好 img.onerror。makeChar() 里挂过一个"挂了就隐藏"的
   *   处理器，但下面会覆盖掉它；早先就是因为覆盖后没补回来，死链直接裂在舞台上。
   */
  function swap(rec, url, isEnter, fallbackUrl) {
    return new Promise(function (res) {
      var img = rec.back.querySelector('img'), settled = false;
      var lay = rec.back, triedFallback = false;
      /* 换图令牌。1.5 秒内同一角色换两次时，两次 swap 操作的是**同一个 <img>**，
         后一次会把前一次的 onload 覆盖掉 —— 于是前一次永远 settle 不了，
         它那个 1500ms 兜底定时器照常到点，把旧立绘重新推回前台，
         而 rec.url 已经是新图，applyStage 不会再换，画面就一直错着。
         实测：换图后 1.7 秒前台从 B 翻回了 A。所以后来者必须让前面的作废。 */
      var token = (rec.swapToken = (rec.swapToken || 0) + 1);
      var dead = function () { return rec.swapToken !== token; };
      var timer = setTimeout(function () { reveal(); }, 1500);
      /* 被取代时**也要 resolve**，只是不碰画面 ——
         applyStage 是 Promise.all(jobs)，漏一个不 resolve 就整体挂住。 */
      function giveUp() {
        if (settled) return;
        settled = true; clearTimeout(timer);
        img.onload = img.onerror = null;
        res();
      }
      function reveal() {
        if (settled) return;
        if (dead()) return giveUp();
        settled = true; clearTimeout(timer);
        rec.back.classList.add('show');
        rec.front.classList.remove('show');
        var t = rec.front; rec.front = rec.back; rec.back = t;
        playFx(rec.front, isEnter ? ENTER_FX : CHANGE_FX);
        res();
      }
      function ready() {
        if (dead()) return giveUp();        // 已被后来的 swap 取代，别再动画面
        img.onload = img.onerror = null;
        lay.style.visibility = '';
        img.decode ? img.decode().then(reveal).catch(reveal) : reveal();
      }
      function failed() {
        if (dead()) return giveUp();
        noteImgFail(rec.name, img.getAttribute('src'));
        /* 先退原皮 */
        if (!triedFallback && fallbackUrl && fallbackUrl !== url) {
          triedFallback = true;
          lay.style.visibility = 'hidden';
          img.src = ImgNet.srcFor(fallbackUrl);   // onload/onerror 还挂着，会再走一轮
          return;
        }
        /* 原皮也挂了：藏掉这一层，剧情照常推进 */
        img.onload = img.onerror = null;
        lay.style.visibility = 'hidden';
        reveal();
      }
      /* 直连不通的图床直接用中转地址（ImgNet 记着账）；中途再挂，页面级的 error 拦截会先换中转，
         中转也挂了才轮到这里的 failed() */
      var src0 = ImgNet.srcFor(url);
      if (img.getAttribute('src') === src0 && img.complete && img.naturalWidth > 0) {
        return ready();
      }
      img.onload = ready;
      img.onerror = failed;
      img.src = src0;
      /* 缓存命中时 onload 不会再触发，得自己判一次。
         complete 为 true 但 naturalWidth 为 0 = 加载失败。 */
      if (img.complete) { img.naturalWidth > 0 ? ready() : failed(); }
    });
  }

  function applyStage(sprites) {
    var names = new Set(sprites.map(function (s) { return s.who; }));
    live.forEach(function (rec, name) {
      if (names.has(name)) return;
      rec.el.classList.add('leaving');
      setTimeout(function () { rec.el.remove(); }, 520);
      live.delete(name);
    });
    var jobs = [];
    sprites.forEach(function (s) {
      var isNew = !live.has(s.who);
      var rec = live.get(s.who) || makeChar(s.who);
      /* 死链时退到原皮：urls[0] 就是 index 0 那张 */
      var base = (s.urls && s.urls.length) ? s.urls[0] : null;
      if (rec.url !== s.url) { rec.url = s.url; jobs.push(swap(rec, s.url, isNew, base)); }
    });
    stageNow = sprites;
    layout();
    return Promise.all(jobs);
  }

  function highlight(who) {
    live.forEach(function (rec, name) {
      var on = String(who || '').indexOf(name) >= 0;
      rec.el.classList.toggle('active', on);
      rec.el.style.zIndex = on ? 20 : 10;
    });
  }

  /* ============================================================
     台词播放
     ============================================================ */
  var speakerEl = $('speaker'), textEl = $('text'), hintEl = $('hint'),
      bodyEl = $('dlg-body'), progEl = $('progress'), envEl = $('envbar'),
      choicesEl = $('choices');

  function typeOut(s, token) {
    clearInterval(typer);
    typing = true; hintEl.classList.remove('on');
    pending = s; textEl.textContent = '';
    var i = 0;
    typer = setInterval(function () {
      /* 这一句已被更新的句子取代就停手，否则会把新文字盖回去、
         并且把 typing 重新置 true，之后怎么点都只在"补全打字"。 */
      if (token != null && token !== presentToken) { clearInterval(typer); return; }
      textEl.textContent = s.slice(0, ++i);
      textEl.scrollTop = textEl.scrollHeight;
      if (i >= s.length) finishTyping();
      else if (i % 8 === 0) refreshDlgHeight();
    }, 26);
  }
  function finishTyping() {
    clearInterval(typer); typing = false;
    textEl.textContent = pending;
    refreshDlgHeight();
    updateNav();
  }

  /* 并发令牌。连点时上一句的立绘可能比这一句晚加载完，
     回调落在后面就会把新句子的文字盖掉 —— 表现为"有几句没显示"，
     而且 typing 会被旧回调重新置 true，之后怎么点都只在"补全打字"，看起来就卡死。 */
  var presentToken = 0;

  function present(m, opts) {
    opts = opts || {};
    var token = ++presentToken;
    bodyEl.classList.add('fading');
    choicesEl.hidden = true; choicesEl.innerHTML = '';
    if (m.scene) paintBG(m.scene.url, opts.instant);
    /* CG 跟着游标走：这句有图就铺上，没有就收起。
       翻回去看也能看到当时那张。 */
    syncCG(m);
    if (m.env) { envEl.textContent = m.env; envEl.hidden = false; }
    else { envEl.hidden = true; }

    /* 立绘最多等 400ms 就出字。
       等太久的话，图没缓存时对话框会空一秒多，看着就像"这句没显示"。
       立绘晚到就晚到，它自己会淡入，不该把台词一起拖住。 */
    var staged = Promise.race([
      applyStage(stageFor(m)),
      new Promise(function (r) { setTimeout(r, opts.instant ? 0 : 400); })
    ]);

    staged.then(function () {
      if (token !== presentToken) return;
      if (!m.narration) { highlight(m.who); lastSpeaker = m.who; }
      setTimeout(function () {
        if (token !== presentToken) return;
        bodyEl.classList.remove('fading');
        speakerEl.textContent = m.narration ? '旁白' : m.who.replace('&', ' & ');
        speakerEl.className = m.narration ? 'narrator' : '';
        if (opts.instant) {            // 回看时直接出全文，不逐字
          clearInterval(typer); typing = false;
          pending = m.text; textEl.textContent = m.text;
          updateNav();
          /* 以前漏了这句：往回翻到一句长的，对话框还是上一句的高度，字被截在框里 */
          refreshDlgHeight();
        } else {
          typeOut(m.text, token);
        }
        /* 只有停在最新一句时才给选项，回看时不给 */
        if (m.choices && m.choices.length && atEnd()) { renderChoices(m.choices); refreshDlgHeight(); }
      }, opts.instant ? 0 : 120);
    });
  }

  function renderChoices(opts) {
    choicesEl.innerHTML = '';
    opts.forEach(function (o) {
      var b = document.createElement('button');
      b.textContent = o;
      /* 点选项只是把文字填进输入框，你可以改完再发 —— 直接发容易手滑 */
      b.onclick = function (e) {
        e.stopPropagation();
        var inp = $('usertext');
        inp.value = o;
        inp.style.height = 'auto';
        inp.style.height = Math.min(inp.scrollHeight, 110) + 'px';
        inp.focus();
        PA2('#choices button').forEach(function (x) { x.classList.toggle('picked', x === b); });
      };
      choicesEl.appendChild(b);
    });
    choicesEl.hidden = false;
  }

  /* ---- 全局游标：eng.log 是所有演过的句子，qi 是当前位置 ---- */
  function total() { return eng.log.length; }
  function atEnd() { return qi >= total() - 1; }

  function updateNav() {
    var n = total();
    $('progress').textContent = n ? (qi + 1) + ' / ' + n : '';
    $('nav-prev').disabled = $('nav-first').disabled = (qi <= 0);
    $('nav-next').disabled = $('nav-last').disabled = atEnd();
    $('hint').classList.toggle('on', !typing && !atEnd());
  }

  function goTo(i, opts) {
    var n = total();
    if (!n) return;
    i = Math.max(0, Math.min(n - 1, i));
    qi = i;
    present(eng.log[qi], opts);
    updateNav();
    /* 后面两句的图先在后台拉着，翻过去就不用等 */
    ImgNet.preload(lineImgs(eng.log[qi + 1]).concat(lineImgs(eng.log[qi + 2])), { wait: 0 });
    var t = eng.log[qi] && eng.log[qi].turn;
    if (t != null && !openTurns[t]) { openTurns[t] = true; renderHistory(); }
    else markHistory();
  }

  function advance() {
    if (typing) { finishTyping(); updateNav(); return; }
    if (atEnd()) { $('usertext').focus(); return; }
    goTo(qi + 1);
  }
  function back() {
    if (typing) finishTyping();
    if (qi <= 0) return;
    goTo(qi - 1, { instant: true });
  }

  /* ============================================================
     CG（文生图）
     ============================================================ */
  var cgEl = $('cg'), cgImg = $('cg-img'), cgBlur = $('cg-blur'), cgCap = $('cg-cap');
  /* cgHiddenId：玩家用 × 收起的那张。只对那一张生效 ——
     换到别的句子时应该正常显示，否则收起一次就再也看不到图了。 */
  var cgShownId = null, cgHiddenId = null, cgNew = false;

  function imgCfg() {
    return Object.assign({}, ImageGen.DEFAULTS, GalStore.local('gal_imagegen') || {});
  }
  function saveImgCfg(patch) {
    var c = Object.assign(imgCfg(), patch || {});
    GalStore.local('gal_imagegen', c);
    return c;
  }

  /* 出图用的独立通道，和手机私聊走同一条 —— 不写主线历史、不占回合 */
  function cgQuiet(prompt, o) {
    return eng.quiet(prompt, Object.assign({
      send: function (msgs, params) {
        return GalAPI.chatWithRetry(msgs, { params: params, retries: 1 });
      }
    }, o || {}));
  }

  async function showCG(id, title) {
    if (!id) return hideCG();
    if (id === cgHiddenId) return;
    if (id === cgShownId) return;
    var url = await Gallery.src(id);
    if (!url) return hideCG();
    cgShownId = id;
    cgImg.src = url;
    cgBlur.style.backgroundImage = 'url("' + url + '")';
    if (title) { cgCap.textContent = title; cgCap.hidden = false; }
    else cgCap.hidden = true;
    cgEl.hidden = false;
    requestAnimationFrame(function () {
      cgEl.classList.add('show');
      $('stage').classList.add('cgon');
    });
  }
  function hideCG() {
    cgShownId = null;
    cgEl.classList.remove('show');
    $('stage').classList.remove('cgon');
    setTimeout(function () { if (!cgEl.classList.contains('show')) cgEl.hidden = true; }, 560);
  }

  /** CG 常驻：开着的时候，没图的句子也保持上一张，不退回立绘 */
  function cgSticky() { return !!imgCfg().sticky; }

  /**
   * 往前找最近一张图。CG 一旦铺上就留到被下一张换掉为止 ——
   * 图只挂在某一句上，只在那一句显示的话推一下就没了，画面闪一下很难看。
   *   sameTurnOnly=true  —— 只在本轮里找
   *   sameTurnOnly=false —— 跨轮一直往前找
   */
  function nearestCG(i, sameTurnOnly) {
    var turn = eng.log[i] ? eng.log[i].turn : null;
    for (var k = Math.min(i, eng.log.length - 1); k >= 0; k--) {
      var m = eng.log[k];
      if (!m) continue;
      if (sameTurnOnly && m.turn !== turn) break;
      if (m.cg) return m.cg;
    }
    return null;
  }

  /**
   * ▣ 是个**真开关**，只有两种状态，没有中间态：
   *   开 —— CG 模式：CG 盖住立绘，一直铺到被下一张换掉，就这么推剧情
   *   关 —— 立绘模式：CG 完全不上舞台，要看图去相册（✿）
   *
   * 之前我把「关」做成了「只在图所在那一句显示」，结果关掉也照样时不时盖上来，
   * 按钮等于没用。二选一才说得清。
   */
  function syncCG(m) {
    if (!cgSticky()) return hideCG();          // 立绘模式：舞台上永远不出 CG
    var id = (m && m.cg) || nearestCG(qi, false);
    if (!id) return hideCG();
    if (id !== cgHiddenId) cgHiddenId = null;
    Gallery.meta(id).then(function (meta) {
      showCG(id, meta && meta.title);
    });
  }

  function renderCGMode() {
    var b = $('btn-cgmode');
    if (!b) return;
    var on = cgSticky();
    b.classList.toggle('on', on);
    b.title = on ? 'CG 模式：图盖住立绘，一直铺着推剧情（点一下切回立绘）'
                 : '立绘模式：舞台上不出 CG（点一下切到 CG 模式）';
  }

  function cgBusy(on, text) {
    $('cg-busy').hidden = !on;
    if (text) $('cg-busy-t').textContent = text;
  }
  function markCGNew(on) {
    cgNew = on;
    $('cg-dot').hidden = !on;
    refreshTbDot();
  }

  /** 一轮演完后异步出图。不阻塞推进 —— NAI 一张要十几秒。 */
  function kickCG(res, startIndex) {
    var cfg = imgCfg();
    if (!cfg.enabled || !cfg.perTurn) return;
    CG.runTurn({
      eng: eng, modules: res.modules, startIndex: startIndex,
      body: res.text, inlinePrompts: res.inlinePrompts || [],
      cfg: cfg, quiet: cgQuiet,
      onUpdate: function (e) {
        if (e.type === 'start') cgBusy(true, '正在解析画面…');
        else if (e.type === 'resolved') {
          if (e.warning) console.warn('[CG]', e.warning);
          cgBusy(true, '出图中 0/' + e.shots);
        } else if (e.type === 'generating') {
          cgBusy(true, '出图中 ' + (e.index + 1) + '/' + e.total);
        } else if (e.type === 'image') {
          markCGNew(true);
          renderCGPanel();
          /* 玩家正好停在这句，就立刻补上 */
          if (qi === e.logIndex) syncCG(eng.log[e.logIndex]);
          autosave();
        } else if (e.type === 'error') {
          console.warn('[CG] ' + e.stage + ' 失败：' + e.message);
          cgBusy(true, '出图失败');
          setTimeout(function () { cgBusy(false); }, 2600);
        } else if (e.type === 'done') {
          cgBusy(false);
          if (e.images.length) autosave();
        }
      }
    }).catch(function (err) {
      cgBusy(false);
      console.warn('[CG] 整轮失败', err);
    });
  }


  /* 重画某一句。
     上下文用<b>整轮</b>的正文而不是孤零零那一句 —— 一句「嗯。」解析不出画面，
     而生成时本来就是按整轮解析的，重画也该保持一致。 */
  function turnBodyOf(logIndex) {
    var m = eng.log[logIndex];
    if (!m) return '';
    var t = m.turn;
    return eng.log.filter(function (x) { return x.turn === t; })
      .map(function (x) { return (x.narration ? '' : x.who + '：') + x.text; })
      .join('\n').slice(0, 2400);
  }

  var cgRedrawing = false;

  async function redrawLine(logIndex, opt) {
    opt = opt || {};
    var cfg = imgCfg();
    if (!cfg.enabled) {
      alert('文生图还没打开。到「设置 · 文生图」里打开开关并填 NovelAI Token。');
      return;
    }
    if (cgRedrawing) return;
    if (!eng.log[logIndex]) return;
    cgRedrawing = true;
    setRedrawBusy(true);
    cgBusy(true, opt.fresh ? '为这一句出图…' : '重画中…');
    try {
      var res = await CG.regenerate({
        eng: eng, logIndex: logIndex, cfg: cfg, quiet: cgQuiet,
        body: turnBodyOf(logIndex),
        onUpdate: function (e) {
          if (e.type === 'generating') cgBusy(true, opt.fresh ? '为这一句出图…' : '重画中…');
          else if (e.type === 'error') {
            cgBusy(true, '失败：' + String(e.message).split('\n')[0].slice(0, 40));
            setTimeout(function () { cgBusy(false); }, 3200);
          }
        }
      });
      if (res.images.length) {
        /* 重画完如果玩家还停在这句，立刻换图 —— 不换的话看着像没生效 */
        cgHiddenId = null;
        cgShownId = null;
        if (qi === logIndex) syncCG(eng.log[logIndex]);
        markCGNew(true);
        autosave();
      }
      renderNowLine(); renderCGPanel();
    } catch (e) {
      console.warn('[CG] 重画失败', e);
      cgBusy(true, '重画失败');
      setTimeout(function () { cgBusy(false); }, 3200);
    } finally {
      cgRedrawing = false;
      setRedrawBusy(false);
      if (!CG.isRunning()) cgBusy(false);
    }
  }

  function setRedrawBusy(on) {
    var b = $('cg-redraw');
    if (b) { b.disabled = on; b.textContent = on ? '…' : '♻'; }
    PA2('#cg-body .redraw, #cg-now button').forEach(function (x) { x.disabled = on; });
  }


  /** 相册顶部那条：当前停在哪句、有没有图、能不能补一张。
      同步渲染 —— 网格那部分要读 IndexedDB，慢一拍，不能让这条跟着空着。 */
  function renderNowLine() {
    var box = $('cg-now');
    if (!box) return;
    var m = eng.log[qi];
    if (!m) { box.innerHTML = ''; return; }
    var on = imgCfg().enabled;
    var label = (m.narration ? '旁白' : m.who) + '：' + String(m.text || '').slice(0, 30);
    if (m.cg) {
      box.innerHTML = '当前这句　<b>' + esc(label) + '</b>' +
        '<button data-now="redraw"' + (on ? '' : ' disabled') + '>重画</button>';
    } else if (!on) {
      box.innerHTML = '文生图还没打开。到「设置 · 文生图」填上 NovelAI Token 并打开开关，' +
        '之后 AI 每轮会固定出 1~2 张。';
    } else {
      box.innerHTML = '当前这句没有配图　<b>' + esc(label) + '</b>' +
        '<span style="flex:none;opacity:.7">下一轮会自动出</span>';
    }
  }

  async function renderCGPanel() {
    var box = $('cg-body');
    if (!box || $('cg-panel').hidden) return;
    var list = await Gallery.list({ limit: 60 });
    var st = await Gallery.stats();
    $('cg-stat').textContent = st.count + ' 张 · ' + st.mb + 'MB' +
      (st.persistent ? '' : ' · 本次会话有效');
    if (!list.length) {
      box.innerHTML = '<div class="empty">还没有生成过图。<br>' +
        '到「设置 · 文生图」填上 NovelAI Token 并打开开关，之后每轮会自动出图。</div>';
      return;
    }
    var rows = await Promise.all(list.map(function (m) {
      return Gallery.src(m.id).then(function (u) { return { m: m, u: u }; });
    }));
    box.innerHTML = rows.filter(function (r) { return r.u; }).map(function (r) {
      var src = r.m.source === 'model' ? '解析' : (r.m.source === 'inline' ? '内联' : '草稿');
      return '<div class="cgcard" data-id="' + esc(r.m.id) + '">' +
        '<img src="' + r.u + '" alt="">' +
        '<div class="cgtools">' +
        '<button class="redraw" data-redraw="' + esc(r.m.id) + '" title="重画这一句">♻</button>' +
        '<button class="pin' + (r.m.pinned ? ' on' : '') + '" data-pin="' + esc(r.m.id) +
        '" title="' + (r.m.pinned ? '取消收藏' : '收藏（永不被清理）') + '">★</button></div>' +
        '<div class="t">' + esc(r.m.title || '未命名') + '</div>' +
        '<div class="m"><span class="src">' + src + '</span>' +
        '<span>第 ' + (r.m.turn + 1) + ' 轮</span></div></div>';
    }).join('');
  }

  $('btn-cgmode').onclick = function (e) {
    e.stopPropagation();
    var on = !cgSticky();
    saveImgCfg({ sticky: on });
    renderCGMode();
    cgHiddenId = null;
    syncCG(eng.log[qi]);
  };
  /* 点 CG 图本身也推进剧情 —— 常驻模式下 CG 盖了大半个屏，
     不让它能点的话玩家得专门去够下面那条对话框。 */
  $('cg-img').onclick = function () { advance(); };
  $('cg-blur').onclick = function () { advance(); };
  $('cg-redraw').onclick = function (e) {
    e.stopPropagation();
    redrawLine(qi);
  };
  $('cg-hide').onclick = function (e) {
    e.stopPropagation();
    cgHiddenId = cgShownId;
    hideCG();
  };
  $('btn-cg').onclick = function (e) {
    e.stopPropagation();
    var p = $('cg-panel');
    p.hidden = !p.hidden;
    if (!p.hidden) { markCGNew(false); renderNowLine(); renderCGPanel(); }
  };
  $('cg-close').onclick = function (e) { e.stopPropagation(); $('cg-panel').hidden = true; };
  $('cg-busy-x').onclick = function (e) { e.stopPropagation(); CG.cancel(); cgBusy(false); };
  $('cg-now').onclick = function (e) {
    e.stopPropagation();
    var now = e.target.getAttribute('data-now');
    if (now) redrawLine(qi, { fresh: now === 'make' });
  };
  $('cg-body').onclick = function (e) {
    e.stopPropagation();
    var rd = e.target.getAttribute('data-redraw');
    if (rd) {
      Gallery.meta(rd).then(function (m) {
        if (m && m.logIndex >= 0 && m.logIndex < eng.log.length) redrawLine(m.logIndex);
        else alert('这张图对应的句子已经不在日志里了（可能被裁掉或读了别的档），没法重画。');
      });
      return;
    }
    var pin = e.target.getAttribute('data-pin');
    if (pin) {
      Gallery.meta(pin).then(function (m) {
        return Gallery.pin(pin, !(m && m.pinned));
      }).then(renderCGPanel);
      return;
    }
    var card = e.target.closest ? e.target.closest('.cgcard') : null;
    if (!card) return;
    var id = card.getAttribute('data-id');
    /* 点相册里的图 = 跳到它所在的那一句 */
    Gallery.meta(id).then(function (m) {
      if (m && m.logIndex >= 0 && m.logIndex < eng.log.length) {
        $('cg-panel').hidden = true;
        cgHiddenId = null;
        goTo(m.logIndex, { instant: true });
      } else {
        cgHiddenId = null;
        showCG(id, m && m.title);
      }
    });
  };


  /* ============================================================
     设置 · 文生图
     ============================================================ */
  function igFreeNote(c) {
    var wh = ImageGen.snapSize(c.size);
    var px = wh.width * wh.height;
    var prof = ImageGen.profileOf(c.model);
    var steps = c.parameterMode === 'custom' ? c.steps : prof.steps;
    var free = px <= 1048576 && steps <= 28;
    return (free ? '✓ 免费档' : '⚠ 会扣点数') +
      '：' + wh.width + '×' + wh.height + ' = ' + px.toLocaleString() + ' 像素、' + steps + ' 步。' +
      (free ? 'Opus 会员在 1,048,576 像素和 28 步以内不限量。'
            : '超过 1,048,576 像素或 28 步就开始按张扣点数了。');
  }

  var IG_MODE_NOTE = {
    auto:  '世界书里那条【持久指令】会让 AI 每轮自己产出 1~2 段 <image>，引擎直接拿来出图，' +
           '不额外花钱。万一某轮 AI 忘了写，才退回「另发一次请求解析正文」兜底。' +
           '这是推荐档。',
    model: '不管 AI 写没写，每轮都另发一次请求把正文解析成出图提示词。出图最稳定，' +
           '但每轮多一次请求的 token。要出 2 张图也只解析一次，不会翻倍。',
    inline:'只认 AI 写的 <image>，绝不额外发请求。最省，但 AI 某轮不写就只能用本地草稿，' +
           '那一张的质量会明显下降。'
  };

  function renderImgSec() {
    var c = imgCfg();
    var sel = $('ig-model');
    if (sel && !sel.options.length) {
      sel.innerHTML = ImageGen.models().map(function (m) {
        return '<option value="' + m + '">' + m + '</option>';
      }).join('');
    }
    $('ig-on').checked = !!c.enabled;
    $('ig-per').value = c.perTurn; $('ig-per-v').textContent = c.perTurn;
    $('ig-key').value = c.apiKey || '';
    $('ig-url').value = c.baseUrl || '';
    if (sel) sel.value = c.model;
    $('ig-size').value = c.size;
    $('ig-mode').value = c.promptMode || 'auto';
    $('ig-mode-note').textContent = IG_MODE_NOTE[c.promptMode || 'auto'];
    $('ig-style').value = c.stylePrompt || '';
    $('ig-neg').value = c.negativePrompt || '';
    $('ig-uc').value = c.ucPreset || 'heavy';
    $('ig-sampler').value = c.sampler;
    $('ig-custom').checked = c.parameterMode === 'custom';
    $('ig-custom-wrap').hidden = c.parameterMode !== 'custom';
    $('ig-steps').value = c.steps; $('ig-steps-v').textContent = c.steps;
    $('ig-cfg').value = c.cfgScale; $('ig-cfg-v').textContent = c.cfgScale;
    $('ig-free').textContent = igFreeNote(c);
    Gallery.stats().then(function (st) {
      $('ig-gal').textContent = st.count + ' 张，约 ' + st.mb + 'MB，上限 ' + st.max + ' 张。' +
        (st.persistent ? '存在 IndexedDB 里，跟着浏览器走；存档只记 id，不会被图撑大。'
                       : '⚠ 这个浏览器不让用 IndexedDB，图只在本次会话有效，刷新就没了。') +
        (st.pinned ? ' 收藏 ' + st.pinned + ' 张（永不清理）。' : '');
    });
  }

  /* 「插画输出规则」那条世界书跟着开关走：
     开了文生图且不是「总是解析」模式，就让模型每轮自己写 <image>（不额外花钱）；
     切成「总是解析」或关掉文生图，就把它停用，省下那段常驻 token。 */
  function syncImageRule() {
    var c = imgCfg();
    var want = !!c.enabled && c.promptMode !== 'model';
    if (eng.pool && eng.pool.length && Editors.setImageRuleEnabled) {
      Editors.setImageRuleEnabled(eng.pool, want);
      if (curSec === 'book' && typeof renderBook === 'function') renderBook();
    }
    return want;
  }

  function bindImgSec() {
    if (!$('ig-on')) return;
    function upd(patch) { saveImgCfg(patch); syncImageRule(); renderImgSec(); }

    $('ig-on').onchange = function () { upd({ enabled: this.checked }); };
    $('ig-per').oninput = function () {
      $('ig-per-v').textContent = this.value;
      saveImgCfg({ perTurn: +this.value });
    };
    $('ig-key').onchange = function () { upd({ apiKey: this.value.trim() }); };
    $('ig-url').onchange = function () { upd({ baseUrl: this.value.trim() || ImageGen.DEFAULTS.baseUrl }); };
    $('ig-model').onchange = function () { upd({ model: this.value }); };
    $('ig-size').onchange = function () { upd({ size: this.value }); };
    $('ig-style').onchange = function () { upd({ stylePrompt: this.value.trim() }); };
    $('ig-neg').onchange = function () { upd({ negativePrompt: this.value.trim() }); };
    $('ig-uc').onchange = function () { upd({ ucPreset: this.value }); };
    $('ig-sampler').onchange = function () { upd({ sampler: this.value }); };
    $('ig-custom').onchange = function () {
      upd({ parameterMode: this.checked ? 'custom' : 'model_default' });
    };
    $('ig-steps').oninput = function () {
      $('ig-steps-v').textContent = this.value; saveImgCfg({ steps: +this.value });
      $('ig-free').textContent = igFreeNote(imgCfg());
    };
    $('ig-cfg').oninput = function () {
      $('ig-cfg-v').textContent = this.value; saveImgCfg({ cfgScale: +this.value });
    };

    $('ig-mode').onchange = function () { upd({ promptMode: this.value }); };

    $('ig-test').onclick = async function () {
      var out = $('ig-testout');
      out.textContent = '正在测试…（会真的出一张最小尺寸的图）';
      this.disabled = true;
      try {
        var r = await ImageGen.testConnection(imgCfg());
        out.textContent = (r.ok ? '✓ ' : '✗ ') + r.message;
      } catch (e) {
        out.textContent = '✗ ' + ((e && e.message) || e);
      }
      this.disabled = false;
    };

    $('ig-clear').onclick = async function () {
      if (!confirm('清空相册？收藏的也会一起删掉，不可撤销。')) return;
      await Gallery.clear();
      eng.log.forEach(function (m) { delete m.cg; });
      hideCG();
      renderImgSec(); renderCGPanel();
    };
  }


  /* 这一轮有地名落到哈希/相似兜底 = 预置表没盖住它。
     花一次独立请求让模型在真实场景名里挑一个，登记后永久生效。
     一个地名只问一次，所以这是一次性开销。 */
  function autoRegisterScenes(misses) {
    if (!imgCfg().autoAlias && GalStore.local('gal_autoalias') === false) return;
    var todo = (misses || []).filter(function (m) {
      return m.kind === 'scene' && Resolver.needsAlias(m.via) && m.loc;
    });
    if (!todo.length) return;
    todo.slice(0, 2).forEach(function (m) {      // 一轮最多问两个，别把额度花在这上面
      Resolver.autoAlias(m.loc, cgQuiet).then(function (hit) {
        if (!hit) return;
        console.log('[别名] 自动登记 ' + m.loc + ' → ' + hit);
        /* 登记完立刻重绘当前这句，不用等下一轮 */
        if (eng.log[qi]) present(eng.log[qi], { instant: true });
        if (typeof renderDebug === 'function') renderDebug();
      });
    });
  }


  /* ============================================================
     设置 · token 计数
     ============================================================ */
  function tkModel() { return (GalAPI.loadConfig && GalAPI.loadConfig().model) || ''; }

  function renderTokens() {
    if (!$('tk-on')) return;
    var on = GalStore.local('gal_tokenizer') === true;
    var bud = GalStore.local('gal_wb_budget') || 'chars';
    $('tk-on').checked = on;
    $('tk-budget').value = bud;
    $('tk-note').textContent = '当前：' + Tokens.note(tkModel());
    $('tk-budget-note').textContent = bud === 'tokens'
      ? (Tokens.mode(tkModel()) === 'exact'
          ? '按真实 token 裁剪，裁得准。'
          : '⚠ 分词器还没加载好，这一项暂时仍按字符裁。')
      : '按字符裁。对中文来说字符数和 token 数差得不小，只是个近似闸门。';

    /* 拿当前这一轮的请求当样本，直接把差多少摆出来 —— 比讲道理直观 */
    var rp = eng.lastReport && eng.lastReport.prompt;
    if (rp && rp.messages) {
      var txt = rp.messages.map(function (m) { return m.content; }).join('\n');
      var rough = Math.round(Tokens.rough(txt));
      var real = Tokens.count(txt, tkModel());
      $('tk-demo').textContent = Tokens.mode(tkModel()) === 'exact'
        ? '上次请求：粗估 ' + rough.toLocaleString() + ' → 实际 ' + real.toLocaleString() +
          '（' + (rough > real ? '高' : '低') + '估 ' +
          Math.abs(Math.round((rough - real) / real * 100)) + '%）'
        : '上次请求粗估 ' + rough.toLocaleString() + ' token。打开开关后这里会显示真实值和偏差。';
    } else {
      $('tk-demo').textContent = '';
    }
  }

  function bindTokens() {
    if (!$('tk-on')) return;
    $('tk-on').onchange = async function () {
      var on = this.checked;
      GalStore.local('gal_tokenizer', on);
      if (on) {
        $('tk-note').textContent = '正在加载分词器（2MB，只加载一次）…';
        var ok = await Tokens.ready(tkModel());
        if (!ok) {
          $('tk-note').textContent = '✗ 加载失败：core/vendor/ 下那两个 gpt-tokenizer 文件可能被删了。已回退粗估。';
          return;
        }
      }
      renderTokens();
      renderDebug();
    };
    $('tk-budget').onchange = function () {
      GalStore.local('gal_wb_budget', this.value);
      applyWbBudget();
      renderTokens();
    };
  }

  /** 把预算模式落到引擎配置上 */
  function applyWbBudget() {
    var mode = GalStore.local('gal_wb_budget') || 'chars';
    if (mode === 'tokens') {
      eng.cfg.budgetTokens = 30000;      /* 60000 字符大致相当于这个量级 */
      eng.cfg.model = tkModel();
    } else {
      delete eng.cfg.budgetTokens;
    }
  }

  /* 开机时如果用户之前打开过，就预热一次（异步，不挡启动） */
  if (GalStore.local('gal_tokenizer') === true) {
    Tokens.ready('').then(function (ok) {
      if (ok) { applyWbBudget(); if (typeof renderDebug === 'function') renderDebug(); }
    });
  }


  /* ============================================================
     设置 · 世界书语义检索
     ============================================================ */
  function vecCfg() {
    return Object.assign({}, Vector.DEFAULTS, GalStore.local('gal_vector') || {});
  }
  function saveVecCfg(patch) {
    var c = Object.assign(vecCfg(), patch || {});
    GalStore.local('gal_vector', c);
    Vector.configure(c);
    return c;
  }

  async function renderVecSec() {
    if (!$('vec-on')) return;
    var c = vecCfg();
    $('vec-on').checked = !!c.enabled;
    $('vec-model').value = c.model;
    $('vec-k').value = c.topK; $('vec-k-v').textContent = c.topK;
    $('vec-th').value = c.threshold; $('vec-th-v').textContent = c.threshold;
    $('vec-dc').value = c.decayStrength; $('vec-dc-v').textContent = c.decayStrength;
    var st = await Vector.stats(eng.pool);
    var parts = ['已索引 ' + st.indexed + ' 条 / 需要 ' + st.needed + ' 条'];
    if (st.stale) parts.push('其中 ' + st.stale + ' 条内容改过，需要重建');
    parts.push(st.dims + ' 维 · ' + st.model);
    if (st.lastError) parts.push('上次报错：' + st.lastError);
    $('vec-out').textContent = parts.join('　·　');
  }

  function bindVecSec() {
    if (!$('vec-on')) return;
    $('vec-on').onchange = function () { saveVecCfg({ enabled: this.checked }); renderVecSec(); };
    $('vec-model').onchange = function () {
      saveVecCfg({ model: this.value.trim() || Vector.DEFAULTS.model }); renderVecSec();
    };
    $('vec-k').oninput = function () { $('vec-k-v').textContent = this.value; saveVecCfg({ topK: +this.value }); };
    $('vec-th').oninput = function () { $('vec-th-v').textContent = this.value; saveVecCfg({ threshold: +this.value }); };
    $('vec-dc').oninput = function () { $('vec-dc-v').textContent = this.value; saveVecCfg({ decayStrength: +this.value }); };

    $('vec-build').onclick = async function () {
      var out = $('vec-out');
      if (!eng.pool.length) { out.textContent = '还没载入角色卡，没有条目可以索引。'; return; }
      this.disabled = true;
      Vector.configure(vecCfg());
  /* 直接调，别用 setTimeout —— 按钮是 index.html 里的静态元素，脚本又在 body 末尾，
     延迟调的话初始状态同步不上，第一次点击看着像没反应。 */
  renderCGMode();
      try {
        var r = await Vector.buildIndex(eng.pool, {
          onProgress: function (p) {
            out.textContent = p.total
              ? '建索引中 ' + p.done + '/' + p.total + '（' + p.skipped + ' 条已缓存，跳过）'
              : '全部 ' + p.skipped + ' 条都已缓存，无需重建。';
          }
        });
        out.textContent = '✓ 新建 ' + r.built + ' 条，复用缓存 ' + r.skipped + ' 条，共 ' + r.total + ' 条。\n' +
          '索引按内容哈希缓存，改过的条目才会重算 —— 不会每次都花钱。';
      } catch (e) {
        out.textContent = '✗ ' + ((e && e.message) || e);
      }
      this.disabled = false;
    };

    $('vec-clear').onclick = async function () {
      await Vector.clearIndex();
      renderVecSec();
    };
  }

  Vector.configure(vecCfg());
  /* 直接调，别用 setTimeout —— 按钮是 index.html 里的静态元素，脚本又在 body 末尾，
     延迟调的话初始状态同步不上，第一次点击看着像没反应。 */
  renderCGMode();


  /* ============================================================
     开场引导：四步向导

     版式借鉴天青的标题画面和开拓轶事的新游戏向导，逻辑是我们自己的：
     每一步都能自己判断"齐了没有"，左栏的点会变绿，没齐的那步不会挡着你
     往下翻（只是「开始游戏」按钮不亮），因为接口可以最后填。
     ============================================================ */
  var BOOT_STEPS = [
    { k: 'asset', code: 'ASSET',    t: '素 材', d: '载入角色卡和预设。两个文件都只存在本机浏览器，不会上传。' },
    { k: 'api',   code: 'API',      t: '接 口', d: '填模型接口。地址填根地址就行，/v1 这些会自动补。' },
    { k: 'art',   code: 'ARTWORK',  t: '插 画', d: '可选。开了之后 AI 每轮会产出 1~2 张插画，铺成 CG。' },
    { k: 'go',    code: 'START',    t: '开 场', d: '起个称呼，挑一个开局，就可以进去了。' }
  ];
  var bootStep = 0;

  /** 每一步"齐了没有" */
  function bootDone(k) {
    if (k === 'asset') return !!loaded.card;
    if (k === 'api') {
      var c = GalAPI.loadConfig();
      return !!(String(c.baseUrl || '').trim() && String(c.apiKey || '').trim() &&
                String(c.model || '').trim());
    }
    if (k === 'art') {
      var g = imgCfg();
      return !g.enabled || !!String(g.apiKey || '').trim();   // 没开也算"处理过了"
    }
    if (k === 'go') return !!loaded.card;
    return false;
  }

  function renderBoot() {
    if (!$('boot-steps')) return;
    var cur = BOOT_STEPS[bootStep];
    $('boot-kicker').textContent =
      'STEP ' + String(bootStep + 1).padStart(2, '0') + ' / ' + cur.code;
    $('boot-title').textContent = cur.t;
    $('boot-sub').textContent = cur.d;
    $('boot-bar-fill').style.width = ((bootStep + 1) / BOOT_STEPS.length * 100) + '%';

    PA2('#boot-steps button').forEach(function (b, i) {
      b.classList.toggle('on', i === bootStep);
      b.classList.toggle('done', i !== bootStep && bootDone(BOOT_STEPS[i].k));
    });
    PA2('#boot .boot-pane').forEach(function (p2) {
      p2.classList.toggle('on', p2.dataset.pane === cur.k);
    });
    $('boot-prev').disabled = bootStep === 0;
    $('boot-next').hidden = bootStep === BOOT_STEPS.length - 1;
    $('btn-start').hidden = bootStep !== BOOT_STEPS.length - 1;
    if (cur.k === 'go') renderBootReady();
    if (cur.k === 'art') renderBootArt();
  }

  function gotoBoot(i) {
    bootStep = Math.max(0, Math.min(BOOT_STEPS.length - 1, i));
    renderBoot();
    var body = $('boot-body') || document.querySelector('#boot .boot-body');
    if (body) body.scrollTop = 0;
  }

  /** 最后一步给一张「齐没齐」的清单，比只给个灰按钮清楚 */
  function renderBootReady() {
    var box = $('boot-ready');
    if (!box) return;
    var c = GalAPI.loadConfig();
    var g = imgCfg();
    var rows = [
      { ok: !!loaded.card, must: true, t: loaded.card
          ? '角色卡已载入 · 世界书 ' + eng.pool.length + ' 条' : '还缺角色卡（第 1 步）' },
      { ok: !!loaded.preset, must: false, t: loaded.preset
          ? '预设已载入 · ' + PromptBuilder.parsePreset(eng.preset).order.length + ' 块'
          : '没载入预设 —— 模型多半不会按剧本格式输出' },
      { ok: bootDone('api'), must: false, t: bootDone('api')
          ? '接口已填 · ' + (c.model || '') : '接口还没填完（第 2 步）' },
      { ok: !!g.enabled, must: false, t: g.enabled
          ? '文生图已开 · 每轮 ' + g.perTurn + ' 张' : '文生图没开（可以之后再开）' }
    ];
    box.innerHTML = rows.map(function (r) {
      var cls = r.ok ? 'ok' : (r.must ? 'bad' : '');
      return '<div class="r ' + cls + '"><i>' + (r.ok ? '✓' : (r.must ? '!' : '·')) +
        '</i>' + esc(r.t) + '</div>';
    }).join('');
  }

  /** 插画那一步和「设置 · 文生图」共用同一份配置 */
  function renderBootArt() {
    if (!$('boot-ig-on')) return;
    var g = imgCfg();
    $('boot-ig-on').checked = !!g.enabled;
    $('boot-ig-key').value = g.apiKey || '';
    $('boot-ig-note').textContent = g.enabled
      ? (String(g.apiKey || '').trim()
          ? '✓ 已开。' + g.model + ' · ' + g.size + ' · 每轮 ' + g.perTurn + ' 张（免费档）'
          : '⚠ 开了但还没填 Token，出图会失败。')
      : '关着。之后在「设置 · 文生图」里随时能开。';
  }

  function bindBoot() {
    if (!$('boot-steps')) return;
    $('boot-steps').onclick = function (e) {
      var b = e.target.closest ? e.target.closest('button[data-step]') : null;
      if (!b) return;
      for (var i = 0; i < BOOT_STEPS.length; i++) {
        if (BOOT_STEPS[i].k === b.dataset.step) return gotoBoot(i);
      }
    };
    $('boot-prev').onclick = function () { gotoBoot(bootStep - 1); };
    $('boot-next').onclick = function () { gotoBoot(bootStep + 1); };
    $('boot-ig-on').onchange = function () {
      saveImgCfg({ enabled: this.checked });
      syncImageRule();
      renderBootArt();
      if (typeof renderImgSec === 'function' && curSec === 'img') renderImgSec();
    };
    $('boot-ig-key').onchange = function () {
      saveImgCfg({ apiKey: this.value.trim() });
      renderBootArt();
    };
    renderBoot();
    if ($('boot-netbox')) { $('boot-netbox').innerHTML = netBoxHTML(); renderNetBoxes(); }
  }

  /** 演完一轮：把新句子并进日志，跳到这批的第一句 */
  function play(modules) {
    if (!modules || !modules.length) {
      speakerEl.className = 'narrator';
      speakerEl.textContent = '系统';
      textEl.textContent = '模型这次没有输出可解析的剧本。打开调试面板看「模型原文」。';
      $('hint').classList.remove('on');
      return;
    }
    var start = eng.appendLog(modules);
    $('dialogue').hidden = false;
    goTo(start);
    renderHistory();
    return start;
  }

  /* ============================================================
     一轮对话
     ============================================================ */
  /* ============================================================
     输入法组合态
     ============================================================ */
  /**
   * 拼音/日文输入法选词时按回车，是在**确认候选词**，不是在发送。
   * 不判这个的话，打「你好」按空格选词、再按回车，会把半截内容直接发出去。
   *
   * e.isComposing 是标准字段；keyCode 229 是旧浏览器（以及部分安卓输入法）
   * 在组合态下统一上报的值，一并兜住。
   */
  function composing(e) {
    return !!(e && (e.isComposing || e.keyCode === 229));
  }

  /* 轻提示：不挡操作，几秒后自己消失 */
  function toast(msg, kind, ms) {
    var box = $('gal-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'gal-toast';
      document.body.appendChild(box);
    }
    var it = document.createElement('div');
    it.className = 'gal-toast-item ' + (kind || '');
    it.textContent = msg;
    it.onclick = function () { it.remove(); };
    box.appendChild(it);
    setTimeout(function () { it.classList.add('out'); }, (ms || 9000) - 400);
    setTimeout(function () { it.remove(); }, ms || 9000);
  }

  /** 这一轮是怎么结束的：被截断 / 被过滤 / 只写了思维链，都要让玩家知道，
      而不是只看到一段戛然而止的台词、不知道是哪一环的问题 */
  function warnAfterTurn(res) {
    var f = GalAPI.lastFinish;
    var rs = res && res.reasoning;
    if (rs && rs.onlyReasoning) {
      toast('这一轮模型只写了思维链、正文还没开始就停了。多半是「最大输出」太小，到 设置 · 接口 调大。', 'bad', 14000);
      return;
    }
    if (f && f.info) {
      toast(f.info.text, f.info.kind === 'filter' ? 'bad' : 'warn', 14000);
    } else if (rs && rs.unclosed) {
      toast('思维链没写闭合标签，已按正文起点切开。如果台词缺了一截，调大「最大输出」。', 'warn', 9000);
    }
  }

  /**
   * 发一轮。
   * @param {string} [userText] 不传就读输入框
   * @param {object} [opt] { reroll: 回合快照 } —— 重roll 时传，沿用那一轮的快照，
   *        并附一句「换一种写法」的要求；失败时退回原来那一版，不会什么都没了
   */
  async function submit(userText, opt) {
    opt = opt || {};
    if (busy) return;
    var input = $('usertext');
    var fromInput = userText == null;
    userText = userText != null ? userText : input.value.trim();
    if (!userText) return;
    busy = true;
    if (fromInput) { input.value = ''; input.style.height = 'auto'; }
    $('send').disabled = true;
    updateTurnUI();
    abortCtl = new AbortController();
    startSpinner();
    if (opt.reroll) $('elapsed').textContent = ' 重roll 中…';

    var snap = opt.reroll || beginTurn(userText);
    try {
      var persona = Editors.loadPersona();
      var res = await eng.turn(userText, {
        userName: persona.name,
        persona: persona.description,
        extraHint: opt.reroll ? rerollHint(snap) : '',
        send: function (messages, params) {
          return GalAPI.chatWithRetry(messages, {
            params: params,
            signal: abortCtl.signal,
            onDelta: function (d, full) { lastRaw = full; },
            onRetry: function (n, total) {
              $('elapsed').textContent = ' 断线重连 ' + n + '/' + total + '…';
            },
            onCompat: function (why) { toast('参数自动调整：' + why + '（已记住，之后不再报错）', 'warn', 8000); }
          });
        },
        onEmptyRetry: function () { $('elapsed').textContent = ' 空回复，自动重试…'; }
      });
      lastResult = res;
      lastRaw = res.raw || res.text;
      warnAfterTurn(res);
      await waitImages(res.modules);
      var startIdx = play(res.modules);
      recordVariant(snap, res);
      await checkpoint(snap);
      autosave({ skipNode: true });
      if (opt.reroll) toast('已重roll：这是第 ' + snap.variants.length + ' 版。不满意可以再点一次，' +
        '或者用 ‹ › 翻回之前的版本。', 'ok', 6000);
      /* 出图另起一条线，不 await —— 剧情已经能推了，图慢慢来 */
      if (startIdx != null) kickCG(res, startIdx);
      autoRegisterScenes(res.misses);
    } catch (e) {
      /* 重roll 失败：已经撤掉的那一版原样放回去，别让玩家两头落空 */
      if (opt.reroll && snap.variants.length) {
        applyVariant(snap, snap.vi, { silent: true });
        toast('重roll 没成功，已经放回原来那一版：' + String(e.message || e).split('\n')[0], 'bad', 12000);
      } else {
        speakerEl.className = 'narrator';
        speakerEl.textContent = '错误';
        var rp = eng.lastReport && eng.lastReport.prompt;
        var size = rp ? '\n\n本次请求约 ' + rp.report.estTokens.toLocaleString() +
                        ' token（' + rp.report.messageCount + ' 条消息）' : '';
        textEl.textContent = String(e.message || e) + size +
          (GalAPI.isTransient(e) ? '\n重试 2 次仍然失败。这类错误多半是中转到上游的连接不稳，' +
                                    '可以直接再发一次试试。' : '');
        $('dialogue').hidden = false;
        hintEl.classList.remove('on');
      }
      /* 把刚才那句还回输入框 —— 输入框是在发请求**之前**清空的，
         网络一抖或者点了中断，玩家写的两百字就没了。
         只在输入框还空着时还原，免得盖掉他这段时间里新写的东西。 */
      if (fromInput && !input.value) {
        input.value = userText;
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 110) + 'px';
      }
    } finally {
      busy = false;
      abortCtl = null;
      $('send').disabled = false;
      stopSpinner();
      updateTurnUI();
      renderDebug();
      renderVars();
      renderHistory();
      renderPhone();
      refreshPhoneBadge();
    }
  }

  /* ============================================================
     回合快照：重roll / 撤回 / 版本切换
     ============================================================
     有人反馈「对回复不满意，不知道怎么重来」。以前确实没有入口 ——
     只能读档。现在输入框旁边有三样：
       ⟳ 重roll   撤掉最后一轮，用同一句话重新生成（附一句「换一种写法」）
       ↶ 撤回     撤掉最后一轮，把那句话还回输入框，改了再发
       ‹ 2/3 ›    同一轮重roll 过的几版之间来回切，不花钱
     每一轮开始前记一份「回合前快照」：变量、宏变量、这轮之前的历史长度和轮次号。
     撤掉一轮 = 把这些恢复回去，再把这一轮的历史和剧情记录摘掉。
     （KaiTuoYiShi 的重roll 也是这个思路：preTurnSnapshot + 回滚；
       多版本切换是酒馆 swipe 的做法，KT 没有） */
  var turnStack = [];          // 最近几轮的回合前快照，栈顶是最后一轮
  var TURN_KEEP = 8;           // 内存里留几层（能连续撤回几轮）
  var TURN_SAVE = 3;           // 存档里带几层（读档后还能重roll）

  function deepCopy(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  function beginTurn(userText) {
    var last = eng.log[eng.log.length - 1];
    return {
      userText: userText,
      histLen: eng.history.length,
      turnNo: last ? last.turn + 1 : 0,
      vars: deepCopy(eng.vars),
      macroVars: deepCopy(eng.macroVars || {}),
      cursor: qi,
      node: activeNode,          // 这一轮从哪个存档节点出发
      turnNode: null,            // 这一轮自己的节点（checkpoint 时定）
      variants: [],              // 每一版：{ raw, mods, varsAfter, at }
      vi: 0
    };
  }

  /** 这一轮生成完，把结果记成一个「版本」 */
  function recordVariant(snap, res) {
    var mods = eng.log.filter(function (m) { return m.turn === snap.turnNo; });
    snap.variants.push({
      raw: res.raw || res.text || '',
      mods: mods,
      varsAfter: deepCopy(eng.vars),
      macroAfter: deepCopy(eng.macroVars || {}),
      at: Date.now()
    });
    snap.vi = snap.variants.length - 1;
    if (turnStack[turnStack.length - 1] !== snap) {
      turnStack.push(snap);
      if (turnStack.length > TURN_KEEP) turnStack.splice(0, turnStack.length - TURN_KEEP);
    }
  }

  /** 撤掉这一轮：恢复变量，摘掉这一轮的历史和剧情记录 */
  function revertTurn(snap) {
    if (window.CG && CG.cancel) CG.cancel();       // 这一轮还在出的图别挂到下一版上
    /* 历史：摘掉这一轮那一对 user/assistant。按内容找而不是直接截断 ——
       这一轮之后手机群聊可能又往历史里加了几条（phoneOnly），那些要留着 */
    for (var i = Math.max(0, snap.histLen - 2); i < eng.history.length; i++) {
      var m = eng.history[i];
      if (m && m.role === 'user' && !m.phoneOnly && m.content === snap.userText) {
        var nx = eng.history[i + 1];
        eng.history.splice(i, nx && nx.role === 'assistant' && !nx.phoneOnly ? 2 : 1);
        break;
      }
    }
    eng.log = eng.log.filter(function (m) { return m.turn < snap.turnNo; });
    eng.vars = deepCopy(snap.vars) || {};
    eng.macroVars = deepCopy(snap.macroVars) || {};
    activeNode = snap.node;
  }

  /** 撤完之后把舞台停到上一轮的最后 */
  function showAfterRevert(snap) {
    if (eng.log.length) {
      goTo(Math.min(snap.cursor != null ? snap.cursor : eng.log.length - 1, eng.log.length - 1), { instant: true });
    } else {
      speakerEl.className = 'narrator'; speakerEl.textContent = '系统';
      textEl.textContent = '已撤回到开头。';
      qi = 0; updateNav();
    }
    renderHistory();
  }

  /** 切到第 i 版：不发请求，直接把那一版的剧情记录和变量放回去 */
  function applyVariant(snap, i, o) {
    o = o || {};
    var v = snap.variants[i];
    if (!v) return;
    revertTurn(snap);
    eng.history.push({ role: 'user', content: snap.userText });
    eng.history.push({ role: 'assistant', content: eng.historyTextOf(v.raw) });
    eng.vars = deepCopy(v.varsAfter) || eng.vars;
    eng.macroVars = deepCopy(v.macroAfter) || eng.macroVars;
    snap.vi = i;
    lastRaw = v.raw;
    if (v.mods && v.mods.length) {
      var start = eng.appendLog(v.mods, { turn: snap.turnNo });
      $('dialogue').hidden = false;
      goTo(start, { instant: !!o.silent });
      renderHistory();
    } else {
      var r = eng.processOutput(v.raw);
      v.mods = r.modules; v.varsAfter = deepCopy(eng.vars);
      play(r.modules);
    }
    if (!o.silent) {
      var done = function () { autosave({ skipNode: true }); };
      checkpoint(snap).then(done, done);
    }
    updateTurnUI();
    renderVars();
  }

  /** 重roll 时附给模型的要求（只对这一次请求生效）。思路同 KaiTuoYiShi 的 buildRerollGenerationGuard */
  function rerollHint(snap) {
    var prev = snap.variants[snap.vi];
    var ex = prev ? eng.historyTextOf(prev.raw).replace(/\s+/g, ' ').slice(0, 160) : '';
    return '<重写要求>\n玩家对上一版回复不满意，要求重写这一轮。玩家的输入和剧情事实起点保持不变，' +
      '但换一种写法：换开场镜头、推进顺序、对白切入和结尾，不要复用上一版的句子。\n' +
      (ex ? '上一版开头（只用于避免重复，不是已经发生的事）：' + ex + '\n' : '') + '</重写要求>';
  }

  async function rerollLast() {
    if (busy) return;
    var snap = turnStack[turnStack.length - 1];
    if (!snap) {
      toast('还没有能重roll的回合。开场白不能重roll —— 想换开场可以点右上角 ⏻ 退出，换一个开局。', 'warn', 8000);
      return;
    }
    revertTurn(snap);
    showAfterRevert(snap);
    await submit(snap.userText, { reroll: snap });
  }

  async function undoLast() {
    if (busy) return;
    var snap = turnStack.pop();
    if (!snap) { toast('没有能撤回的回合了。', 'warn'); return; }
    revertTurn(snap);
    showAfterRevert(snap);
    /* 这一轮自己的自动节点也撤掉（它就是被撤掉的那一版）；手动存过的不动 */
    if (snap.turnNode) {
      try {
        var d = await GalStore.loadSlot('node:' + snap.turnNode);
        if (d && d.type === 'auto') await GalStore.deleteSlot('node:' + snap.turnNode);
      } catch (e) {}
    }
    autosave();
    var input = $('usertext');
    if (!input.value.trim()) {
      input.value = snap.userText;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 110) + 'px';
    }
    input.focus();
    updateTurnUI();
    renderVars();
    toast('已撤回最后一轮，那句话放回输入框了，改完再发。', 'ok', 5000);
  }

  function switchVariant(delta) {
    var snap = turnStack[turnStack.length - 1];
    if (busy || !snap || snap.variants.length < 2) return;
    var i = snap.vi + delta;
    if (i < 0 || i >= snap.variants.length) return;
    applyVariant(snap, i);
  }

  /** 输入栏上三个按钮的状态 */
  function updateTurnUI() {
    var snap = turnStack[turnStack.length - 1];
    var rr = $('btn-reroll'), ud = $('btn-undo'), vs = $('turn-ver');
    if (rr) rr.disabled = busy || !snap;
    if (ud) ud.disabled = busy || !snap;
    if (vs) {
      var n = snap ? snap.variants.length : 0;
      vs.hidden = n < 2;
      if (n >= 2) {
        $('ver-n').textContent = (snap.vi + 1) + '/' + n;
        $('ver-prev').disabled = busy || snap.vi <= 0;
        $('ver-next').disabled = busy || snap.vi >= n - 1;
      }
    }
  }

  /** 存档里带上的快照（剧情记录 mods 很占地方，只带最近几层） */
  function stackForSave() {
    return turnStack.slice(-TURN_SAVE).map(function (s) {
      return Object.assign({}, s, { variants: s.variants.map(function (v) {
        return { raw: v.raw, mods: v.mods, varsAfter: v.varsAfter, macroAfter: v.macroAfter, at: v.at };
      }) });
    });
  }



  /* ============================================================
     小手机 —— 骨架与样式原样取自 juus 卡，这里只负责填内容
     ============================================================ */
  var phoneSeen = 0, phoneReady = false, curContact = null, curGroup = null;

  function P(sel) { return document.querySelector('#jup-root ' + sel); }
  function PA(sel) { return Array.prototype.slice.call(document.querySelectorAll('#jup-root ' + sel)); }

  function phoneData() {
    return window.Phone ? Phone.scan(eng.history, eng.phoneSent,
        { userName: GalStore.local('gal_username') || '指挥官' })
      : { chats: {}, groups: {}, posts: [], trends: [], counts: { total: 0 } };
  }
  function av(url) {
    return url ? '<img class="av" src="' + url + '" loading="lazy" alt="">'
               : '<span class="av"></span>';
  }
  function lastLine(log) {
    if (!log || !log.length) return '还没有消息';
    var m = log[log.length - 1];
    return m.type === 'sticker' ? '[表情]' : m.v;
  }

  var ctFilter = 0;      // 0 全部 / 1 仅在场 / 2 有消息

  function applyCtFilter() {
    var si = P('.ctsi');
    var q = si ? si.value.trim() : '';
    var d = phoneData();
    var ppl = (eng.vars && eng.vars.人物) || {};
    PA('.ctl .ct').forEach(function (el) {
      var n = el.dataset.c || '';
      var pass = !q || n.indexOf(q) !== -1;
      if (pass && ctFilter === 1) pass = !!(ppl[n] && ppl[n].在场);
      if (pass && ctFilter === 2) pass = (d.chats[n] || []).length > 0;
      el.style.display = pass ? '' : 'none';
    });
  }

  var phoneBusy = false;

  /**
   * 手机对话独立于主线：单独发一次请求，只让对方回短信，不推进剧情、不写主线历史。
   * 这些记录会由 engine.renderPhoneLog() 注入下一轮主线上下文，所以两边互相看得到。
   */
  async function chatTurn(input, kind) {
    var name = curContact, group = curGroup;
    var S = (window.PHONE_RES && PHONE_RES.stickers) || {};
    var shownValue = kind === 'sticker' ? (S[input] || input) : input;
    pushSent(group, name, kind, shownValue);
    renderPhone(); openChat(name, group);

    phoneBusy = true;
    var ty = P('.ty'); if (ty) ty.style.display = '';
    var typing = document.createElement('div');
    typing.className = 'ph-typing';
    typing.textContent = (group || name) + ' 正在输入…';
    var ms = P('.ms'); if (ms) { ms.appendChild(typing); ms.scrollTop = ms.scrollHeight; }

    try {
      var d = phoneData();
      var log = group ? (d.groups[group] || []) : (d.chats[name] || []);
      var userText = kind === 'sticker' ? '[表情包：' + input + ']' : input;
      /* 拿角色名 + 这句话去激活世界书，把她自己的设定和当前剧情一起带上 */
      var ctx = eng.quietContext((group || name) + ' ' + userText + ' ' +
        (log || []).slice(-4).map(function (x) { return x.v; }).join(' '),
        { who: name || group });
      var prompt = group
        ? Phone.buildGroupPrompt(group, log, groupMembers(group), userText, ctx)
        : Phone.buildSmsPrompt(name, log,
            ((eng.vars && eng.vars.人物) || {})[name], userText, ctx);

      var raw = await eng.quiet(prompt, {
        send: function (msgs, params) {
          return GalAPI.chatWithRetry(msgs, { params: params, retries: 1 });
        }
      });

      if (group) {
        /* 群聊直接输出 [群聊|…] 标签，塞进一条虚拟 assistant 记录让扫描器认领 */
        /* 群聊输出的就是 [群聊|…] 标签，塞进历史交给扫描器认领；
           标 phoneOnly，主线组装时会跳过它 */
        eng.history.push({ role: 'assistant', content: raw, phoneOnly: true });
      } else {
        Phone.parseSmsReply(raw).forEach(function (it, i) {
          eng.phoneSent.push({ group: null, who: name, type: it.type, v: it.v,
                               me: false,
                               turn: nextSeq() });
        });
      }
    } catch (e) {
      eng.phoneSent.push({ group: group, who: group ? '系统' : name, type: 'text',
        v: '（没能送达：' + String(e.message || e).split('\n')[0] + '）',
        me: false, turn: nextSeq() });
    } finally {
      phoneBusy = false;
      if (typing.parentNode) typing.parentNode.removeChild(typing);
      renderPhone();
      openChat(name, group);
      refreshPhoneBadge();
    }
  }

  function groupMembers(g) {
    var META = (window.PHONE_RES && PHONE_RES.groupMeta) || {};
    var custom = GalStore.local('gal_groups') || {};
    var m = (META[g] && META[g].members) || (custom[g] && custom[g].members) || [];
    if (m.length) return m.slice(0, 24);
    return (window.Phone ? Phone.roster() : []).slice(0, 20);
  }

  /* 手机消息的排序用单调递增的序号。
     原来用 eng.history.length —— 但私聊是独立生成、不写主线历史，
     所以连发两条时两条的 turn 完全一样，排序就乱了：
     你的第二句会跟第一句挤在一起，回复全堆到后面。

     ⚠ 但只用 ++phoneSeq 又错得更离谱：剧情里的 [短信|…] 用的 turn 是
     **history 数组下标**（玩几十轮就是几十上百），而 phoneSeq 从 1 开始。
     两套编号混在一起排序，手机侧消息**永远排在剧情侧短信前面**。
     实测第 40 轮时她发来「晚上有空吗」(turn=39)，你回的「有空啊」(turn=1)
     排在她前面。

     所以现在回到同一个坐标系：整数部分 = 当前 history 长度（保证排在
     已有剧情消息之后），小数部分 = 单调递增的 seq（保证同一时刻连发的
     几条之间有稳定先后）。1e6 的分母足够大，几十万条手机消息才会进位。 */
  function nextSeq() { return eng.history.length + (++eng.phoneSeq) / 1e6; }

  /** me=true 表示这条是玩家自己发的 */
  function pushSent(group, who, type, v, me) {
    eng.phoneSent.push({ group: group || null,
                         who: me === false ? who : (group ? '我' : who),
                         type: type, v: v, me: me !== false,
                         turn: nextSeq() });
  }

  function makeGroup() {
    var name = prompt('群聊名字');
    if (!name || !(name = name.trim())) return;
    var who = prompt('拉谁进来？逗号分隔（可留空）', '') || '';
    var custom = GalStore.local('gal_groups') || {};
    custom[name] = { members: who.split(/[,，、\s]+/).filter(Boolean) };
    GalStore.local('gal_groups', custom);
    renderPhone();
    openChat(null, name, phoneData());
  }

  /* 主屏 App 定义。图标色用渐变，图形用 emoji —— 不依赖任何图标库。 */
  var APPS = [
    { k:'juus', name:'JUUS',       icon:'💬', bg:'linear-gradient(160deg,#5ac8fa,#0a84ff)' },
    { k:'ig',   name:'推荐',       icon:'📷', bg:'linear-gradient(160deg,#ff9a6c,#ff375f)' },
    { k:'hot',  name:'热点',       icon:'📡', bg:'linear-gradient(160deg,#ffd60a,#ff9f0a)' },
    { k:'doss', name:'档案',       icon:'🗂', bg:'linear-gradient(160deg,#bf5af2,#7d3cc0)' },
    { k:'log',  name:'剧情',       icon:'📜', bg:'linear-gradient(160deg,#8ad6a0,#30b06a)' },
    { k:'cfg',  name:'设置',       icon:'⚙',  bg:'linear-gradient(160deg,#60cdf0,#2b7fa8)' }
  ];

  /* 「设置」里的分区。合成一个工作台，左侧导航切换。 */
  /* ============================================================
     「图片网络」设置 + 测试（开场引导的接口页、手机设置里各一份，同一套）
     ============================================================ */
  function netBoxHTML() {
    return '<div class="netbox">' +
      '<label>图片怎么加载<select class="nb-mode">' +
      '<option value="auto">自动：先直连，连不上自动走中转（推荐）</option>' +
      '<option value="relay">总走中转：代拉并压缩，省流量，手机上更快</option>' +
      '<option value="direct">只直连（不走中转）</option>' +
      '<option value="custom">自定义中转地址</option></select></label>' +
      '<label class="nb-tpl-l" hidden>中转地址（{url} 会换成图片地址）' +
      '<input type="text" class="nb-tpl" placeholder="https://你的图片代理/?url={url}"></label>' +
      '<label>每轮开演前最多等图<select class="nb-wait">' +
      '<option value="0">不等（边演边加载）</option><option value="6">6 秒</option>' +
      '<option value="12">12 秒</option><option value="20">20 秒</option>' +
      '<option value="30">30 秒</option></select></label>' +
      '<div class="nb-row"><button type="button" class="kt-btn nb-test">测试图片网络</button>' +
      '<span class="nb-stat"></span></div>' +
      '<div class="nb-out"></div>' +
      '<p class="nb-tip">立绘和背景都挂在第三方图床上（files.catbox.moe、huggingface.co），国内要走代理。' +
      '图裂了先点「测试」：它会分别测本站、图床直连、图床经中转，告诉你卡在哪一段。' +
      '中转默认用 wsrv.nl（开源的图片代理，顺手把图压小，4096 的背景 670KB → 110KB）。</p>' +
      '</div>';
  }
  function renderNetBoxes() {
    var c = ImgNet.config(), st = ImgNet.stats();
    var bad = Object.keys(st).filter(function (h) { return st[h].bad; });
    PA2('.netbox').forEach(function (box) {
      box.querySelector('.nb-mode').value = c.mode;
      box.querySelector('.nb-wait').value = String(c.wait);
      if (box.querySelector('.nb-wait').value !== String(c.wait)) box.querySelector('.nb-wait').value = '12';
      box.querySelector('.nb-tpl').value = c.tpl;
      box.querySelector('.nb-tpl-l').hidden = c.mode !== 'custom';
      box.querySelector('.nb-stat').textContent = !bad.length || c.mode !== 'auto' ? '' :
        '当前：' + bad.map(function (h) {
          return h + (st[h].rok ? ' 直连不通，正在走中转' : ' 直连不通，中转也还没拉到图');
        }).join('；');
    });
  }
  /** 测试用的样图：每个图床挑一张（优先卡里的场景图 —— 立绘里死链多，拿死链测会误判） */
  function netSamples() {
    var out = [];
    function add(u) { u = ImgNet.originOf(u); if (ImgNet.isRemote(u) && out.indexOf(u) < 0) out.push(u); }
    var R0 = window.RESOURCE || {};
    [R0.scenes, R0.defaults].forEach(function (obj) {
      if (!obj) return;
      Object.keys(obj).slice(0, 30).forEach(function (k) {
        JSON.stringify(obj[k]).replace(/https?:\/\/[^"\\]+/g, function (u) { add(u); return u; });
      });
    });
    lineImgs(eng.log && eng.log[qi]).forEach(add);
    return out;
  }
  function fmtRes(r) {
    if (!r) return '<span class="dim">（没测）</span>';
    if (r.local) return '<span class="dim">本地打开的，不用测</span>';
    var t = (r.ms / 1000).toFixed(1) + 's';
    if (r.ok) return '<span class="ok">✓ 通</span> ' + t + (r.bytes ? ' · ' + Math.round(r.bytes / 1024) + 'KB' : '');
    if (r.status) return '<span class="warn">✗ HTTP ' + r.status + '</span>（连上了，是这张图本身没了）';
    return '<span class="bad">✗ ' + (r.err === 'timeout' ? '超时' : '连不上') + '</span> ' + t;
  }
  function netVerdict(d) {
    var tips = '让代理管到图床：规则模式里加上这几个域名，或者直接开全局；' +
      '手机代理有「分应用代理」的，看看勾没勾你用的浏览器；' +
      '关掉手机的「私人 DNS」和浏览器的「安全 DNS」，代理里有 IPv6 选项的先关掉（这两样最常绕过代理）。';
    if (!d.site.ok) return '<b class="bad">连本站都时断时续</b>：网络本身不稳，先换个网络 / 节点再试。';
    if (!d.hosts.length) return '这张卡没有外链图片，不用测。';
    var lines = d.hosts.map(function (h) {
      var dOk = h.direct.ok || h.direct.status, rOk = h.relay && (h.relay.ok || h.relay.status);
      if (dOk) return '<b class="ok">' + h.host + ' 直连正常</b>' +
        (h.relay && h.relay.ok && h.relay.ms < h.direct.ms * 0.6 ? '（不过中转更快，手机上可以选「总走中转」）' : '') + '。';
      if (rOk) return '<b class="warn">' + h.host + ' 你这边直连不通，走中转能通</b>：' +
        (d.mode === 'direct' ? '现在设成了「只直连」，改成「自动」图就能出来。'
                             : '已经自动改走中转，图能正常出，不用管。') +
        '想直连的话：' + tips;
      return '<b class="bad">' + h.host + ' 直连和中转都不通</b>：这是网络 / 代理的问题，页面这边补不了。' + tips +
        '也可以在上面选「自定义中转地址」，填一个你能连上的图片代理。';
    });
    return lines.join('<br>');
  }
  document.addEventListener('change', function (e) {
    var box = e.target.closest ? e.target.closest('.netbox') : null;
    if (!box) return;
    var patch = {};
    if (e.target.classList.contains('nb-mode')) patch.mode = e.target.value;
    if (e.target.classList.contains('nb-wait')) patch.wait = Number(e.target.value);
    if (e.target.classList.contains('nb-tpl')) patch.tpl = e.target.value;
    if (patch.mode === 'custom' && !/\{(url|raw|path)\}/.test(box.querySelector('.nb-tpl').value)) {
      box.querySelector('.nb-tpl-l').hidden = false;
      box.querySelector('.nb-tpl').focus();
      box.querySelector('.nb-stat').textContent = '先填中转地址（要带 {url}），填好再选一次';
      e.target.value = ImgNet.config().mode;
      return;
    }
    ImgNet.setConfig(patch);
    renderNetBoxes();
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.nb-test') : null;
    if (!b) return;
    var box = b.closest('.netbox'), out = box.querySelector('.nb-out');
    var samples = netSamples();
    b.disabled = true;
    out.innerHTML = '<span class="dim">测试中…（最多二十来秒）</span>';
    ImgNet.diagnose(samples).then(function (d) {
      b.disabled = false;
      var rows = [['本站（页面本身）', d.site]];
      d.hosts.forEach(function (h) {
        rows.push([h.host + ' 直连', h.direct]);
        rows.push([h.host + ' 经' + d.relayName + '中转', h.relay]);
      });
      out.innerHTML = '<table>' + rows.map(function (r) {
        return '<tr><th>' + esc(r[0]) + '</th><td>' + fmtRes(r[1]) + '</td></tr>';
      }).join('') + '</table><p class="nb-verdict">' + netVerdict(d) + '</p>';
      renderNetBoxes();
    }).catch(function (err) {
      b.disabled = false;
      out.textContent = '测试出错：' + (err && err.message || err);
    });
  });

  var SECTIONS = [
    { k:'me',    t:'我的人设', d:'称呼与自我描述' },
    { k:'book',  t:'世界书',   d:'设定条目与触发' },
    { k:'pre',   t:'预设',     d:'提示词块与顺序' },
    { k:'vars',  t:'变量',     d:'场景与角色状态' },
    { k:'save',  t:'存读档',   d:'进度存取' },
    { k:'tune',  t:'外观',     d:'立绘与对话框' },
    { k:'img',   t:'文生图',   d:'NovelAI 出图与 CG' },
    { k:'net',   t:'图片网络', d:'图裂了看这里' },
    { k:'debug', t:'调试',     d:'请求与兜底告警' },
    { k:'api',   t:'接口',     d:'API 地址与模型' }
  ];

  /* 每个 App 一页。juus 的列表和气泡类名原样保留，只是换了外壳。 */
  var APP_HTML = {
    juus:
      '<div class="ph-bar"><h2>JUUS</h2>' +
      '<div class="ph-seg"><button class="on" data-sub="ct">私聊</button>' +
      '<button data-sub="gp">群聊</button></div>' +
      '<button class="act filter" title="筛选">≡ 全部</button></div>' +
      '<div class="ph-body">' +
      '<div class="ctsr"><input class="ctsi" type="text" placeholder="🔍 搜索舰娘…"></div>' +
      '<div class="sub on" data-sub="ct"><div class="ctl"></div></div>' +
      '<div class="sub" data-sub="gp"><div class="gpl"></div></div></div>' +
      '<div class="cw">' +
      '<div class="ph-bar"><button class="bk">‹</button>' +
      '<h2 class="ctitle"></h2><span class="csub" style="font-size:12px;opacity:.6"></span></div>' +
      '<div class="ms"></div>' +
      '<div class="sp"></div>' +
      '<div class="ib" style="flex:none;display:flex;gap:7px;padding:8px 10px;' +
      'border-top:1px solid rgba(43,61,77,.12);background:#fff">' +
      '<button class="eb" style="border:0;background:none;font-size:20px;cursor:pointer">😊</button>' +
      '<input class="cin" placeholder="发消息…" style="flex:1;border:1px solid rgba(180,210,240,.8);' +
      'border-radius:18px;padding:7px 14px;font:inherit;outline:none">' +
      '<button class="snd" style="border:0;background:#0a84ff;color:#fff;border-radius:18px;' +
      'padding:7px 16px;font:inherit;cursor:pointer">发送</button></div></div>',
    ig:
      '<div class="ph-bar"><h2>推 荐</h2></div>' +
      '<div class="ph-body"><div class="xl"></div></div>' +
      '<div class="postd"><div class="ph-bar"><button class="bk qcbk">‹</button>' +
      '<h2>帖子</h2></div><div class="ph-body qcbd"></div>' +
      '<div class="cmtbar"><input class="cmtin" placeholder="写条评论…">' +
      '<button class="cmtsend">发送</button></div></div>',
    hot:
      '<div class="ph-bar"><h2>啾啾热点</h2></div>' +
      '<div class="ph-body"><div class="hotlist"></div></div>',
    doss: '<div class="ph-bar"><h2>舰娘档案</h2></div><div class="ph-body dsl"></div>',
    log:
      '<div class="ph-bar"><h2>剧情回顾</h2></div>' +
      '<div class="ph-body"><div class="jp-panel"><div class="jp-body" id="histlist"></div></div></div>',
    cfg:
      '<div class="kt-shell">' +
      '<nav class="kt-nav">' +
      '<div class="kt-brand">设 置<button class="hm" id="kt-home" title="回主屏" ' +
      'style="margin-left:auto;background:none;border:0;color:inherit;font-size:17px;' +
      'cursor:pointer;padding:0">⌂</button></div>' +
      SECTIONS.map(function (x, i) {
        return '<button data-sec="' + x.k + '"' + (i === 0 ? ' class="on"' : '') + '>' +
          '<b>' + x.t + '</b><span>' + x.d + '</span></button>';
      }).join('') +
      '<div class="kt-ver">gal 引擎 · v5.24</div></nav>' +
      '<section class="kt-main">' +
      '<header class="kt-head"><h2 id="kt-title"></h2><p id="kt-sub"></p>' +
      '<div class="kt-acts" id="kt-acts"></div></header>' +
      '<div class="kt-content" id="kt-content"></div></section></div>'
  };


  /* 每个分区的 DOM 只建一次，切换时显隐 —— 保住已绑定的事件 */
  var SEC_HTML = {
    me:
      '<div class="kt-pane-bd pad">' +
      '<div class="kt-sec"><h4>身 份</h4>' +
      '<div class="kt-field"><label>称呼</label>' +
      '<input type="text" id="me-name" placeholder="指挥官">' +
      '<div class="kt-hint">模型会这样称呼你，预设里的 {{user}} 也会换成它。</div></div></div>' +
      '<div class="kt-sec"><h4>人 设 描 述</h4>' +
      '<div class="kt-field"><label>描述</label>' +
      '<textarea id="me-desc" rows="10" placeholder="例如：黑发蓝瞳的男性，港区指挥官。说话简短，不爱解释。"></textarea>' +
      '<div class="kt-hint" id="me-note">每轮请求都会发给模型。外貌、身份、说话方式、与角色的关系都可以写。</div></div></div>' +
      '<div class="kt-sec"><h4>注 入 方 式</h4><div class="kt-grid">' +
      '<div class="kt-field"><label>位置</label><select id="me-pos">' +
      '<option value="prompt">提示词里（填进 personaDescription 占位）</option>' +
      '<option value="depth">插进对话历史的指定深度</option></select></div>' +
      '<div class="kt-field" id="me-depth-wrap" hidden><label>深度</label>' +
      '<input type="number" id="me-depth" min="0" max="20" value="4"></div></div>' +
      '<button class="kt-btn kt-btn-primary kt-btn-wide" id="me-save">保 存 人 设</button></div></div>',

    book:
      '<div class="kt-split" id="bk-split">' +
      '<div class="kt-pane"><div class="kt-pane-hd"><b>条目</b><span id="bk-stat-mini"></span></div>' +
      '<div class="kt-pane-bd">' +
      '<div class="kt-stat" id="bk-stat"></div>' +
      '<div class="kt-field" style="margin-bottom:10px">' +
      '<input type="text" id="bk-q" placeholder="搜条目名 / 关键词 / 正文"></div>' +
      '<div id="bk-list"></div></div></div>' +
      '<div class="kt-pane"><div class="kt-pane-hd"><b>条目编辑</b>' +
      '<button class="kt-btn" id="bk-back" style="margin-left:auto">‹ 列表</button>' +
      '<button class="kt-btn kt-btn-danger" id="bk-del">删除</button></div>' +
      '<div class="kt-pane-bd pad" id="bk-form"></div></div></div>',

    pre:
      '<div class="kt-split" id="pre-split">' +
      '<div class="kt-pane"><div class="kt-pane-hd"><b>提示词块</b></div>' +
      '<div class="kt-pane-bd"><div class="kt-stat" id="pre-stat"></div>' +
      '<div id="pre-list"></div></div></div>' +
      '<div class="kt-pane"><div class="kt-pane-hd"><b id="pre-title">块内容</b>' +
      '<button class="kt-btn" id="pre-back" style="margin-left:auto">‹ 列表</button>' +
      '<button class="kt-btn kt-btn-primary" id="pre-save">保存</button></div>' +
      '<div class="kt-pane-bd pad" id="pre-body"><div class="kt-empty">' +
      '<span class="ic">🧩</span>左边选一个块</div></div></div></div>',

    vars:  '<div class="kt-pane-bd pad" id="varsbody"></div>',
    save:  '<div class="kt-pane-bd pad">' +
      '<div class="kt-sec"><h4>存 读 档</h4>' +
      '<p class="kt-hint">存档现在是一棵树：每一轮自动存一个节点，读旧节点接着玩会长出分支。' +
      '游戏里右上角的 ▤ 也能直接打开。</p>' +
      '<button class="kt-btn kt-btn-primary kt-btn-wide" id="open-saves">打开存档</button></div></div>',
    tune:  '<div class="kt-pane-bd pad" id="tune-host"></div>',
    img:
      '<div class="kt-pane-bd pad">' +

      '<div class="kt-sec"><h4>开 关</h4>' +
      '<div class="kt-row"><span class="kt-label">启用文生图</span>' +
      '<label class="kt-sw"><input type="checkbox" id="ig-on"></label></div>' +
      '<p class="kt-hint">打开后，AI 每轮会固定产出 1~2 张插画，铺成 CG。' +
      '这里出的图<b>就是</b> CG —— 不需要另外准备 CG 素材表。<br>' +
      '开关会同时开合世界书里那条「【引擎】插画输出规则」，不用你手动去开。</p>' +
      '<div class="kt-field"><label>每轮张数　<b id="ig-per-v">1</b></label>' +
      '<input type="range" id="ig-per" min="1" max="4" step="1" value="1">' +
      '<p class="kt-hint">张数越多越慢越费额度。1~2 张比较合适。</p></div></div>' +

      '<div class="kt-sec"><h4>接 口</h4>' +
      '<div class="kt-field"><label>NovelAI Token</label>' +
      '<input type="password" id="ig-key" placeholder="pst-…">' +
      '<p class="kt-hint">要填<b>持久 token</b>，不是登录密码：NovelAI 网页 → 用户设置 → ' +
      'Account → Get Persistent API Token。只存在你自己浏览器里。</p></div>' +
      '<div class="kt-field"><label>接口地址</label>' +
      '<input type="text" id="ig-url" placeholder="https://image.novelai.net">' +
      '<p class="kt-hint">一般不用改。只有浏览器报 CORS 时才填中转地址。</p></div>' +
      '<div class="kt-grid">' +
      '<div class="kt-field"><label>模型</label><select id="ig-model"></select></div>' +
      '<div class="kt-field"><label>尺寸</label><select id="ig-size">' +
      '<option value="1216x832">1216×832 横幅（免费档）</option>' +
      '<option value="832x1216">832×1216 竖幅（免费档）</option>' +
      '<option value="1024x1024">1024×1024 方形（免费档）</option>' +
      '<option value="1536x1024">1536×1024 横幅（扣点数）</option>' +
      '</select></div></div>' +
      '<p class="kt-hint" id="ig-free"></p>' +
      '<div class="kt-field" style="margin-top:12px">' +
      '<button class="kt-btn" id="ig-test">测 试 连 接</button>' +
      '<p class="kt-hint" id="ig-testout" style="white-space:pre-wrap"></p></div></div>' +

      '<div class="kt-sec"><h4>提 示 词 来 源</h4>' +
      '<div class="kt-field"><label>模式</label><select id="ig-mode">' +
      '<option value="auto">AI 每轮输出（推荐，不额外花钱）</option>' +
      '<option value="model">总是另发一次请求解析正文</option>' +
      '<option value="inline">只认 AI 输出的，绝不额外发请求</option>' +
      '</select>' +
      '<p class="kt-hint" id="ig-mode-note"></p></div>' +
      '<div class="kt-field"><label>画风词</label>' +
      '<input type="text" id="ig-style" placeholder="例如：anime screencap, soft lighting, detailed background">' +
      '<p class="kt-hint">拼在每张图的正面提示词尾部，用来统一画风。留空就不加。</p></div>' +
      '<div class="kt-field"><label>额外负面词</label>' +
      '<input type="text" id="ig-neg" placeholder="例如：text, watermark, extra fingers">' +
      '<p class="kt-hint">叠在模型自带的 UC 预设之上。</p></div></div>' +

      '<div class="kt-sec"><h4>进 阶</h4>' +
      '<div class="kt-grid">' +
      '<div class="kt-field"><label>UC 预设</label><select id="ig-uc">' +
      '<option value="heavy">Heavy（默认，去瑕疵最狠）</option>' +
      '<option value="light">Light</option>' +
      '<option value="human_focus">Human Focus（重点修人体）</option>' +
      '<option value="none">None</option></select></div>' +
      '<div class="kt-field"><label>采样器</label><select id="ig-sampler">' +
      '<option value="k_euler_ancestral">k_euler_ancestral</option>' +
      '<option value="k_euler">k_euler</option>' +
      '<option value="k_dpmpp_2m">k_dpmpp_2m</option>' +
      '<option value="k_dpmpp_2s_ancestral">k_dpmpp_2s_ancestral</option>' +
      '<option value="k_dpmpp_sde">k_dpmpp_sde</option></select></div></div>' +
      '<div class="kt-row"><span class="kt-label">自定步数与 CFG' +
      '<br><span class="kt-hint" style="font-weight:400">不勾就用模型官方推荐值</span></span>' +
      '<label class="kt-sw"><input type="checkbox" id="ig-custom"></label></div>' +
      '<div class="kt-grid" id="ig-custom-wrap" hidden style="margin-top:14px">' +
      '<div class="kt-field"><label>步数　<b id="ig-steps-v">23</b></label>' +
      '<input type="range" id="ig-steps" min="1" max="50" step="1" value="23"></div>' +
      '<div class="kt-field"><label>CFG　<b id="ig-cfg-v">5</b></label>' +
      '<input type="range" id="ig-cfg" min="1" max="10" step="0.5" value="5"></div></div>' +
      '<p class="kt-hint">步数超过 28 会离开免费档。</p></div>' +

      '<div class="kt-sec"><h4>相 册</h4>' +
      '<p class="kt-hint" id="ig-gal"></p>' +
      '<button class="kt-btn" id="ig-clear">清 空 相 册</button></div></div>',

    net:
      '<div class="kt-pane-bd pad"><div class="kt-sec"><h4>图 片 网 络</h4>' + netBoxHTML() + '</div></div>',
    debug:
      '<div class="kt-pane-bd pad">' +
      '<div class="kt-acts" style="margin-bottom:14px" id="debug-tabs">' +
      '<button class="kt-btn on" data-dt="warn">兜底告警</button>' +
      '<button class="kt-btn" data-dt="wb">世界书</button>' +
      '<button class="kt-btn" data-dt="req">上次请求</button>' +
      '<button class="kt-btn" data-dt="raw">模型原文</button></div>' +
      '<div id="debug-body"></div></div>',
    api:
      '<div class="kt-pane-bd pad"><div class="kt-sec"><h4>当 前 接 口</h4>' +
      '<div id="api-info"></div>' +
      '<button class="kt-btn kt-btn-primary kt-btn-wide" id="api-open">打 开 接 口 设 置</button>' +
      '<div class="kt-hint">接口、密钥、模型和素材导入都在启动面板里。</div></div>' +
      '<div class="kt-sec"><h4>Token 计 数</h4>' +
      '<div class="kt-row"><span class="kt-label">用真实分词器（gpt-tokenizer）</span>' +
      '<label class="kt-sw"><input type="checkbox" id="tk-on"></label></div>' +
      '<p class="kt-hint" id="tk-note"></p>' +
      '<p class="kt-hint">世界书的预算裁剪就是按这个数裁的，低估等于「以为还有空间」，' +
      '实际发超。juus 是大卡，偏差会被放大。<br>' +
      '首次打开会加载一个 2MB 的脚本（core/vendor/ 下），之后缓存。' +
      '嫌包大可以直接删掉那两个文件，会自动回退粗估，不报错。</p>' +
      '<div class="kt-field"><label>世界书预算</label>' +
      '<select id="tk-budget">' +
      '<option value="chars">按字符数（老行为，60000 字）</option>' +
      '<option value="tokens">按真实 token（需要上面的开关打开）</option>' +
      '</select>' +
      '<p class="kt-hint" id="tk-budget-note"></p></div>' +
      '<div id="tk-demo" class="kt-hint" style="white-space:pre-wrap"></div></div>' +
      '<div class="kt-sec"><h4>世 界 书 语 义 检 索</h4>' +
      '<div class="kt-row"><span class="kt-label">启用向量检索</span>' +
      '<label class="kt-sw"><input type="checkbox" id="vec-on"></label></div>' +
      '<div class="kt-hint">现在的激活靠关键词<b>字面</b>命中：条目写了「甜品厅」，' +
      '正文里得真出现这三个字。玩家说「想吃点甜的」一个词都不沾，那条就捞不上来。' +
      '打开后会按语义补捞，只<b>追加</b>，绝不挤掉关键词已经命中的条目。</div>' +
      '<div class="kt-hint">走你在启动面板里配的那个端点的 <code>/v1/embeddings</code>。' +
      '很多中转只转发对话接口、不转嵌入接口 —— 那样会自动退回纯关键词，不影响游戏。</div>' +
      '<div class="kt-grid">' +
      '<div class="kt-field"><label>嵌入模型</label>' +
      '<input type="text" id="vec-model" placeholder="text-embedding-3-small"></div>' +
      '<div class="kt-field"><label>每轮补几条 <b id="vec-k-v">4</b></label>' +
      '<input type="range" id="vec-k" min="1" max="10" step="1" value="4"></div></div>' +
      '<div class="kt-grid">' +
      '<div class="kt-field"><label>相似度下限 <b id="vec-th-v">0.32</b></label>' +
      '<input type="range" id="vec-th" min="0.1" max="0.7" step="0.01" value="0.32">' +
      '<div class="kt-hint">调高＝更严，宁缺毋滥。</div></div>' +
      '<div class="kt-field"><label>时间衰减强度 <b id="vec-dc-v">0.45</b></label>' +
      '<input type="range" id="vec-dc" min="0" max="0.9" step="0.05" value="0.45">' +
      '<div class="kt-hint">刚注入过的条目降权，免得同几条反复霸占。0＝不衰减。</div></div></div>' +
      '<button class="kt-btn kt-btn-primary" id="vec-build">建 立 索 引</button> ' +
      '<button class="kt-btn" id="vec-clear">清 除 索 引</button>' +
      '<p id="vec-out" class="kt-hint" style="white-space:pre-wrap"></p></div></div>'
  };

  var secNodes = {}, curSec = 'me';

  function bindSections() {
    bindPersona();
    bindImgSec();
    bindTokens();
    bindVecSec();

    $('bk-q').oninput = renderBook;
    $('bk-stat').onclick = function (e) {
      var t = e.target.closest ? e.target.closest('[data-tile]') : null;
      if (!t) return;
      bkTile = t.dataset.tile;
      renderBook();
    };
    $('bk-list').onclick = function (e) {
      if (!e.target.closest) return;
      var gh = e.target.closest('.kt-ghead');
      if (gh) {
        var g = gh.parentNode.dataset.g;
        bkOpen[g] = !gh.parentNode.classList.contains('open');
        gh.parentNode.classList.toggle('open');
        return;
      }
      var t = e.target.getAttribute && e.target.getAttribute('data-tog');
      if (t) {
        var en = Editors.findEntry(eng.pool, t);
        if (en) en.enabled = e.target.checked;
        renderBook();
        return;
      }
      var row = e.target.closest('[data-uid]');
      if (row) openEntry(row.dataset.uid);
    };
    $('bk-back').onclick = function () { $('bk-split').classList.remove('show-edit'); };
    $('bk-del').onclick = function () {
      if (!bkSel) return;
      if (!confirm('删除条目「' + (bkSel.comment || '无名') + '」？')) return;
      var i = eng.pool.indexOf(bkSel);
      if (i >= 0) eng.pool.splice(i, 1);
      bkSel = null;
      $('bk-form').innerHTML = '<div class="kt-empty"><span class="ic">📚</span>左边选一个条目</div>';
      $('bk-split').classList.remove('show-edit');
      renderBook();
    };

    $('pre-list').onclick = function (e) {
      if (!e.target.closest) return;
      var gh = e.target.closest('.kt-ghead');
      if (gh) { gh.parentNode.classList.toggle('open'); preOpen = true; return; }
      var rt = e.target.getAttribute && e.target.getAttribute('data-rtog');
      if (rt) {
        var offMap = GalStore.local('gal_regex_off') || {};
        offMap[rt] = !e.target.checked;
        GalStore.local('gal_regex_off', offMap);
        eng.regexOff = offMap;
        renderPreset(); noteAssets();
        return;
      }
      var rxRow = e.target.closest('[data-rx]');
      if (rxRow) { openRegex(rxRow.getAttribute('data-rx')); return; }
      var t = e.target.getAttribute && e.target.getAttribute('data-ptog');
      if (t) { Editors.setBlockEnabled(eng.preset, t, e.target.checked); persistPreset(); renderPreset(); return; }
      var up = e.target.getAttribute && e.target.getAttribute('data-pup');
      var dn = e.target.getAttribute && e.target.getAttribute('data-pdn');
      if (up || dn) { Editors.moveBlock(eng.preset, up || dn, up ? -1 : 1); persistPreset(); renderPreset(); return; }
      var row = e.target.closest('[data-pid]');
      if (row) openBlock(row.dataset.pid);
    };
    $('pre-back').onclick = function () { $('pre-split').classList.remove('show-edit'); };
    $('pre-save').onclick = function () {
      var ta = $('pre-content');
      if (!preSel || !ta) return;
      Editors.setBlockContent(eng.preset, preSel, ta.value);
      persistPreset();
      renderPreset();
      $('pre-title').textContent = '已保存';
      setTimeout(function () { $('pre-title').textContent = '块内容'; }, 1200);
    };

    PA('#debug-tabs button').forEach(function (b2) {
      b2.onclick = function () {
        PA('#debug-tabs button').forEach(function (x) { x.classList.toggle('on', x === b2); });
        dtab = b2.dataset.dt;
        renderDebug();
      };
    });

    $('open-saves').onclick = openSaves;
  }

  function buildSections(root) {
    var host = $('kt-content');
    SECTIONS.forEach(function (x) {
      var n = document.createElement('div');
      n.className = 'kt-sec-page';
      n.style.cssText = 'flex:1;min-width:0;display:none';
      n.innerHTML = SEC_HTML[x.k] || '<div class="kt-empty">待建</div>';
      host.appendChild(n);
      secNodes[x.k] = n;
    });
    /* 外观面板是 index.html 里的实体元素，搬进来而不是重建，滑块绑定才不会丢 */
    var t = $('tune');
    if (t && $('tune-host')) { t.hidden = false; t.classList.add('in-phone'); $('tune-host').appendChild(t); }

    PA('.kt-nav button[data-sec]').forEach(function (b) {
      b.onclick = function () { openSection(b.dataset.sec); };
    });
    $('kt-home').onclick = function () {
      PA('.kt-split').forEach(function (x) { x.classList.remove('show-edit'); });
      PA('.ph-layer').forEach(function (l) { l.classList.toggle('on', l.dataset.app === 'home'); });
      $('jup-root').classList.add('at-home');
    };
    bindSections();
    openSection('me');
  }

  var SEC_ICON = { me:'🪪', book:'📚', pre:'🧩', vars:'📊',
                   save:'💾', tune:'🎚', img:'🎨', net:'🖼', debug:'🔧', api:'⚙' };

  function openSection(k) {
    curSec = k;
    var meta = SECTIONS.filter(function (x) { return x.k === k; })[0] || {};
    $('kt-title').innerHTML = '<span class="ib">' + (SEC_ICON[k] || '◆') + '</span>' +
      esc(meta.t || '');
    $('kt-sub').textContent = meta.d || '';
    PA('.kt-nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.sec === k); });
    Object.keys(secNodes).forEach(function (n) {
      secNodes[n].style.display = n === k ? 'flex' : 'none';
    });
    $('kt-acts').innerHTML = '';
    if (k === 'img') { renderImgSec(); }
    if (k === 'api') { renderTokens(); renderVecSec(); }
    if (k === 'book') {
      $('kt-acts').innerHTML = '<button class="kt-btn" id="bk-new">＋ 新建条目</button>' +
        '<button class="kt-btn" id="bk-export">导出</button>';
      $('bk-new').onclick = function () {
        var en = Editors.newEntry();
        eng.pool.unshift(en); renderBook(); openEntry(en.uid);
      };
      $('bk-export').onclick = function () {
        download('worldbook.json', JSON.stringify(Editors.exportBook(eng.pool), null, 1));
      };
      renderBook();
    } else if (k === 'pre') {
      $('kt-acts').innerHTML = '<button class="kt-btn" id="pre-export">导出</button>';
      $('pre-export').onclick = function () {
        if (eng.preset) download('preset.json', JSON.stringify(eng.preset, null, 1));
      };
      renderPreset();
    }
    else if (k === 'me') renderPersona();
    else if (k === 'vars') renderVars();
    else if (k === 'save') { /* 入口按钮在面板里，见 open-saves */ }
    else if (k === 'debug') renderDebug();
    else if (k === 'net') renderNetBoxes();
    else if (k === 'api') renderApiInfo();
  }

  function renderApiInfo() {
    var c = GalAPI.loadConfig();
    $('api-info').innerHTML = '<table>' +
      [['协议', c.protocol], ['地址', c.baseUrl || '—'], ['模型', c.model || '—'],
       ['密钥', c.apiKey ? '已填（' + c.apiKey.slice(0, 6) + '…）' : '<span class="bad">未填</span>'],
       ['温度', c.temperature], ['最大输出', c.maxTokens], ['流式', c.stream ? '开' : '关']]
        .map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; })
        .join('') + '</table>';
    $('api-open').onclick = function () { closePhone(); $('boot').classList.remove('gone'); };
  }

  function buildPhone() {
    if (phoneReady) return;
    var root = $('jup-root');
    phoneReady = true;

    /* 主屏图标 */
    $('jup-root').classList.add('at-home');
    $('ph-grid').innerHTML =
      '<div class="ph-dock">' + APPS.map(function (a) {
        return '<button class="ph-app" data-app="' + a.k + '">' +
          '<i style="background:' + a.bg + '">' + a.icon +
          (a.k === 'juus' ? '<b class="bdg" id="ph-badge" hidden></b>' : '') +
          '</i><span>' + a.name + '</span></button>';
      }).join('') + '</div>';

    /* 各 App 的页面 */
    APPS.forEach(function (a) {
      var layer = document.createElement('div');
      layer.className = 'ph-layer app' + (a.k === 'cfg' ? ' kt' : '');
      layer.dataset.app = a.k;
      layer.innerHTML = (APP_HTML[a.k] ||
        '<div class="ph-bar"><h2>' + a.name + '</h2></div>' +
        '<div class="ph-body"><div class="jp-panel"><div class="jp-body"></div></div></div>')
        .replace('<div class="ph-bar">', '<div class="ph-bar"><button class="hm" title="回主屏">⌂</button>');
      root.appendChild(layer);
    });

    buildSections(root);

    $('ph-grid').onclick = function (e) {
      var b = e.target.closest ? e.target.closest('[data-app]') : null;
      if (b) openApp(b.dataset.app);
    };
    $('ph-home-btn').onclick = goHome;
    /* 每个顶栏左上角的 ⌂ 直接回主屏，比底部那根细条好点 */
    PA('.ph-bar .hm').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        PA('.kt-split').forEach(function (x) { x.classList.remove('show-edit'); });
        var cw = P('.cw'); if (cw) cw.classList.remove('on');
        var pd = P('.postd'); if (pd) pd.classList.remove('on');
        PA('.ph-layer').forEach(function (l) { l.classList.toggle('on', l.dataset.app === 'home'); });
        $('jup-root').classList.add('at-home');
      };
    });

    /* 会话内的返回 */
    PA('.cw .bk').forEach(function (b) {
      b.onclick = function () { P('.cw').classList.remove('on'); };
    });
    PA('.qcbk').forEach(function (b) {
      b.onclick = function () { P('.postd').classList.remove('on'); };
    });

    /* 私聊 / 群聊 分段 */
    PA('.ph-seg [data-sub]').forEach(function (b) {
      b.onclick = function () {
        PA('.ph-seg [data-sub]').forEach(function (x) { x.classList.toggle('on', x === b); });
        PA('.sub').forEach(function (p2) {
          p2.classList.toggle('on', p2.dataset.sub === b.dataset.sub);
        });
      };
    });

    var si = P('.ctsi');
    if (si) si.oninput = applyCtFilter;
    var fb = P('.filter');
    if (fb) fb.onclick = function () {
      ctFilter = (ctFilter + 1) % 3;
      fb.textContent = ['≡ 全部', '≡ 仅在场', '≡ 有消息'][ctFilter];
      applyCtFilter();
    };

    /* 在手机里发消息 = 推进一轮剧情 */
    var cin = P('.cin'), snd = P('.snd');
    function sendFromPhone() {
      var txt = (cin.value || '').trim();
      if (!txt || phoneBusy) return;
      if (!curContact && !curGroup) { cin.placeholder = '先点开一个会话'; return; }
      cin.value = '';
      chatTurn(txt, 'text');
    }
    if (snd) snd.onclick = sendFromPhone;
    if (cin) cin.onkeydown = function (e) {
      if (composing(e)) return;                 // 正在选词，这个回车是确认候选
      if (e.key === 'Enter') sendFromPhone();
    };

    /* 表情包 */
    var eb = P('.eb'), sp = P('.sp');
    if (eb && sp) {
      var S = (window.PHONE_RES && PHONE_RES.stickers) || {};
      sp.innerHTML = Object.keys(S).map(function (k) {
        return '<div class="si" data-s="' + esc(k) + '">' +
          '<img src="' + S[k] + '" loading="lazy" alt=""><span>' + esc(k) + '</span></div>';
      }).join('');
      eb.onclick = function () { sp.classList.toggle('on'); };
      sp.onclick = function (e) {
        var it = e.target.closest ? e.target.closest('[data-s]') : null;
        if (!it) return;
        sp.classList.remove('on');
        if (busy || (!curContact && !curGroup)) return;
        if (phoneBusy) return;
        chatTurn(it.dataset.s, 'sticker');
      };
    }
    tickClock();
    initBattery();
  }

  /* 电量：浏览器支持 Battery Status API 就显示真实值，
     不支持（Safari / 多数移动端已移除）就把这一段藏掉，不摆假数字。 */
  function initBattery() {
    var el = $('ph-batt');
    if (!el) return;
    if (!navigator.getBattery) { el.parentNode.removeChild(el); return; }
    navigator.getBattery().then(function (b) {
      function up() {
        el.textContent = Math.round(b.level * 100) + '%' + (b.charging ? ' ⚡' : '');
      }
      up();
      b.addEventListener('levelchange', up);
      b.addEventListener('chargingchange', up);
    }).catch(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* ============================================================
     人设 / 世界书 / 预设 编辑器
     ============================================================ */
  function renderPersona() {
    var p = Editors.loadPersona();
    $('me-name').value = p.name;
    $('me-desc').value = p.description;
    $('me-pos').value = p.position;
    $('me-depth').value = p.depth;
    $('me-depth-wrap').hidden = p.position !== 'depth';
    $('me-note').textContent = '约 ' + PromptBuilder.estTokens(p.description).toFixed(0) +
      ' token。留空则不注入。';
  }
  function bindPersona() {
    $('me-pos').onchange = function () {
      $('me-depth-wrap').hidden = this.value !== 'depth';
    };
    $('me-desc').oninput = function () {
      $('me-note').textContent = '约 ' + PromptBuilder.estTokens(this.value).toFixed(0) + ' token。';
      };
    function doSavePersona() {
      Editors.savePersona({
        name: $('me-name').value.trim() || '指挥官',
        description: $('me-desc').value,
        position: $('me-pos').value,
        depth: parseInt($('me-depth').value, 10) || 4
      });
      GalStore.local('gal_username', $('me-name').value.trim() || '指挥官');
      $('me-note').textContent = '已保存，下一轮生效。';
    }
    $('me-save').onclick = doSavePersona;
  }

  var bkSel = null, bkOpen = {}, bkTile = 'all';
  var BK_EMPTY = '<div class="kt-empty"><span class="ic">📚</span>' +
    '左边选一个条目，或点右上角「＋ 新建条目」</div>';
  function renderBook() {
    var st = Editors.bookStats(eng.pool);
    $('bk-stat').innerHTML =
      '<div class="kt-tiles">' +
      [['all', '全部条目', 'ALL', st.total, ''],
       ['on', '已启用', 'ENABLED', st.enabled, 'c-ok'],
       ['blue', '蓝灯常驻', 'CONSTANT', st.constant, ''],
       ['green', '绿灯触发', 'SELECTIVE', st.selective, 'c-ok']
      ].map(function (x) {
        return '<button class="kt-tile ' + x[4] + (bkTile === x[0] ? ' on' : '') +
          '" data-tile="' + x[0] + '"><div class="lb">' + x[1] + '</div>' +
          '<div class="cd">' + x[2] + '</div><div class="nm">' + x[3] + '</div></button>';
      }).join('') + '</div>' +
      '<div class="kt-hint" style="margin:-6px 0 12px">' +
      '其中启用的蓝灯 ' + st.enabledConstant + ' 条、绿灯 ' + st.enabledSelective +
      ' 条 · 常驻注入约 ' + st.constantChars.toLocaleString() + ' 字，每轮都会发给模型</div>';
    var q = ($('bk-q').value || '').trim();
    var list = eng.pool.filter(function (e) {
      if (bkTile === 'on' && e.enabled === false) return false;
      if (bkTile === 'blue' && !e.constant) return false;
      if (bkTile === 'green' && e.constant) return false;
      if (!q) return true;
      return (e.comment || '').indexOf(q) !== -1 ||
             String(e.content || '').indexOf(q) !== -1 ||
             Editors.asKeyArray(e.key).join(',').indexOf(q) !== -1;
    });
    if (!list.length) { $('bk-list').innerHTML = '<p class="dim">没有匹配的条目。</p>'; return; }

    /* 分成三组：自建 / 蓝灯常驻 / 绿灯关键词。搜索时全部展开。 */
    var groups = [
      { k: 'mine', t: '自 建', f: function (e) { return e.custom; } },
      { k: 'blue', t: '蓝 灯 · 常 驻 注 入', f: function (e) { return !e.custom && e.constant; } },
      { k: 'green', t: '绿 灯 · 关 键 词 触 发', f: function (e) { return !e.custom && !e.constant; } }
    ];
    $('bk-list').innerHTML = groups.map(function (g) {
      var items = list.filter(g.f);
      if (!items.length) return '';
      var open = q || bkOpen[g.k] !== false;
      var on = items.filter(function (e) { return e.enabled !== false; }).length;
      return '<section class="kt-group' + (open ? ' open' : '') + '" data-g="' + g.k + '">' +
        '<div class="kt-ghead"><span class="arw">▶</span>' + g.t +
        '<span class="cnt">' + on + '/' + items.length + '</span></div>' +
        '<div class="kt-gbody">' + items.map(function (e) {
          var keys = Editors.asKeyArray(e.key);
          return '<div class="kt-item' + (e.enabled === false ? ' off' : '') +
            (bkSel && bkSel.uid === e.uid ? ' on' : '') +
            '" data-uid="' + esc(String(e.uid)) + '">' +
            '<label class="kt-sw"><input type="checkbox" data-tog="' + esc(String(e.uid)) + '"' +
            (e.enabled !== false ? ' checked' : '') + '></label>' +
            '<div class="kt-i-main"><div class="kt-i-t">' +
            (e.constant ? '<em class="tag blue">蓝</em>' : '<em class="tag green">绿</em>') +
            esc(e.comment || '(无注释)') + (e.custom ? '<em class="tag mine">自建</em>' : '') +
            '</div><div class="kt-i-s">' +
            (keys.length ? esc(keys.slice(0, 5).join('、')) : '无关键词') +
            ' · ' + String(e.content || '').length + ' 字</div></div></div>';
        }).join('') + '</div></section>';
    }).join('');
  }
  function openEntry(uid) {
    var e = Editors.findEntry(eng.pool, uid);
    if (!e) return;
    bkSel = e;
    $('bk-form').innerHTML =
      '<div class="kt-sec"><h4>基 本</h4>' +
      '<div class="kt-field"><label>条目名</label><input type="text" id="e-name" value="' + esc(e.comment || '') + '"></div>' +
      '<div class="kt-grid">' +
      '<div class="kt-row"><span class="kt-label">启用此条目</span><label class="kt-sw"><input type="checkbox" id="e-on"' +
      (e.enabled !== false ? ' checked' : '') + '></label></div>' +
      '<div class="kt-row"><span class="kt-label">蓝灯（恒定注入）</span><label class="kt-sw"><input type="checkbox" id="e-const"' +
      (e.constant ? ' checked' : '') + '></label></div></div></div>' +

      '<div class="kt-sec"><h4>触 发 条 件</h4>' +
      '<p class="kt-hint">蓝灯忽略关键词，永远注入。绿灯要主关键词命中才注入。</p>' +
      '<label>主关键词<input type="text" id="e-key" placeholder="逗号分隔，留空则不触发" value="' +
      esc(Editors.asKeyArray(e.key).join('，')) + '"></label>' +
      '<label>次关键词<input type="text" id="e-key2" placeholder="可留空" value="' +
      esc(Editors.asKeyArray(e.keysecondary).join('，')) + '"></label>' +
      '<div class="kt-grid">' +
      '<label>次词逻辑<select id="e-logic">' +
      ['任一命中', '不可全中', '不可命中', '必须全中'].map(function (n, i) {
        return '<option value="' + i + '"' +
          (Number(e.selectiveLogic) === i ? ' selected' : '') + '>' + n + '</option>';
      }).join('') + '</select></label>' +
      '<label>触发概率 %<input type="number" id="e-prob" min="0" max="100" value="' +
      (e.probability == null ? 100 : e.probability) + '"></label></div></div>' +

      '<div class="kt-sec"><h4>注 入 方 式</h4>' +
      '<div class="kt-grid">' +
      '<label>插入位置<select id="e-pos">' +
      Editors.POS_NAME.map(function (n, i) {
        return '<option value="' + i + '"' +
          (Number(e.position) === i ? ' selected' : '') + '>' + n + '</option>';
      }).join('') + '</select></label>' +
      '<label>排序（小的在前）<input type="number" id="e-order" value="' +
      (Number(e.order) || 100) + '"></label>' +
      '<label>深度（位置选「按深度」时生效）<input type="number" id="e-depth" value="' +
      (Number(e.depth) || 4) + '"></label></div></div>' +

      '<div class="kt-sec"><h4>正 文</h4>' +
      '<label><textarea id="e-content" rows="16" placeholder="条目内容，会被原样注入提示词">' +
      esc(e.content || '') + '</textarea></label>' +
      '<div class="kt-hint" id="e-len"></div></div>' +

      '<button class="kt-btn kt-btn-primary kt-btn-wide" id="e-save">保 存 条 目</button>' +
      '<div class="kt-hint" id="e-note"></div>';
    var lenEl = $('e-len');
    function upLen() {
      lenEl.textContent = $('e-content').value.length + ' 字 · 约 ' +
        PromptBuilder.estTokens($('e-content').value).toFixed(0) + ' token';
    }
    upLen();
    $('e-content').oninput = upLen;
    $('e-save').onclick = function () {
      e.comment = $('e-name').value.trim();
      e.constant = $('e-const').checked;
      e.key = Editors.asKeyArray($('e-key').value);
      e.keysecondary = Editors.asKeyArray($('e-key2').value);
      e.selectiveLogic = +$('e-logic').value;
      e.position = +$('e-pos').value;
      e.order = +$('e-order').value;
      e.depth = +$('e-depth').value;
      e.probability = +$('e-prob').value;
      e.enabled = $('e-on').checked;
      e.content = $('e-content').value;
      $('e-note').textContent = '已保存，下一轮请求生效。';
      renderBook();
    };
    $('bk-split').classList.add('show-edit');
  }

  var preSel = null;
  /* 预设面板里的改动（开关、排序、改正文）以前只改内存，刷新就没了 */
  var presetName = '';
  function persistPreset() {
    if (eng.preset) GalStore.putPreset(eng.preset, presetName).catch(function () {});
  }

  /** 正则列表：预设自带 / 卡自带 / 单独导入，逐条可开关 */
  function regexSection() {
    var list = eng.regexList('prompt');
    if (!list.length) return '';
    var SRC = { preset: '预设', card: '卡', user: '导入' };
    function where(r) {
      var w = [];
      if (r.placement.indexOf(1) !== -1) w.push('输入');
      if (r.placement.indexOf(2) !== -1 || !r.placement.length) w.push('输出');
      var scope = r.markdownOnly && r.promptOnly ? '显示+提示词'
        : r.markdownOnly ? '仅显示' : r.promptOnly ? '仅提示词' : '直接改写';
      return w.join('/') + ' · ' + scope;
    }
    return '<section class="kt-group' + (preOpen ? ' open' : '') + '" data-g="rx">' +
      '<div class="kt-ghead"><span class="arw">▶</span>正 则<span class="cnt">' + list.length + '</span></div>' +
      '<div class="kt-gbody">' + list.map(function (r) {
        var key = r.source + ':' + r.name;
        var tagNote = r.renderTags && r.renderTags.length
          ? '舞台画不了 HTML 卡片：<' + r.renderTags.join('> <') + '> 块改成选项按钮（像选项的话）或旁白' : '';
        var note = tagNote ? tagNote + (r.promptOnly ? ' · 提示词里照常' : '')
          : r.skip ? '已跳过：' + r.skip
          : r.htmlOnly ? '替换成 HTML 美化，舞台不渲染 HTML，只在提示词里生效'
          : r.hideHtml ? '折叠块 → 这里直接隐藏' : where(r);
        if (r.source === 'card') note += ' · 卡的显示正则仍走老路径';
        return '<div class="kt-item' + (r.disabled || r.skip ? ' off' : '') + '" data-rx="' + esc(key) + '">' +
          '<label class="kt-sw"><input type="checkbox" data-rtog="' + esc(key) + '"' +
          (r.disabled ? '' : ' checked') + (r.skip ? ' disabled' : '') + '></label>' +
          '<div class="kt-i-main"><div class="kt-i-t"><em class="tag role">' + (SRC[r.source] || r.source) +
          '</em>' + esc(r.name) + '</div><div class="kt-i-s">' + esc(note) + '</div></div></div>';
      }).join('') + '</div></section>';
  }

  function renderPreset() {
    if (!eng.preset) {
      $('pre-stat').innerHTML = '<span class="warn">还没载入预设。</span>';
      $('pre-list').innerHTML = regexSection();
      return;
    }
    var blocks = Editors.presetBlocks(eng.preset);
    var on = blocks.filter(function (b) { return b.enabled && !b.marker; });
    $('pre-stat').innerHTML = '共 <b>' + blocks.length + '</b> 块 · 启用文本块 <b>' +
      on.length + '</b> · 合计 ' +
      on.reduce(function (s2, b) { return s2 + b.chars; }, 0).toLocaleString() + ' 字';
    var secs = [
      { t: '启 用 中', f: function (b) { return b.enabled; } },
      { t: '已 关 闭', f: function (b) { return !b.enabled; } }
    ];
    $('pre-list').innerHTML = secs.map(function (g, gi) {
      var items = blocks.filter(g.f);
      if (!items.length) return '';
      return '<section class="kt-group' + (gi === 0 || preOpen ? ' open' : '') +
        '" data-g="pre' + gi + '">' +
        '<div class="kt-ghead"><span class="arw">▶</span>' + g.t +
        '<span class="cnt">' + items.length + '</span></div>' +
        '<div class="kt-gbody">' + items.map(function (b) {
      return '<div class="kt-item' + (b.enabled ? '' : ' off') +
        (preSel === b.identifier ? ' on' : '') + '" data-pid="' + esc(b.identifier) + '">' +
        '<label class="kt-sw"><input type="checkbox" data-ptog="' + esc(b.identifier) + '"' +
        (b.enabled ? ' checked' : '') + '></label>' +
        '<div class="kt-i-main"><div class="kt-i-t">' +
        (b.marker ? '<em class="tag mark">占位</em>' : '<em class="tag role">' + esc(b.role) + '</em>') +
        esc(b.name) + '</div><div class="kt-i-s">' +
        (b.marker ? '运行时替换：' + esc(b.identifier) : b.chars + ' 字') + '</div></div>' +
        '<span class="kt-move"><button data-pup="' + esc(b.identifier) + '">▲</button>' +
        '<button data-pdn="' + esc(b.identifier) + '">▼</button></span></div>';
        }).join('') + '</div></section>';
    }).join('') + regexSection();
  }
  var preOpen = false;
  function openBlock(id) {
    var b = Editors.presetBlocks(eng.preset).filter(function (x) {
      return x.identifier === id; })[0];
    if (!b) return;
    if (b.marker) {
      preSel = null;
      $('pre-body').innerHTML = '<div class="kt-sec"><h4>' + esc(b.name) + '</h4>' +
        '<div class="kt-hint">这是占位块，运行时会被替换成 <b>' + esc(b.identifier) +
        '</b> 对应的内容（世界书 / 角色描述 / 对话历史等），没有可编辑的正文。</div></div>';
      $('pre-split').classList.add('show-edit');
      return;
    }
    preSel = id;
    $('pre-title').textContent = b.name;
    $('pre-body').innerHTML = '<div class="kt-sec"><h4>' + esc(b.name) + '</h4>' +
      '<div class="kt-field"><label>角色：' + esc(b.role) + '　·　' + b.chars + ' 字</label>' +
      '<textarea id="pre-content" rows="20"></textarea></div></div>';
    $('pre-content').value = b.content;
    $('pre-split').classList.add('show-edit');
    PA('#pre-list .kt-item').forEach(function (el) {
      el.classList.toggle('on', el.dataset.pid === id);
    });
  }

  /** 正则详情 + 试跑：贴一段模型原文，看这条正则会把它改成什么样 */
  function openRegex(key) {
    var r = eng.regexList('prompt').filter(function (x) { return x.source + ':' + x.name === key; })[0];
    if (!r) return;
    preSel = null;
    $('pre-title').textContent = '正则';
    var scope = r.markdownOnly && r.promptOnly ? '显示 + 提示词' : r.markdownOnly ? '仅显示'
      : r.promptOnly ? '仅提示词' : '直接改写（显示和提示词都生效）';
    var dep = (r.minDepth != null || r.maxDepth != null)
      ? '　·　深度 ' + (r.minDepth == null ? '0' : r.minDepth) + ' ~ ' + (r.maxDepth == null || r.maxDepth < 0 ? '∞' : r.maxDepth) : '';
    $('pre-body').innerHTML = '<div class="kt-sec"><h4>' + esc(r.name) + '</h4>' +
      '<div class="kt-hint">' + esc(scope) + dep + (r.skip ? '<br><span class="warn">已跳过：' + esc(r.skip) + '</span>' : '') +
      (r.htmlOnly ? '<br>替换成 HTML，舞台不渲染 HTML，所以只在提示词里生效。' : '') +
      (r.hideHtml ? '<br>替换成折叠块，这里当作隐藏处理。' : '') + '</div>' +
      '<div class="kt-field"><label>查找</label><textarea rows="3" readonly id="rx-find"></textarea></div>' +
      '<div class="kt-field"><label>替换为</label><textarea rows="3" readonly id="rx-rep"></textarea></div>' +
      '<div class="kt-field"><label>试跑：贴一段模型原文（调试面板「模型原文」里复制）</label>' +
      '<textarea rows="6" id="rx-sample"></textarea></div>' +
      '<div class="kt-field"><label id="rx-stat">结果</label><textarea rows="6" readonly id="rx-out"></textarea></div></div>';
    $('rx-find').value = r.find; $('rx-rep').value = r.rep;
    $('rx-sample').value = lastRaw || '';
    function go() {
      var res = GalRegex.dryRun(r, $('rx-sample').value, { charName: eng.card && (eng.card.data || eng.card).name,
        userName: Editors.loadPersona().name });
      $('rx-stat').textContent = res.ok ? '结果（命中 ' + res.matches + ' 处）' : '出错：' + res.error;
      $('rx-out').value = res.after;
    }
    $('rx-sample').addEventListener('input', go);
    go();
    $('pre-split').classList.add('show-edit');
  }

  function openApp(k) {
    PA('.ph-layer').forEach(function (l) { l.classList.toggle('on', l.dataset.app === k); });
    $('jup-root').classList.toggle('at-home', k === 'home');
    if (k === 'log') renderHistory();
    else if (k === 'cfg') openSection(curSec || 'me');
    else if (k === 'juus' || k === 'ig' || k === 'hot' || k === 'doss') renderPhone();
  }
  function goHome() {
    renderWidget();
    var det = P('.kt-split.show-edit');
    if (det) { det.classList.remove('show-edit'); return; }
    var cw = P('.cw'); if (cw && cw.classList.contains('on')) { cw.classList.remove('on'); return; }
    var pd = P('.postd'); if (pd && pd.classList.contains('on')) { pd.classList.remove('on'); return; }
    PA('.ph-layer').forEach(function (l) { l.classList.toggle('on', l.dataset.app === 'home'); });
    $('jup-root').classList.add('at-home');
  }

  var clockTimer = null;
  function tickClock() {
    function up() {
      var d = new Date();
      var hm = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
      ['ph-time', 'ph-bigtime'].forEach(function (id) {
        if ($(id)) $(id).textContent = hm;
      });
      if ($('ph-date')) {
        $('ph-date').textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
          '周' + '日一二三四五六'[d.getDay()];
      }
    }
    up();
    clearInterval(clockTimer);
    clockTimer = setInterval(up, 20000);
  }

  function renderWidget() {
    var el = $('ph-widget');
    if (!el) return;
    var v = eng.vars || {}, t = v.时间 || {};
    var ppl = v.人物 || {};
    var on = Object.keys(ppl).filter(function (n) { return ppl[n] && ppl[n].在场; });
    var d = phoneData();
    var hot = d.trends.length ? '<div class="whot">' + d.trends.slice(0, 4).map(function (x, i) {
      return '<div class="hl"><i>' + (i + 1) + '</i><span>' + esc(x.text) + '</span></div>';
    }).join('') + '</div>' : '';

    if (!v.地点 && !on.length && !eng.log.length) {
      el.innerHTML = '<h5>港 区 简 报</h5><div class="wempty">还没有开始游戏。' +
        '在「设置 · 接口」里配好 API，回到启动面板点开始。</div>' + hot;
      return;
    }
    el.innerHTML = '<h5>港 区 简 报</h5>' +
      '<div class="wrow"><b>时间</b><span>第 ' + (t.天数 || 1) + ' 天 ' + esc(t.时段 || '—') + '</span></div>' +
      '<div class="wrow"><b>地点</b><span>' + esc(v.地点 || '—') + '</span></div>' +
      '<div class="wrow"><b>在场</b><span>' + (on.length ? esc(on.join('、')) : '—') + '</span></div>' +
      '<div class="wrow"><b>剧情</b><span>' + eng.log.length + ' 句 · ' +
        (eng.log.length ? '第 ' + ((eng.log[eng.log.length - 1].turn || 0) + 1) + ' 轮' : '未开始') +
        '</span></div>' +
      '<div class="wrow"><b>消息</b><span>' + d.counts.messages + ' 条</span></div>' +
      '<div class="wrow"><b>动态</b><span>' + d.counts.posts + ' 条</span></div>' + hot;
  }

  function renderPhone() {
    if ($('phone-overlay').hidden) return;
    buildPhone();
    var d = phoneData();

    /* 联系人 */
    var ppl = (eng.vars && eng.vars.人物) || {};
    var set = {};
    Phone.roster().forEach(function (n) { set[n] = 1; });   // 有立绘的常驻联系人
    Object.keys(ppl).forEach(function (n) { set[n] = 1; });
    Object.keys(d.chats).forEach(function (n) { set[n] = 1; });
    var names = Object.keys(set).sort(function (a, b) {
      var pa = ppl[a] && ppl[a].在场 ? 0 : 1, pb = ppl[b] && ppl[b].在场 ? 0 : 1;
      if (pa !== pb) return pa - pb;
      var la = (d.chats[a] || []).length ? 0 : 1, lb = (d.chats[b] || []).length ? 0 : 1;
      if (la !== lb) return la - lb;
      return a.localeCompare(b, 'zh');
    });
    P('.ctl').innerHTML = names.length ? names.map(function (n) {
      var on = ppl[n] && ppl[n].在场;
      return '<div class="ct" data-c="' + esc(n) + '">' + av(Phone.avatarOf(n)) +
        '<div class="ci"><div class="cn">' + esc(n) + (on ? ' <span class="dot"></span>' : '') + '</div>' +
        '<div class="cs">' + esc(lastLine(d.chats[n])) + '</div></div></div>';
    }).join('') : '<div class="dsempty">还没有联系人</div>';
    PA('.ctl .ct').forEach(function (el) {
      el.onclick = function () { openChat(el.dataset.c, null, d); };
    });

    /* 群聊 */
    var META = (window.PHONE_RES && PHONE_RES.groupMeta) || {};
    var custom = GalStore.local('gal_groups') || {};
    var gset = {};
    Object.keys(META).forEach(function (g) { gset[g] = 1; });
    Object.keys(custom).forEach(function (g) { gset[g] = 1; });
    Object.keys(d.groups).forEach(function (g) { gset[g] = 1; });
    var gs = Object.keys(gset).sort(function (a, b) {
      return ((d.groups[b] || []).length ? 1 : 0) - ((d.groups[a] || []).length ? 1 : 0);
    });
    P('.gpl').innerHTML =
      '<div class="ct mkgrp"><span class="av" style="display:flex;align-items:center;' +
      'justify-content:center;font-size:22px;color:#7aa8cc">＋</span>' +
      '<div class="ci"><div class="cn">新建群聊</div>' +
      '<div class="cs">拉几位舰娘开个群</div></div></div>' +
      gs.map(function (g) {
        var meta = META[g] || custom[g] || {};
        var log = d.groups[g] || [];
        var sub = log.length ? esc(lastLine(log))
          : (meta.members && meta.members.length ? meta.members.length + ' 位舰娘' : '新群');
        return '<div class="ct" data-g="' + esc(g) + '">' + av(meta.img || Phone.avatarOf(g)) +
          '<div class="ci"><div class="cn">' + esc(g) + '</div>' +
          '<div class="cs">' + sub + '</div></div></div>';
      }).join('');
    PA('.gpl .ct').forEach(function (el) {
      el.onclick = function () {
        if (el.classList.contains('mkgrp')) return makeGroup();
        openChat(null, el.dataset.g, d);
      };
    });

    /* 热点：趋势 */
    P('.hotlist').innerHTML = d.trends.length ? d.trends.map(function (t, i) {
      return '<div class="hot-row"><b class="hot-n' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</b>' +
        '<div class="hot-main"><div class="hot-t">' + esc(t.text) + '</div>' +
        (t.cnt ? '<div class="hot-c">' + esc(t.cnt) + '</div>' : '') + '</div>' +
        (t.cat ? '<span class="hot-cat">' + esc(t.cat) + '</span>' : '') + '</div>';
    }).join('') : '<div class="dsempty">还没有热点<br>剧情里出现 [趋势|…] 时会显示</div>';

    /* 推荐：动态 */
    P('.xl').innerHTML = d.posts.length ? d.posts.map(function (p, i) {
      var plain = String(p.body || '').replace(/\[\[[^:：\]]*[:：]([^\]]*)\]\]/g, '$1')
                    .replace(/\*\*/g, '').replace(/\n/g, ' ');
      return '<article class="fd" data-i="' + i + '">' +
        '<div class="fd-hd"><b>' + esc(p.author) + '</b>' +
        '<span class="hd">@' + esc(p.author.toLowerCase()) + '</span>' +
        (p.tag ? '<span class="tg">#' + esc(p.tag) + '</span>' : '') +
        '<span class="tm">' + (p.seed ? '较早' : '刚刚') + '</span></div>' +
        '<h3 class="fd-t">' + esc(p.title) + '</h3>' +
        '<p class="fd-b">' + esc(plain.slice(0, 110)) + (plain.length > 110 ? '…' : '') + '</p>' +
        '<div class="fd-ac"><span>💬 ' + esc(p.comments) + '</span>' +
        '<span>★ ' + esc(p.stars) + '</span>' +
        '<span class="lk">♥ ' + esc(p.likes) + '</span></div></article>';
    }).join('') : '<div class="dsempty">还没有动态<br>剧情里出现 [小红书|…] 时会显示</div>';
    PA('.xl .fd').forEach(function (el) {
      el.onclick = function () { openPost(d.posts[+el.dataset.i]); };
    });

    /* 档案：完整卡片 —— 立绘头像、好感度条与等级、服装状态、心理活动 */
    var dn = Object.keys(ppl);
    var LV = [[200, '誓约', 'lv-oath'], [150, '挚爱', 'lv-love'], [100, '亲密', 'lv-close'],
              [60, '友好', 'lv-warm'], [30, '相识', 'lv-known'], [0, '初见', 'lv-new']];
    P('.dsl').innerHTML = dn.length ? dn.map(function (n) {
      var p = ppl[n] || {}, fav = Number(p.好感度);
      var lv = LV.filter(function (x) { return !isNaN(fav) && fav >= x[0]; })[0] || LV[LV.length - 1];
      var extra = Object.keys(p).filter(function (k) {
        return ['好感度', '在场', '是否誓约', '服装', '当前状态'].indexOf(k) < 0 &&
               p[k] !== '' && p[k] != null;
      });
      return '<article class="dcard ' + lv[2] + '">' +
        '<div class="dc-av"><img src="' + Phone.avatarOf(n) + '" loading="lazy" alt=""></div>' +
        '<div class="dc-main">' +
        '<div class="dc-hd"><b>' + esc(n) + '</b>' +
        (p.在场 ? '<span class="dc-on">在场</span>' : '<span class="dc-off">不在场</span>') +
        (p.是否誓约 ? '<span class="dc-oath">誓约</span>' : '') +
        '<span class="dc-lv">' + lv[1] + '</span></div>' +
        (isNaN(fav) ? '' :
          '<div class="dc-fav"><span>好感度</span><b>' + fav + '</b>' +
          '<div class="dc-bar"><i style="width:' +
          Math.max(2, Math.min(100, fav / 2)).toFixed(0) + '%"></i></div></div>') +
        '<div class="dc-tags">' +
        (p.服装 ? '<span class="t t-cloth">' + esc(p.服装) + '</span>' : '') +
        (p.当前状态 ? '<span class="t t-mood">' + esc(p.当前状态) + '</span>' : '') +
        extra.map(function (k) {
          return '<span class="t"><em>' + esc(k) + '</em>' + esc(String(p[k])) + '</span>';
        }).join('') + '</div></div></article>';
    }).join('') : '<div class="dsempty">还没有档案<br>开局或模型输出 &lt;update&gt; 后这里会填充</div>';

    phoneSeen = d.counts.total;
    $('phone-dot').hidden = true;
    var bd = $('ph-badge');
    if (bd) {
      var unread = 0;
      Object.keys(d.chats).forEach(function (n) {
        var last = d.chats[n][d.chats[n].length - 1];
        if (last && !last.me) unread++;
      });
      bd.hidden = !unread;
      bd.textContent = unread ? (unread > 99 ? '99+' : String(unread)) : '';
    }
  }

  var curPost = null;
  function openPost(p) {
    if (!p) return;
    curPost = p;
    var a = p.avatar || Phone.avatarOf(p.author);
    P('.qcbd').innerHTML =
      '<article class="pd">' +
      '<div class="pd-au"><div><b>' + esc(p.author) + '</b>' +
      '<span>@' + esc(p.author.toLowerCase()) + ' · ' + (p.seed ? '较早' : '刚刚') +
      (p.tag ? ' · #' + esc(p.tag) : '') + '</span></div></div>' +
      '<h2 class="pd-t">' + esc(p.title) + '</h2>' +
      '<div class="pd-b">' + Phone.formatBody(p.body, esc) + '</div>' +
      '<div class="pd-m"><span>❤ ' + esc(p.likes) + '</span>' +
      '<span>💬 ' + esc(p.comments) + '</span><span>★ ' + esc(p.stars) + '</span></div>' +
      '<div class="pd-c"><h4>评论 ' + (p.cmts.length ? '(' + p.cmts.length + ')' : '') + '</h4>' +
      (p.cmts.length ? p.cmts.map(function (c) {
        return '<div class="pd-cc' + (c.mine ? ' mine' : '') + '">' +
          '<div><b>' + esc(c.who) + '</b><p>' + esc(c.text) + '</p></div></div>';
      }).join('') : '<p class="dim">还没有评论。写一条，或等剧情里出现 [评论|…]。</p>') +
      '</div></article>';
    P('.postd').classList.add('on');
    var ci = P('.cmtin'), cs = P('.cmtsend');
    if (ci) ci.value = '';
    if (cs) cs.onclick = sendComment;
    if (ci) ci.onkeydown = function (e) {
      if (composing(e)) return;
      if (e.key === 'Enter') sendComment();
    };
  }

  /* 评论 = 推进一轮剧情：模型看到你在谁的帖子下说了什么，会照世界书格式回 [评论|…] */
  /* 评论同样独立生成：不推进剧情，只让几个角色在这条动态下接话 */
  async function sendComment() {
    var ci = P('.cmtin');
    if (!ci || !curPost || phoneBusy) return;
    var txt = (ci.value || '').trim();
    if (!txt) return;
    ci.value = '';
    var me = GalStore.local('gal_username') || '指挥官';
    curPost.cmts.push({ who: me, text: txt, mine: true });
    openPost(curPost);

    phoneBusy = true;
    try {
      var prompt = '[独立任务 · 动态评论区，忽略之前的角色扮演格式]\n' +
        '这是 @' + curPost.author + ' 发的动态「' + curPost.title + '」：\n' +
        String(curPost.body || '').slice(0, 300) + '\n\n' +
        '已有评论：\n' + (curPost.cmts.map(function (c) {
          return c.who + '：' + c.text; }).join('\n') || '（还没有）') + '\n\n' +
        '指挥官刚评论了「' + txt + '」。生成 1~3 条新回复，' +
        '可以是发帖人本人回，也可以是别的角色插话，按各自性格说话，口语短句。\n' +
        '【输出格式】一行一条，不要别的内容：\n[评论|角色名|内容]';
      var raw = await eng.quiet(prompt, {
        send: function (msgs, params) {
          return GalAPI.chatWithRetry(msgs, { params: params, retries: 1 });
        }, maxTokens: 400
      });
      var re = /\[评论\|([^|\]\n]*)\|([^\]\n]*)\]/g, m;
      var got = 0;
      while ((m = re.exec(raw || ''))) {
        curPost.cmts.push({ who: m[1].trim(), text: m[2].trim() });
        got++;
      }
      if (!got) {
        var plain = String(raw || '').replace(/<[^>]*>/g, '').trim().slice(0, 120);
        if (plain) curPost.cmts.push({ who: curPost.author, text: plain });
      }
      curPost.comments = (parseInt(curPost.comments, 10) || 0) + 1 + got;
    } catch (e) {
      curPost.cmts.push({ who: '系统', text: '（评论没发出去：' +
        String(e.message || e).split('\n')[0] + '）' });
    } finally {
      phoneBusy = false;
      openPost(curPost);
    }
  }

  function openChat(name, group, d) {
    d = d || phoneData();
    if (!P('.ms')) return;
    curContact = name; curGroup = group;
    var log = group ? d.groups[group] : d.chats[name];
    var title = group || name;
    P('.ctitle').textContent = title;
    var p = ((eng.vars && eng.vars.人物) || {})[name];
    P('.csub').textContent = group ? ((log || []).length + ' 条消息')
                                   : (p && p.在场 ? '就在附近' : '在线');
    P('.ms').innerHTML = (log || []).map(function (m) {
      var who = m.who || title;
      var b = m.type === 'sticker'
        ? '<div class="bb stk"><img src="' + m.v + '" alt="表情" ' +
          'onerror="this.parentNode.classList.remove(\'stk\');' +
          'this.parentNode.textContent=\'[表情包加载失败]\'"></div>'
        : '<div class="bb">' + esc(m.v) + '</div>';
      var mine = !!m.me;
      var inner = (group && !mine)
        ? '<div class="mw"><div class="mwho">' + esc(who) + '</div>' + b + '</div>' : b;
      return '<div class="m' + (mine ? ' me' : '') + '">' +
        av(mine ? Phone.avatarOf(GalStore.local('gal_username') || '指挥官')
                : Phone.avatarOf(who)) + inner + '</div>';
    }).join('');
    var ms = P('.ms'); if (ms) ms.scrollTop = ms.scrollHeight;
    var ty = P('.ty'); if (ty) ty.style.display = 'none';
    P('.cw').classList.add('on');
  }

  function openPhone() {
    $('phone-overlay').hidden = false;
    buildPhone();
    goHome();
    renderPhone();
    renderWidget();
  }
  function closePhone() { $('phone-overlay').hidden = true; }
  /* 手机模式下小手机铺满屏幕，没有「点外面关掉」的地方了，底部的圆键又容易被系统手势条挡住。
     所以顶上常驻两个键：‹ 返回（逐级返回，到主屏再按就收起）和 ✕ 收起 */
  function phoneBack() {
    if ($('jup-root').classList.contains('at-home')) { closePhone(); return; }
    goHome();
  }

  function refreshPhoneBadge() {
    var n = phoneData().counts.total;
    $('phone-dot').hidden = !(n > phoneSeen);
    refreshTbDot();
  }

  /* ============================================================
     全部剧情（可翻可跳）
     ============================================================ */
  var openTurns = {};          // 哪几轮是展开的

  function renderHistory() {
    var box = $('histlist');
    if (!box) return;
    if (!eng.log.length) { box.innerHTML = '<p class="dim">还没有剧情。</p>'; return; }

    /* 按轮分组，默认全部收起，只展开当前所在的那一轮 */
    var turns = [], cur = null;
    eng.log.forEach(function (m, i) {
      if (!cur || cur.turn !== m.turn) { cur = { turn: m.turn, from: i, lines: [] }; turns.push(cur); }
      cur.lines.push({ m: m, i: i });
    });
    var curTurn = eng.log[qi] ? eng.log[qi].turn : null;
    if (curTurn != null && openTurns[curTurn] === undefined) openTurns[curTurn] = true;

    box.innerHTML = turns.map(function (t) {
      var open = !!openTurns[t.turn];
      var first = t.lines[0].m;
      var speakers = [];
      t.lines.forEach(function (x) {
        if (!x.m.narration && speakers.indexOf(x.m.who) < 0) speakers.push(x.m.who);
      });
      var head = '<div class="histturn' + (open ? ' open' : '') + '" data-turn="' + t.turn + '">' +
        '<span class="tw">' + (open ? '▾' : '▸') + '</span>' +
        '<b>第 ' + (t.turn + 1) + ' 轮</b>' +
        '<span class="tn">' + t.lines.length + ' 句</span>' +
        '<span class="tp">' + esc(speakers.slice(0, 3).join('、') || '旁白') +
        (speakers.length > 3 ? ' 等' : '') + '</span>' +
        (curTurn === t.turn ? '<span class="tc">当前</span>' : '') +
        '<div class="tsum">' + esc(first.text.slice(0, 40)) + '…</div></div>';
      if (!open) return head;
      return head + '<div class="tbody">' + t.lines.map(function (x) {
        return '<div class="histline' + (x.m.narration ? ' narr' : '') +
          (x.i === qi ? ' on' : '') + '" data-jump="' + x.i + '">' +
          '<b>' + esc(x.m.narration ? '旁白' : x.m.who) + '</b>' +
          '<span>' + esc(x.m.text.length > 90 ? x.m.text.slice(0, 90) + '…' : x.m.text) +
          '</span></div>';
      }).join('') + '</div>';
    }).join('');

    var curEl = box.querySelector('.histline.on');
    if (curEl && curEl.scrollIntoView) curEl.scrollIntoView({ block: 'center' });
  }

  function markHistory() {
    var box = $('histlist');
    if (!box) return;
    var prev = box.querySelector('.histline.on');
    if (prev) prev.classList.remove('on');
    var cur = box.querySelector('[data-jump="' + qi + '"]');
    if (cur) {
      cur.classList.add('on');
      if (cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }
    else renderHistory();          // 当前句所在的轮是收起的，重画一次把它展开
  }

  /* #histlist 是手机建好后才存在的，用事件委托绑到 document 上 */
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('#histlist')) return;
    if (!e.target.closest) return;
    var th = e.target.closest('[data-turn]');
    if (th) {
      var t = +th.getAttribute('data-turn');
      openTurns[t] = !openTurns[t];
      renderHistory();
      return;
    }
    var el = e.target.closest('[data-jump]');
    if (el) goTo(parseInt(el.getAttribute('data-jump'), 10), { instant: true });
  });

  /* ============================================================
     状态面板（对应酒馆的 MVU 变量）
     ============================================================ */
  var varEdit = null;          // 正在编辑哪个角色
  var VAR_FIELDS = ['服装', '穿着细节', '当前状态', '内心想法', '所在位置'];

  function favorCap(p) { return (p && p.是否誓约) ? 200 : 100; }

  function renderVars() {
    if (!$('varsbody')) return;
    var v = eng.vars || {}, t = v.时间 || {}, ppl = v.人物 || {};
    var names = Object.keys(ppl);
    var on = names.filter(function (n) { return ppl[n] && ppl[n].在场; });
    var sworn = names.filter(function (n) { return ppl[n] && ppl[n].是否誓约; });

    var h = '<div class="kt-tiles">' +
      [['当前天数', 'DAY', t.天数 || 1, ''],
       ['登场角色', 'CAST', names.length, 'c-purple'],
       ['在场', 'PRESENT', on.length, 'c-ok'],
       ['已誓约', 'SWORN', sworn.length, 'c-warn']
      ].map(function (x) {
        return '<div class="kt-tile ' + x[3] + '"><div class="lb">' + x[0] + '</div>' +
          '<div class="cd">' + x[1] + '</div><div class="nm">' + x[2] + '</div></div>';
      }).join('') + '</div>';

    /* 场景：可直接编辑 */
    h += '<div class="kt-sec"><h4>场 景</h4><div class="kt-grid">' +
      '<div class="kt-field"><label>地点</label>' +
      '<input type="text" id="vx-loc" value="' + esc(v.地点 || '') + '"></div>' +
      '<div class="kt-field"><label>天数</label>' +
      '<input type="number" id="vx-day" min="1" value="' + (t.天数 || 1) + '"></div>' +
      '<div class="kt-field"><label>时段</label><select id="vx-band">' +
      ['清晨', '上午', '午后', '傍晚', '夜晚', '深夜'].map(function (x) {
        return '<option' + (t.时段 === x ? ' selected' : '') + '>' + x + '</option>';
      }).join('') + '</select></div></div>' +
      '<button class="kt-btn" id="vx-scene-save">保存场景</button></div>';

    h += '<div class="kt-sec"><h4>角 色</h4>' +
      '<div class="kt-acts" style="margin-bottom:12px">' +
      '<button class="kt-btn" id="vx-add">＋ 新增角色</button></div>';

    if (!names.length) {
      h += '<div class="kt-empty"><span class="ic">📊</span>' +
        '还没有角色状态。开局或模型输出 &lt;update&gt; 后会自动填充，也可以手动新增。</div>';
    } else {
      names.sort(function (a2, b2) {
        return (ppl[b2].在场 ? 1 : 0) - (ppl[a2].在场 ? 1 : 0);
      });
      h += '<div class="kt-cards">' + names.map(function (n) {
        return varEdit === n ? varForm(n, ppl[n]) : varCard(n, ppl[n]);
      }).join('') + '</div>';
    }
    h += '</div>';
    $('varsbody').innerHTML = h;
  }

  function varCard(n, p) {
    p = p || {};
    var fav = Number(p.好感度), cap = favorCap(p);
    var av = window.Phone ? Phone.avatarOf(n) : '';
    var extra = VAR_FIELDS.filter(function (k) { return p[k] != null && p[k] !== ''; });
    return '<div class="kt-card">' +
      '<h5>' + (av ? '<img src="' + av + '" class="vx-av">' : '') + esc(n) +
      (p.在场 ? ' <em class="tag green">在场</em>' : ' <em class="tag role">不在场</em>') +
      (p.是否誓约 ? ' <em class="tag mine">已誓约</em>' : '') +
      '<button class="kt-btn vx-edit" data-edit="' + esc(n) + '">编辑</button></h5>' +
      (isNaN(fav) ? '' :
        '<div class="bd" style="display:flex;justify-content:space-between">' +
        '<span>好感度</span><b style="color:rgb(var(--acc))">' + fav + ' / ' + cap + '</b></div>' +
        '<div class="kt-meter"><i style="width:' +
        Math.max(0, Math.min(100, fav / cap * 100)).toFixed(0) + '%"></i></div>') +
      (extra.length ? '<div class="kt-chips">' + extra.map(function (k) {
        return '<span class="c">' + esc(k) + '：' + esc(String(p[k])) + '</span>';
      }).join('') + '</div>' : '') + '</div>';
  }

  function varForm(n, p) {
    p = p || {};
    var fav = Number(p.好感度); if (isNaN(fav)) fav = 80;
    var cap = favorCap(p);
    return '<div class="kt-card" style="grid-column:1/-1">' +
      '<h5>' + esc(n) + ' · 编辑' +
      '<button class="kt-btn vx-edit" data-edit="">收起</button></h5>' +
      '<div class="kt-grid">' +
      '<div class="kt-field"><label>好感度（上限 ' + cap + '）</label>' +
      '<input type="number" id="vf-fav" min="0" max="' + cap + '" value="' + fav + '"></div>' +
      '<div class="kt-row"><span class="kt-label">在场</span>' +
      '<label class="kt-sw"><input type="checkbox" id="vf-on"' +
      (p.在场 ? ' checked' : '') + '></label></div>' +
      '<div class="kt-row"><span class="kt-label">已誓约<br>' +
      '<span class="kt-hint">誓约后好感度上限从 100 升到 200</span></span>' +
      '<label class="kt-sw"><input type="checkbox" id="vf-oath"' +
      (p.是否誓约 ? ' checked' : '') + '></label></div></div>' +
      VAR_FIELDS.map(function (k) {
        return '<div class="kt-field"><label>' + k + '</label>' +
          '<input type="text" id="vf-' + encodeURIComponent(k) + '" value="' +
          esc(p[k] == null ? '' : String(p[k])) + '"></div>';
      }).join('') +
      '<div class="kt-acts">' +
      '<button class="kt-btn kt-btn-primary" data-vsave="' + esc(n) + '">保存</button>' +
      '<button class="kt-btn kt-btn-danger" data-vdel="' + esc(n) + '">删除这个角色</button>' +
      '</div></div>';
  }

  /* 注意：不能写成 $('varsbody') && document.addEventListener(...) ——
     模块加载时 #varsbody 还没建出来，短路会导致监听根本没挂上。 */
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('#varsbody')) return;
    var ed = e.target.getAttribute && e.target.getAttribute('data-edit');
    if (ed !== null && ed !== undefined) { varEdit = ed || null; renderVars(); return; }

    var sv = e.target.getAttribute && e.target.getAttribute('data-vsave');
    if (sv) {
      var p = (eng.vars.人物 = eng.vars.人物 || {})[sv] = eng.vars.人物[sv] || {};
      p.是否誓约 = $('vf-oath').checked;
      var cap = favorCap(p);
      p.好感度 = Math.max(0, Math.min(cap, parseInt($('vf-fav').value, 10) || 0));
      p.在场 = $('vf-on').checked;
      VAR_FIELDS.forEach(function (k) {
        var el = $('vf-' + encodeURIComponent(k));
        if (!el) return;
        var val = el.value.trim();
        if (val) p[k] = val; else delete p[k];
      });
      varEdit = null;
      /* 这里可能改了服装，同样要整条日志重刷这个角色 —— 只刷当前句的话
         一点下一句就跳回旧的（和换装那个坑一样） */
      renderVars(); renderSkinPanel(); refreshStageSprites(sv);
      return;
    }
    var dl = e.target.getAttribute && e.target.getAttribute('data-vdel');
    if (dl) {
      if (!confirm('从变量里删掉「' + dl + '」？（立绘不受影响）')) return;
      delete eng.vars.人物[dl];
      varEdit = null; renderVars();
      return;
    }
    if (e.target.id === 'vx-scene-save') {
      eng.vars.地点 = $('vx-loc').value.trim();
      eng.vars.时间 = eng.vars.时间 || {};
      eng.vars.时间.天数 = parseInt($('vx-day').value, 10) || 1;
      eng.vars.时间.时段 = $('vx-band').value;
      renderVars();
      return;
    }
    if (e.target.id === 'vx-add') {
      var nm = prompt('角色名（最好和立绘表里的名字一致）');
      if (!nm || !(nm = nm.trim())) return;
      eng.vars.人物 = eng.vars.人物 || {};
      if (!eng.vars.人物[nm]) {
        eng.vars.人物[nm] = { 好感度: eng.cfg.initialFavor || 80, 是否誓约: false,
                              服装: '常服', 当前状态: '平静', 在场: true };
      }
      varEdit = nm; renderVars();
    }
  });

  /* ============================================================
     调试面板
     ============================================================ */
  var dtab = 'warn';
  function renderDebug() {
    var b = $('debug-body');
    if (!b) return;
    var h = '';
    if (dtab === 'warn') {
      var ms = (lastResult && lastResult.misses) || [];
      var wb0 = eng.lastReport && eng.lastReport.worldbook;
      var rp0 = eng.lastReport && eng.lastReport.prompt;
      h = '<div class="kt-tiles">' +
        [['兜底告警', 'FALLBACK', ms.length, ms.length ? 'c-warn' : 'c-ok'],
         ['世界书激活', 'ENTRIES', wb0 ? wb0.stats.activated : 0, ''],
         ['请求 token', 'TOKENS', rp0 ? rp0.report.estTokens.toLocaleString() : 0, 'c-purple'],
         ['剧情句数', 'LINES', eng.log.length, 'c-ok']
        ].map(function (x) {
          return '<div class="kt-tile ' + x[3] + '"><div class="lb">' + x[0] + '</div>' +
            '<div class="cd">' + x[1] + '</div><div class="nm">' + x[2] + '</div></div>';
        }).join('') + '</div>';
      if (!ms.length) h += '<p class="ok">上一轮全部精确命中，没有任何将就。</p>';
      else {
        var LV = {
          'other-period': { s: 0, t: '时段不同', d: function (m) {
            return '有「' + m.loc + '」这个地方的图，但没有当前时段的版本，用了别的时段。不影响观感。'; } },
          'fuzzy':  { s: 1, t: '近似地点', d: function (m) {
            return '没有「' + m.loc + '」，换成了名字相近的场景。通常还算贴题。'; } },
          'similar':{ s: 1, t: '勉强相近', d: function (m) {
            return '「' + m.loc + '」靠字面相似度猜了一个场景。可能对，也可能不太对，建议看一眼画面。'; } },
          'alias':  { s: 0, t: '你登记的', d: function (m) {
            return '按你登记的别名映射过去的。'; } },
          'default-expr': { s: 1, t: '表情缺图', d: function (m) {
            return m.who + ' 没有「' + m.expr + '」这张立绘，退回了默认表情。'; } },
          'other-outfit': { s: 1, t: '换了套衣服', d: function (m) {
            return m.who + ' 当前服装里没有「' + m.expr + '」，从别的服装里借了一张，可能和身上衣服对不上。'; } },
          'legacy-prefix': { s: 0, t: '老式命名', d: function () { return '按旧的拼接式表情名解析的，正常。'; } },
          'hash':   { s: 2, t: '完全没匹配', d: function (m) {
            return '场景表里找不到「' + m.loc + '」，也没有相近的，随便给了一张。点右边登记别名可以永久修好。'; } },
          'default-sprite': { s: 0, t: '默认立绘', d: function (m) {
            return m.who + ' 没有表情差分，用了卡里给她配的默认立绘。'; } },
          'any':    { s: 2, t: '完全没匹配', d: function (m) {
            return m.who + ' 的「' + m.expr + '」查不到，随便挑了一张。要么是模型编的表情名，要么立绘库缺图。'; } },
          'miss':   { s: 2, t: '查无此人', d: function (m) {
            return '立绘库里没有「' + m.who + '」这个角色，这句没有立绘。'; } }
        };
        var COLOR = ['dim', 'warn', 'bad'], LABEL = ['无妨', '将就', '明显不对'];
        var sorted = ms.slice().sort(function (a, b) {
          return ((LV[b.via] || {}).s || 0) - ((LV[a.via] || {}).s || 0);
        });
        h += '<div class="kt-cards">' + sorted.map(function (m) {
          var lv = LV[m.via] || { s: 1, t: m.via, d: function () { return ''; } };
          var btn = (m.kind === 'scene' && lv.s > 0)
            ? ' <button class="kt-btn" data-alias="' + encodeURIComponent(m.loc) +
              '" style="padding:3px 10px;font-size:11.5px">登记别名</button>' : '';
          var cls = ['', 'c-warn', 'c-warn'][lv.s];
          return '<div class="kt-card ' + (lv.s === 2 ? 'bad-card' : lv.s === 1 ? 'warn-card' : '') + '">' +
            '<h5>' + esc(lv.t) + ' <em class="tag ' +
            (lv.s === 2 ? 'mine' : lv.s === 1 ? 'role' : 'green') + '">' + LABEL[lv.s] + '</em>' +
            ' <span class="dim" style="font-weight:400">×' + m.count + '</span></h5>' +
            '<div class="bd">' + esc(lv.d(m)) + btn + '</div></div>';
        }).join('') + '</div>' +
        '<p class="kt-hint" style="margin-top:14px">「无妨」不用管；「将就」可以看一眼对不对；' +
        '「明显不对」建议登记别名或补图。</p>';
      }
      var al = Resolver.getAliases();
      if (Object.keys(al).length) {
        h += '<h3 class="dim" style="margin-top:14px">已登记别名</h3><table>' +
          Object.keys(al).map(function (k) {
            return '<tr><td>' + esc(k) + '</td><td>→ ' + esc(al[k]) +
              '<button class="alias-btn" data-unalias="' + encodeURIComponent(k) + '">删</button></td></tr>';
          }).join('') + '</table>';
      }
    } else if (dtab === 'wb') {
      var wb = eng.lastReport && eng.lastReport.worldbook;
      if (!wb) h = '<p class="dim">还没有请求记录。</p>';
      else h = '<p>激活 <b>' + wb.stats.activated + '</b> / ' + wb.stats.pool + ' 条 · ' +
        wb.stats.chars.toLocaleString() + ' 字 · 递归 ' + wb.stats.recursionSteps + ' 轮' +
        (wb.stats.dropped ? ' · <span class="warn">超预算砍 ' + wb.stats.dropped + ' 条</span>' : '') +
        '</p><table><tr><th>类型</th><th>条目</th><th>长度</th></tr>' +
        wb.active.map(function (e) {
          return '<tr><td>' + (e.constant ? '<span class="ok">蓝灯</span>' : '<span class="warn">绿灯</span>') +
            '</td><td>' + esc(e.comment || '(无注释)') + '</td><td class="dim">' +
            String(e.content || '').length + '</td></tr>';
        }).join('') + '</table>';
    } else if (dtab === 'req') {
      var rp = eng.lastReport && eng.lastReport.prompt;
      if (!rp) h = '<p class="dim">还没有请求记录。</p>';
      else h = '<p>' + rp.report.messageCount + ' 条消息 · ' +
        rp.report.totalChars.toLocaleString() + ' 字 · 粗估 <b>' +
        rp.report.estTokens.toLocaleString() + '</b> token</p>' +
        '<table>' + rp.report.blocks.map(function (x) {
          return '<tr><td>' + esc(x.tag) + '</td><td class="dim">' + x.chars + ' 字</td></tr>';
        }).join('') + '</table>' +
        '<pre>' + esc(rp.messages.map(function (m) {
          return '【' + m.role + '】\n' + m.content;
        }).join('\n\n' + '─'.repeat(30) + '\n\n')) + '</pre>';
    } else {
      h = '<pre>' + (lastRaw ? esc(lastRaw) : '<span class="dim">还没有输出。</span>') + '</pre>';
    }
    b.innerHTML = h;
  }
  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.getAttribute && e.target.getAttribute('data-alias');
    if (a) { openAliasPicker(decodeURIComponent(a)); return; }
    var u = e.target.getAttribute && e.target.getAttribute('data-unalias');
    if (u) { Resolver.clearAlias(decodeURIComponent(u)); renderDebug(); }
    var c = e.target.getAttribute && e.target.getAttribute('data-close');
    if (c) $(c).hidden = true;
  });
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); dtab = b.dataset.dt; renderDebug();
    };
  });

  /* ---- 别名选择器：从 141 个场景里搜着选，不用手打 ---- */
  function openAliasPicker(from) {
    var wrap = document.createElement('div');
    wrap.id = 'alias-modal';
    var keys = Object.keys(RESOURCE.scenes).sort();
    wrap.innerHTML =
      '<div class="am-box"><h3>「' + esc(from) + '」用哪个场景？</h3>' +
      '<input type="text" id="am-q" placeholder="搜索场景名…" autocomplete="off">' +
      '<div id="am-list"></div>' +
      '<div class="am-foot"><button id="am-cancel">取消</button></div></div>';
    document.body.appendChild(wrap);
    function draw(q) {
      var hit = keys.filter(function (k) { return !q || k.indexOf(q) !== -1; });
      $('am-list').innerHTML = hit.slice(0, 120).map(function (k) {
        var t = RESOURCE.scenes[k], p = Object.keys(t)[0];
        return '<div class="am-item" data-pick="' + esc(k) + '">' +
          '<img loading="lazy" src="' + t[p] + '" alt=""><span>' + esc(k) + '</span></div>';
      }).join('') || '<p class="dim">没有匹配的场景。</p>';
    }
    draw('');
    $('am-q').oninput = function () { draw(this.value.trim()); };
    $('am-q').focus();
    wrap.onclick = function (e) {
      if (e.target === wrap || e.target.id === 'am-cancel') { wrap.remove(); return; }
      var it = e.target.closest ? e.target.closest('[data-pick]') : null;
      if (it) {
        Resolver.setAlias(from, it.getAttribute('data-pick'));
        wrap.remove();
        renderDebug();
        if (eng.log[qi]) goTo(qi, { instant: true });   // 立刻看到换图效果
      }
    };
  }

  /* ============================================================
     存读档
     ============================================================ */
  /* ---------- 周目 ----------
     每次「开始游戏」生成一个新的 runId，自动存档写进**这个周目自己的槽**
     （auto:<runId>）。以前所有周目共用一个 'auto'：开第二个开局，第一个
     的进度就被悄悄覆盖了 —— 想换个开局玩玩再回来的人会直接丢档。 */
  var runId = null;
  function newRunId() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }
  /* runId 为空 = 还没开过局，或读的是老版本留下的那个全局 'auto'，
     这种情况继续写 'auto'，不给老存档搬家。 */
  function autoSlotId() { return runId ? 'auto:' + runId : 'auto'; }

  /* ---------- 存档树 ----------
     思路来自 KaiTuoYiShi：一个开局是一棵树，每一轮结束自动存一个节点，
     手动存档也是节点。读一个旧节点接着玩，新节点挂在它下面 —— 自然长出分支，
     原来那条线不会被覆盖。自动节点每棵树保留最近 SaveTree.AUTO_KEEP 个。
     auto:<runId> 仍然是「最新进度」指针，「继续上次」和开场的周目列表用它。 */
  var activeNode = null;       // 现在所在的节点（下一个节点的父节点）

  /**
   * @param {object} [o] { type:'auto'|'manual', nodeId, parent, name }
   *        不传就是「最新进度」指针用的那份
   */
  function snapshot(o) {
    o = o || {};
    var last = eng.log[Math.min(qi, eng.log.length - 1)];
    return {
      title: (eng.vars.地点 || '未知地点') + ' · 第' +
             ((eng.vars.时间 && eng.vars.时间.天数) || 1) + '天',
      history: eng.history, vars: eng.vars, log: eng.log,
      phoneSent: eng.phoneSent, phoneSeq: eng.phoneSeq,
      macroVars: eng.macroVars || {},
      cursor: qi, opening: currentOpening, runId: runId,
      /* 存档树 */
      type: o.type || 'latest',
      name: o.name || '',
      node: activeNode,
      tree: o.nodeId ? { rootId: runId || '', nodeId: o.nodeId, parentNodeId: o.parent || '' }
                     : { rootId: runId || '', nodeId: '', parentNodeId: '' },
      round: SaveTree.roundsOf(eng.history),
      summary: last ? SaveTree.summaryOf({ log: [last] }) : '',
      /* 读档后还能重roll */
      turnStack: stackForSave()
    };
  }

  /** @param {object} [o] { skipNode } —— 刚 checkpoint 过就不用再写一遍节点 */
  function autosave(o) {
    GalStore.saveSlot(autoSlotId(), snapshot()).catch(function (e) {
      console.warn('[存档] 自动保存失败', e);
    });
    /* 最后一轮的自动节点也跟着更新（CG 图晚到、翻到了别的句子） */
    var top = turnStack[turnStack.length - 1];
    if (!(o && o.skipNode) && top && top.turnNode && top.turnNode === activeNode && top.nodeType !== 'manual') {
      GalStore.saveSlot('node:' + top.turnNode,
        snapshot({ type: 'auto', nodeId: top.turnNode, parent: top.node })).catch(function () {});
    }
  }

  /**
   * 一轮结束：给这一轮建（或更新）自动节点。
   * 重roll / 换版本还是同一轮，写回同一个节点，不会一版一个节点地堆。
   */
  /* 只有 IndexedDB 才存节点。降级到 localStorage（5MB）时每轮一份完整存档很快就会撑爆，
     撑爆后 GalStore 会再降级到「只在内存」，那就连最新进度都丢了 —— 所以那种情况下只留
     「最新进度」和手动存档，和以前一样 */
  function treeOn() { return GalStore.backend() === 'idb'; }

  async function checkpoint(snap) {
    if (!runId) runId = newRunId();
    if (!treeOn()) return;
    if (!snap.turnNode) snap.turnNode = SaveTree.newId('n');
    activeNode = snap.turnNode;
    try {
      await GalStore.saveSlot('node:' + snap.turnNode,
        snapshot({ type: 'auto', nodeId: snap.turnNode, parent: snap.node }));
      await pruneAuto();
    } catch (e) { console.warn('[存档] 节点保存失败', e); }
  }

  /** 自动节点超了就删最老的，子节点改挂到没被删的祖先上 */
  async function pruneAuto() {
    var list = await GalStore.listSaves();
    var plan = SaveTree.planPrune(list, runId, activeNode);
    for (var i = 0; i < plan.reparent.length; i++) {
      var r = plan.reparent[i];
      var d = await GalStore.loadSlot(r.id);
      if (!d) continue;
      d.tree = Object.assign({}, d.tree || {}, { parentNodeId: r.parentNodeId });
      await GalStore.saveSlot(r.id, d);
    }
    for (var j = 0; j < plan.del.length; j++) await GalStore.deleteSlot(plan.del[j]);
    return plan;
  }

  /**
   * 从一份存档完整恢复。
   *
   * ⚠ 必须恢复**全部**五样：history / vars / log / phoneSent / phoneSeq，
   *   外加光标位置。早先「继续上次」只恢复了前两样，结果读档后整条剧情
   *   记录是空的、手机消息也没了，只能从空白继续 —— 别再拆开写第二份。
   *
   * @param {string} [id] 这份存档的槽名，用来推断周目 id
   */
  function restoreFrom(sv, id) {
    if (!sv) return false;
    eng.history = sv.history || [];
    eng.vars = sv.vars || {};
    eng.log = sv.log || [];
    eng.phoneSent = sv.phoneSent || [];
    eng.phoneSeq = sv.phoneSeq || 0;
    eng.macroVars = sv.macroVars || {};
    currentOpening = sv.opening || null;
    /* 接着往下玩时，自动存档要落回同一个周目的槽，不能另起一个 */
    runId = (sv.tree && sv.tree.rootId) || sv.runId ||
            (id && id.indexOf('auto:') === 0 ? id.slice(5) : null);
    /* 存档树：读的是节点就站在这个节点上；读的是「最新进度」就站在它记着的节点上 */
    activeNode = (sv.tree && sv.tree.nodeId) || sv.node || null;
    /* 回合快照跟着存档走，读档后还能重roll / 撤回。
       读的是树上的旧节点时，重roll 出来的新版本另起一个节点（成为分支），
       不去改写那个节点 —— 它下面可能已经长着后来的剧情 */
    var readNode = !!(sv.tree && sv.tree.nodeId);
    turnStack = (sv.turnStack || []).map(function (t) {
      return readNode ? Object.assign({}, t, { turnNode: null }) : t;
    });
    if (window.CG && CG.cancel) CG.cancel();

    closePhone();
    enterGame();
    live.forEach(function (r) { r.el.remove(); }); live.clear();
    stageNow = []; lastBgUrl = null;
    if (eng.log.length) {
      goTo(sv.cursor != null ? sv.cursor : eng.log.length - 1, { instant: true });
      renderHistory();
    } else {
      speakerEl.className = 'narrator'; speakerEl.textContent = '系统';
      textEl.textContent = '已读取存档（' + eng.history.length + ' 轮），但没有剧情记录。继续输入以推进。';
      qi = 0; updateNav();
    }
    updateTurnUI();
    return true;
  }

  /* ============================================================
     存档的导出 / 导入
     ============================================================
     为什么必须有：存档在浏览器的 IndexedDB 里，清缓存、换浏览器、换设备
     都会没。而且 file:// 打开的本地文件和 https:// 的网址**是两个不同的源**，
     存档不互通 —— 这点最容易让人以为"数据丢了"。
     以前只有崩溃兜底页里那颗按钮能导出，等于崩了才能备份，很荒谬。

     导出的内容不含 API 密钥（snapshot() 里本来就没有），可以放心传给别人。 */

  var SAVE_PACK = 'gal-saves';      // 包格式标识，导入时校验用
  var SAVE_PACK_V = 1;

  /**
   * @param {string[]} [ids] 只导这几个；不传就是全部
   * @param {boolean} [withImages] 连 CG 图一起打包。图是 dataURL，一张 1~2MB，
   *        几十张就上百兆，所以默认不带。
   */
  async function exportSaves(ids, withImages) {
    /* 先把当前进度落一次盘。自动存档只在「生成完一轮」时触发，
       玩家翻了几页再点导出的话，不先存就会把旧位置导出去 ——
       实测过：翻到第 2 句导出，读回来停在第 1 句。 */
    if (eng.log.length || eng.history.length) {
      try { await GalStore.saveSlot(autoSlotId(), snapshot()); } catch (e) {}
    }
    var list = await GalStore.listSaves();
    if (ids && ids.length) {
      list = list.filter(function (s) { return ids.indexOf(s.id) >= 0; });
    }
    var pack = { kind: SAVE_PACK, v: SAVE_PACK_V, at: new Date().toISOString(),
                 saves: {}, images: null };
    for (var i = 0; i < list.length; i++) {
      var d = await GalStore.loadSlot(list[i].id);
      if (d) pack.saves[list[i].id] = d;
    }
    if (withImages && window.Gallery) {
      pack.images = {};
      try {
        var metas = await Gallery.list();
        for (var j = 0; j < metas.length; j++) {
          var src = await Gallery.src(metas[j].id);
          if (src) pack.images[metas[j].id] = { src: src, meta: metas[j] };
        }
      } catch (e) { pack.images = null; }
    }
    var n = Object.keys(pack.saves).length;
    var name = 'gal-存档备份-' + new Date().toISOString().slice(0, 10) +
               (ids && ids.length === 1 ? '-' + ids[0] : '-全部' + n + '份') + '.json';
    download(name, JSON.stringify(pack));
    return { count: n, images: pack.images ? Object.keys(pack.images).length : 0 };
  }

  /**
   * 导入。**合并，不覆盖** —— 重名的存档加后缀另存，
   * 免得手一抖把正在玩的那个盖掉。
   */
  async function importSaves(text) {
    var pack;
    try { pack = JSON.parse(text); }
    catch (e) { throw new Error('这不是一个有效的 JSON 文件'); }
    if (!pack || pack.kind !== SAVE_PACK || !pack.saves) {
      throw new Error('这不是本引擎导出的存档备份（缺 kind/saves 字段）');
    }
    var have = {};
    (await GalStore.listSaves()).forEach(function (s) { have[s.id] = 1; });

    var added = 0, renamed = 0;
    var ids = Object.keys(pack.saves);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], target = id;
      if (have[target]) {
        renamed++;
        var k = 2;
        while (have[id + '(导入' + k + ')']) k++;
        target = id + '(导入' + k + ')';
      }
      /* 标成「导入」，存档界面里单独一栏；树信息保留，整棵树导出再导入还是一棵树 */
      await GalStore.saveSlot(target, Object.assign({}, pack.saves[id], { imported: true }));
      have[target] = 1;
      added++;
    }

    var imgs = 0;
    if (pack.images && window.Gallery) {
      var iid = Object.keys(pack.images);
      for (var j = 0; j < iid.length; j++) {
        var it = pack.images[iid[j]];
        /* Gallery.put 收的是一个完整记录对象（带 id / src / turn / logIndex …），
           把导出时存下的 meta 原样还回去，id 保持不变 —— 存档里挂的就是这个 id。 */
        try {
          await Gallery.put(Object.assign({}, it.meta || {}, { id: iid[j], src: it.src }));
          imgs++;
        } catch (e) {}
      }
    }
    return { added: added, renamed: renamed, images: imgs };
  }

  /* ============================================================
     存读档界面（存档树）
     ============================================================
     版式参考 KaiTuoYiShi 的「存档树控制台」：左边一列操作和统计，右边是
     「全部 / 手动 / 自动 / 导入」标签、开局（树）列表、所选那棵树的节点时间线。
     以前存档藏在 手机 → 设置 → 存读档 里，很多人根本找不到；现在工具栏 ▤ 直达，
     手机里那个入口也打开这里。 */
  var svTab = 'all', svRoot = null;
  var SV_TYPE = { auto: '自动', manual: '手动', latest: '最新进度' };

  function openSaves() {
    closePhone();
    $('save-modal').hidden = false;
    renderSlots();
  }
  function closeSaves() { $('save-modal').hidden = true; }

  function nodeVisible(s) {
    if (svTab === 'manual') return s.type === 'manual' && !s.imported;
    if (svTab === 'auto') return (s.type === 'auto' || s.type === 'latest') && !s.imported;
    if (svTab === 'imported') return !!s.imported;
    return true;
  }

  function fmtTime(t) {
    if (!t) return '';
    return new Date(t).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit' });
  }

  async function renderSlots() {
    var list;
    try { list = await GalStore.listSaves(); }
    catch (e) {
      $('slotlist').innerHTML = '<p class="bad">存档读取失败：' + esc(e.message || e) + '</p>';
      return;
    }
    var trees = SaveTree.buildTrees(list);
    var all = [];
    trees.forEach(function (t) { t.nodes.forEach(function (n) { all.push(n.s); }); });
    var count = function (f) { return all.filter(f).length; };
    var nAuto = count(function (s) { return (s.type === 'auto' || s.type === 'latest') && !s.imported; });
    var nManual = count(function (s) { return s.type === 'manual' && !s.imported; });
    var nImp = count(function (s) { return s.imported; });
    var branches = trees.reduce(function (t, g) { return t + g.branchCount; }, 0);
    var kb = trees.reduce(function (t, g) { return t + g.kb; }, 0);

    $('sv-metrics').innerHTML = [
      [all.length, '节点'], [branches, '分支'], [trees.length, '开局'],
      [kb >= 1024 ? (kb / 1024).toFixed(1) + 'M' : kb + 'K', '占用']
    ].map(function (m) { return '<div><b>' + m[0] + '</b><span>' + m[1] + '</span></div>'; }).join('');

    $('sv-tabs').innerHTML = [['all', '全部', all.length], ['manual', '手动', nManual],
      ['auto', '自动', nAuto], ['imported', '导入', nImp]].map(function (t) {
      return '<button type="button" data-tab="' + t[0] + '"' + (svTab === t[0] ? ' class="on"' : '') + '>' +
        t[1] + '<i>' + t[2] + '</i></button>';
    }).join('');

    var shown = trees.map(function (g) {
      return Object.assign({}, g, { nodes: g.nodes.filter(function (n) { return nodeVisible(n.s); }) });
    }).filter(function (g) { return g.nodes.length; });
    if (!shown.some(function (g) { return g.rootId === svRoot; })) {
      var mine = shown.filter(function (g) { return runId && g.rootId === runId; })[0];
      svRoot = (mine || shown[0] || {}).rootId || null;
    }
    var cur = shown.filter(function (g) { return g.rootId === svRoot; })[0];

    $('sv-trees').innerHTML = shown.length > 1 || (cur && shown.length) ? shown.map(function (g) {
      return '<button type="button" class="sv-tree' + (g.rootId === svRoot ? ' on' : '') +
        '" data-root="' + esc(g.rootId) + '"><b>' + esc(g.title) + '</b>' +
        (runId && g.rootId === runId ? '<em>当前</em>' : '') +
        '<span>' + g.nodeCount + ' 节点 · ' + g.branchCount + ' 分支 · 第 ' + ((g.latest && g.latest.round) || 0) +
        ' 轮</span></button>';
    }).join('') : '';

    var body = '';
    if (!cur) {
      body = '<div class="sv-empty">' + (svTab === 'all' ? '还没有存档。开始游戏后每一轮会自动存一个节点。'
        : '这个分类下没有存档。') + '</div>';
    } else {
      var nodes = cur.nodes.slice().sort(function (a, b) { return b.s.at - a.s.at; });
      body = '<div class="sv-treehd"><div><b>' + esc(cur.title) + '</b><span>' + cur.nodeCount + ' 个节点 · ' +
        cur.branchCount + ' 个分支 · ' + (cur.kb >= 1024 ? (cur.kb / 1024).toFixed(1) + ' MB' : cur.kb + ' KB') +
        '</span></div><div class="sv-treeacts">' +
        '<button type="button" class="sv-btn" data-exptree="' + esc(cur.rootId) + '">导出整棵树</button>' +
        '<button type="button" class="sv-btn danger" data-deltree="' + esc(cur.rootId) + '">删除整棵树</button>' +
        '</div></div><div class="sv-line">' + nodes.map(function (n) {
        var s = n.s;
        var isCur = activeNode && s.nodeId === activeNode;
        var tags = '<i class="t ' + s.type + '">' + (s.imported ? '导入' : SV_TYPE[s.type] || s.type) + '</i>' +
          (isCur ? '<i class="t cur">当前</i>' : '') + (n.isLatest ? '<i class="t new">最新</i>' : '') +
          (n.depth > 0 && n.s.parentNodeId && cur.nodes.some(function (m) {
            return m.children.length > 1 && m.children.indexOf(n) >= 0; }) ? '<i class="t fork">分支</i>' : '');
        return '<article class="sv-node' + (isCur ? ' cur' : '') + '" style="--d:' + Math.min(n.depth, 6) + '">' +
          '<div class="sv-ninfo"><div class="sv-ntitle">' + tags + '<b>' + esc(s.name || s.title || '存档') + '</b></div>' +
          '<div class="sv-nmeta">第 ' + (s.round || 0) + ' 轮 · ' + esc(s.title || '') + ' · ' + fmtTime(s.at) +
          (s.kb ? ' · ' + s.kb + ' KB' : '') + '</div>' +
          (s.summary ? '<div class="sv-nsum">' + esc(s.summary) + '</div>' : '') + '</div>' +
          '<div class="sv-nacts"><button type="button" class="sv-btn primary" data-load="' + esc(s.id) + '">读取</button>' +
          '<button type="button" class="sv-btn" data-exp="' + esc(s.id) + '">导出</button>' +
          (s.type === 'manual' ? '<button type="button" class="sv-btn" data-ren="' + esc(s.id) + '">改名</button>' : '') +
          '<button type="button" class="sv-btn danger" data-del="' + esc(s.id) + '">删除</button></div></article>';
      }).join('') + '</div>';
    }
    var note = GalStore.backendNote();
    if (note) note += '每轮的自动节点只在 IndexedDB 下才存，现在只保留「最新进度」和手动存档。';
    $('slotlist').innerHTML = (note ? '<p class="warn" style="margin-bottom:8px">' + esc(note) + '</p>' : '') + body;
    $('sv-cur').textContent = eng.log.length ? '当前：' + snapshot().title + ' · 第 ' +
      SaveTree.roundsOf(eng.history) + ' 轮' : '';
    $('do-save').disabled = !(eng.log.length || eng.history.length);

    var note2 = $('sv-note');
    var say = function (t, cls) {
      if (note2) { note2.textContent = t; note2.className = 'sv-note ' + (cls || ''); }
    };
    $('sv-exp').onclick = async function () {
      say('正在打包…');
      try {
        var r = await exportSaves(null, $('sv-img').checked);
        say('已导出 ' + r.count + ' 份存档' + (r.images ? '、' + r.images + ' 张图' : '') + '。', 'ok');
      } catch (e) { say('导出失败：' + (e.message || e), 'bad'); }
    };
    $('sv-imp').onclick = function () { $('sv-file').click(); };
    $('sv-file').onchange = function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = async function () {
        try {
          var r = await importSaves(String(rd.result));
          svTab = 'imported';
          /* 必须先重建列表再写提示：renderSlots() 会重建整块 innerHTML，
             先写的话提示立刻就被冲掉了（note2 指向的元素也没了）。 */
          await renderSlots();
          var n2 = $('sv-note');
          if (n2) {
            n2.className = 'sv-note ok';
            n2.textContent = '导入了 ' + r.added + ' 份' +
              (r.renamed ? '（其中 ' + r.renamed + ' 份重名，已另存副本，没有覆盖原档）' : '') +
              (r.images ? '，另有 ' + r.images + ' 张图' : '') + '。';
          }
        } catch (e) { say('导入失败：' + (e.message || e), 'bad'); }
      };
      rd.readAsText(f);
      this.value = '';
    };
  }

  async function slotClick(e) {
    var el = e.target.closest ? e.target.closest('[data-load],[data-exp],[data-ren],[data-del],[data-tab],[data-root],[data-exptree],[data-deltree]') : null;
    if (!el) return;
    var tab = el.getAttribute('data-tab');
    if (tab) { svTab = tab; renderSlots(); return; }
    var root = el.getAttribute('data-root');
    if (root) { svRoot = root; renderSlots(); return; }
    var id = el.getAttribute('data-load');
    if (id) {
      /* 先把手上的进度落盘，读别的节点不会丢现在这条线 */
      if (eng.log.length || eng.history.length) {
        try { await GalStore.saveSlot(autoSlotId(), snapshot()); } catch (err) {}
      }
      /* 点的是「最新进度」停着的那个节点：读指针那份 —— 内容一样，但还带着之后翻到哪一句 */
      var all0 = await GalStore.listSaves();
      var me0 = all0.filter(function (x) { return x.id === id; })[0];
      var ptr = me0 && me0.nodeId && all0.filter(function (x) {
        return x.type === 'latest' && x.rootId === me0.rootId && x.nodeId === me0.nodeId && x.at >= me0.at;
      })[0];
      var useId = ptr ? ptr.id : id;
      var data = await GalStore.loadSlot(useId);
      if (!data) { toast('这个存档读不出来了。', 'bad'); return; }
      restoreFrom(data, useId);
      closeSaves();
      toast('已读取。接着玩会从这里长出一条新分支，原来那条线不受影响。', 'ok', 6000);
      return;
    }
    var x = el.getAttribute('data-exp');
    if (x) {
      try { await exportSaves([x], $('sv-img') && $('sv-img').checked); }
      catch (err) { console.warn('[存档] 导出失败', err); }
      return;
    }
    var xt = el.getAttribute('data-exptree');
    if (xt) {
      try { await exportSaves(SaveTree.slotsOfTree(await GalStore.listSaves(), xt), $('sv-img') && $('sv-img').checked); }
      catch (err) { console.warn('[存档] 导出失败', err); }
      return;
    }
    var r = el.getAttribute('data-ren');
    if (r) {
      var d0 = await GalStore.loadSlot(r);
      if (!d0) return;
      var old = d0.name || (SaveTree.isNode(r) ? '' : r);
      var nn = prompt('新的存档名', old);
      if (nn && nn.trim() && nn.trim() !== old) {
        if (SaveTree.isNode(r)) { d0.name = nn.trim(); await GalStore.saveSlot(r, d0); }
        else { await GalStore.saveSlot(nn.trim(), d0); await GalStore.deleteSlot(r); }
      }
      renderSlots(); return;
    }
    var del = el.getAttribute('data-del');
    if (del) {
      if (!confirm('删除这个存档？删了找不回来。')) return;
      /* 删中间的节点：它的子节点改挂到它的父节点上，树不断 */
      var list = await GalStore.listSaves();
      var me = list.filter(function (s) { return s.id === del; })[0];
      if (me && me.nodeId) {
        var kids = list.filter(function (s) { return s.rootId === me.rootId && s.parentNodeId === me.nodeId; });
        for (var i = 0; i < kids.length; i++) {
          var kd = await GalStore.loadSlot(kids[i].id);
          if (!kd) continue;
          kd.tree = Object.assign({}, kd.tree || {}, { parentNodeId: me.parentNodeId || '' });
          await GalStore.saveSlot(kids[i].id, kd);
        }
        if (activeNode === me.nodeId) activeNode = me.parentNodeId || null;
      }
      await GalStore.deleteSlot(del); renderSlots(); renderRuns();
      return;
    }
    var dt = el.getAttribute('data-deltree');
    if (dt) {
      var ids = SaveTree.slotsOfTree(await GalStore.listSaves(), dt);
      if (!confirm('删除这个开局的全部 ' + ids.length + ' 份存档？删了找不回来。')) return;
      for (var j = 0; j < ids.length; j++) await GalStore.deleteSlot(ids[j]);
      if (dt === runId) activeNode = null;
      svRoot = null;
      renderSlots(); renderRuns();
    }
  }

  async function doSave() {
    if (!(eng.log.length || eng.history.length)) return;
    var name = $('save-name').value.trim();
    if (!name) {
      name = (eng.vars.地点 || '存档') + ' ' +
        new Date().toLocaleString('zh-CN', { hour12: false, month: '2-digit',
          day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    if (!runId) runId = newRunId();
    var nodeId = SaveTree.newId('m');
    await GalStore.saveSlot('node:' + nodeId, snapshot({ type: 'manual', nodeId: nodeId, parent: activeNode, name: name }));
    activeNode = nodeId;
    autosave({ skipNode: true });
    $('save-name').value = '';
    svTab = svTab === 'auto' ? 'all' : svTab;
    svRoot = runId;
    await renderSlots();
    var n = $('sv-note');
    if (n) { n.className = 'sv-note ok'; n.textContent = '已保存「' + name + '」。之后的自动节点会挂在它下面。'; }
  }

  /* ============================================================
     换装面板：列出在场舰娘的原皮与皮肤，点缩略图即换并锁定
     ============================================================ */
  function renderSkinPanel() {
    if ($('skin-panel').hidden) return;
    var box = $('skin-body');
    /* 按这一句的全部登场角色列 —— 手机竖屏台上只站一个人，但换装要能换所有人 */
    var curLine = eng.log[qi];
    var names = ((curLine && curLine.sprites && curLine.sprites.length) ? curLine.sprites : stageNow)
      .map(function (c) { return c.who; });
    /* 台上没人时退而列出变量里在场的 */
    if (!names.length) {
      var ppl = (eng.vars && eng.vars.人物) || {};
      names = Object.keys(ppl).filter(function (n) { return ppl[n] && ppl[n].在场; });
    }
    if (!names.length) {
      box.innerHTML = '<div class="sk-empty">现在台上没有人。<br>' +
        '开始一段剧情，有舰娘登场后再打开这里。</div>';
      return;
    }
    var ppl2 = (eng.vars && eng.vars.人物) || {};
    /* 「点了就锁定」的总开关。锁定本来就是默认行为，但一直藏在里面，
       点完只在标题旁边冒一个小小的「已锁定」，很难注意到。摆到最上面。 */
    var lockMode = GalStore.local('gal_skin_lock') !== false;
    var head = '<label class="sk-lockmode' + (lockMode ? ' on' : '') + '">' +
      '<input type="checkbox" id="sk-lockmode"' + (lockMode ? ' checked' : '') + '>' +
      '<span class="t"><b>点了就锁定</b>' +
      '<i>' + (lockMode
        ? '选中的皮肤会一直用下去，后面每一轮都是它'
        : '只换当前这一句，下一轮会恢复自动') + '</i></span></label>';

    box.innerHTML = head + names.map(function (n) {
      var skins = Resolver.skinsOf(n);
      var outfits = Resolver.outfitsOf(n);
      var p = ppl2[n] || {};
      var locked = !!p.皮肤锁定;
      var cur = p.皮肤;
      if (!skins.length && outfits.length < 2) {
        return '<div class="sk-char"><div class="sk-hd"><b>' + esc(n) + '</b>' +
          '<span class="n">只有一套立绘</span></div></div>';
      }
      var hasExpr = !!(window.RESOURCE.characters || {})[n];
      var h = '<div class="sk-char"><div class="sk-hd"><b>' + esc(n) + '</b>' +
        (locked ? '<span class="lock">已锁定 · 后续都用这张</span>' : '') +
        '<span class="n">' + skins.length + ' 套</span></div>';

      h += '<div class="sk-grid">' + skins.map(function (s2) {
        var on = cur === s2.index;
        return '<div class="sk-item' + (s2.isBase ? ' base' : '') + (on ? ' on' : '') +
          (on && locked ? ' locked' : '') +
          '" data-skin="' + n + '|' + s2.index + '">' +
          '<img src="' + s2.url + '" alt="" ' +
          'onerror="this.parentNode.style.display=\'none\'">' +
          '<span>' + (s2.isBase ? '原皮' : '皮肤 ' + s2.index) + '</span>' +
          (on && locked ? '<em class="pin">锁</em>' : '') + '</div>';
      }).join('') + '</div>';

      /* 有表情差分的角色锁了皮肤 = 表情不再变化。这是必然的（默认立绘没有表情），
         但不说清楚的话玩家会以为坏了。 */
      if (locked && hasExpr) {
        h += '<div class="sk-warn">锁了皮肤之后她的表情不会再变 —— ' +
          '默认立绘每人只有一张图，没有表情差分。<br>' +
          '想要表情演出，点下面那排服装回到带表情的那套。</div>';
      }

      /* 有表情差分的角色，额外给一排"回到会做表情的那套服装" */
      if (outfits.length) {
        h += '<div class="sk-acts">' + outfits.map(function (o) {
          return '<button data-outfit="' + n + '|' + esc(o) + '">' + esc(o) +
            '<br><i style="font-style:normal;opacity:.6;font-size:10px">带表情</i></button>';
        }).join('') + '</div>';
      }
      if (locked) {
        h += '<div class="sk-acts"><button data-unlock="' + esc(n) +
          '">解除锁定（恢复自动）</button></div>';
      }
      return h + '</div>';
    }).join('');
  }

  $('skin-body').addEventListener('change', function (e) {
    if (e.target.id !== 'sk-lockmode') return;
    var on = e.target.checked;
    GalStore.local('gal_skin_lock', on);
    /* 关掉时把已经锁上的都放开，否则开关看着没生效 */
    var freed = [];
    if (!on) {
      var ppl = (eng.vars && eng.vars.人物) || {};
      Object.keys(ppl).forEach(function (n) {
        if (ppl[n] && ppl[n].皮肤锁定) { ppl[n].皮肤锁定 = false; freed.push(n); }
      });
    }
    refreshStageSprites(freed);
    renderSkinPanel();
    renderVars();
  });

  $('skin-body').addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-skin],[data-outfit],[data-unlock]') : null;
    if (!el) return;
    var touched = null;
    var sk = el.getAttribute('data-skin');
    if (sk) {
      var a = sk.split('|');
      touched = a[0];
      eng.setSkin(a[0], parseInt(a[1], 10), null,
                  GalStore.local('gal_skin_lock') !== false);
    }
    var of = el.getAttribute('data-outfit');
    if (of) {
      var b = of.split('|');
      touched = b[0];
      eng.setSkin(b[0], null, b[1]);      // 解锁皮肤，改回有表情的服装
    }
    var un = el.getAttribute('data-unlock');
    if (un) { touched = un; eng.setSkin(un, null); }
    refreshStageSprites(touched);
    renderSkinPanel();
    renderVars();
    autosave();
  });

  /* ============================================================
     换装后刷新立绘

     ⚠ 这里踩过一次：原来只刷新当前这一句（refreshStageSprites），
     结果「锁了以后随便点一下又跳回去」—— 因为一轮十几句的立绘是在
     processOutput 的时候**一次性全解析好**的，你停在第 3 句锁定，
     第 4 句往后的 sprites 还是锁定之前那张，一按下一句就打回原形。

     所以必须把**整条日志里这个角色的立绘**都重解析一遍。
     只动这一个角色 —— 全量重解析会把别人的多图差分重新随机抽一次，
     那就把「没说话的人也在动」那个老 bug 又招回来了。
     ============================================================ */
  function resolveSpriteFor(name, expr, outfit) {
    var p = ((eng.vars && eng.vars.人物) || {})[name] || {};
    var skin = null;
    if (p.皮肤锁定 && p.皮肤 != null) skin = p.皮肤;
    else if (!(window.RESOURCE.characters || {})[name] && p.皮肤 != null) skin = p.皮肤;
    return Resolver.sprite(name, expr, { outfit: p.服装 || outfit, skin: skin });
  }

  /** 把整条日志里这几个角色的立绘重解析一遍 */
  function refreshSpritesFor(names) {
    var want = {};
    (Array.isArray(names) ? names : [names]).forEach(function (n) { if (n) want[n] = 1; });
    if (!Object.keys(want).length) return 0;
    var n2 = 0;
    eng.log.forEach(function (m) {
      if (!m || !m.stage || !m.stage.length) return;
      var hit = m.stage.some(function (c) { return want[c.name]; });
      if (!hit) return;
      /* 按 stage 重建，保证顺序和人数跟着 stage 走；不在 want 里的沿用原来那张 */
      var old = {};
      (m.sprites || []).forEach(function (s2) { if (s2 && s2.who) old[s2.who] = s2; });
      m.sprites = m.stage.map(function (c) {
        if (!want[c.name]) return old[c.name] || resolveSpriteFor(c.name, c.expr, c.outfit);
        n2++;
        return resolveSpriteFor(c.name, c.expr, c.outfit);
      }).filter(Boolean);
    });
    return n2;
  }

  /** 换完装立刻把画面换掉，不用等下一句 */
  function refreshStageSprites(names) {
    if (names) refreshSpritesFor(names);
    var m = eng.log[qi];
    if (m) applyStage(stageFor(m));
  }

  $('btn-skin').onclick = function () {
    $('skin-panel').hidden = !$('skin-panel').hidden;
    renderSkinPanel();
  };
  $('skin-close').onclick = function () { $('skin-panel').hidden = true; };

  /* ============================================================
     立绘微调（大小 / 垂直位置），记在 localStorage
     ============================================================ */
  var TUNE_DEF = { h: 78, y: 0, o: 100, bg: 52, bd: 16, ms: 4, bl: 14, py: 0,
                   auto: true, fx: true, fav: 80, rndskin: false,
                   keepAll: false, lp: 20, lt: 20 };
  function applyTune(t) {
    var R = document.documentElement.style;
    R.setProperty('--portrait-h', t.h + '%');
    R.setProperty('--portrait-y', t.y + '%');
    R.setProperty('--dlg-alpha', (t.o / 100).toFixed(2));
    R.setProperty('--dlg-bg', 'rgba(15,20,28,' + (t.bg / 100).toFixed(2) + ')');
    R.setProperty('--dlg-border', 'rgba(255,255,255,' + (t.bd / 100).toFixed(2) + ')');
    $('v-h').textContent = t.h + '%'; $('t-h').value = t.h;
    $('v-y').textContent = t.y + '%'; $('t-y').value = t.y;
    $('v-o').textContent = t.o + '%'; $('t-o').value = t.o;
    $('v-bg').textContent = t.bg + '%'; $('t-bg').value = t.bg;
    $('v-bd').textContent = t.bd + '%'; $('t-bd').value = t.bd;
    $('v-ms').textContent = t.ms; $('t-ms').value = t.ms;
    $('v-fav').textContent = t.fav; $('t-fav').value = t.fav;
    eng.cfg.initialFavor = t.fav;
    $('t-keepall').checked = !!t.keepAll;
    $('v-lp').textContent = t.lp; $('t-lp').value = t.lp;
    $('v-lt').textContent = t.lt; $('t-lt').value = t.lt;
    $('t-lp').disabled = $('t-lt').disabled = !!t.keepAll;
    if (window.Phone) Phone.limits({ posts: t.lp, trends: t.lt, keepAll: t.keepAll });
    R.setProperty('--dlg-blur', t.bl + 'px');
    R.setProperty('--dlg-pos-y', t.py);
    $('v-bl').textContent = t.bl + 'px'; $('t-bl').value = t.bl;
    $('v-py').textContent = t.py + '%'; $('t-py').value = t.py;
    $('t-auto').checked = !!t.auto;
    $('t-fx').checked = t.fx !== false;
    $('t-rndskin').checked = !!t.rndskin;
    eng.cfg.randomSkin = !!t.rndskin;
    fxOn = t.fx !== false;
    document.documentElement.classList.toggle('dlg-auto', !!t.auto);
    eng.cfg.maxStage = t.ms;
    refreshDlgHeight();
  }

  /* 动态高度。
     不能用「先设 height:auto 再量」那一套：对话框带 backdrop-filter，
     每次往返都会触发一次强制重排，浏览器会把滤镜区域刷成白条闪一下。
     改成直接量内容高度，一次性写死像素值，全程不出现 auto。 */
  var dlgHeightPending = false;
  function refreshDlgHeight() {
    if (dlgHeightPending) return;
    dlgHeightPending = true;
    requestAnimationFrame(function () {
      dlgHeightPending = false;
      var dlg = $('dialogue');
      if (!document.documentElement.classList.contains('dlg-auto')) {
        dlg.classList.remove('is-capped');
        dlg.style.height = '';
        return;
      }
      var cs = getComputedStyle(dlg);
      var pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) +
                parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      /* 选项区在 #dlg-body 外面，不算进去的话会溢出对话框 */
      /* 用 scrollHeight 不用 offsetHeight：对话框本身太矮时选项区已经被压扁了，
         量到的是压扁后的高度，算出来的对话框就一直偏矮（小屏上选项会盖住正文） */
      var extra = choicesEl.hidden ? 0 : (choicesEl.scrollHeight + 10);
      var need = Math.ceil(bodyEl.scrollHeight + extra + pad);
      /* 手机上对话框最多占半屏，不然人全被挡住（横屏本来就矮） */
      var withChoices = !choicesEl.hidden;
      var capK = isPortraitPhone() ? (withChoices ? 0.62 : 0.5)
               : H.classList.contains('m-land') ? (withChoices ? 0.7 : 0.56) : 0.72;
      var maxH = Math.max(120, Math.floor($('stage').clientHeight * capK));
      if (need > maxH) { dlg.classList.add('is-capped'); dlg.style.height = maxH + 'px'; }
      else { dlg.classList.remove('is-capped'); dlg.style.height = need + 'px'; }
    });
  }
  function readTune() {
    return Object.assign({}, TUNE_DEF, GalStore.local('gal_tune') || {});
  }
  function writeTune() {
    var t = { h: +$('t-h').value, y: +$('t-y').value, o: +$('t-o').value,
              bg: +$('t-bg').value, bd: +$('t-bd').value, ms: +$('t-ms').value,
              bl: +$('t-bl').value, py: +$('t-py').value,
              auto: $('t-auto').checked, fx: $('t-fx').checked,
              rndskin: $('t-rndskin').checked,
              fav: +$('t-fav').value, keepAll: $('t-keepall').checked,
              lp: +$('t-lp').value, lt: +$('t-lt').value };
    GalStore.local('gal_tune', t); applyTune(t);
  }
  ['t-h','t-y','t-o','t-bg','t-bd','t-ms','t-bl','t-py','t-fav','t-lp','t-lt']
    .forEach(function (id) {
    $(id).addEventListener('input', writeTune);
  });
  $('t-auto').addEventListener('change', writeTune);
  $('t-fx').addEventListener('change', writeTune);
  $('t-rndskin').addEventListener('change', writeTune);
  $('t-keepall').addEventListener('change', function () { writeTune(); renderPhone(); });
  $('t-reset').onclick = function () { GalStore.local('gal_tune', TUNE_DEF); applyTune(TUNE_DEF); };
  applyTune(readTune());

  /* ============================================================
     设置面板
     ============================================================ */
  function loadCfgToForm() {
    var c = GalAPI.loadConfig();
    $('cfg-protocol').value = c.protocol;
    $('cfg-base').value = c.baseUrl; $('cfg-key').value = c.apiKey;
    $('cfg-model').value = c.model; $('cfg-temp').value = c.temperature;
    $('cfg-max').value = c.maxTokens; $('cfg-stream').checked = !!c.stream;
    $('cfg-post').value = c.postProcess || 'auto'; $('cfg-prefill').value = c.prefillMode || 'auto';
    $('cfg-user').value = GalStore.local('gal_username') || '指挥官';
  }
  function saveCfgFromForm() {
    GalAPI.saveConfig({
      protocol: $('cfg-protocol').value, baseUrl: $('cfg-base').value.trim(),
      apiKey: $('cfg-key').value.trim(), model: $('cfg-model').value.trim(),
      temperature: parseFloat($('cfg-temp').value) || 1,
      maxTokens: parseInt($('cfg-max').value, 10) || 4096,
      stream: $('cfg-stream').checked,
      postProcess: $('cfg-post').value || 'auto',
      prefillMode: $('cfg-prefill').value || 'auto'
    });
    GalStore.local('gal_username', $('cfg-user').value.trim() || '指挥官');
  }
  ['cfg-protocol', 'cfg-base', 'cfg-key', 'cfg-model', 'cfg-temp', 'cfg-max', 'cfg-stream', 'cfg-user', 'cfg-post', 'cfg-prefill']
    .forEach(function (id) { $(id).addEventListener('change', saveCfgFromForm); });

  /* 模型下拉：以前用 <datalist>，可模型框里一旦有字，浏览器只显示「和这几个字匹配」的项，
     看起来就是「拉取了但什么都没有」；手机上 datalist 干脆不弹。换成真正的 <select>。 */
  function fillModelSelect(list) {
    var sel = $('cfg-model-sel');
    var cur = $('cfg-model').value.trim();
    if (!list || !list.length) { sel.hidden = true; return; }
    var has = list.indexOf(cur) !== -1;
    sel.innerHTML = '<option value="">— 这个接口可用的模型（' + list.length + ' 个），点这里选 —</option>' +
      list.map(function (m) {
        return '<option value="' + esc(m) + '"' + (m === cur ? ' selected' : '') + '>' + esc(m) + '</option>';
      }).join('');
    if (!has) sel.value = '';
    sel.hidden = false;
    $('model-list').innerHTML = list.map(function (m) { return '<option value="' + esc(m) + '">'; }).join('');
    try { GalStore.local('gal_models_cache', { base: $('cfg-base').value.trim(), list: list }); } catch (e) {}
  }
  $('cfg-model-sel').onchange = function () {
    var v = this.value;
    if (!v) return;
    $('cfg-model').value = v;
    saveCfgFromForm();
    var n = $('test-note');
    n.className = 'note';
    n.textContent = '已选 ' + v + '，再点一次「测试连接」验证它能不能对话。';
  };
  /* 上次拉到的列表留着，下次打开不用重拉 */
  (function () {
    try {
      var c = GalStore.local('gal_models_cache');
      if (c && c.list && c.base === GalAPI.loadConfig().baseUrl) fillModelSelect(c.list);
    } catch (e) {}
  })();

  async function runProbe(listOnly) {
    saveCfgFromForm();
    var n = $('test-note');
    var btns = [$('btn-test'), $('btn-models')];
    btns.forEach(function (b) { b.disabled = true; });
    n.className = 'note';
    n.textContent = listOnly ? '拉取模型列表…' : '连接中：先拉模型列表，再发一句话试试…';
    try {
      var r = listOnly
        ? await GalAPI.listModels().then(function (m) { return { models: m }; },
            function (e) { return { models: [], listError: String(e.message || e).split('\n')[0] }; })
        : await GalAPI.probe();
      fillModelSelect(r.models);
      var parts = [], cls = 'ok';
      if (r.models && r.models.length) parts.push('拿到 ' + r.models.length + ' 个模型');
      else if (r.listError) parts.push('模型列表拉不到（' + r.listError + '）');
      else parts.push('接口没有返回模型列表');

      if (listOnly) {
        if (!(r.models && r.models.length)) cls = r.listError ? 'bad' : 'warn';
        else parts.push('在下面的下拉框里选');
      } else if (!r.model) {
        cls = r.models.length ? 'warn' : 'bad';
        parts.push(r.models.length ? '还没选模型：在下面的下拉框里挑一个，再点一次测试' : '也没填模型名，没法测对话');
      } else if (r.chat) {
        if (r.chat.verified) {
          parts.push('对话通了 ' + r.chat.ms + 'ms，' + r.model + ' 正确复述了随机校验码');
        } else if (!r.chat.reply) {
          cls = 'warn';
          parts.push('接口通了（' + r.chat.ms + 'ms），但回复为空：推理模型可能把字数全花在思考上了');
        } else {
          cls = 'warn';
          parts.push('接口通了，但模型没照抄随机校验码（回了「' + r.chat.reply.slice(0, 40) + '」）。' +
            '可能是中转给的不是这个模型、回的是缓存，或者这个模型不太听指令');
        }
        if (r.models.length && r.models.indexOf(r.model) === -1) {
          parts.push('注意：' + r.model + ' 不在列表里，但能用');
        }
        if (r.chat.finish && r.chat.finish.info && r.chat.finish.info.kind === 'filter') {
          cls = 'warn'; parts.push(r.chat.finish.info.text);
        }
      } else {
        cls = 'bad';
        parts.push('对话失败：' + r.chatError);
        if (r.models.length && r.models.indexOf(r.model) === -1) {
          parts.push('「' + r.model + '」不在这个接口的模型列表里，换一个');
        }
      }
      n.className = 'note ' + cls;
      n.textContent = parts.join('；');
    } catch (e) {
      n.className = 'note bad';
      n.textContent = String(e.message || e).split('\n')[0];
    } finally {
      btns.forEach(function (b) { b.disabled = false; });
    }
  }
  $('btn-models').onclick = function () { runProbe(true); };
  $('btn-test').onclick = function () { runProbe(false); };

  /* ============================================================
     素材载入
     ============================================================ */
  var loaded = { card: false, preset: false };

  /** 宽松解析：Windows 记事本存的 JSON 开头常带 BOM；手改过的预设常留尾逗号；
      从聊天里复制的会包一层 ```json。这些 JSON.parse 都直接报错，玩家只看到「解析失败」。 */
  function parseJSONLoose(text) {
    var t = String(text || '').replace(/^\uFEFF/, '').trim();
    try { return JSON.parse(t); } catch (e0) {
      var f = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (f) t = f[1].trim();
      /* 只在字符串外面删尾逗号 */
      var out = '', inStr = false, esc2 = false;
      for (var i = 0; i < t.length; i++) {
        var ch = t[i];
        if (inStr) {
          out += ch;
          if (esc2) esc2 = false; else if (ch === '\\') esc2 = true; else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') { inStr = true; out += ch; continue; }
        if (ch === ',') {
          var j = i + 1;
          while (j < t.length && /\s/.test(t[j])) j++;
          if (t[j] === '}' || t[j] === ']') continue;
        }
        out += ch;
      }
      try { return JSON.parse(out); } catch (e1) { throw e0; }
    }
  }

  function readJSON(input, cb) {
    input.onchange = function () {
      var f = input.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try { cb(parseJSONLoose(r.result), f.name); input.parentNode.classList.add('ok'); }
        catch (e) { $('assets-note').innerHTML = '<span class="bad">解析失败：' + esc(e.message) + '</span>'; }
      };
      r.readAsText(f);
    };
  }
  function noteAssets() {
    var rx = eng.regexList('display').filter(function (r) { return !r.disabled; });
    /* 酒馆助手（Tavern Helper）的脚本是 JS，这里不运行 —— 跑别人预设里的代码等于把密钥交出去 */
    var th = eng.preset && eng.preset.extensions && eng.preset.extensions.tavern_helper;
    var thN = th && Array.isArray(th.scripts) ? th.scripts.length : 0;
    var rxP = rx.filter(function (r) { return r.source === 'preset'; }).length;
    var rxU = rx.length - rxP;
    var html = '世界书 <b>' + eng.pool.length + '</b> 条 ｜ 预设 <b>' +
      (loaded.preset ? PromptBuilder.parsePreset(eng.preset).order.length : 0) + '</b> 块' +
      (rx.length ? ' ｜ 正则 <b>' + rx.length + '</b> 条' +
        '<span class="dim">（预设自带 ' + rxP + (rxU ? ' · 导入 ' + rxU : '') + '，默认按它们自己的开关启用）</span>' : '') +
      (thN ? ' ｜ <span class="dim">酒馆助手脚本 ' + thN + ' 个（JS，不运行）</span>' : '') +
      (loaded.card ? '' : ' <span class="warn">— 还缺角色卡</span>');
    /* 从卡里抽出来多少立绘 —— 这是用户最关心的一件事（"我的图呢"），
       载完卡就该直接看见数字，而不是等进了游戏发现舞台是空的。 */
    if (loaded.card) {
      var st = eng.resStats;
      var R = window.RESOURCE || {};
      var chars = Object.keys(R.characters || {}).length;
      var defs = Object.keys(R.defaults || {}).length;
      var locs = Object.keys(R.scenes || {}).length;
      if (chars || defs || locs) {
        html += ' ｜ 立绘 <b>' + (chars + defs) + '</b> 角色 ｜ 场景 <b>' + locs + '</b> 地点';
        if (st && !st.found) html += ' <span class="dim">（来自预置素材包）</span>';
      } else {
        html += ' <span class="warn">— 这张卡里没找到立绘表，舞台会是空的</span>';
      }
    }
    $('assets-note').innerHTML = html;
    $('btn-start').disabled = !loaded.card;
    if (typeof renderBoot === 'function') renderBoot();
  }
  function fillOpenings(card) {
    var d = card.data || card;
    var list = [].concat(d.first_mes ? [{ n: '默认开场', t: d.first_mes }] : [],
      (d.alternate_greetings || []).map(function (g, i) {
        var m = g.match(/『([^』]*)』/);
        return { n: (i + 1) + '. ' + (m ? m[1].replace(/✨/g, '').trim().slice(0, 40) : '开场 ' + (i + 1)), t: g };
      }));
    $('opening-sel').innerHTML = list.map(function (o, i) {
      return '<option value="' + i + '">' + esc(o.n) + '</option>';
    }).join('') || '<option value="">（无开场白）</option>';
    $('opening-sel')._list = list;
  }
  readJSON($('f-card'), function (j, name) {
    eng.loadCard(j); loaded.card = true; fillOpenings(j); syncImageRule();
    GalStore.putCard(j, name).catch(function () {}); noteAssets();
  });
  readJSON($('f-preset'), function (j, name) {
    eng.loadPreset(j); loaded.preset = true; presetName = name || '';
    GalStore.putPreset(j, name).catch(function () {}); noteAssets();
  });
  readJSON($('f-wi'), function (j) { eng.addWorldbook(j); noteAssets(); });

  /* 单独导入的正则：可多选，追加进已有的；存 localStorage（正则都很短） */
  function loadUserRegex() {
    var list = GalStore.local('gal_user_regex');
    eng.setUserRegex(Array.isArray(list) ? list : []);
    eng.regexOff = GalStore.local('gal_regex_off') || {};
  }
  $('f-regex').onchange = function () {
    var files = Array.prototype.slice.call(this.files || []);
    if (!files.length) return;
    var input = this;
    Promise.all(files.map(function (f) {
      return f.text().then(function (t) {
        try { return GalRegex.fromImport(parseJSONLoose(t)); } catch (e) { return []; }
      });
    })).then(function (lists) {
      var add = [].concat.apply([], lists);
      var cur = GalStore.local('gal_user_regex') || [];
      /* 同名的覆盖，不重复堆 */
      add.forEach(function (r) {
        var k = r.scriptName || r.findRegex;
        cur = cur.filter(function (x) { return (x.scriptName || x.findRegex) !== k; });
        cur.push(r);
      });
      GalStore.local('gal_user_regex', cur);
      loadUserRegex();
      input.parentNode.classList.add('ok');
      input.value = '';
      noteAssets();
      if (typeof renderPreset === 'function') renderPreset();
    });
  };

  /* ============================================================
     开始 / 继续
     ============================================================ */
  function enterGame() {
    $('boot').classList.add('gone');
    ['dialogue', 'inputbar', 'toolbar'].forEach(function (id) { $(id).hidden = false; });
  }

  /**
   * 退出到开场。先把当前周目存好，再回引导页 —— 在那里可以挑别的存档、
   * 或者换个开局重开。舞台要清干净，否则下次进来会看见上一局的残留立绘。
   */
  async function leaveGame() {
    if (eng.log.length || eng.history.length) {
      try { await GalStore.saveSlot(autoSlotId(), snapshot()); }
      catch (e) { console.warn('[存档] 退出前保存失败', e); }
    }
    closePhone();
    closeSaves();
    ['skin-panel', 'cg-panel', 'cg'].forEach(function (id) {
      var el = $(id); if (el) el.hidden = true;
    });
    ['dialogue', 'inputbar', 'toolbar'].forEach(function (id) { $(id).hidden = true; });
    live.forEach(function (r) { r.el.remove(); }); live.clear();
    stageNow = []; lastBgUrl = null;
    $('boot').classList.remove('gone');
    await renderRuns();
  }

  /** 开场引导左栏的周目列表 */
  async function renderRuns() {
    var list;
    try { list = await GalStore.listSaves(); }
    catch (e) { list = []; }
    list = list.filter(function (s) { return s.turns > 0; });
    /* 存档树之后一个开局有很多节点。这里每个开局只列一行（它的最新进度），
       要读中间的节点去游戏里的存档界面 */
    var trees = SaveTree.buildTrees(list);
    var nodeCount = {};
    trees.forEach(function (g) { nodeCount[(g.pointer || g.latest).id] = g.nodeCount; });
    list = trees.map(function (g) { return g.pointer || g.latest; }).filter(Boolean);

    var box = $('boot-runs'), body = $('boot-runs-body');
    if (!box || !body) return list;
    if (!list.length) { box.hidden = true; $('btn-continue').hidden = true; return list; }

    box.hidden = false;
    /* 最近那一份单独提到上面，点一下直接续上 —— 最常见的操作不该要先读列表 */
    $('btn-continue').hidden = false;
    $('btn-continue').dataset.slot = list[0].id;
    $('resume-meta').textContent =
      (list[0].opening || '未命名开局') + ' · ' + list[0].title + ' · 第 ' +
      (list[0].round != null ? list[0].round : list[0].turns) + ' 轮';

    body.innerHTML = list.map(function (s) {
      return '<button type="button" class="runrow" data-run="' + esc(s.id) + '">' +
        '<div class="ri"><b>' + esc(s.opening || (s.auto ? '未命名开局' : s.id)) + '</b>' +
        '<span>' + esc(s.title) + ' · 第 ' + (s.round != null ? s.round : s.turns) + ' 轮 · ' +
        (nodeCount[s.id] > 1 ? nodeCount[s.id] + ' 个存档 · ' : '') +
        new Date(s.at || 0).toLocaleString() + '</span></div>' +
        '<i class="tag">' + (s.auto ? '自动' : '手动') + '</i></button>';
    }).join('');
    return list;
  }

  $('boot-runs-body').onclick = async function (e) {
    var btn = e.target.closest('[data-run]');
    if (!btn) return;
    var id = btn.getAttribute('data-run');
    restoreFrom(await GalStore.loadSlot(id), id);
  };

  $('btn-start').onclick = function () {
    saveCfgFromForm();
    if (!loaded.preset) {
      $('boot-note').innerHTML = '<span class="warn">没载入预设 —— 模型多半不会按剧本格式输出。' +
        '仍要开始的话再点一次。</span>';
      loaded.preset = 'warned'; return;
    }
    var list = $('opening-sel')._list || [];
    var pick = list[parseInt($('opening-sel').value, 10)] || null;
    currentOpening = pick ? pick.n : null;
    runId = newRunId();          // 新周目，自动存档另开一个槽，不碰上一局
    activeNode = null;           // 新的一棵存档树
    turnStack = [];
    eng.macroVars = {};
    eng.history = [];
    eng.log = [];
    eng.phoneSent = [];
    eng.phoneSeq = 0;        // 忘了清它，新周目的手机消息会接着上一局的编号往上加
    if (pick) eng.seedVarsFromOpening(pick.t);   // 开局先把地点/时段/在场角色填好
    enterGame();
    updateTurnUI();
    if (pick) {
      eng.history.push({ role: 'assistant', content: pick.t });
      var r = eng.processOutput(pick.t);
      lastResult = r; lastRaw = pick.t;
      speakerEl.className = 'narrator'; speakerEl.textContent = '系统';
      textEl.textContent = '正在加载立绘和背景…';
      var myRun = runId;
      waitImages(r.modules).then(function () {
        stopSpinner();
        if (runId !== myRun) return;           // 等图的时候玩家已经退出 / 换了一局
        play(r.modules);
        /* 开场本身也是一个节点（树根）：以后想换个方向从头来，读它就行 */
        if (treeOn()) {
          var rootNode = SaveTree.newId('n');
          GalStore.saveSlot('node:' + rootNode,
            snapshot({ type: 'auto', nodeId: rootNode, parent: '', name: '开场' })).catch(function () {});
          activeNode = rootNode;
        }
        autosave({ skipNode: true });
      });
    } else {
      speakerEl.className = 'narrator'; speakerEl.textContent = '系统';
      textEl.textContent = '输入一句话开始。';
    }
  };

  /* 续最近的那一份。槽名由 renderRuns() 填进 dataset，
     退回 'auto' 是为了兼容老版本留下的那个全局槽。 */
  $('btn-continue').onclick = async function () {
    var id = this.dataset.slot || 'auto';
    restoreFrom(await GalStore.loadSlot(id), id);
  };

  $('btn-exit').onclick = function () { leaveGame(); };
  $('btn-saves').onclick = openSaves;
  $('sv-close').onclick = closeSaves;
  $('save-modal').addEventListener('click', function (e) { if (e.target === this) closeSaves(); });
  $('do-save').onclick = doSave;
  $('save-modal').addEventListener('click', slotClick);
  $('btn-reroll').onclick = function () { rerollLast(); };
  $('btn-undo').onclick = function () { undoLast(); };
  $('ver-prev').onclick = function () { switchVariant(-1); };
  $('ver-next').onclick = function () { switchVariant(1); };

  /* ============================================================
     绑定
     ============================================================ */
  $('btn-abort').onclick = function (e) {
    e.stopPropagation();
    if (imgSkip) { imgSkip(); return; }        // 在等图：不等了，先演
    if (abortCtl) abortCtl.abort();
  };
  $('dialogue').onclick = advance;
  $('send').onclick = function () { submit(); };
  $('usertext').addEventListener('keydown', function (e) {
    if (composing(e)) return;                   // 正在选词，别把半截内容发出去
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  document.addEventListener('keydown', function (e) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); advance(); }
    else if (e.key === 'Escape') {
      closePhone();
      closeSaves();
      var am = $('alias-modal'); if (am) am.remove();
    }
  });
  $('usertext').addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 110) + 'px';
  });
  $('btn-phone').onclick = function () {
    if ($('phone-overlay').hidden) openPhone(); else closePhone();
  };
  $('phone-overlay').onclick = function (e) { if (e.target === this) closePhone(); };
  $('ph-m-back').onclick = function (e) { e.stopPropagation(); phoneBack(); };
  $('ph-m-close').onclick = function (e) { e.stopPropagation(); closePhone(); };
  $('nav-prev').onclick = function (e) { e.stopPropagation(); back(); };
  $('nav-next').onclick = function (e) { e.stopPropagation(); advance(); };
  $('nav-first').onclick = function (e) { e.stopPropagation(); goTo(0, { instant: true }); };
  $('nav-last').onclick = function (e) { e.stopPropagation(); goTo(total() - 1, { instant: true }); };
  window.addEventListener('resize', function () { layout(); refreshDlgHeight(); });
  bindBoot();

  /* 调试钩子：浏览器控制台里可以 __gal.eng.vars / __gal.eng.pool 看内部状态，
     冒烟测试也靠它注入角色卡。 */
  window.__gal = {
    eng: eng,
    reload: function () { renderPhone(); renderBook(); renderPreset(); renderVars(); },
    goTo: function (i) { goTo(i, { instant: true }); },
    /* 出图相关的钩子，调试和冒烟测试都用得上 */
    nearestCG: nearestCG,
    gotoBoot: gotoBoot, bootDone: bootDone,
    imgCfg: imgCfg,
    redraw: function (i) { return redrawLine(i == null ? qi : i); },
    cgSticky: cgSticky,
    /* 存档相关的钩子，端到端测试要用 */
    autosave: autosave, leaveGame: leaveGame, renderRuns: renderRuns,
    autoSlotId: function () { return autoSlotId(); },
    imgFails: function () { return imgFails.slice(); },
    toast: toast,
    /* 重roll / 存档树，测试要用 */
    rerollLast: rerollLast, undoLast: undoLast, switchVariant: switchVariant,
    openSaves: openSaves, renderSlots: renderSlots, doSave: doSave, pruneAuto: pruneAuto,
    turnStack: function () { return turnStack; },
    activeNode: function () { return activeNode; },
    submit: function (t) { return submit(t); },
    setDevice: setDevice, setOrient: setOrient, setTbHidden: setTbHidden,
    stageFor: stageFor, phoneBack: phoneBack
  };

  /* 恢复上次的素材与配置 */
  onLayoutChange();           // 设备选择按钮的高亮、输入框提示语
  loadCfgToForm();
  loadUserRegex();
  Promise.all([GalStore.getCard(), GalStore.getPreset(), GalStore.loadSlot('auto')])
    .then(function (r) {
      if (r[0] && r[0].json) {
        eng.loadCard(r[0].json); loaded.card = true; fillOpenings(r[0].json); syncImageRule();
        $('f-card').parentNode.classList.add('ok');
      }
      if (r[1] && r[1].json) {
        eng.loadPreset(r[1].json); loaded.preset = true; presetName = r[1].name || '';
        $('f-preset').parentNode.classList.add('ok');
      }
      noteAssets();
      renderRuns();      // 列出全部周目，顺便决定「继续上次」露不露
    })
    .catch(function () { noteAssets(); });
})();
