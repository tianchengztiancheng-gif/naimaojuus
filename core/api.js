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
    maxTokens: 4096,
    topP: 1,
    stream: true
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
      if (/generateContent/.test(b)) return b;
      if (/\/models$/.test(b)) return b + '/' + m + ':streamGenerateContent?alt=sse';
      return b + '/v1beta/models/' + m + ':streamGenerateContent?alt=sse';
    }
    if (/\/chat\/completions$/.test(b)) return b;
    if (/\/v1$/.test(b)) return b + '/chat/completions';
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

  /** messages: [{role:'system'|'user'|'assistant', content}] */
  function body(cfg, messages, params) {
    params = params || {};
    var temp = params.temperature != null ? params.temperature : cfg.temperature;
    /* 界面填的值是硬上限。预设里常写 60000 这种极大值，
       一旦真按它生成，长输出在不稳定的中转上极易半路断连。 */
    var maxT = Math.min(params.maxTokens != null ? params.maxTokens : cfg.maxTokens,
                        cfg.maxTokens || 4096);

    if (cfg.protocol === 'claude') {
      // Anthropic 把 system 单独拿出来，只留 user/assistant，且必须交替
      var sys = messages.filter(function (m) { return m.role === 'system'; })
                        .map(function (m) { return m.content; }).join('\n\n');
      var turns = [];
      messages.filter(function (m) { return m.role !== 'system'; }).forEach(function (m) {
        var last = turns[turns.length - 1];
        if (last && last.role === m.role) last.content += '\n\n' + m.content;
        else turns.push({ role: m.role, content: m.content });
      });
      if (turns.length && turns[0].role !== 'user') turns.unshift({ role: 'user', content: '（开始）' });
      if (!turns.length) turns.push({ role: 'user', content: '（继续）' });
      return {
        model: cfg.model, system: sys || undefined, messages: turns,
        max_tokens: maxT, temperature: temp, stream: !!cfg.stream
      };
    }
    if (cfg.protocol === 'gemini') {
      var sysG = messages.filter(function (m) { return m.role === 'system'; })
                         .map(function (m) { return m.content; }).join('\n\n');
      return {
        systemInstruction: sysG ? { parts: [{ text: sysG }] } : undefined,
        contents: messages.filter(function (m) { return m.role !== 'system'; })
          .map(function (m) {
            return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
          }),
        generationConfig: { temperature: temp, maxOutputTokens: maxT }
      };
    }
    /* OpenAI 兼容端点后面常常接的是 Anthropic（clewdr 这类中转）。
       Anthropic 要求首条非 system 必须是 user、且 user/assistant 交替，
       开场白会以 assistant 身份进历史，不规整就会首条是 assistant。 */
    var sysO = [], turnsO = [];
    messages.forEach(function (m) {
      if (m.role === 'system') { sysO.push(m.content); return; }
      var last = turnsO[turnsO.length - 1];
      if (last && last.role === m.role) last.content += '\n\n' + m.content;
      else turnsO.push({ role: m.role, content: m.content });
    });
    /* 首条是 assistant（开场白）时补一条占位 user，而不是把开场白丢掉 */
    if (turnsO.length && turnsO[0].role !== 'user') {
      turnsO.unshift({ role: 'user', content: '（开始）' });
    }
    if (!turnsO.length) turnsO.push({ role: 'user', content: '（继续）' });
    var outMsgs = (sysO.length ? [{ role: 'system', content: sysO.join('\n\n') }] : [])
                  .concat(turnsO);

    return {
      model: cfg.model, messages: outMsgs,
      temperature: temp, max_tokens: maxT,
      top_p: params.topP != null ? params.topP : cfg.topP,
      stream: !!cfg.stream
    };
  }

  /** 从一个 SSE data 块里抽出增量文本 */
  function deltaOf(cfg, obj) {
    try {
      if (cfg.protocol === 'claude') {
        if (obj.type === 'content_block_delta') return obj.delta && (obj.delta.text || '') || '';
        return '';
      }
      if (cfg.protocol === 'gemini') {
        var c = obj.candidates && obj.candidates[0];
        var p = c && c.content && c.content.parts;
        return (p || []).map(function (x) { return x.text || ''; }).join('');
      }
      var d = obj.choices && obj.choices[0] && (obj.choices[0].delta || obj.choices[0].message);
      return (d && d.content) || '';
    } catch (e) { return ''; }
  }
  function fullOf(cfg, obj) {
    if (cfg.protocol === 'claude') {
      return (obj.content || []).map(function (b) { return b.text || ''; }).join('');
    }
    if (cfg.protocol === 'gemini') {
      var c = obj.candidates && obj.candidates[0];
      return ((c && c.content && c.content.parts) || []).map(function (p) { return p.text || ''; }).join('');
    }
    var ch = obj.choices && obj.choices[0];
    return (ch && ((ch.message && ch.message.content) || (ch.delta && ch.delta.content))) || '';
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
    var useCfg = Object.assign({}, cfg, { stream: wantStream });

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
      res = await fetch(endpoint(useCfg), {
        method: 'POST', headers: headers(useCfg),
        body: JSON.stringify(body(useCfg, messages, opt.params)),
        signal: ctl.signal
      });
    } catch (e) {
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

    if (!wantStream) {
      try { var j = await res.json(); return fullOf(useCfg, j); }
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
    return full;
  }

  /* 退避上限。服务端偶尔会给出几十分钟的 Retry-After，不封顶的话界面就卡死了。 */
  var RETRY_CAP = 60000;

  /** 这些错再试多少次都一样，别浪费两次重试和玩家的时间 */
  function isFatal(e) {
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

  /** 拉取可用模型列表。三种协议路径不同，失败时返回空数组而不是抛错。 */
  async function listModels(cfgOverride) {
    var cfg = Object.assign(loadConfig(), cfgOverride || {});
    var b = trimSlash(cfg.baseUrl);
    if (!b) throw new Error('没填 API 地址');
    var url, h = headers(cfg);
    if (cfg.protocol === 'gemini') {
      url = /\/v1beta/.test(b) ? b + '/models' : b + '/v1beta/models';
    } else if (cfg.protocol === 'claude') {
      url = /\/v1$/.test(b) ? b + '/models' : b + '/v1/models';
    } else {
      url = /\/v1$/.test(b) ? b + '/models' : b + '/v1/models';
    }
    var res = await fetch(url, { headers: h });
    if (!res.ok) throw await readError(res);
    var j = await res.json();
    var list = j.data || j.models || [];
    return list.map(function (m) {
      var id = m.id || m.name || m.model || '';
      return String(id).replace(/^models\//, '');
    }).filter(Boolean).sort();
  }

  /** 连通性自检：发一句极短的话 */
  async function test(cfgOverride) {
    var t0 = Date.now();
    var out = await chat([{ role: 'user', content: '回复"ok"两个字符，不要别的。' }],
                         { config: Object.assign({ stream: false }, cfgOverride || {}) });
    return { ok: true, ms: Date.now() - t0, reply: String(out).slice(0, 80) };
  }

  global.GalAPI = {
    DEFAULTS: DEFAULTS, loadConfig: loadConfig, saveConfig: saveConfig,
    endpoint: endpoint, chat: chat, chatWithRetry: chatWithRetry,
    isTransient: isTransient, isFatal: isFatal, backoffMs: backoffMs,
    test: test, listModels: listModels
  };
})(typeof window !== 'undefined' ? window : globalThis);
