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
  }

  /* ============================================================
     背景（双缓冲交叉淡入）
     ============================================================ */
  var bgFront = $('bgA'), bgBack = $('bgB'), lastBgUrl = null;
  function paintBG(url, instant) {
    if (!url || url === lastBgUrl) return;
    lastBgUrl = url;
    bgBack.style.backgroundImage = 'url("' + url + '")';
    if (instant) {
      bgBack.style.transition = 'none';
      requestAnimationFrame(function () { bgBack.style.transition = ''; });
    }
    bgBack.classList.add('show');
    bgFront.classList.remove('show');
    var t = bgFront; bgFront = bgBack; bgBack = t;
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
      var timer = setTimeout(reveal, 1500);
      function reveal() {
        if (settled) return;
        settled = true; clearTimeout(timer);
        rec.back.classList.add('show');
        rec.front.classList.remove('show');
        var t = rec.front; rec.front = rec.back; rec.back = t;
        playFx(rec.front, isEnter ? ENTER_FX : CHANGE_FX);
        res();
      }
      function ready() {
        img.onload = img.onerror = null;
        lay.style.visibility = '';
        img.decode ? img.decode().then(reveal).catch(reveal) : reveal();
      }
      function failed() {
        noteImgFail(rec.name, img.getAttribute('src'));
        /* 先退原皮 */
        if (!triedFallback && fallbackUrl && fallbackUrl !== url) {
          triedFallback = true;
          lay.style.visibility = 'hidden';
          img.src = fallbackUrl;          // onload/onerror 还挂着，会再走一轮
          return;
        }
        /* 原皮也挂了：藏掉这一层，剧情照常推进 */
        img.onload = img.onerror = null;
        lay.style.visibility = 'hidden';
        reveal();
      }
      if (img.getAttribute('src') === url && img.complete && img.naturalWidth > 0) {
        return ready();
      }
      img.onload = ready;
      img.onerror = failed;
      img.src = url;
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
      applyStage(m.sprites || []),
      new Promise(function (r) { setTimeout(r, opts.instant ? 0 : 400); })
    ]);

    staged.then(function () {
      if (token !== presentToken) return;
      if (!m.narration) highlight(m.who);
      setTimeout(function () {
        if (token !== presentToken) return;
        bodyEl.classList.remove('fading');
        speakerEl.textContent = m.narration ? '旁白' : m.who.replace('&', ' & ');
        speakerEl.className = m.narration ? 'narrator' : '';
        if (opts.instant) {            // 回看时直接出全文，不逐字
          clearInterval(typer); typing = false;
          pending = m.text; textEl.textContent = m.text;
          updateNav();
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
  async function submit(userText) {
    if (busy) return;
    var input = $('usertext');
    userText = userText != null ? userText : input.value.trim();
    if (!userText) return;
    busy = true;
    input.value = ''; input.style.height = 'auto';
    $('send').disabled = true;
    abortCtl = new AbortController();
    startSpinner();

    try {
      var persona = Editors.loadPersona();
      var res = await eng.turn(userText, {
        userName: persona.name,
        persona: persona.description,
        send: function (messages, params) {
          return GalAPI.chatWithRetry(messages, {
            params: params,
            signal: abortCtl.signal,
            onDelta: function (d, full) { lastRaw = full; },
            onRetry: function (n, total) {
              $('elapsed').textContent = ' 断线重连 ' + n + '/' + total + '…';
            }
          });
        }
      });
      lastResult = res;
      lastRaw = res.text;
      var startIdx = play(res.modules);
      autosave();
      /* 出图另起一条线，不 await —— 剧情已经能推了，图慢慢来 */
      if (startIdx != null) kickCG(res, startIdx);
      autoRegisterScenes(res.misses);
    } catch (e) {
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
    } finally {
      busy = false;
      abortCtl = null;
      $('send').disabled = false;
      stopSpinner();
      renderDebug();
      renderVars();
      renderHistory();
      renderPhone();
      refreshPhoneBadge();
    }
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
     你的第二句会跟第一句挤在一起，回复全堆到后面。 */
  function nextSeq() { return ++eng.phoneSeq; }

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
  var SECTIONS = [
    { k:'me',    t:'我的人设', d:'称呼与自我描述' },
    { k:'book',  t:'世界书',   d:'设定条目与触发' },
    { k:'pre',   t:'预设',     d:'提示词块与顺序' },
    { k:'vars',  t:'变量',     d:'场景与角色状态' },
    { k:'save',  t:'存读档',   d:'进度存取' },
    { k:'tune',  t:'外观',     d:'立绘与对话框' },
    { k:'img',   t:'文生图',   d:'NovelAI 出图与 CG' },
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
      '<div class="kt-ver">gal 引擎 · v5.20</div></nav>' +
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
      '<div class="kt-sec"><h4>新 建 存 档</h4>' +
      '<div class="kt-field"><label>存档名</label>' +
      '<input type="text" id="save-name" placeholder="留空则自动用地点+时间">' +
      '<div class="kt-hint">每轮会自动存一份到 auto 槽，这里是手动多存几个。</div></div>' +
      '<button class="kt-btn kt-btn-primary kt-btn-wide" id="do-save">保 存</button></div>' +
      '<div class="kt-sec"><h4>已 有 存 档</h4><div id="slotlist"></div></div></div>',
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
      var t = e.target.getAttribute && e.target.getAttribute('data-ptog');
      if (t) { Editors.setBlockEnabled(eng.preset, t, e.target.checked); renderPreset(); return; }
      var up = e.target.getAttribute && e.target.getAttribute('data-pup');
      var dn = e.target.getAttribute && e.target.getAttribute('data-pdn');
      if (up || dn) { Editors.moveBlock(eng.preset, up || dn, up ? -1 : 1); renderPreset(); return; }
      var row = e.target.closest('[data-pid]');
      if (row) openBlock(row.dataset.pid);
    };
    $('pre-back').onclick = function () { $('pre-split').classList.remove('show-edit'); };
    $('pre-save').onclick = function () {
      var ta = $('pre-content');
      if (!preSel || !ta) return;
      Editors.setBlockContent(eng.preset, preSel, ta.value);
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

    $('do-save').onclick = doSave;
    $('slotlist').addEventListener('click', slotClick);
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
                   save:'💾', tune:'🎚', img:'🎨', debug:'🔧', api:'⚙' };

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
    else if (k === 'save') renderSlots();
    else if (k === 'debug') renderDebug();
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
    if (cin) cin.onkeydown = function (e) { if (e.key === 'Enter') sendFromPhone(); };

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
  function renderPreset() {
    if (!eng.preset) {
      $('pre-stat').innerHTML = '<span class="warn">还没载入预设。</span>';
      $('pre-list').innerHTML = '';
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
    }).join('');
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
    if (ci) ci.onkeydown = function (e) { if (e.key === 'Enter') sendComment(); };
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

  function refreshPhoneBadge() {
    var n = phoneData().counts.total;
    $('phone-dot').hidden = !(n > phoneSeen);
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

  function snapshot() {
    return {
      title: (eng.vars.地点 || '未知地点') + ' · 第' +
             ((eng.vars.时间 && eng.vars.时间.天数) || 1) + '天',
      history: eng.history, vars: eng.vars, log: eng.log,
      phoneSent: eng.phoneSent, phoneSeq: eng.phoneSeq,
      cursor: qi, opening: currentOpening, runId: runId
    };
  }
  function autosave() {
    GalStore.saveSlot(autoSlotId(), snapshot()).catch(function (e) {
      console.warn('[存档] 自动保存失败', e);
    });
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
    currentOpening = sv.opening || null;
    /* 接着往下玩时，自动存档要落回同一个周目的槽，不能另起一个 */
    runId = sv.runId ||
            (id && id.indexOf('auto:') === 0 ? id.slice(5) : null);

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
    return true;
  }

  async function renderSlots() {
    var list;
    try { list = await GalStore.listSaves(); }
    catch (e) {
      $('slotlist').innerHTML = '<p class="bad">存档读取失败：' + esc(e.message || e) + '</p>';
      return;
    }
    var note = GalStore.backendNote();
    $('slotlist').innerHTML = (note ? '<p class="warn" style="margin-bottom:8px">' + esc(note) + '</p>' : '') +
      (list.length ? list.map(function (s) {
      return '<div class="slot"><div><b>' + esc(s.id === 'auto' ? '自动存档' : s.id) + '</b>' +
        '<div class="meta">' + esc(s.title) + ' · ' + s.turns + ' 轮 · ' +
        new Date(s.at).toLocaleString() + '</div></div><div>' +
        '<button data-load="' + esc(s.id) + '">读取</button> ' +
        (s.id === 'auto' ? '' : '<button data-ren="' + esc(s.id) + '">改名</button> ') +
        '<button data-del="' + esc(s.id) + '">删除</button></div></div>';
    }).join('') : '<p class="dim">还没有存档。开始游戏后会自动存一份。</p>');
  }
  async function slotClick(e) {
    var id = e.target.getAttribute('data-load');
    if (id) {
      restoreFrom(await GalStore.loadSlot(id), id);
      return;
    }
    var r = e.target.getAttribute('data-ren');
    if (r) {
      var nn = prompt('新的存档名', r);
      if (nn && nn.trim() && nn.trim() !== r) {
        var data = await GalStore.loadSlot(r);
        if (data) { await GalStore.saveSlot(nn.trim(), data); await GalStore.deleteSlot(r); }
      }
      renderSlots(); return;
    }
    var d = e.target.getAttribute('data-del');
    if (d) {
      if (!confirm('删除存档「' + d + '」？')) return;
      await GalStore.deleteSlot(d); renderSlots();
    }
  }
  async function doSave() {
    var name = $('save-name').value.trim();
    if (!name) {
      name = (eng.vars.地点 || '存档') + ' ' +
        new Date().toLocaleString('zh-CN', { hour12: false, month: '2-digit',
          day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/[/:]/g, '');
    }
    if (name === 'auto') name = 'auto_' + Date.now();
    await GalStore.saveSlot(name, snapshot());
    $('save-name').value = '';
    renderSlots();
  }

  /* ============================================================
     换装面板：列出在场舰娘的原皮与皮肤，点缩略图即换并锁定
     ============================================================ */
  function renderSkinPanel() {
    if ($('skin-panel').hidden) return;
    var box = $('skin-body');
    var names = stageNow.map(function (c) { return c.who; });
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
    if (m) applyStage(m.sprites || []);
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
      var extra = choicesEl.hidden ? 0 : (choicesEl.offsetHeight + 10);
      var need = Math.ceil(bodyEl.scrollHeight + extra + pad);
      var maxH = Math.max(120, Math.floor($('stage').clientHeight * 0.72));
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
    $('cfg-user').value = GalStore.local('gal_username') || '指挥官';
  }
  function saveCfgFromForm() {
    GalAPI.saveConfig({
      protocol: $('cfg-protocol').value, baseUrl: $('cfg-base').value.trim(),
      apiKey: $('cfg-key').value.trim(), model: $('cfg-model').value.trim(),
      temperature: parseFloat($('cfg-temp').value) || 1,
      maxTokens: parseInt($('cfg-max').value, 10) || 4096,
      stream: $('cfg-stream').checked
    });
    GalStore.local('gal_username', $('cfg-user').value.trim() || '指挥官');
  }
  ['cfg-protocol', 'cfg-base', 'cfg-key', 'cfg-model', 'cfg-temp', 'cfg-max', 'cfg-stream', 'cfg-user']
    .forEach(function (id) { $(id).addEventListener('change', saveCfgFromForm); });

  $('btn-models').onclick = async function () {
    saveCfgFromForm();
    var n = $('test-note');
    n.textContent = '拉取模型列表…'; n.className = 'note';
    try {
      var list = await GalAPI.listModels();
      if (!list.length) { n.className = 'note warn'; n.textContent = '端点没有返回模型列表，手填吧。'; return; }
      $('model-list').innerHTML = list.map(function (m) {
        return '<option value="' + esc(m) + '">';
      }).join('');
      n.className = 'note ok';
      n.textContent = '拿到 ' + list.length + ' 个模型，点模型框看下拉。';
      if (!$('cfg-model').value.trim()) { $('cfg-model').value = list[0]; saveCfgFromForm(); }
    } catch (e) {
      n.className = 'note bad';
      n.textContent = '拉取失败：' + String(e.message || e).split('\n')[0] + '（可以继续手填）';
    }
  };

  $('btn-test').onclick = async function () {
    saveCfgFromForm();
    var n = $('test-note');
    n.textContent = '连接中…'; n.className = 'note';
    try {
      var r = await GalAPI.test();
      n.className = 'note ok';
      n.textContent = '通了（' + r.ms + 'ms）：' + r.reply;
    } catch (e) {
      n.className = 'note bad';
      n.textContent = String(e.message || e).split('\n')[0];
    }
  };

  /* ============================================================
     素材载入
     ============================================================ */
  var loaded = { card: false, preset: false };
  function readJSON(input, cb) {
    input.onchange = function () {
      var f = input.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try { cb(JSON.parse(r.result), f.name); input.parentNode.classList.add('ok'); }
        catch (e) { $('assets-note').innerHTML = '<span class="bad">解析失败：' + esc(e.message) + '</span>'; }
      };
      r.readAsText(f);
    };
  }
  function noteAssets() {
    var html = '世界书 <b>' + eng.pool.length + '</b> 条 ｜ 预设 <b>' +
      (loaded.preset ? PromptBuilder.parsePreset(eng.preset).order.length : 0) + '</b> 块' +
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
    eng.loadPreset(j); loaded.preset = true;
    GalStore.putPreset(j, name).catch(function () {}); noteAssets();
  });
  readJSON($('f-wi'), function (j) { eng.addWorldbook(j); noteAssets(); });

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

    var box = $('boot-runs'), body = $('boot-runs-body');
    if (!box || !body) return list;
    if (!list.length) { box.hidden = true; $('btn-continue').hidden = true; return list; }

    box.hidden = false;
    /* 最近那一份单独提到上面，点一下直接续上 —— 最常见的操作不该要先读列表 */
    $('btn-continue').hidden = false;
    $('btn-continue').dataset.slot = list[0].id;
    $('resume-meta').textContent =
      (list[0].opening || '未命名开局') + ' · ' + list[0].title + ' · ' + list[0].turns + ' 轮';

    body.innerHTML = list.map(function (s) {
      return '<button type="button" class="runrow" data-run="' + esc(s.id) + '">' +
        '<div class="ri"><b>' + esc(s.opening || (s.auto ? '未命名开局' : s.id)) + '</b>' +
        '<span>' + esc(s.title) + ' · ' + s.turns + ' 轮 · ' +
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
    eng.history = [];
    eng.log = [];
    eng.phoneSent = [];
    if (pick) eng.seedVarsFromOpening(pick.t);   // 开局先把地点/时段/在场角色填好
    enterGame();
    if (pick) {
      eng.history.push({ role: 'assistant', content: pick.t });
      var r = eng.processOutput(pick.t);
      lastResult = r; lastRaw = pick.t;
      play(r.modules);
      autosave();
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

  /* ============================================================
     绑定
     ============================================================ */
  $('btn-abort').onclick = function (e) {
    e.stopPropagation();
    if (abortCtl) abortCtl.abort();
  };
  $('dialogue').onclick = advance;
  $('send').onclick = function () { submit(); };
  $('usertext').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  document.addEventListener('keydown', function (e) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); advance(); }
    else if (e.key === 'Escape') {
      closePhone();
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
    imgFails: function () { return imgFails.slice(); }
  };

  /* 恢复上次的素材与配置 */
  loadCfgToForm();
  Promise.all([GalStore.getCard(), GalStore.getPreset(), GalStore.loadSlot('auto')])
    .then(function (r) {
      if (r[0] && r[0].json) {
        eng.loadCard(r[0].json); loaded.card = true; fillOpenings(r[0].json); syncImageRule();
        $('f-card').parentNode.classList.add('ok');
      }
      if (r[1] && r[1].json) {
        eng.loadPreset(r[1].json); loaded.preset = true;
        $('f-preset').parentNode.classList.add('ok');
      }
      noteAssets();
      renderRuns();      // 列出全部周目，顺便决定「继续上次」露不露
    })
    .catch(function () { noteAssets(); });
})();
