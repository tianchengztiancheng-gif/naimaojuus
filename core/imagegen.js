/* ============================================================
 * core/imagegen.js —— 文生图后端（当前只实装 NovelAI）
 *
 * 移植自 LingYuYue1/KaiTuoYiShi 的 services/ai/imageGeneration.ts
 * 与 services/ai/novelaiPromptCompiler.ts。那边是 TypeScript + React 工程，
 * 但出图这一层是纯 fetch，不碰框架，所以逻辑可以原样搬过来。
 *
 * 为什么不是抄天青：天青自己不会出图。它的「🎨 生成」按钮做的是调酒馆的
 * 斜杠命令 /imagine，出图交给酒馆的扩展或用户装的油猴 NAI 脚本。
 * 我们没有酒馆在下面兜着，这一层必须自己写。
 *
 * 后端做成可插拔（BACKENDS 表），现在只有 novelai 一条实装，
 * 以后加 sd_webui / comfyui / openai_compatible 各补一个函数即可，
 * 上层 ImageGen.generate() 不用动。
 *
 * ✓ CORS：实测浏览器可以直连 image.novelai.net（file:// 打开的页面也行），
 *   不需要中转。baseUrl 留成可配置只是以防万一。
 *   万一哪天被拦，fetch 抛的是 TypeError «Failed to fetch» ——
 *   那一步还没到验密钥，所以 describeNetworkError() 会把它和「密钥错」分开报，
 *   不然用户会一直去换密钥。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     一、模型档案
     每个模型的官方推荐参数和 UC 预设都不一样，抄自开拓轶事的
     NOVELAI_MODEL_PROFILES。supportsCharacterPrompts 决定要不要发
     v4_prompt —— V3 没有这个字段，发了会 400。
     ============================================================ */
  var MODEL_PROFILES = {
    'nai-diffusion-4-5-full': {
      family: 'v4.5',
      qualityTags: 'very aesthetic, masterpiece, no text',
      steps: 23, cfgScale: 5,
      characterPrompts: true, prependNsfw: true,
      ucPresets: [
        { name: 'Heavy', text: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page' },
        { name: 'Light', text: 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page' },
        { name: 'Furry Focus', text: '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic' },
        { name: 'Human Focus', text: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy' },
        { name: 'None', text: '' }
      ]
    },
    'nai-diffusion-4-5-curated': {
      family: 'v4.5',
      qualityTags: 'very aesthetic, masterpiece, no text, -0.8::feet::, rating:general',
      steps: 23, cfgScale: 5,
      characterPrompts: true, prependNsfw: false,
      ucPresets: [
        { name: 'Heavy', text: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page' },
        { name: 'Light', text: 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page' },
        { name: 'Human Focus', text: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page' },
        { name: 'None', text: '' }
      ]
    },
    'nai-diffusion-4-full': {
      family: 'v4',
      qualityTags: 'no text, best quality, very aesthetic, absurdres',
      steps: 23, cfgScale: 5.5,
      characterPrompts: true, prependNsfw: true,
      ucPresets: [
        { name: 'Heavy', text: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page' },
        { name: 'Light', text: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page' },
        { name: 'None', text: '' }
      ]
    },
    'nai-diffusion-4-curated-preview': {
      family: 'v4',
      qualityTags: 'rating:general, best quality, very aesthetic, absurdres',
      steps: 23, cfgScale: 5.5,
      characterPrompts: true, prependNsfw: false,
      ucPresets: [
        { name: 'Heavy', text: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page' },
        { name: 'Light', text: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page' },
        { name: 'None', text: '' }
      ]
    },
    'nai-diffusion-3': {
      family: 'v3',
      qualityTags: 'best quality, amazing quality, very aesthetic, absurdres',
      steps: 23, cfgScale: 5,
      characterPrompts: false, prependNsfw: true,
      ucPresets: [
        { name: 'Heavy', text: 'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]' },
        { name: 'Light', text: 'lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing' },
        { name: 'Human Focus', text: 'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes' },
        { name: 'None', text: 'lowres' }
      ]
    }
  };

  function profileOf(model) {
    return MODEL_PROFILES[String(model || '').trim()] || MODEL_PROFILES['nai-diffusion-3'];
  }

  /* ============================================================
     二、默认配置

     尺寸默认 1216×832：横画幅适合当 CG，而且 1216×832 = 1,011,712 像素，
     压在 1024×1024（1,048,576）这条线以下 —— Opus 会员的免费额度看的是
     总像素和步数（≤28 步），所以这个尺寸配 23 步是**免费**的。
     改大到 1536×864 之类就会开始扣点数了，设置页里有提示。
     ============================================================ */
  var DEFAULTS = {
    enabled: false,
    backend: 'novelai',
    baseUrl: 'https://image.novelai.net',
    apiKey: '',
    model: 'nai-diffusion-4-5-full',
    size: '1216x832',
    sampler: 'k_euler_ancestral',
    noiseSchedule: 'karras',
    ucPreset: 'heavy',
    steps: 23,
    cfgScale: 5,
    seed: -1,
    parameterMode: 'model_default',   // model_default | custom
    perTurn: 1,                       // 每轮出几张
    promptMode: 'auto',               // auto = AI 每轮自己写 <image>，没写才解析
    sticky: true,                     // CG 模式：图盖住立绘一直铺着；关掉则舞台上不出 CG
    stylePrompt: '',                  // 画风词，拼在正面提示词尾部
    negativePrompt: '',               // 额外负面词
    timeoutMs: 120000,
    retries: 1
  };

  var UC_PRESET_NAMES = {
    heavy: 'Heavy', light: 'Light',
    furry_focus: 'Furry Focus', human_focus: 'Human Focus', none: 'None'
  };

  function ucPresetIndex(profile, key) {
    var want = UC_PRESET_NAMES[String(key || 'heavy').toLowerCase()];
    if (!want || want === 'Heavy') return 0;
    for (var i = 0; i < profile.ucPresets.length; i++) {
      if (profile.ucPresets[i].name === want) return i;
    }
    return profile.ucPresets.length - 1;
  }

  /* ============================================================
     三、提示词编译

     sanitize() 是这里最重要的一步。两段式解析出来的东西经常夹带脏货：
     中文残留、"NovelAI"/"workflow"/"json" 这类把自己的工作说明写进 prompt 的
     元描述、以及重复标签。全部剔掉，只留纯 ASCII 标签并去重。
     ============================================================ */
  var CJK = /[぀-ヿ㐀-鿿豈-﫿]/;
  var META = /\b(?:novelai|sd\s*webui|stable\s+diffusion|comfyui|openai(?:-compatible)?|workflow|json|payload|api|system\s+prompt)\b/i;
  var COUNT_TAG = /^\d+\s*(?:girls?|boys?|people)$/i;
  /* 模型经常把「我该怎么写 prompt」的指令原样抄进 prompt 里，逐条拦掉 */
  var CONTROL = [
    /^choose composition by final slot\b/i,
    /^(?:avatar|portrait|scene|phone wallpaper)\s*:/i,
    /^(?:output compact image tags|prefer concrete visual tags|remove plot explanation|return a clear positive prompt)\b/i,
    /^(?:but\s+)?(?:still\s+)?keep visual facts dense\b/i,
    /^use plain positive prompt\b/i,
    /^keep the prompt modular\b/i,
    /^do not output\b/i,
    /^target canvas size\s*:/i
  ];

  function segments(text) {
    return String(text == null ? '' : text)
      .replace(/\r/g, '\n').split(/[\n,;]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function sanitize(text, blocked) {
    var seen = {}, out = [];
    segments(text).forEach(function (seg) {
      if (CJK.test(seg) || META.test(seg)) return;
      for (var i = 0; i < CONTROL.length; i++) if (CONTROL[i].test(seg)) return;
      if (blocked && blocked(seg)) return;
      var ascii = seg.replace(/[^\x20-\x7e]/g, '').trim();
      if (!ascii) return;
      var key = ascii.toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      out.push(ascii);
    });
    return out.join(', ');
  }

  function joinParts() {
    return Array.prototype.slice.call(arguments)
      .map(function (p) { return p == null ? '' : String(p).trim(); })
      .filter(Boolean).join(', ');
  }

  /** 「2girls, 1boy」这种人数标签，按渲染上下文里的角色算 */
  function countTag(ctx) {
    var list = ((ctx && ctx.characters) || []).filter(function (c) { return c.enabled !== false; }).slice(0, 4);
    if (!list.length) return '';
    var girls = 0, boys = 0;
    list.forEach(function (c) {
      if (c.subjectType === 'girl') girls++;
      else if (c.subjectType === 'boy') boys++;
    });
    var others = list.length - girls - boys;
    return [
      girls ? girls + 'girl' + (girls === 1 ? '' : 's') : '',
      boys ? boys + 'boy' + (boys === 1 ? '' : 's') : '',
      others ? others + 'people' : ''
    ].filter(Boolean).join(', ');
  }

  var POSITIVE_LIMIT = 1600, NEGATIVE_LIMIT = 1200;

  /** 超长时按标签边界裁，不从中间切断一个标签 */
  function truncate(text, limit) {
    text = String(text || '');
    if (text.length <= limit) return { text: text, truncated: false };
    var out = [], used = 0;
    var segs = segments(text);
    for (var i = 0; i < segs.length; i++) {
      var sep = out.length ? 2 : 0;
      if (used + sep + segs[i].length <= limit) {
        out.push(segs[i]); used += sep + segs[i].length; continue;
      }
      var room = limit - used - sep;
      if (room > 0) out.push(segs[i].slice(0, room).trim());
      break;
    }
    return { text: out.filter(Boolean).join(', '), truncated: true };
  }

  /* 有角色分段时，底图和每个角色分预算，免得一个角色把额度吃光 */
  function budget(base, chars, limit, field, baseCap, charFloor) {
    if (!chars.length) {
      var r = truncate(base, limit);
      return { base: r.text, characters: chars, truncated: r.truncated };
    }
    var bl = Math.min(baseCap, Math.max(Math.floor(baseCap * 0.6), Math.floor(limit * 0.5)));
    var br = truncate(base, bl);
    var each = Math.max(charFloor, Math.floor((limit - br.text.length) / chars.length));
    var cut = br.truncated;
    var list = chars.map(function (c) {
      var r2 = truncate(c[field], each);
      if (r2.truncated) cut = true;
      var copy = {};
      for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) copy[k] = c[k];
      copy[field] = r2.text;
      return copy;
    });
    return { base: br.text, characters: list, truncated: cut };
  }

  /** official / append / replace / off 四种叠加模式 */
  function optional(mode, official, custom) {
    var o = sanitize(official), c = sanitize(custom || '');
    if (mode === 'off') return '';
    if (mode === 'replace') return c;
    if (mode === 'append') return sanitize(joinParts(o, c));
    return o;
  }

  /**
   * 把渲染上下文编译成 NAI 要的形状。
   * ctx 形如 { scenePrompt, sceneNegativePrompt, stylePrompt, styleNegativePrompt,
   *            characters: [{ name, subjectType, visualPrompt, negativePrompt }] }
   * ctx 缺省时退回单段 prompt（模型直接写 <image> 的零成本路径走这条）。
   */
  function compilePrompt(input) {
    var profile = profileOf(input.model);
    var adv = input.advanced || {};
    var ctx = input.context;
    var actives = ((ctx && ctx.characters) || [])
      .filter(function (c) { return c.enabled !== false && String(c.visualPrompt || '').trim(); })
      .slice(0, 4);

    var baseBody = sanitize(joinParts(
      adv.basePromptPrefix,
      (ctx && ctx.scenePrompt) || input.prompt,
      (ctx && ctx.stylePrompt) || input.stylePrompt,
      adv.basePromptSuffix
    ), function (seg) { return COUNT_TAG.test(seg); });

    var chars = actives.map(function (c, i) {
      return {
        name: c.name || ('Character ' + (i + 1)),
        prompt: sanitize(joinParts(
          adv.characterPromptPrefix,
          c.subjectType === 'other' ? '' : c.subjectType,
          c.visualPrompt,
          adv.characterPromptSuffix
        )),
        negativePrompt: sanitize(c.negativePrompt),
        /* 站位：模型显式给了就用它（油猴世界书会让模型写 |centers:x,y），
           没给就沿画幅横向均分，单人居中。NAI4 靠 centers 区分角色。 */
        center: (c.center && typeof c.center.x === 'number')
          ? { x: c.center.x, y: typeof c.center.y === 'number' ? c.center.y : 0.5 }
          : { x: actives.length <= 1 ? 0.5 : (i + 1) / (actives.length + 1), y: 0.5 }
      };
    });

    var quality = optional(adv.qualityMode, profile.qualityTags, adv.qualityText);
    var idx = ucPresetIndex(profile, input.ucPreset);
    var preset = profile.ucPresets[idx] || profile.ucPresets[profile.ucPresets.length - 1];
    var positive = joinParts(countTag(ctx), baseBody, quality);

    var officialUc = sanitize(joinParts(
      (profile.prependNsfw && preset.name !== 'None' && !/\bnsfw\b/i.test(positive)) ? 'nsfw' : '',
      preset.text
    ));
    var ucLayer = optional(adv.ucMode, officialUc, adv.ucText);
    /* 多角色时 "solo" / "multiple people" 是自相矛盾的负面词，去掉 */
    var multi = actives.length > 1;
    var baseNeg = sanitize(joinParts(
      (ctx && ctx.sceneNegativePrompt) || input.negativePrompt,
      ctx && ctx.styleNegativePrompt,
      adv.negativePromptAppend
    ), multi ? function (seg) {
      return COUNT_TAG.test(seg) || /^(?:multiple people|solo)$/i.test(seg);
    } : null);
    var uc = sanitize(joinParts(ucLayer, baseNeg));

    var pos = budget(positive, chars, POSITIVE_LIMIT, 'prompt', 800, 120);
    var neg = budget(uc, chars, NEGATIVE_LIMIT, 'negativePrompt', 720, 80);

    var merged = pos.characters.map(function (c, i) {
      return {
        name: c.name, prompt: c.prompt, center: c.center,
        negativePrompt: (neg.characters[i] && neg.characters[i].negativePrompt) || ''
      };
    });

    return {
      family: profile.family,
      basePrompt: pos.base,
      uc: neg.base,
      ucPreset: idx,
      qualityTags: quality,
      characterPrompts: profile.characterPrompts ? merged : [],
      truncated: pos.truncated || neg.truncated
    };
  }

  /* ============================================================
     四、请求体
     ============================================================ */

  function parseSize(size) {
    var m = String(size || '').match(/(\d+)\s*[xX*]\s*(\d+)/);
    if (!m) return { width: 1024, height: 1024 };
    return {
      width: Math.max(64, parseInt(m[1], 10) || 1024),
      height: Math.max(64, parseInt(m[2], 10) || 1024)
    };
  }

  /** NAI 要求宽高是 64 的倍数，不是就 400 */
  function snapSize(size) {
    var p = parseSize(size);
    function snap(v) { return Math.max(64, Math.min(2048, Math.round(v / 64) * 64)); }
    return { width: snap(p.width), height: snap(p.height) };
  }

  function buildPayload(cfg, req, seed) {
    var model = String(cfg.model || '').trim();
    var profile = profileOf(model);
    var wh = snapSize(req.size || cfg.size);
    var compiled = compilePrompt({
      model: model,
      prompt: req.prompt,
      negativePrompt: req.negativePrompt,
      stylePrompt: cfg.stylePrompt,
      advanced: cfg.advanced,
      context: req.context,
      ucPreset: cfg.ucPreset
    });
    var custom = cfg.parameterMode === 'custom';
    var charPrompts = compiled.characterPrompts.map(function (c) {
      return { prompt: c.prompt, uc: c.negativePrompt, center: c.center, enabled: true };
    });

    var params = {
      width: wh.width, height: wh.height,
      scale: custom ? cfg.cfgScale : profile.cfgScale,
      sampler: cfg.sampler,
      steps: custom ? cfg.steps : profile.steps,
      seed: seed,
      n_samples: 1,
      ucPreset: compiled.ucPreset,
      uc: compiled.uc,
      negative_prompt: compiled.uc,
      noise_schedule: cfg.noiseSchedule,
      qualityToggle: !!compiled.qualityTags,
      cfg_rescale: 0,
      controlnet_strength: 1,
      dynamic_thresholding: false,
      params_version: 3,
      legacy: false, legacy_uc: false, legacy_v3_extend: false,
      sm: false, sm_dyn: false,
      add_original_image: true,
      characterPrompts: charPrompts,
      use_coords: false,
      deliberate_euler_ancestral_bug: false,
      prefer_brownian: true
    };

    /* V4/V4.5 的多角色分段。V3 没有这两个字段，带上会 400。 */
    if (profile.characterPrompts) {
      params.v4_prompt = {
        caption: {
          base_caption: compiled.basePrompt,
          char_captions: charPrompts.map(function (c) {
            return { char_caption: c.prompt, centers: [c.center] };
          })
        },
        use_coords: false, use_order: true
      };
      params.v4_negative_prompt = {
        caption: {
          base_caption: compiled.uc,
          char_captions: charPrompts.map(function (c) {
            return { char_caption: c.uc, centers: [c.center] };
          })
        },
        legacy_uc: false
      };
    }

    return {
      payload: { action: 'generate', input: compiled.basePrompt, model: model, parameters: params },
      compiled: compiled
    };
  }

  /* ============================================================
     五、ZIP 解包

     NAI 回的是一个 zip，里面一张 png。不引 JSZip —— 自己扫本地文件头，
     用浏览器内置的 DecompressionStream('deflate-raw') 解 deflate。零依赖。
     （这套是开拓轶事的写法，很省事，值得保留。）
     ============================================================ */

  function isZipHeader(b) {
    return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
  }
  function isZipType(t) {
    return /(?:application|binary)\/(?:zip|x-zip-compressed)|application\/octet-stream/i.test(String(t || ''));
  }

  function readU16(b, o) { return b[o] | (b[o + 1] << 8); }
  function readU32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function readName(b, o, len) {
    var s = '';
    for (var i = 0; i < len; i++) s += String.fromCharCode(b[o + i]);
    return s;
  }
  function isImageName(n) { return /\.(png|jpe?g|webp)$/i.test(n); }

  /* ⚠ NAI 回的是**流式写入**的 zip：本地文件头里的压缩长度写 0，
     真实长度在数据**之后**的 data descriptor 里（general purpose flag 的 bit 3）。
     所以只扫本地文件头会直接扑空 —— 实测就是这么挂的，报
     「返回了压缩包，但里面没找到 PNG」。
     中央目录（文件末尾）里的长度永远是对的，优先读那儿。 */

  /** 倒着找 End of Central Directory（0x06054b50） */
  function findEOCD(b) {
    var min = Math.max(0, b.length - 65557);        // 22 字节固定头 + 最长 65535 的注释
    for (var o = b.length - 22; o >= min; o--) {
      if (readU32(b, o) === 0x06054b50) return o;
    }
    return -1;
  }

  /** 从中央目录里挑第一个图片条目 */
  function fromCentralDirectory(b) {
    var eocd = findEOCD(b);
    if (eocd < 0) return null;
    var count = readU16(b, eocd + 10);
    var cdOff = readU32(b, eocd + 16);
    if (cdOff >= b.length) return null;

    var o = cdOff;
    for (var i = 0; i < count && o + 46 <= b.length; i++) {
      if (readU32(b, o) !== 0x02014b50) break;
      var method = readU16(b, o + 10);
      var compressed = readU32(b, o + 20);
      var nameLen = readU16(b, o + 28);
      var extraLen = readU16(b, o + 30);
      var cmtLen = readU16(b, o + 32);
      var localOff = readU32(b, o + 42);
      var name = readName(b, o + 46, nameLen);
      o += 46 + nameLen + extraLen + cmtLen;

      if (!isImageName(name) || !compressed) continue;
      if (localOff + 30 > b.length || readU32(b, localOff) !== 0x04034b50) continue;
      /* 本地头的名字/扩展字段长度可能和中央目录不同，必须按本地头算数据起点 */
      var dataOffset = localOff + 30 + readU16(b, localOff + 26) + readU16(b, localOff + 28);
      if (dataOffset + compressed > b.length) continue;
      return { filename: name, method: method, size: compressed, offset: dataOffset, via: 'central' };
    }
    return null;
  }

  /** 退路：没有中央目录（截断的包）时顺着本地头扫 */
  function fromLocalHeaders(b) {
    var o = 0;
    while (o + 30 <= b.length) {
      if (readU32(b, o) !== 0x04034b50) break;
      var method = readU16(b, o + 8);
      var compressed = readU32(b, o + 18);
      var nameLen = readU16(b, o + 26);
      var extraLen = readU16(b, o + 28);
      var name = readName(b, o + 30, nameLen);
      var dataOffset = o + 30 + nameLen + extraLen;
      if (isImageName(name) && compressed > 0) {
        return { filename: name, method: method, size: compressed, offset: dataOffset, via: 'local' };
      }
      if (!compressed) break;                       // 流式包，长度在尾部，这条路走不通
      o = dataOffset + compressed;
    }
    return null;
  }

  /**
   * 最后的退路：整个包里只有一张图时，直接从数据区读到 data descriptor 之前。
   * 流式包 + 中央目录也坏了才会走到这，但 NAI 每次只回一张图，这一招基本必中。
   */
  function fromSingleStream(b) {
    if (b.length < 30 || readU32(b, 0) !== 0x04034b50) return null;
    var method = readU16(b, 8);
    var nameLen = readU16(b, 26);
    var extraLen = readU16(b, 28);
    var name = readName(b, 30, nameLen);
    if (!isImageName(name)) return null;
    var start = 30 + nameLen + extraLen;
    /* 数据区一直到 data descriptor(0x08074b50) 或中央目录(0x02014b50) 为止 */
    for (var o = start; o + 4 <= b.length; o++) {
      var sig = readU32(b, o);
      if (sig === 0x08074b50 || sig === 0x02014b50) {
        return { filename: name, method: method, size: o - start, offset: start, via: 'stream' };
      }
    }
    return { filename: name, method: method, size: b.length - start, offset: start, via: 'stream-eof' };
  }

  /** 三级：中央目录 → 本地头 → 单流兜底 */
  function findImageEntry(bytes) {
    return fromCentralDirectory(bytes) || fromLocalHeaders(bytes) || fromSingleStream(bytes);
  }

  async function inflateRaw(bytes) {
    var DS = global.DecompressionStream;
    if (!DS) throw new Error('这个浏览器没有 DecompressionStream，解不开 NovelAI 的压缩包。请换新版 Chrome / Edge / Firefox。');
    var stream = new global.Blob([bytes]).stream().pipeThrough(new DS('deflate-raw'));
    var buf = await new global.Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  function mimeOf(name, bytes) {
    if (bytes && bytes.length > 3 && bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
    if (bytes && bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
    if (/\.jpe?g$/i.test(name || '')) return 'image/jpeg';
    if (/\.webp$/i.test(name || '')) return 'image/webp';
    return 'image/png';
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new global.FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(new Error('图片读取失败')); };
      fr.readAsDataURL(blob);
    });
  }

  async function readImageBlob(blob, contentType) {
    var declared = blob.type || contentType || '';
    var head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (isZipType(declared) || isZipHeader(head)) {
      var bytes = new Uint8Array(await blob.arrayBuffer());
      var entry = findImageEntry(bytes);
      if (!entry) throw new Error('NovelAI 返回了压缩包，但里面没找到 PNG/JPEG/WebP。');
      var raw = bytes.slice(entry.offset, entry.offset + entry.size);
      var img;
      if (entry.method === 0) img = raw;
      else if (entry.method === 8) img = await inflateRaw(raw);
      else throw new Error('压缩包用了暂不支持的压缩方式：' + entry.method);
      var mime = mimeOf(entry.filename, img);
      return { src: await blobToDataUrl(new global.Blob([img], { type: mime })), mimeType: mime };
    }
    var m = declared && /^image\//.test(declared) ? declared : 'image/png';
    return { src: await blobToDataUrl(blob), mimeType: m };
  }

  /* ============================================================
     六、错误信息

     报错要说人话，并且把「网络/CORS」和「密钥/额度」分开 ——
     这两类的处理方式完全不同，混在一起用户只会一直去换密钥。
     ============================================================ */

  function describeNetworkError(err, url) {
    var msg = (err && err.message) || String(err);
    if (err && err.name === 'AbortError') return '出图请求超时或被中断。';
    /* fetch 被 CORS 拦下时抛的就是 TypeError «Failed to fetch»，
       浏览器出于安全不会告诉脚本具体原因，只能靠这个特征判断。 */
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return '连不上 ' + url + '。\n' +
             '这类失败有三种可能，按顺序排查：\n' +
             '① 浏览器跨域（CORS）被拦 —— 控制台会有一条 CORS 报错。' +
             '解法是在「文生图 · 接口地址」里填一个中转地址，或者本地跑 proxy/server.js。\n' +
             '② 断网或被墙。\n' +
             '③ 地址填错了。\n' +
             '注意：这一步还没到验密钥，所以换密钥没用。';
    }
    return '出图请求失败：' + msg;
  }

  function describeHttpError(status, text, model) {
    var tips = [];
    if (status === 401 || status === 403) {
      tips.push('NovelAI Token 无效或过期。注意要填的是持久 token（订阅账号 → 用户设置 → Account → Get Persistent API Token），不是网页登录密码。');
    } else if (status === 402) {
      tips.push('额度不足。Opus 会员的免费额度只覆盖「小图」：总像素 ≤ 1024×1024（1,048,576）且步数 ≤ 28。把尺寸调回 1216×832、步数调到 23 就回到免费档。');
    } else if (status === 429) {
      tips.push('触发限流，等一会儿再试。同时出多张图时容易撞上，把「每轮张数」调小。');
    } else if (status === 400) {
      tips.push('参数不对。最常见的是尺寸不是 64 的倍数，其次是采样器或噪点表名字写错。');
    } else if (status === 500 && /^nai-diffusion-4/.test(String(model || ''))) {
      tips.push('V4/V4.5 需要 v4_prompt 参数（本引擎已自动补齐）。仍然失败的话，检查模型名是不是你账号可用的那个。');
    }
    var body = String(text || '').slice(0, 400);
    return ['NovelAI 接口错误 ' + status + (body ? '：' + body : '')].concat(tips).join('\n');
  }

  /* ============================================================
     七、出图
     ============================================================ */

  function joinUrl(base, path) {
    var b = String(base || '').trim().replace(/\/+$/, '');
    var p = String(path || '');
    if (p.charAt(0) !== '/') p = '/' + p;
    if (b.slice(-p.length).toLowerCase() === p.toLowerCase()) return b;
    return b + p;
  }

  /* novelai.net 和 image.novelai.net 是两个域，出图只在后者 */
  function imageHost(base) {
    return String(base || '').replace(/^https:\/\/novelai\.net/i, 'https://image.novelai.net');
  }

  async function generateNovelAI(cfg, req) {
    if (!String(cfg.apiKey || '').trim()) throw new Error('请先填 NovelAI Token。');
    if (!String(cfg.model || '').trim()) throw new Error('请先选 NovelAI 模型。');

    var seed = (cfg.seed != null && cfg.seed >= 0) ? cfg.seed : Math.floor(Math.random() * 2147483647);
    var built = buildPayload(cfg, req, seed);
    var url = joinUrl(imageHost(cfg.baseUrl || DEFAULTS.baseUrl), '/ai/generate-image');

    /* 超时用 AbortController 自己管。外面传进来的 signal 也要能中断。 */
    var ctl = new global.AbortController();
    var timer = global.setTimeout(function () { ctl.abort(); }, cfg.timeoutMs || DEFAULTS.timeoutMs);
    if (req.signal) {
      if (req.signal.aborted) ctl.abort();
      else req.signal.addEventListener('abort', function () { ctl.abort(); });
    }

    var res;
    try {
      res = await global.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + String(cfg.apiKey).trim()
        },
        body: JSON.stringify(built.payload),
        signal: ctl.signal
      });
    } catch (e) {
      global.clearTimeout(timer);
      var err = new Error(describeNetworkError(e, url));
      err.kind = 'network';
      /* 中断不是"网络抖了"，标出来，重试循环看到它就直接收手 */
      if (e && e.name === 'AbortError') err.aborted = true;
      throw err;
    }
    global.clearTimeout(timer);

    if (!res.ok) {
      var text = '';
      try { text = await res.text(); } catch (e2) {}
      var he = new Error(describeHttpError(res.status, text, cfg.model));
      he.kind = 'http';
      he.status = res.status;
      /* 429 限流和 5xx 值得再试 —— 免费档 NAI 最常见的失败就是 429。
         其余 4xx（密钥错、模型名错、参数不合法）再试多少次都一样。 */
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        he.retryable = true;
        var ra = 0;
        try { ra = Number(res.headers && res.headers.get && res.headers.get('retry-after')); }
        catch (e3) {}
        if (isFinite(ra) && ra > 0) he.retryAfterMs = Math.min(ra * 1000, 60000);
      }
      /* 401/402/400 重试没有意义，标出来让重试层跳过 */
      he.retryable = (res.status === 429 || res.status >= 500);
      throw he;
    }

    var ct = res.headers.get('content-type') || '';
    /* 少数中转会把图包成 JSON 回来，先试 JSON 再走二进制 */
    if (/application\/json/i.test(ct)) {
      var data = null;
      try { data = await res.clone().json(); } catch (e3) {}
      var b64 = data && ((data.data && data.data[0] && data.data[0].b64_json) || data.image ||
                         (data.output && data.output[0]));
      if (typeof b64 === 'string' && b64.trim()) {
        return {
          src: /^data:/.test(b64) ? b64 : 'data:image/png;base64,' + b64,
          mimeType: 'image/png', model: cfg.model, backend: 'novelai',
          seed: seed, prompt: built.compiled.basePrompt, negativePrompt: built.compiled.uc
        };
      }
    }

    var blob = await res.blob();
    var img = await readImageBlob(blob, ct);
    return {
      src: img.src, mimeType: img.mimeType, model: cfg.model, backend: 'novelai',
      seed: seed, prompt: built.compiled.basePrompt, negativePrompt: built.compiled.uc,
      truncated: built.compiled.truncated
    };
  }

  var BACKENDS = {
    novelai: generateNovelAI
    /* sd_webui / comfyui / openai_compatible 以后按同样签名补进来，
       上层不用改：(cfg, req) => Promise<{src, mimeType, ...}> */
  };

  function sleep(ms) { return new Promise(function (r) { global.setTimeout(r, ms); }); }

  /**
   * 出图。失败会按退避重试，但只重试「值得重试」的错（429 / 5xx / 网络）。
   * req = { prompt, negativePrompt, context, size, signal }
   */
  async function generate(cfg, req) {
    cfg = Object.assign({}, DEFAULTS, cfg || {});
    req = req || {};
    if (!cfg.enabled) throw new Error('文生图没开。到「设置 · 文生图」里打开。');
    var fn = BACKENDS[cfg.backend];
    if (!fn) throw new Error('还没实装这个出图后端：' + cfg.backend + '（当前只有 NovelAI）');
    if (!String(req.prompt || '').trim() && !(req.context && req.context.scenePrompt)) {
      throw new Error('没有可用的出图提示词。');
    }

    var tries = Math.max(0, cfg.retries == null ? DEFAULTS.retries : cfg.retries);
    var last;
    for (var i = 0; i <= tries; i++) {
      try {
        return await fn(cfg, req);
      } catch (e) {
        last = e;
        /* 玩家点了「停」/ 新一轮掐掉旧一轮时，别再退避一秒去发一个注定失败的请求 */
        if (e.aborted || (req && req.signal && req.signal.aborted)) break;
        var worth = e.kind === 'network' || e.retryable;
        if (!worth || i === tries) break;
        await sleep(e.retryAfterMs > 0 ? e.retryAfterMs
                                       : Math.min(1000 * Math.pow(3, i), 60000));
      }
    }
    throw last;
  }

  /** 连接测试：故意发一个最小请求，看是走到了鉴权还是根本连不上 */
  async function testConnection(cfg) {
    cfg = Object.assign({}, DEFAULTS, cfg || {});
    var url = joinUrl(imageHost(cfg.baseUrl || DEFAULTS.baseUrl), '/ai/generate-image');
    var t0 = Date.now();
    try {
      var r = await generate(Object.assign({}, cfg, { enabled: true, retries: 0, size: '64x64' }), {
        prompt: 'test'
      });
      return { ok: true, ms: Date.now() - t0,
               message: '通了，' + (Date.now() - t0) + 'ms 出了一张测试图。' , src: r.src };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, message: (e && e.message) || String(e), url: url };
    }
  }

  function models() { return Object.keys(MODEL_PROFILES); }

  global.ImageGen = {
    DEFAULTS: DEFAULTS,
    MODEL_PROFILES: MODEL_PROFILES,
    profileOf: profileOf,
    models: models,
    generate: generate,
    testConnection: testConnection,
    /* 下面这些导出主要是给冒烟测试和调试面板用 */
    compilePrompt: compilePrompt,
    buildPayload: buildPayload,
    sanitize: sanitize,
    snapSize: snapSize,
    findImageEntry: findImageEntry,
    describeHttpError: describeHttpError
  };
})(typeof window !== 'undefined' ? window : globalThis);
