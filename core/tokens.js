/* ============================================================
 * core/tokens.js —— token 计数
 *
 * 原来只有一条拍脑袋的规则（CJK 1 字 1 token，其余 4 字符 1 token）。
 * 实测数据（`node tools/measure-tokens.mjs` 可复现，别信这段注释，自己跑一遍）：
 *
 *   样本              字符   粗估   cl100k   误差    o200k   误差
 *   纯中文（无标点）     28    28     35     -20%     23     +22%
 *   带标点对白          21    17     30     -43%     22     -23%
 *   剧本行「…|柴郡|微笑|」12     9     16     -44%     14     -36%
 *   世界书人设         149   131    207     -37%    141      -7%
 *   JSON 变量           46    26     33     -21%     28      -7%
 *   英文 prompt        122    31     30      +3%     30      +3%
 *   ---------------------------------------------------------------
 *   合计               —    242    351   -31.1%    258     -6.2%
 *
 * 偏差最大的恰好是剧本行（-44%）和中文标点（-43%）—— 而世界书的预算裁剪就是按
 * 这个数裁的，低估意味着「以为还有空间」，实际发出去比预期大。juus 是大卡，会放大。
 *
 * 所以接了真实 BPE：gpt-tokenizer 2.9.0（MIT，Bazyli Brzoska，取自 npm 官方 UMD 构建），
 * 按模型名选编码，**用到时才加载**那 1~2MB 的脚本。
 *
 * ⚠ 三条限制，界面上也要说清楚：
 *   1. 这是 OpenAI 的分词器。对 GPT 系是精确值，对 **Claude / Gemini 是估算** ——
 *      它们的分词器不公开，没有任何办法拿到真值。
 *   2. 认不出的模型默认走 o200k 而不是 cl100k。**这是一个判断，不是实测结论**：
 *      cl100k 是 2022 年的 10 万词表，对中文切得极碎（上表 -31%）；Claude / Gemini /
 *      国产模型用的都是更大的现代词表，行为更接近 o200k。但没有公开数据能证实这点，
 *      如果你手上有真实用量账单，以账单为准。
 *   3. core/vendor/gpt-tokenizer-*.js 合计 3MB。嫌包大可以直接删掉这两个文件，
 *      本模块会自动回退到粗估，不会报错。
 * ============================================================ */
(function (global) {
  'use strict';

  var FILES = {
    cl100k_base: 'core/vendor/gpt-tokenizer-cl100k_base.js',
    o200k_base: 'core/vendor/gpt-tokenizer-o200k_base.js'
  };
  /* 认不出的模型走 o200k —— 见文件头第 2 条，这是判断不是实测。 */
  var DEFAULT = 'o200k_base';
  var loading = {};
  var failed = {};

  /**
   * 按模型名选编码。
   * 只有明确属于 cl100k 家族的 OpenAI 老模型（GPT-4 / GPT-3.5 / embedding）走 cl100k，
   * 其余一律 o200k —— 包括 Claude / Gemini / 国产模型这些「认不出」的。
   */
  function encodingFor(model) {
    var m = String(model == null ? '' : model).trim().toLowerCase();
    if (!m) return DEFAULT;
    /* cl100k 家族：gpt-4（但不含 gpt-4o / gpt-4.1）、gpt-3.5、text-embedding-* */
    if (/^gpt-4(?!o|\.1)/.test(m) || /^gpt-3\.5/.test(m) || /^text-embedding-/.test(m))
      return 'cl100k_base';
    return DEFAULT;
  }

  function tokenizer(enc) {
    var g = global['GPTTokenizer_' + (enc || DEFAULT)];
    return (g && typeof g.encode === 'function') ? g : null;
  }

  /** 粗估：保留原来的规则，作为兜底 */
  function rough(text) {
    var s = String(text == null ? '' : text);
    var cjk = (s.match(/[一-龥぀-ヿ]/g) || []).length;
    return cjk + (s.length - cjk) / 4;
  }

  /** 按需插 <script>。失败就永久记下，不反复重试。 */
  function load(enc) {
    enc = enc || DEFAULT;
    var have = tokenizer(enc);
    if (have) return Promise.resolve(have);
    if (failed[enc]) return Promise.reject(new Error('分词器不可用：' + enc));
    if (loading[enc]) return loading[enc];
    var src = FILES[enc];
    if (!src) return Promise.reject(new Error('未知编码：' + enc));
    if (!global.document) return Promise.reject(new Error('非浏览器环境'));

    loading[enc] = new Promise(function (res, rej) {
      var s = global.document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () {
        var t = tokenizer(enc);
        if (t) res(t);
        else { failed[enc] = 1; rej(new Error('脚本加载了但没找到 GPTTokenizer_' + enc)); }
      };
      s.onerror = function () {
        failed[enc] = 1;
        delete loading[enc];
        /* 最常见的原因就是用户把 vendor 那两个 2MB 的文件删了 —— 这是允许的 */
        rej(new Error('加载不到 ' + src + '（文件可能被删了，将回退到粗估）'));
      };
      global.document.head.appendChild(s);
    });
    return loading[enc];
  }

  /** 预热：在设置页打开真实分词、或载入卡之后调一次，之后计数就是同步的 */
  function ready(model) {
    return load(encodingFor(model)).then(function () { return true; },
                                        function () { return false; });
  }

  /**
   * 数 token。分词器没加载好就回退粗估 —— 永远同步返回，
   * 不让界面为了一个数字变成异步。
   */
  function count(text, model) {
    var enc = encodingFor(model);
    var t = tokenizer(enc);
    if (!t) return Math.round(rough(text));
    try { return t.encode(String(text == null ? '' : text)).length; }
    catch (e) { return Math.round(rough(text)); }
  }

  /** 每条消息有角色名和分隔符的固定开销，按 OpenAI 的算法加 4 */
  function countMessage(msg, model) {
    if (!msg) return 0;
    return 4 + count(msg.content, model);
  }
  function countMessages(list, model) {
    var n = 0;
    (list || []).forEach(function (m) { n += countMessage(m, model); });
    return n;
  }

  /** 当前是精确还是粗估，给界面标注用 */
  function mode(model) {
    return tokenizer(encodingFor(model)) ? 'exact' : 'rough';
  }
  function note(model) {
    var enc = encodingFor(model);
    if (!tokenizer(enc)) {
      return '粗估（CJK 1 字 1 token）。实测整体偏低约 6~31%（取决于拿哪套词表当基准），' +
             '短剧本行可低估四成。';
    }
    var m = String(model || '').toLowerCase();
    var openai = /^(gpt|o[1-5]|chatgpt|text-embedding)/.test(m);
    return '真实分词 · ' + enc +
      (openai ? '。对这个模型是精确值。'
              : '。⚠ 这是 OpenAI 的分词器，对 Claude / Gemini 是估算（它们的分词器不公开）。' +
                '这里默认按 o200k 算，因为它们的词表规模更接近 o200k —— 但这是判断，不是实测。');
  }

  global.Tokens = {
    encodingFor: encodingFor, load: load, ready: ready,
    count: count, countMessage: countMessage, countMessages: countMessages,
    rough: rough, mode: mode, note: note, FILES: FILES
  };
})(typeof window !== 'undefined' ? window : globalThis);
