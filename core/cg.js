/* ============================================================
 * core/cg.js —— CG 由文生图驱动
 *
 * 原来的设计（天青那套）是 CG 查素材表：<CG|名字> → 表里找图。
 * 我们没有 CG 素材表（juus 卡的是成人内容，没接），所以反过来：
 * **CG 就是这一轮现生成的图**。不用手工准备素材，剧情走到哪画到哪。
 *
 * 一轮的流程：
 *   1. pickAnchors()  这一轮哪几句值得配图
 *   2. Snapshot.resolveShots()  一次请求拿回 N 个镜头
 *   3. ImageGen.generate()      逐张出图（NAI 会限流，所以串行不并发）
 *   4. Gallery.put()            存起来，把 id 挂到那句上
 *
 * 全程异步、不阻塞剧情推进 —— NAI 出一张要十几秒到半分钟，
 * 让玩家干等是不可接受的。所以是「先演，图后到」：
 * 图到了如果玩家正好停在那句，界面自己补上；翻回去看时也在。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     一、挑锚点

     一轮十几句，配 1~2 张图，挑哪几句？按「画面变化量」打分：
       · 换了背景 —— 最强的信号，新地点必然是新画面
       · 有人上台 —— 阵容变了
       · 台上人多 —— 群像比独角戏有画面感
       · 旁白 —— 旁白写的就是画面描写，台词写的是对话
       · 长句 —— 信息量大
     然后挑最高的 n 句，但强制彼此隔开，免得两张图画的是连着的两句。
     ============================================================ */
  function score(m, prev) {
    var s = 0;
    var prevLoc = prev && prev.bg ? prev.bg.loc : null;
    if (m.bg && m.bg.loc && m.bg.loc !== prevLoc) s += 3;
    var now = (m.stage || []).map(function (c) { return c.name; });
    var was = prev ? (prev.stage || []).map(function (c) { return c.name; }) : [];
    var entered = now.filter(function (n) { return was.indexOf(n) < 0; });
    if (entered.length) s += 2;
    if (now.length >= 2) s += 1;
    if (now.length >= 3) s += 0.5;
    if (m.narration) s += 1.5;
    var len = String(m.text || '').length;
    s += Math.min(1.5, len / 60);
    return s;
  }

  /**
   * modules 是这一轮的句子数组，n 是要几张。
   * 返回在 modules 里的下标数组，从小到大。
   */
  function pickAnchors(modules, n) {
    modules = modules || [];
    n = Math.max(0, Math.min(4, n || 0));
    if (!n || !modules.length) return [];
    if (modules.length <= n) {
      return modules.map(function (_, i) { return i; });
    }

    var ranked = modules.map(function (m, i) {
      return { i: i, s: score(m, i ? modules[i - 1] : null) };
    }).sort(function (a, b) {
      return b.s - a.s || a.i - b.i;
    });

    /* 两张图至少隔开这么多句，免得画面挨着重复 */
    var gap = Math.max(1, Math.floor(modules.length / (n + 1)));
    var picked = [];
    for (var k = 0; k < ranked.length && picked.length < n; k++) {
      var idx = ranked[k].i;
      var tooClose = picked.some(function (p) { return Math.abs(p - idx) < gap; });
      if (!tooClose) picked.push(idx);
    }
    /* 间隔条件太严时补齐 */
    for (var j = 0; j < ranked.length && picked.length < n; j++) {
      if (picked.indexOf(ranked[j].i) < 0) picked.push(ranked[j].i);
    }
    return picked.sort(function (a, b) { return a - b; });
  }

  /* ============================================================
     二、跑一轮

     opt = {
       eng, modules, startIndex,   // startIndex = 这批句子在 eng.log 里的起点
       body,                       // 清洗后的正文，给解析用
       inlinePrompts,              // 正文里抠出来的 <image>（有就零成本）
       cfg,                        // 文生图配置
       quiet,                      // (prompt, opt) => Promise<string>
       onUpdate                    // 进度回调
     }
     ============================================================ */
  var running = null;      // 当前轮的取消句柄，新一轮开始时掐掉上一轮

  function notify(fn, evt) {
    if (typeof fn === 'function') { try { fn(evt); } catch (e) {} }
  }

  async function runTurn(opt) {
    opt = opt || {};
    var cfg = opt.cfg || {};
    var eng = opt.eng;
    var modules = opt.modules || [];
    var onUpdate = opt.onUpdate;

    var want = Math.max(0, Math.min(4, cfg.perTurn == null ? 1 : cfg.perTurn));
    if (!cfg.enabled || !want || !modules.length) return { images: [], skipped: true };

    /* 上一轮还在出图就掐掉 —— 玩家已经翻篇了，旧图没意义还占额度 */
    if (running) { try { running.abort(); } catch (e) {} }
    var ctl = new global.AbortController();
    running = ctl;

    var anchors = pickAnchors(modules, want);
    notify(onUpdate, { type: 'start', count: anchors.length, anchors: anchors });

    /* ---- 解析：整轮一次请求 ---- */
    var vars = (eng && eng.vars) || {};
    var ppl = vars.人物 || {};
    var cast = Object.keys(ppl).filter(function (n) { return ppl[n] && ppl[n].在场; });
    var qctx = {};
    if (eng && typeof eng.quietContext === 'function') {
      try { qctx = eng.quietContext(opt.body || '', { who: cast[0] || '', recentLines: 6 }) || {}; }
      catch (e) { qctx = {}; }
    }

    var resolved;
    try {
      resolved = await global.Snapshot.resolveShots({
        body: opt.body || '',
        shots: anchors.length,
        mode: cfg.promptMode || 'auto',
        inlinePrompts: opt.inlinePrompts || [],
        quiet: opt.quiet,
        style: cfg.stylePrompt || '',
        loc: vars.地点 || '',
        period: (vars.时间 && vars.时间.时段) || '',
        cast: cast,
        lore: qctx.lore || '',
        scene: qctx.scene || ''
      });
    } catch (e) {
      notify(onUpdate, { type: 'error', stage: 'snapshot', message: (e && e.message) || String(e) });
      if (running === ctl) running = null;
      return { images: [], error: e };
    }
    if (ctl.signal.aborted) { return { images: [], aborted: true }; }

    notify(onUpdate, {
      type: 'resolved', source: resolved.source,
      warning: resolved.warning, shots: resolved.shots.length
    });

    /* ---- 出图：串行。NAI 并发容易 429，而且串行还能中途取消 ---- */
    var out = [];
    for (var i = 0; i < anchors.length; i++) {
      if (ctl.signal.aborted) break;
      var ctx = resolved.shots[i];
      if (!ctx) continue;
      var logIndex = (opt.startIndex || 0) + anchors[i];

      notify(onUpdate, { type: 'generating', index: i, total: anchors.length, logIndex: logIndex });

      try {
        var img = await global.ImageGen.generate(cfg, {
          context: ctx,
          prompt: ctx.scenePrompt,
          negativePrompt: cfg.negativePrompt || '',
          size: cfg.size,
          signal: ctl.signal
        });
        if (ctl.signal.aborted) break;

        var id = await global.Gallery.put({
          src: img.src,
          mimeType: img.mimeType,
          prompt: img.prompt,
          negativePrompt: img.negativePrompt,
          model: img.model,
          backend: img.backend,
          seed: img.seed,
          title: ctx.title || '',
          turn: (eng && eng.log[logIndex] && eng.log[logIndex].turn),
          logIndex: logIndex,
          source: resolved.source
        });

        /* 挂到那一句上。存档里存的是这个 id，不是图。 */
        if (eng && eng.log[logIndex]) eng.log[logIndex].cg = id;
        out.push({ id: id, logIndex: logIndex, title: ctx.title || '' });
        notify(onUpdate, { type: 'image', id: id, logIndex: logIndex, index: i, title: ctx.title || '' });
      } catch (e) {
        notify(onUpdate, {
          type: 'error', stage: 'generate', index: i, logIndex: logIndex,
          message: (e && e.message) || String(e)
        });
        /* 一张失败不影响下一张 —— 除非是配置问题，那就整轮停掉 */
        if (/没开|没填|还没实装/.test(String(e && e.message))) break;
      }
    }

    if (running === ctl) running = null;
    notify(onUpdate, { type: 'done', images: out, source: resolved.source });
    return { images: out, source: resolved.source, warning: resolved.warning };
  }

  function cancel() {
    if (running) { try { running.abort(); } catch (e) {} running = null; }
  }
  function isRunning() { return !!running; }

  /** 重画某一句：删掉旧图，重新出一张 */
  async function regenerate(opt) {
    opt = opt || {};
    var eng = opt.eng, logIndex = opt.logIndex, cfg = opt.cfg || {};
    var m = eng && eng.log[logIndex];
    if (!m) throw new Error('找不到这一句。');

    var old = m.cg;
    var res = await runTurn({
      eng: eng, modules: [m], startIndex: logIndex, body: opt.body || m.text,
      cfg: Object.assign({}, cfg, { perTurn: 1 }), quiet: opt.quiet,
      inlinePrompts: opt.inlinePrompts || [], onUpdate: opt.onUpdate
    });
    if (res.images.length && old && old !== m.cg) {
      /* 收藏过的不删 —— 玩家点了 ★ 就是明确说「这张要留着」，
         重画只是换掉这一句挂的图，不该顺手毁掉收藏。 */
      try {
        var meta = await global.Gallery.meta(old);
        if (!meta || !meta.pinned) await global.Gallery.remove(old);
      } catch (e) {}
    }
    return res;
  }

  global.CG = {
    pickAnchors: pickAnchors,
    score: score,
    runTurn: runTurn,
    regenerate: regenerate,
    cancel: cancel,
    isRunning: isRunning
  };
})(typeof window !== 'undefined' ? window : globalThis);
