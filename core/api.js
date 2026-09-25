/* ============================================================
 * core/api.js —— 浏览器直连 API 客户端
 *
 * 三种协议：
 *   openai  POST {base}/chat/completions      Authorization: Bearer
 *   claude  POST {base}/v1/messages           x-api-key + anthropic-version
 *   gemini  POST {base}/models/{m}:streamGenerateContent
 *
 * Anthropic 官方端点必须带 anthropic-dangerous-direct-browser-access: true，
 * 否则浏览器直连会被 CORS 拦掉。这里默认带上。
 *
 * 密钥只存在浏览器 localStorage，不发往任何第三方。
 * ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'gal_api_config';
  var DEFAULTS = {
    protocol: 'openai',
    baseUrl: '',
    apiKey: '',
    model: '',
    temperature: 1,
    /* 4096 对「先写思维链再写正文」的预设太紧：推理写完正文刚开头就到顶了，
       看起来就像「写到一半被截断」。老配置里存的值不受影响。 */
    maxTokens: 8192,
    topP: 1,
    stream: true,
    postProcess: 'auto',   // auto | keep | single，见 arrange()
    prefillMode: 'auto'    // auto | all | off，见 prefillFor()
  };

  function loadConfig() {
    try {
      return Object.assign({}, DEFAULTS, JSON.parse(global.localStorage.getItem(KEY) || '{}'));
    } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function saveConfig(cfg) {
    var merged = Object.assign(loadConfig(), cfg || {});
    try { global.localStorage.setItem(KEY, JSON.stringify(merged)); } catch (e) {}
    return merged;
  }

  function trimSlash(s) { return String(s || '').replace(/\/+$/, ''); }

  /** 拼出最终请求地址。用户填根地址或完整地址都能用。 */
  function endpoint(cfg) {
    var b = trimSlash(cfg.baseUrl);
    if (!b) throw new Error('没填 API 地址');
    if (cfg.protocol === 'claude') {
      if (/\/messages$/.test(b)) return b;
      if (/\/v1$/.test(b)) return b + '/messages';
      return b + '/v1/messages';
    }
    if (cfg.protocol === 'gemini') {
      var m = cfg.model || 'gemini-2.0-flash';
      /* 不流式时走 :generateContent —— 以前一律是流式地址，
         「测试连接」用 stream:false 去 res.json() 一段 SSE，Gemini 永远测不通 */
      var act = cfg.stream ? ':streamGenerateContent?alt=sse' : ':generateContent';
      if (/generateContent/i.test(b)) return b;
      if (/\/models$/.test(b)) return b + '/' + m + act;
      if (/\/v1(beta)?$/.test(b)) return b + '/models/' + m + act;
      return b + '/v1beta/models/' + m + act;
    }
    if (/\/chat\/completions$/.test(b)) return b;
    /* 已经带版本段的（/v1、火山方舟的 /api/v3、DeepSeek 的 /beta）直接接，不再重复补 /v1 */
    if (/\/(v\d+[a-z0-9]*|beta)$/i.test(b)) return b + '/chat/completions';
    return b + '/v1/chat/completions';
  }

  function headers(cfg) {
    var h = { 'Content-Type': 'application/json' };
    if (cfg.protocol === 'claude') {
      h['x-api-key'] = cfg.apiKey;
      h['anthropic-version'] = '2023-06-01';
      h['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if (cfg.protocol === 'gemini') {
      h['x-goog-api-key'] = cfg.apiKey;
    } else {
      h['Authorization'] = 'Bearer ' + cfg.apiKey;
    }
    return h;
  }

  /**
   * 规整消息顺序。
   *
   * 以前三种协议都把**所有** system 消息拎到最前面合并。可预设的破限、
   * 后置指令、深度注入都是故意放在对话历史**后面**的 system 块 ——
   * 拎到最前面，它们就被几十轮对话压在底下，基本等于没发。
   * 这是「预设没效果、一到感情戏就截断」的另一个主因。
   *
   * 现在：开头连续的 system 才算系统提示词；对话开始之后的 system
   * 原地改成 user（酒馆对 Claude / Gemini 也是这么做的），位置不动。
   * 相邻同角色合并，首条保证是 user。
   *
   * opt.single：酒馆「单一用户消息」后处理 —— 全部拼成一条 user，
   * 给那些只认一条消息、或者一见多轮就乱的中转用。
   */
  function arrange(messages, opt) {
    opt = opt || {};
    if (opt.single) {
      var all = (messages || []).map(function (m) { return String(m.content == null ? '' : m.content); })
        .filter(function (c) { return c.trim(); });
      if (opt.prefill) all.push(opt.prefill);
      return { system: '', turns: [{ role: 'user', content: all.join('\n\n') || '（继续）' }] };
    }
    var sys = [], turns = [], started = false;
    (messages || []).forEach(function (m) {
      var content = String(m.content == null ? '' : m.content);
      if (!content.trim()) return;
      var role = m.role;
      if (role === 'system' && !started) { sys.push(content); return; }
      started = true;
      if (role === 'system') role = opt.midSystem === 'system' ? 'system' : 'user';
      var last = turns[turns.length - 1];
      if (last && last.role === role) last.content += '\n\n' + content;
      else turns.push({ role: role, content: content });
    });
    if (opt.prefill) {
      var tail = turns[turns.length - 1];
      if (tail && tail.role === 'assistant') tail.content += '\n\n' + opt.prefill;
      else turns.push({ role: 'assistant', content: opt.prefill, prefix: true });
    } else if (opt.userLast && turns.length && turns[turns.length - 1].role === 'assistant') {
      /* 新一代 Claude 不接受以 assistant 结尾（等于预填），补一句让它接着写 */
      turns.push({ role: 'user', content: '（继续）' });
    }
    /* 首条是 assistant（开场白）时补一条占位 user，而不是把开场白丢掉 */
    if (turns.length && turns[0].role !== 'user') turns.unshift({ role: 'user', content: '（开始）' });
    if (!turns.length) turns.push({ role: 'user', content: '（继续）' });
    return { system: sys.join('\n\n'), turns: turns };
  }

  /* Gemini 默认的安全阈值会把正常的成人感情戏半路掐断（finishReason: SAFETY），
     表现就是「写到亲密处戛然而止」。酒馆发请求时全部放开，这里对齐。 */
  var GEMINI_SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']
    .map(function (c) { return { category: c, threshold: 'BLOCK_NONE' }; });

  function isDeepSeek(cfg) { return /deepseek\.com/i.test(String(cfg.baseUrl || '')); }

  /**
   * 预设的「助手预填」发不发、怎么发：
   *   auto（默认）—— Anthropic 协议照发；DeepSeek 官方走它的前缀续写（/beta + prefix:true）
   *   all        —— 另外 Gemini / OpenAI 兼容也作为最后一条 assistant 发（部分中转支持）
   *   off        —— 都不发
   * 被上游拒绝过（见 compatFix）的会自动关掉。
   */
  function prefillFor(cfg, params) {
    var p = params && params.assistantPrefill;
    if (!p || cfg.prefillMode === 'off' || (cfg._compat && cfg._compat.noPrefill)) return '';
    if (cfg.protocol === 'claude') return p;
    if (cfg.protocol === 'openai' && isDeepSeek(cfg)) return p;
    return cfg.prefillMode === 'all' ? p : '';
  }

  /** messages: [{role:'system'|'user'|'assistant', content}] */
  function body(cfg, messages, params) {
    params = params || {};
    var cp = cfg._compat || {};
    var temp = params.temperature != null ? params.temperature : cfg.temperature;
    /* 界面填的值是硬上限。预设里常写 60000 这种极大值，
       一旦真按它生成，长输出在不稳定的中转上极易半路断连。 */
    var maxT = Math.min(params.maxTokens != null ? params.maxTokens : cfg.maxTokens,
                        cfg.maxTokens || 8192);
    if (cp.maxCap) maxT = Math.min(maxT, cp.maxCap);
    var topP = params.topP != null ? params.topP : cfg.topP;
    var single = cfg.postProcess === 'single';
    var prefill = prefillFor(cfg, params);

    if (cfg.protocol === 'claude') {
      /* Anthropic 把 system 单独拿出来，只留 user/assistant，且必须交替 */
      var a = arrange(messages, { prefill: prefill, single: single, userLast: true });
      a.turns.forEach(function (t) { delete t.prefix; });
      var outC = {
        model: cfg.model, system: a.system || undefined, messages: a.turns,
        max_tokens: maxT, stream: !!cfg.stream
      };
      if (!cp.noTemp && temp != null) outC.temperature = temp;
      /* Anthropic 不许 temperature 和 top_p 同时改，只在 top_p 被明确调过时才带 */
      if (!cp.noTopP && topP != null && topP < 1 && outC.temperature == null) outC.top_p = topP;
      return outC;
    }
    if (cfg.protocol === 'gemini') {
      var g = arrange(messages, { single: single, prefill: prefill });
      var gen = { maxOutputTokens: maxT };
      if (!cp.noTemp && temp != null) gen.temperature = temp;
      if (!cp.noTopP && topP != null) gen.topP = topP;
      if (params.topK) gen.topK = params.topK;
      return {
        systemInstruction: g.system ? { parts: [{ text: g.system }] } : undefined,
        contents: g.turns.map(function (m) {
          return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
        }),
        safetySettings: GEMINI_SAFETY,
        generationConfig: gen
      };
    }
    /* OpenAI 兼容端点后面常常接的是 Anthropic（clewdr 这类中转）。
       Anthropic 要求首条非 system 必须是 user、且 user/assistant 交替，
       开场白会以 assistant 身份进历史，不规整就会首条是 assistant。 */
    var o = arrange(messages, {
      midSystem: cfg.postProcess === 'keep' ? 'system' : cfg.midSystem,
      single: single, prefill: prefill
    });
    var ds = isDeepSeek(cfg);
    var turnsO = o.turns.map(function (t) {
      /* DeepSeek 的前缀续写：最后一条 assistant 带 prefix:true，别家不认这个字段就不带 */
      if (t.prefix && ds) return { role: t.role, content: t.content, prefix: true };
      return { role: t.role, content: t.content };
    });
    var outMsgs = (o.system ? [{ role: 'system', content: o.system }] : []).concat(turnsO);
    var outO = { model: cfg.model, messages: outMsgs, stream: !!cfg.stream };
    /* o1 / o3 / gpt-5 这类推理模型不认 max_tokens，要 max_completion_tokens */
    if (cp.maxCompletion) outO.max_completion_tokens = maxT; else outO.max_tokens = maxT;
    if (!cp.noTemp && temp != null) outO.temperature = temp;
    if (!cp.noTopP && topP != null) outO.top_p = topP;
    if (!cp.noPenalty) {
      if (params.frequencyPenalty) outO.frequency_penalty = params.frequencyPenalty;
      if (params.presencePenalty) outO.presence_penalty = params.presencePenalty;
    }
    return outO;
  }

  /* ------------------------------------------------------------
     参数不兼容时自动降级。
     不同模型对参数的容忍度差很多：推理模型拒收 temperature、要 max_completion_tokens；
     小模型的输出上限只有 4096，填 8192 直接 400；新一代 Claude 不接受预填。
     以前这些都是一个 400 甩给玩家。现在认出是哪个参数，去掉/调小后自动再发一次，
     并按「协议 + 地址 + 模型」记住，后面的请求直接用降级后的参数。
     （思路参考 KaiTuoYiShi 的 deepSeekRecovery / 各家错误提示）
     ------------------------------------------------------------ */
  var COMPAT = {};
  function compatKey(cfg) { return [cfg.protocol, trimSlash(cfg.baseUrl), cfg.model].join('|'); }

  /** 看错误信息判断该怎么降级。改了返回说明文字，认不出返回 '' */
  function compatFix(err, cp, cur) {
    var st = err && err.status;
    if (st !== 400 && st !== 422) return '';
    var m = String((err && err.message) || '').toLowerCase();
    var unsupported = /unsupported|not support|does not support|isn'?t supported|not allowed|invalid|unknown|unrecognized|only the default|不支持/;
    if (!cp.maxCompletion && /max_completion_tokens/.test(m) && /max_tokens/.test(m)) {
      cp.maxCompletion = true; return '改用 max_completion_tokens';
    }
    if (!cp.noPrefill && /prefill|must end with a user|final (assistant )?message|last message.*(user|assistant)|prefix/.test(m)) {
      cp.noPrefill = true; return '这个模型不接受助手预填，已去掉';
    }
    if (/(max_tokens|max_output_tokens|maxoutputtokens|max_completion_tokens|max new tokens|output tokens)/.test(m) &&
        /(too large|exceed|maximum|at most|less than or equal|<=|range|上限|超出|超过|不能大于)/.test(m)) {
      /* 只从上游返回的正文里找数字 —— 第一行是我们自己拼的「HTTP 400 …」 */
      var detail = m.indexOf('\n') >= 0 ? m.slice(m.indexOf('\n') + 1) : m;
      var nums = (detail.match(/\d{3,7}/g) || []).map(Number).filter(function (n) { return n >= 256 && n < cur; });
      var cap = nums.length ? Math.min.apply(null, nums) : Math.floor(cur / 2);
      if (cap >= 256 && cap < cur && cap !== cp.maxCap) { cp.maxCap = cap; return '最大输出超过模型上限，调到 ' + cap; }
    }
    if (!cp.noTemp && /temperature/.test(m) && unsupported.test(m)) { cp.noTemp = true; return '这个模型不接受 temperature，已去掉'; }
    if (!cp.noTopP && /top_p/.test(m) && unsupported.test(m)) { cp.noTopP = true; return '这个模型不接受 top_p，已去掉'; }
    if (!cp.noPenalty && /(frequency|presence)_penalty/.test(m) && unsupported.test(m)) { cp.noPenalty = true; return '去掉了惩罚参数'; }
    return '';
  }

  /* ------------------------------------------------------------
     读正文。OpenAI 兼容这一路最乱：content 可能是字符串，也可能是分段数组；
     有的中转包一层 data；有的回的其实是 Anthropic 格式（content_block_delta）；
     还有 Responses API 的 output_text。思考类的分段（thinking / reasoning /
     thought:true）一律不算正文。（兼容面参考了 KaiTuoYiShi 的 chatCompletionClient）
     ------------------------------------------------------------ */
  var THINK_TYPE = /^(thinking|reasoning|thinking_delta|reasoning_delta|redacted_thinking|signature_delta)$/i;
  function partText(c) {
    if (c == null) return '';
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(partText).join('');
    if (typeof c !== 'object') return '';
    if (c.thought === true || THINK_TYPE.test(c.type || '')) return '';
    if (typeof c.text === 'string') return c.text;
    if (typeof c.output_text === 'string') return c.output_text;
    if (typeof c.content === 'string') return c.content;
    if (Array.isArray(c.content)) return partText(c.content);
    return '';
  }

  /** 从一个 SSE data 块里抽出增量文本 */
  function deltaOf(cfg, obj) {
    try {
      if (cfg.protocol === 'gemini') {
        var c = obj.candidates && obj.candidates[0];
        var p = c && c.content && c.content.parts;
        /* thought:true 的是 Gemini 的思考摘要，不是正文 */
        return (p || []).map(function (x) { return x.thought ? '' : (x.text || ''); }).join('');
      }
      /* Anthropic 格式（Anthropic 协议本身，或者 OpenAI 地址背后直接转发的 Anthropic 流） */
      if (obj.type === 'content_block_delta') {
        var dt = obj.delta || {};
        return THINK_TYPE.test(dt.type || '') ? '' : (dt.text || '');
      }
      if (obj.type === 'content_block_start') {
        var cb = obj.content_block || {};
        return THINK_TYPE.test(cb.type || '') ? '' : (cb.text || '');
      }
      if (cfg.protocol === 'claude') return '';
      if (/^response\.(output_text|text|content_part)\.delta$/.test(obj.type || '')) {
        return partText(obj.delta && obj.delta.text != null ? obj.delta.text : obj.delta);
      }
      var env = (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) ? obj.data : obj;
      var ch = (env.choices && env.choices[0]) || (obj.choices && obj.choices[0]);
      if (!ch) return '';
      var d = ch.delta || ch.message || {};
      if (d.thought === true || THINK_TYPE.test(d.type || '')) return '';
      /* reasoning_content / reasoning 是推理模型的思考，不是正文，故意不读 */
      return partText(d.content) || partText(d.text) || partText(ch.text);
    } catch (e) { return ''; }
  }
  function fullOf(cfg, obj) {
    if (cfg.protocol === 'gemini') {
      var c = obj.candidates && obj.candidates[0];
      return ((c && c.content && c.content.parts) || []).map(function (p) { return p.thought ? '' : (p.text || ''); }).join('');
    }
    if (cfg.protocol === 'claude') return partText(obj.content);
    var env = (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) ? obj.data : obj;
    var ch = (env.choices && env.choices[0]) || (obj.choices && obj.choices[0]);
    if (ch) {
      return partText(ch.message && ch.message.content) || partText(ch.delta && ch.delta.content) ||
             partText(ch.text);
    }
    /* 没有 choices：可能是 Anthropic 格式或 Responses API */
    return partText(env.content) || partText(env.output_text) ||
      (Array.isArray(env.output) ? env.output.map(function (o) { return partText(o.content); }).join('') : '');
  }

  /** 从一个响应块里读「为什么停」。三家字段各不相同 */
  function finishOf(cfg, obj) {
    try {
      if (cfg.protocol === 'claude') {
        if (obj.type === 'message_delta') return obj.delta && obj.delta.stop_reason || '';
        return obj.stop_reason || '';
      }
      if (cfg.protocol === 'gemini') {
        if (obj.promptFeedback && obj.promptFeedback.blockReason) return 'BLOCKED:' + obj.promptFeedback.blockReason;
        var c = obj.candidates && obj.candidates[0];
        return (c && c.finishReason) || '';
      }
      if (obj.type === 'message_delta') return (obj.delta && obj.delta.stop_reason) || '';
      var env = (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) ? obj.data : obj;
      var ch = (env.choices && env.choices[0]) || (obj.choices && obj.choices[0]);
      return (ch && ch.finish_reason) || obj.stop_reason || '';
    } catch (e) { return ''; }
  }

  /**
   * 把停止原因翻成人话。正常结束返回 null。
   * kind: 'length' = 到了最大输出 · 'filter' = 被安全过滤掐断 · 'other'
   */
  function explainFinish(reason) {
    var r = String(reason || '');
    if (!r || /^(stop|end_turn|stop_sequence|STOP|FINISH_REASON_UNSPECIFIED|tool_use|tool_calls|eos)$/i.test(r)) return null;
    if (/^(length|max_tokens|MAX_TOKENS)$/i.test(r)) {
      return { kind: 'length', reason: r,
        text: '输出到了「最大输出」上限被截断。预设要先写思维链的话，4096 不够用，到 设置 · 接口 调到 8192 以上。' };
    }
    if (/SAFETY|content_filter|PROHIBITED|BLOCKED|BLOCKLIST|SPII|RECITATION|refusal|IMAGE_SAFETY/i.test(r)) {
      return { kind: 'filter', reason: r,
        text: '被上游的内容过滤掐断（' + r + '）。这不是预设能控制的：官方 Gemini 已自动放开安全阈值；' +
              '如果走的是中转，多半是中转或上游自己加的审核，换个渠道或模型试试。' };
    }
    return { kind: 'other', reason: r, text: '生成提前结束（' + r + '）。' };
  }

  async function readError(res) {
    var txt = '';
    try { txt = await res.text(); } catch (e) {}
    var detail = txt;
    try {
      var j = JSON.parse(txt);
      detail = (j.error && (j.error.message || j.error.type)) || j.message || txt;
    } catch (e) {}
    var hint = '';
    if (res.status === 401 || res.status === 403) hint = '（密钥无效或没权限）';
    else if (res.status === 404) hint = '（地址不对，检查是否要去掉或补上 /v1）';
    else if (res.status === 429) hint = '（触发限流，等一会儿再试）';
    else if (res.status >= 500) hint = '（上游服务器出错，不是你的问题）';
    var err = new Error('HTTP ' + res.status + ' ' + hint + '\n' + String(detail).slice(0, 400));
    /* 把状态码和 Retry-After 挂到错误对象上 —— 重试逻辑要用。
       以前只有一段人读的文案，429 被识别出来了却不重试，反而叫玩家"等一会儿再试"。 */
    err.status = res.status;
    err.retryAfterMs = parseRetryAfter(res);
    return err;
  }

  /** 解析 Retry-After：可能是秒数，也可能是 HTTP 日期 */
  function parseRetryAfter(res) {
    var raw = '';
    try { raw = res.headers && res.headers.get && res.headers.get('retry-after'); } catch (e) {}
    if (!raw) return 0;
    var secs = Number(raw);
    if (isFinite(secs) && secs >= 0) return Math.min(secs * 1000, RETRY_CAP);
    var at = Date.parse(raw);
    if (!isNaN(at)) return Math.max(0, Math.min(at - Date.now(), RETRY_CAP));
    return 0;
  }

  /**
   * @param {Array} messages
   * @param {object} [opt] { params, onDelta(text), signal }
   * @returns {Promise<string>} 完整文本
   */
  async function chat(messages, opt) {
    opt = opt || {};
    var cfg = Object.assign(loadConfig(), opt.config || {});
    if (!cfg.apiKey) throw new Error('没填密钥');
    if (!cfg.model && cfg.protocol !== 'gemini') throw new Error('没填模型名');

    var wantStream = cfg.stream && typeof opt.onDelta === 'function';
    var ck = compatKey(cfg);
    var cp = COMPAT[ck] || (COMPAT[ck] = {});
    var useCfg = Object.assign({}, cfg, { stream: wantStream, _compat: cp });
    /* DeepSeek 官方的前缀续写只在 /beta 下可用 */
    if (cfg.protocol === 'openai' && isDeepSeek(cfg) && prefillFor(useCfg, opt.params)) {
      useCfg.baseUrl = trimSlash(cfg.baseUrl).replace(/\/v1$/, '').replace(/\/beta$/, '') + '/beta';
    }

    /* 超时兜底：流式连接偶尔会挂住不返回，不设上限会永远转圈 */
    var ctl = new AbortController();
    var timeoutMs = opt.timeoutMs || 180000;
    var timer = setTimeout(function () { ctl.abort('timeout'); }, timeoutMs);
    if (opt.signal) {
      if (opt.signal.aborted) ctl.abort();
      else opt.signal.addEventListener('abort', function () { ctl.abort(); });
    }

    var res;
    try {
      for (var attempt = 0; ; attempt++) {
        res = await fetch(endpoint(useCfg), {
          method: 'POST', headers: headers(useCfg),
          body: JSON.stringify(body(useCfg, messages, opt.params)),
          signal: ctl.signal
        });
        if (res.ok || attempt >= 4 || (res.status !== 400 && res.status !== 422)) break;
        var bad = await readError(res);
        var curMax = Math.min((opt.params && opt.params.maxTokens) || useCfg.maxTokens || 8192, cp.maxCap || 1e9);
        var why = compatFix(bad, cp, curMax);
        if (!why) { clearTimeout(timer); throw bad; }
        if (cp.noPrefill && useCfg.baseUrl !== cfg.baseUrl) useCfg.baseUrl = cfg.baseUrl;   // 退出 DeepSeek /beta
        (api.compatLog = api.compatLog || []).push({ model: cfg.model, why: why, at: Date.now() });
        if (opt.onCompat) { try { opt.onCompat(why); } catch (e2) {} }
      }
    } catch (e) {
      if (e && e.status) throw e;
      clearTimeout(timer);
      if (e && e.name === 'AbortError') {
        throw new Error(ctl.signal.reason === 'timeout'
          ? '超时（' + Math.round(timeoutMs / 1000) + '秒没有响应）'
          : '已中断');
      }
      throw new Error('连不上：' + (e.message || e) +
        '\n（地址写错、服务没启动，或这个端点不允许浏览器直连）');
    }
    if (!res.ok) { clearTimeout(timer); throw await readError(res); }

    var finish = '';
    function done(text) {
      var info = explainFinish(finish);
      api.lastFinish = { reason: finish, info: info, chars: String(text || '').length, at: Date.now() };
      if (opt.onFinish) { try { opt.onFinish(api.lastFinish); } catch (e) {} }
      /* 一个字都没回、又是被过滤拦下的 —— 别当成功，直接说清楚 */
      if (!String(text || '').trim() && info && info.kind === 'filter') {
        var err = new Error('上游没有返回内容：' + info.text);
        err.status = 0; err.fatal = true;
        throw err;
      }
      return text;
    }

    if (!wantStream) {
      try {
        /* 有些中转无视 stream:false 照样回 SSE，res.json() 会直接炸。先拿文本再判断 */
        var txt = await res.text();
        var j;
        try { j = JSON.parse(txt); }
        catch (e) {
          var acc = '';
          txt.split('\n').forEach(function (ln) {
            ln = ln.trim();
            if (ln.indexOf('data:') !== 0) return;
            var pl = ln.slice(5).trim();
            if (pl === '[DONE]') return;
            try { var o2 = JSON.parse(pl); acc += deltaOf(useCfg, o2); finish = finishOf(useCfg, o2) || finish; } catch (e2) {}
          });
          if (!acc && !finish) throw new Error('响应既不是 JSON 也不是 SSE：' + txt.slice(0, 200));
          return done(acc);
        }
        if (j && j.error) throw new Error((j.error.message || j.error.type || JSON.stringify(j.error)).slice(0, 400));
        finish = finishOf(useCfg, j);
        return done(fullOf(useCfg, j));
      }
      finally { clearTimeout(timer); }
    }

    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '', full = '';
    try {
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      var lines = buf.split('\n');
      buf = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i].trim();
        if (!ln || ln.indexOf('data:') !== 0) continue;
        var payload = ln.slice(5).trim();
        if (payload === '[DONE]') continue;
        var obj;
        try { obj = JSON.parse(payload); } catch (e) { continue; }
        if (obj.error) throw new Error(obj.error.message || '上游返回错误');
        finish = finishOf(useCfg, obj) || finish;
        var d = deltaOf(useCfg, obj);
        if (d) { full += d; opt.onDelta(d, full); }
      }
    }
    } catch (e) {
      if (e && e.name === 'AbortError') {
        if (full) return full;                 // 已经收到内容就当部分成功
        throw new Error(ctl.signal.reason === 'timeout' ? '超时' : '已中断');
      }
      throw e;
    } finally { clearTimeout(timer); }
    return done(full);
  }

  /* 退避上限。服务端偶尔会给出几十分钟的 Retry-After，不封顶的话界面就卡死了。 */
  var RETRY_CAP = 60000;

  /** 这些错再试多少次都一样，别浪费两次重试和玩家的时间 */
  function isFatal(e) {
    if (e && e.fatal) return true;
    var st = e && e.status;
    if (st === 400 || st === 401 || st === 403 || st === 404 || st === 422) return true;
    var m = String((e && e.message) || e).toLowerCase();
    return /没填密钥|没填模型名|model.*(not found|does not exist)|invalid api key/.test(m);
  }

  /** 判断是不是"再试一次也许就好"的故障 */
  function isTransient(e) {
    if (isFatal(e)) return false;
    /* 429 = 限流。这才是最该重试的一类，以前反而漏了。 */
    if (e && (e.status === 429 || (e.status >= 500 && e.status < 600))) return true;
    var m = String((e && e.message) || e).toLowerCase();
    return /network error|failed to fetch|error reading a body|connection|reset|eof|502|503|504|500|timeout|超时|rate.?limit|too many requests|429/.test(m);
  }

  /** 这一次该等多久：服务端给了 Retry-After 就听它的，否则指数退避 */
  function backoffMs(e, attempt) {
    if (e && e.retryAfterMs > 0) return Math.min(e.retryAfterMs, RETRY_CAP);
    return Math.min(1000 * Math.pow(3, attempt), RETRY_CAP);   // 1s, 3s, 9s…
  }

  /** 带重试的 chat。瞬时断连与限流重试 2 次；
      退避优先听服务端的 Retry-After，否则 1s / 3s，最多 60s。 */
  async function chatWithRetry(messages, opt) {
    opt = opt || {};
    var tries = opt.retries == null ? 2 : opt.retries;
    var lastErr;
    for (var i = 0; i <= tries; i++) {
      try {
        return await chat(messages, opt);
      } catch (e) {
        lastErr = e;
        if (opt.signal && opt.signal.aborted) throw e;
        if (i >= tries || !isTransient(e)) throw e;
        var wait = backoffMs(e, i);
        if (opt.onRetry) opt.onRetry(i + 1, tries, e, wait);
        await new Promise(function (r) { setTimeout(r, wait); });
      }
    }
    throw lastErr;
  }

  /** 用户可能把完整地址填进来（…/v1/chat/completions、…/v1/messages），
      列模型要的是根地址，把这些尾巴剥掉 */
  function rootOf(b) {
    return trimSlash(b)
      .replace(/\/chat\/completions$/, '')
      .replace(/\/messages$/, '')
      .replace(/\/models(\/[^/]*)?(:\w+)?(\?.*)?$/, '')
      .replace(/\/+$/, '');
  }

  /** OpenAI 兼容的模型列表地址不统一：有的在 {base}/models，有的只在根上的 /v1/models，
      有的干脆是 /models。按顺序都试一遍（参考 KaiTuoYiShi 的 buildOpenAICompatibleModelUrls） */
  function modelsUrls(cfg) {
    var first = modelsUrl(cfg);
    if (cfg.protocol !== 'openai') return [first];
    var b = rootOf(cfg.baseUrl).replace(/\/beta$/i, '/v1');
    var bare = b.replace(/\/v\d+[a-z0-9]*$/i, '');
    return [first, bare + '/v1/models', bare + '/models', b + '/models']
      .filter(function (u, i, a) { return a.indexOf(u) === i; });
  }

  function modelsUrl(cfg) {
    var b = rootOf(cfg.baseUrl);
    if (!b) throw new Error('没填 API 地址');
    if (cfg.protocol === 'gemini') {
      return (/\/v1(beta)?$/.test(b) ? b : b + '/v1beta') + '/models?pageSize=1000';
    }
    var base = /\/v\d+[a-z]*$/.test(b) ? b : b + '/v1';
    return base + '/models' + (cfg.protocol === 'claude' ? '?limit=1000' : '');
  }

  /** 拉取可用模型列表。返回按名字排好的 id 数组。
      Gemini 只留能对话的（generateContent），嵌入 / 图像模型剔掉。 */
  async function listModels(cfgOverride) {
    var cfg = Object.assign(loadConfig(), cfgOverride || {});
    if (!cfg.apiKey) throw new Error('没填密钥');
    var urls = modelsUrls(cfg), errs = [], list = null;
    for (var ui = 0; ui < urls.length && !list; ui++) {
      var ctl = new AbortController();
      var timer = setTimeout(function () { ctl.abort(); }, 20000);
      var res;
      try { res = await fetch(urls[ui], { headers: headers(cfg), signal: ctl.signal }); }
      catch (e) {
        clearTimeout(timer);
        errs.push(e && e.name === 'AbortError' ? '超时（20 秒）'
          : '连不上：' + (e.message || e) + '（地址写错，或这个端点不允许浏览器直连 / CORS）');
        continue;
      }
      clearTimeout(timer);
      if (!res.ok) {
        var er = await readError(res);
        /* 密钥错了换地址也没用，直接报 */
        if (res.status === 401 || res.status === 403) throw er;
        errs.push(String(er.message).split('\n')[0]);
        continue;
      }
      var j;
      try { j = await res.json(); } catch (e) { errs.push('返回的不是 JSON'); continue; }
      var arr = Array.isArray(j) ? j : (j && (j.data || j.models)) || [];
      if (Array.isArray(arr) && arr.length) list = arr;
      else errs.push('返回里没有模型列表');
    }
    if (!list) throw new Error(errs[0] || '拉不到模型列表');
    var seen = {};
    return list.filter(function (m) {
      if (cfg.protocol !== 'gemini' || !m || !m.supportedGenerationMethods) return true;
      return m.supportedGenerationMethods.indexOf('generateContent') !== -1;
    }).map(function (m) {
      var id = typeof m === 'string' ? m : (m.id || m.name || m.model || '');
      return String(id).replace(/^models\//, '');
    }).filter(function (id) {
      if (!id || seen[id]) return false;
      seen[id] = 1; return true;
    }).sort(function (a, b) { return a.localeCompare(b); });
  }

  function challengeCode() {
    var n;
    try { var a = new Uint32Array(1); global.crypto.getRandomValues(a); n = a[0]; }
    catch (e) { n = Math.floor(Math.random() * 0xffffffff); }
    return 'GAL-' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  /**
   * 连通性自检：让模型复述一串**随机校验码**。
   * 只回个「ok」证明不了什么 —— 有的中转会回缓存、回别的模型、甚至回固定文案。
   * 校验码每次都不一样，照抄出来才说明这个模型真的在听你的话。（KaiTuoYiShi 的做法）
   */
  async function test(cfgOverride) {
    var t0 = Date.now();
    var fin = null;
    var code = challengeCode();
    var out = await chat([
      { role: 'system', content: '你正在执行接口连通测试。只输出用户给出的校验码本身，不要解释、标点或 Markdown。' },
      { role: 'user', content: '校验码：' + code }
    ], { config: Object.assign({ stream: false }, cfgOverride || {}),
         params: { maxTokens: 1024, temperature: 0 },
         onFinish: function (f) { fin = f; }, timeoutMs: 60000 });
    var text = String(out || '');
    var clean = global.GalRegex ? global.GalRegex.stripReasoning(text).text : text;
    return { ok: true, ms: Date.now() - t0, reply: clean.trim().slice(0, 80), finish: fin,
             verified: clean.indexOf(code) !== -1, code: code };
  }

  /**
   * 「测试连接」按钮用的完整体检：
   *   ① 拉模型列表 —— 不需要先填模型名，只要地址和密钥对就能拿到
   *   ② 有模型名（或列表里挑得出来）再真发一句话，验证这个模型能用
   * 任何一步失败都不抛，结果里写清楚哪一步、为什么。
   */
  async function probe(cfgOverride) {
    var cfg = Object.assign(loadConfig(), cfgOverride || {});
    var r = { models: [], listError: null, chat: null, chatError: null, model: cfg.model || '' };
    if (!trimSlash(cfg.baseUrl)) { r.listError = '没填 API 地址'; return r; }
    if (!cfg.apiKey) { r.listError = '没填密钥'; return r; }
    try { r.models = await listModels(cfg); }
    catch (e) { r.listError = String(e.message || e).split('\n').slice(0, 2).join(' '); }
    if (!r.model) return r;                     // 没模型名就只列清单，让玩家挑
    try { r.chat = await test(Object.assign({}, cfgOverride || {}, { model: r.model })); }
    catch (e) { r.chatError = String(e.message || e).split('\n').slice(0, 2).join(' '); }
    return r;
  }

  global.GalAPI = {
    DEFAULTS: DEFAULTS, loadConfig: loadConfig, saveConfig: saveConfig,
    endpoint: endpoint, chat: chat, chatWithRetry: chatWithRetry,
    isTransient: isTransient, isFatal: isFatal, backoffMs: backoffMs,
    test: test, listModels: listModels, probe: probe, modelsUrl: modelsUrl, modelsUrls: modelsUrls,
    compatFix: compatFix, COMPAT: COMPAT, partText: partText, prefillFor: prefillFor,
    body: body, arrange: arrange, explainFinish: explainFinish, finishOf: finishOf,
    lastFinish: null
  };
  var api = global.GalAPI;
})(typeof window !== 'undefined' ? window : globalThis);
