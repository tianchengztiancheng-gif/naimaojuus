/* ============================================================
 * core/engine.js —— 一轮对话的完整流程
 *
 *   用户输入
 *     → 世界书激活 (worldbook.js)
 *     → 提示词组装 (prompt.js)
 *     → 发请求      (api.js，send 可注入替换)
 *     → 正则管线    (内置清理 + 预设自带的正则)
 *     → 剧本解析    (script.js)
 *     → 立绘/背景查找 (resolver.js)
 *     → 模块流，交给界面渲染
 *
 * send 可注入，所以没有 API 密钥也能干跑整条链路。
 * ============================================================ */
(function (global) {
  'use strict';

  var DEFAULTS = {
    scanDepth: 2,
    recursion: true,
    maxRecursion: 3,
    budgetChars: 60000,
    historyLimit: 40,
    scriptOrder: 'auto',
    maxStage: 4,          // 同台角色上限
    /* 登场时用哪张皮肤。false = 原皮（数组第 0 张），true = 随机抽一套。
       默认原皮：卡里那几千个换装 URL 挂在第三方图床上，死链不少，随机抽
       很容易抽到裂图；而且玩家默认期待看到的就是原皮。想要随机的在
       设置 · 外观 里开。 */
    randomSkin: false,
    initialFavor: 80,     // 开局好感度（卡里的规则：新角色默认 80）
    logLimit: 5000        // 日志条数上限，超了从头裁
  };

  /* 模型输出里必须先剥掉的东西（对应卡里的前几条正则） */
  var CLEANERS = [
    { name: '去思维链', re: /<(?:juus_cot|Gal_cot|thinking|think)>[\s\S]*?<\/(?:juus_cot|Gal_cot|thinking|think)>/g, to: '' },
    { name: '去 content 前置', re: /^[\s\S]*?(?=<content>)/, to: '' },
    { name: '去 content 标签', re: /<\/?content>/g, to: '' },
    { name: '直角引号统一', re: /[“”]/g, to: '"' }
  ];

  function Engine(cfg) {
    this.cfg = Object.assign({}, DEFAULTS, cfg || {});
    this.card = null;
    this.preset = null;
    this.pool = [];
    this.regexScripts = [];     // 卡自带的正则（显示用，沿用老行为）
    this.cardRegex = [];        // 卡自带的正则（按酒馆语义，给提示词用）
    this.presetRegex = [];      // 预设自带的正则
    this.userRegex = [];        // 玩家单独导入的正则
    this.regexOff = {};         // 玩家在界面上手动开关过的：{ 'preset:名字': true=关 / false=开 }
    this.lastReasoning = null;  // 上一轮剥思维链的情况，界面据此提示「被截断在思维链里」
    this.history = [];
    this.log = [];              // 全部演过的句子，扁平存放，供回看与跳转
    this.phoneSent = [];        // 手机里产生的消息（玩家发的 + 独立生成的回复）
    this.phoneSeq = 0;          // 手机消息的单调序号，排序只认它
    this.vars = {};          // MVU 风格变量：地点 / 时段 / 人物
    this.lastReport = null;
  }

  Engine.prototype.loadCard = function (card) {
    this.card = card;
    this.pool = global.Worldbook.fromCard(card);
    this.regexScripts = collectRegex(card);
    this.cardRegex = global.GalRegex ? global.GalRegex.fromCard(card) : [];
    if (global.Editors && global.Editors.ensurePhoneRule) {
      global.Editors.ensurePhoneRule(this.pool);
    }
    /* 立绘/场景/手机资源也在这张卡里，顺手抽出来装上。
       以前这一步只能靠 tools/build-juus.py 离线做，没跑过脚本的人
       载完卡舞台还是空的 —— 那是个缺陷，不是设计。见 core/cardres.js。
       抽不到就是抽不到（别的卡没这些变量），不影响其余流程。 */
    this.resStats = null;
    if (global.CardRes) {
      try { this.resStats = global.CardRes.apply(card); }
      catch (e) { this.resStats = null; }
    }
    return this.pool.length;
  };

  /* 卡自带的正则脚本。
     超长 replaceString（几十万字的 HTML 渲染器）跳过——我们有自己的渲染器，
     把那种东西塞进文本流只会把剧本冲掉。这里只收文本清理类的短脚本。 */
  var MAX_REPLACE = 2000;
  function collectRegex(card) {
    var d = (card && (card.data || card)) || {};
    var list = (d.extensions && d.extensions.regex_scripts) || [];
    var out = [];
    list.forEach(function (r) {
      if (r.disabled) return;
      var find = r.findRegex || '';
      /* 空的 findRegex 会编成 new RegExp('','g') —— 它在每个字符缝隙都匹配，
         于是 replaceString 被插得满正文都是，整段剧本就废了。
         卡里那种「只是拿 replaceString 当代码仓库存着」的条目正是这样（没有 findRegex）。 */
      if (!String(find).trim()) return;
      var rep = String(r.replaceString == null ? '' : r.replaceString);
      if (rep.length > MAX_REPLACE) return;                 // 渲染器，跳过
      /* 解析 /body/flags 形式，用字符串切分而不是正则，避免转义地狱 */
      var body = find, flags = 'g';
      if (find.charAt(0) === '/') {
        var last = find.lastIndexOf('/');
        if (last > 0) { body = find.slice(1, last); flags = find.slice(last + 1) || 'g'; }
      }
      if (flags.indexOf('g') === -1) flags += 'g';
      var re;
      try { re = new RegExp(body, flags); } catch (e) { return; }
      out.push({ name: r.scriptName || '(无名)', re: re,
                 to: rep.replace(/\{\{match\}\}/g, '$&') });
    });
    return out;
  }

  Engine.prototype.loadPreset = function (preset) {
    this.preset = preset;
    /* 预设自带的正则 —— 以前完全没读，「隐藏思维链」那条因此失效 */
    this.presetRegex = global.GalRegex ? global.GalRegex.fromPreset(preset) : [];
    /* 有些预设附带世界书（world_info）。换预设时先把上一份预设带来的条目摘掉 */
    this.pool = (this.pool || []).filter(function (e) { return String(e.uid).indexOf('preset:') !== 0; });
    var wi = preset && preset.world_info;
    var list = wi && (Array.isArray(wi) ? wi : (wi.entries || wi));
    if (list && typeof list === 'object') {
      this.presetWiCount = 0;
      try {
        var add = global.Worldbook.fromCard({ data: { character_book: { entries: list } } }, { uidPrefix: 'preset:' })
          .filter(function (e) { return String(e.content || '').trim(); });
        this.pool = this.pool.concat(add);
        this.presetWiCount = add.length;
      } catch (e) {}
    } else this.presetWiCount = 0;
    return global.PromptBuilder.parsePreset(preset).order.length;
  };

  /** 玩家单独导入的正则（酒馆导出的 regex-*.json），传原始脚本数组 */
  Engine.prototype.setUserRegex = function (list) {
    this.userRegex = global.GalRegex ? global.GalRegex.collect(list || [], 'user') : [];
    return this.userRegex.length;
  };

  /** 全部正则，已套上玩家的手动开关。which: 'display' 不含卡（卡走老路径） */
  Engine.prototype.regexList = function (which) {
    var off = this.regexOff || {};
    var all = (which === 'display' ? [] : this.cardRegex || [])
      .concat(this.presetRegex || [], this.userRegex || []);
    return all.map(function (s) {
      var k = s.source + ':' + s.name;
      if (off[k] == null) return s;
      return Object.assign({}, s, { disabled: !!off[k] });
    });
  };

  /** 这个预设 / 导入正则认定的思维链标签（兜底剥思维链时一起认，见 GalRegex.learnCotTags） */
  Engine.prototype.cotTags = function () {
    return global.GalRegex ? global.GalRegex.learnCotTags(this.regexList('prompt')) : [];
  };
  /** 剥思维链，带上从预设学到的标签名 */
  Engine.prototype.stripCot = function (text) {
    return global.GalRegex ? global.GalRegex.stripReasoning(text, this.cotTags())
                           : { text: String(text || ''), stripped: false, unclosed: false, onlyReasoning: false };
  };

  /** 发给模型之前，按酒馆语义处理历史：
      剥掉旧的思维链、跑 promptOnly / 普通正则（带深度筛选）。
      存档里的原文不动。 */
  Engine.prototype.promptHistory = function (hist, userText) {
    var R = global.GalRegex;
    if (!R) return { hist: hist, userText: userText };
    var scripts = this.regexList('prompt');
    var ctx = { charName: this.card && (this.card.data || this.card).name,
                userName: this.cfg.userName || '指挥官' };
    var total = hist.length + (userText ? 1 : 0);
    var tags = this.cotTags();
    /* 正则的替换内容里常带宏：TG 破限把玩家输入包成 <player_input>$1{{getvar::supernsfw}}</player_input>。
       这些宏要等预设块里的 setvar 求值之后才有值，所以这里只做标记（_macro），
       由 PromptBuilder.build() 在预设块之后展开 */
    function macroMark(before, after) { return after !== before && /\{\{/.test(after) && !/\{\{/.test(before); }
    var out = hist.map(function (m, i) {
      var depth = total - 1 - i;
      var c = m.content;
      if (m.role === 'assistant') c = R.stripPlaceholders(R.stripReasoning(c, tags).text || c, null, true);
      var c2 = R.run(c, scripts, { mode: 'prompt', depth: depth, ctx: ctx,
        placement: m.role === 'user' ? R.PLACE.USER : R.PLACE.AI });
      if (c2 === m.content) return m;
      return Object.assign({}, m, { content: c2, _macro: macroMark(c, c2) });
    });
    var u = userText ? R.run(userText, scripts,
      { mode: 'prompt', depth: 0, ctx: ctx, placement: R.PLACE.USER }) : userText;
    return { hist: out, userText: u, userMacro: !!userText && macroMark(userText, u) };
  };

  /** 额外世界书（独立 .json 导出的 World Info） */
  Engine.prototype.addWorldbook = function (wi) {
    var entries = wi && (wi.entries || wi);
    var list = Array.isArray(entries) ? entries
             : Object.keys(entries || {}).map(function (k) { return entries[k]; });
    /* 每次导入给一个唯一前缀，避免和卡内条目（以及上一次导入的）uid 撞车 */
    this._wiSeq = (this._wiSeq || 0) + 1;
    var add = global.Worldbook.fromCard(
      { data: { character_book: { entries: list } } },
      { uidPrefix: 'wi' + this._wiSeq + ':' });
    this.pool = this.pool.concat(add);
    return add.length;
  };

  /** 只组装不发送——干跑，用来检视会发出去什么 */
  Engine.prototype.dryRun = function (userText, opt) {
    opt = opt || {};
    /* 手机独立生成产生的记录不当成主线对话发回去 ——
       它们会以 <手机记录> 的形式被压缩注入，避免重复又省 token */
    var hist = this.history.filter(function (m) { return !m.phoneOnly; })
                           .slice(-this.cfg.historyLimit);
    var scanHist = hist.concat(userText ? [{ role: 'user', content: userText }] : []);

    var wb = global.Worldbook.activate(this.pool, scanHist, {
      scanDepth: this.cfg.scanDepth,
      recursion: this.cfg.recursion,
      maxRecursion: this.cfg.maxRecursion,
      budgetChars: this.cfg.budgetChars,
      /* 设置里切到「按 token 裁」时才有这两项；没有就还按字符裁（老行为） */
      budgetTokens: this.cfg.budgetTokens,
      model: this.cfg.model,
      /* 语义检索补的条目由 turn() 先算好传进来（那是异步的，dryRun 是同步的） */
      semantic: opt.semantic || this._semantic || [],
      rng: opt.rng
    });

    /* 世界书扫描用原文；发给模型的历史要先过正则、剥思维链 */
    var ph = this.promptHistory(hist, userText);
    var built = global.PromptBuilder.build({
      preset: this.preset, card: this.card, history: ph.hist, userText: ph.userText,
      userTextMacro: ph.userMacro,
      worldbook: wb,
      charName: opt.charName || (this.card && (this.card.data || this.card).name),
      userName: opt.userName || '指挥官',
      personaDescription: opt.persona || '',
      macroVars: this.macroVars || (this.macroVars = {}),
      model: this.cfg.model || (global.GalAPI && global.GalAPI.loadConfig().model) || '',
      /* opt.extraHint：只对这一次请求有效的附加要求（重roll 时的「换一种写法」） */
      extraSystem: [this.renderVars(), this.renderPhoneLog(), opt.extraHint || ''].filter(Boolean).join('\n\n')
    });

    this.lastReport = { worldbook: wb, prompt: built };
    return { messages: built.messages, params: built.params, worldbook: wb, report: built.report };
  };

  /** 把当前变量状态渲染成一段可注入的文本 */
  /**
   * 从开场白正文推导初始变量：地点、时段、登场角色（含服装与在场）。
   * 开局如果什么都不设，第一轮模型拿到的状态是空的，容易自己瞎编。
   */
  Engine.prototype.seedVarsFromOpening = function (raw, opt) {
    opt = opt || {};
    var parsed = global.ScriptParser.parse(raw);
    var loc = '', period = '', cast = [];
    parsed.events.forEach(function (ev) {
      if (ev.type === 'bg') {
        if (!loc) loc = ev.loc || '';
        if (!period) period = ev.period || '';
      } else if (ev.type === 'say' && !ev.narration) {
        ev.who.split(/[&＆]/).forEach(function (n) {
          n = n.trim();
          if (n && cast.indexOf(n) < 0) cast.push(n);
        });
      }
    });

    var chars = (global.RESOURCE && global.RESOURCE.characters) || {};
    var people = {};
    var favor = opt.favor;
    if (favor == null) favor = this.cfg.initialFavor;
    if (favor == null) favor = 80;
    cast.forEach(function (n) {
      var table = chars[n];
      people[n] = {
        好感度: favor,
        是否誓约: false,
        服装: table ? (table.default_outfit || Object.keys(table.outfits || {})[0] || '常服') : '常服',
        当前状态: '平静',
        在场: !!table
      };
    });

    this.vars = {
      时间: { 天数: 1, 时段: period || '白日' },
      地点: loc || '',
      人物: people
    };
    return { loc: loc, period: period, cast: cast };
  };

  /**
   * 皮肤：角色第一次登场时定下一套并记住，之后整场都用这套。
   * 每句都重新挑的话画面会一直跳衣服；玩家在皮肤面板里手选后会锁住（locked）。
   *
   * 默认取第 0 张（原皮）。cfg.randomSkin 打开才随机抽 —— 别把这个默认改回
   * true：卡里的换装图死链率不低，随机抽经常抽到裂图，玩家看到的还不是原皮。
   */
  Engine.prototype.ensureSkin = function (name) {
    var a = (global.RESOURCE && global.RESOURCE.defaults &&
             global.RESOURCE.defaults[name]) || [];
    if (a.length <= 1) return 0;
    this.vars.人物 = this.vars.人物 || {};
    var p = this.vars.人物[name] = this.vars.人物[name] || {};
    if (p.皮肤 == null) {
      p.皮肤 = this.cfg.randomSkin === false ? 0 : Math.floor(Math.random() * a.length);
    }
    return p.皮肤;
  };

  /**
   * 玩家手动选皮肤。
   * @param {boolean} [lock=true] 是否锁定 —— 锁定后**后续每一轮**都用这张，
   *        不锁就只影响当前这一句（换装面板里那个「点了就锁定」开关控制）。
   */
  Engine.prototype.setSkin = function (name, index, outfit, lock) {
    this.vars.人物 = this.vars.人物 || {};
    var p = this.vars.人物[name] = this.vars.人物[name] || {};
    if (index == null) { delete p.皮肤; p.皮肤锁定 = false; }
    else {
      p.皮肤 = index;
      p.皮肤锁定 = (lock === false) ? false : true;
    }
    if (outfit) p.服装 = outfit;
    return p;
  };

  /** 把一轮的模块追加进全局日志，返回这批的起始下标 */
  Engine.prototype.appendLog = function (modules, meta) {
    var start = this.log.length;
    /* 轮次用日志自己的序号，别跟 history.length 挂钩 ——
       开场白会先入 history，导致第一轮显示成"第 2 轮"。 */
    var last = this.log[this.log.length - 1];
    var turn = (meta && meta.turn != null) ? meta.turn
             : (last ? last.turn + 1 : 0);
    var self = this;
    (modules || []).forEach(function (m) {
      m.turn = turn;
      self.log.push(m);
    });
    /* 无限增长会把存档撑大（每句约 900 字节），超上限就从头裁 */
    var over = this.log.length - (this.cfg.logLimit || 5000);
    if (over > 0) { this.log.splice(0, over); start = Math.max(0, start - over); }
    return start;
  };

  Engine.prototype.renderVars = function () {
    var v = this.vars;
    if (!v || !Object.keys(v).length) return '';
    var lines = ['<当前状态>'];
    if (v.时间) lines.push('时间：第' + (v.时间.天数 || 1) + '天 ' + (v.时间.时段 || ''));
    if (v.地点) lines.push('地点：' + v.地点);
    if (v.人物) {
      var on = Object.keys(v.人物).filter(function (n) { return v.人物[n] && v.人物[n].在场; });
      if (on.length) {
        lines.push('在场：' + on.map(function (n) {
          var p = v.人物[n];
          return n + '(' + (p.服装 || '常服') + '/好感' + (p.好感度 == null ? '-' : p.好感度) + ')';
        }).join('、'));
      }
    }
    lines.push('</当前状态>');
    return lines.join('\n');
  };

  /** 手机记录压成一段注入主线，让剧情知道你在手机上说过什么 */
  Engine.prototype.renderPhoneLog = function () {
    if (!global.Phone || !global.Phone.renderForStory) return '';
    try {
      return global.Phone.renderForStory(
        global.Phone.scan(this.history, this.phoneSent,
          { userName: this.cfg.userName || '指挥官' }), 6);
    } catch (e) { return ''; }
  };

  /**
   * 给手机独立生成准备上下文：
   *   lore  —— 拿角色名和最近的聊天去激活世界书，取她自己的设定条目
   *   scene —— 当前地点/时段/在场，加最近几句剧情
   * 原脚本走的是酒馆的 generateQuietPrompt（skip_wian:false，世界书照常生效），
   * 这边没有那套管线，所以手动查一遍补上。
   */
  Engine.prototype.quietContext = function (scanText, opt) {
    opt = opt || {};
    var budget = opt.loreChars || 3500;
    var who = String(opt.who || '').trim();
    var lore = '';
    try {
      /* 先不设预算地激活，过滤完再裁 ——
         否则「柴郡」这种六千多字的人设会先被预算砍掉，
         只剩「柴郡差分」那种一百多字的立绘名单，等于什么都没带上。 */
      var r = global.Worldbook.activate(this.pool,
        [{ role: 'user', content: String(scanText || '') }],
        { scanDepth: 1, recursion: false, rng: function () { return 0.01; } });

      var JUNK = /差分|列表|格式|规则|输出|开局|契约|导向|总集|cg$|CG$|tag|标签/;
      var hits = r.active.filter(function (e) {
        return !e.constant && !JUNK.test(e.comment || '') &&
               String(e.content || '').trim();
      });
      /* 名字和角色完全对上的排最前 */
      hits.sort(function (a2, b2) {
        var sa = (a2.comment || '') === who ? 0 : 1;
        var sb = (b2.comment || '') === who ? 0 : 1;
        return sa - sb;
      });

      var parts = [], used = 0;
      for (var i = 0; i < hits.length && used < budget; i++) {
        var head = hits[i].comment ? '【' + hits[i].comment + '】\n' : '';
        var body = String(hits[i].content || '').trim();
        var room = budget - used - head.length;
        if (room < 120) break;
        if (body.length > room) body = body.slice(0, room) + '…（已截断）';
        parts.push(head + body);
        used += head.length + body.length;
      }
      lore = parts.join('\n\n');
    } catch (e) {}

    var v = this.vars || {}, t = v.时间 || {};
    var ppl = v.人物 || {};
    var on = Object.keys(ppl).filter(function (n) { return ppl[n] && ppl[n].在场; });
    var head2 = [];
    if (v.地点) head2.push('地点：' + v.地点);
    if (t.时段) head2.push('时间：第' + (t.天数 || 1) + '天 ' + t.时段);
    if (on.length) head2.push('在场：' + on.join('、'));
    var recent = this.log.slice(-(opt.recentLines || 8)).map(function (m) {
      return (m.narration ? '旁白' : m.who) + '：' + m.text;
    }).join('\n');
    var scene = head2.join('　') + (recent ? '\n最近发生的：\n' + recent : '');

    return { lore: lore, scene: scene.trim() };
  };

  /** 独立生成：不进主线历史，不产生剧情日志 */
  Engine.prototype.quiet = async function (prompt, opt) {
    opt = opt || {};
    var send = opt.send || this.cfg.quietSend;
    if (!send) throw new Error('未配置独立生成通道');
    var out = await send([{ role: 'user', content: prompt }], {
      maxTokens: opt.maxTokens || 600,
      temperature: opt.temperature
    });
    /* 推理模型在独立通道里也可能先吐 <think>，手机消息里不该出现 */
    if (global.GalRegex && typeof out === 'string') out = this.stripCot(out).text || out;
    return out;
  };

  /* ============================================================
     变量更新：这张卡用的是 MVU 的 <UpdateVariable> + RFC 6902 JSON Patch，
     不是 _.set() 那种写法。支持 replace / delta / insert / remove / move。
     为兼容别的卡，旧的 _.set('路径', 值) 也继续认。
     ============================================================ */

  function ptrParse(path) {
    /* JSON Pointer："/人物/柴郡/好感度" → ['人物','柴郡','好感度'] */
    return String(path || '').replace(/^\//, '').split('/')
      .map(function (seg) {
        return seg.replace(/~1/g, '/').replace(/~0/g, '~');
      })
      .filter(function (x) { return x !== ''; });
  }

  function ptrGetParent(root, parts) {
    var cur = root;
    for (var i = 0; i < parts.length - 1; i++) {
      var k = parts[i];
      if (cur == null) return null;
      if (Array.isArray(cur)) k = parseInt(k, 10);
      if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
      cur = cur[k];
    }
    return cur;
  }

  function applyPatchOp(root, op) {
    var kind = String(op.op || '').toLowerCase();
    var parts = ptrParse(kind === 'move' ? op.from : op.path);
    if (!parts.length) return null;
    var parent = ptrGetParent(root, parts);
    if (parent == null) return null;
    var key = parts[parts.length - 1];
    var arr = Array.isArray(parent);
    var idx = arr ? (key === '-' ? parent.length : parseInt(key, 10)) : key;

    if (kind === 'replace' || kind === 'insert' || kind === 'add') {
      var v = op.value;
      /* 模型常把数字写成字符串，能转就转 */
      if (typeof v === 'string' && v !== '' && !isNaN(Number(v))) v = Number(v);
      if (typeof v === 'string' && /^(true|false)$/i.test(v)) v = /^true$/i.test(v);
      if (arr && key === '-') parent.push(v); else parent[idx] = v;
      return parts.join('.') + ' = ' + JSON.stringify(v);
    }
    if (kind === 'delta') {
      var d = Number(op.value);
      if (isNaN(d)) return null;
      var old = Number(parent[idx]) || 0;
      var nv = old + d;
      /* 好感度按卡里的规则夹紧：上限 100，誓约后 200 */
      if (key === '好感度') {
        var cap = (parent && parent.是否誓约) ? 200 : 100;
        nv = Math.max(0, Math.min(cap, nv));
      }
      parent[idx] = nv;
      return parts.join('.') + ' ' + (d >= 0 ? '+' : '') + d + ' → ' + nv;
    }
    if (kind === 'remove') {
      if (arr) parent.splice(idx, 1); else delete parent[idx];
      return parts.join('.') + ' 已删除';
    }
    if (kind === 'move') {
      var val = parent[idx];
      if (arr) parent.splice(idx, 1); else delete parent[idx];
      var toParts = ptrParse(op.to || op.path);
      var toParent = ptrGetParent(root, toParts);
      if (toParent) toParent[toParts[toParts.length - 1]] = val;
      return parts.join('.') + ' → ' + toParts.join('.');
    }
    return null;
  }

  /** 解析模型输出里的变量更新块，合并进变量 */
  Engine.prototype.applyUpdates = function (text) {
    var changed = [];
    var self = this;
    var src = String(text || '');

    /* ① MVU：<UpdateVariable> … <JSONPatch>[ … ]</JSONPatch> */
    src.replace(/<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/gi, function (m, body) {
      var jp = /<JSONPatch>([\s\S]*?)<\/JSONPatch>/i.exec(body);
      var raw = jp ? jp[1] : body;
      var start = raw.indexOf('['), end = raw.lastIndexOf(']');
      if (start < 0 || end <= start) return '';
      var ops;
      try { ops = JSON.parse(raw.slice(start, end + 1)); }
      catch (e) {
        /* 模型偶尔会留尾逗号或注释，清一遍再试 */
        try {
          ops = JSON.parse(raw.slice(start, end + 1)
            .replace(/\/\/[^\n]*/g, '').replace(/,\s*([\]}])/g, '$1'));
        } catch (e2) { return ''; }
      }
      (Array.isArray(ops) ? ops : []).forEach(function (op) {
        try {
          var note = applyPatchOp(self.vars, op);
          if (note) changed.push(note);
        } catch (e3) {}
      });
      return '';
    });

    /* ② 旧写法：<update> 里的 _.set('路径', 值) 或 路径 = 值 */
    src.replace(/<update>([\s\S]*?)<\/update>/gi, function (m, body) {
      body.split('\n').forEach(function (ln) {
        var mm = ln.match(/_\.set\(\s*['"]([^'"]+)['"]\s*,\s*([\s\S]+?)\s*\)/) ||
                 ln.match(/^\s*([\u4e00-\u9fa5\w.]+)\s*=\s*(.+?)\s*;?\s*$/);
        if (!mm) return;
        var path = mm[1];
        var args = mm[2].trim().replace(/[,;]$/, '');
        /* MVU 的 _.set 有时是 (路径, 旧值, 新值)，取最后一个 */
        var pieces = args.split(/\s*,\s*/);
        var raw2 = pieces[pieces.length - 1];
        var val;
        try { val = JSON.parse(raw2); }
        catch (e) { val = raw2.replace(/^['"]|['"]$/g, ''); }
        self.setVar(path, val);
        changed.push(path + ' = ' + JSON.stringify(val));
      });
      return '';
    });

    return changed;
  };

  Engine.prototype.setVar = function (path, val) {
    var parts = String(path).split('.'), cur = this.vars;
    for (var i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  };

  /** 模型原文 → 清洗 → 剧本模块流 */
  Engine.prototype.processOutput = function (raw) {
    var text = String(raw || '');
    var applied = [];
    /* 快照：<update> 改的地点应从下一轮生效，不能回溯到本轮画面 */
    /* 换了表情就允许重新抽图，所以每轮清一次记忆 */
    this._picked = {};
    var sceneAtTurnStart = {
      loc: this.vars.地点 || '',
      period: (this.vars.时间 && this.vars.时间.时段) || ''
    };
    var outfitAtTurnStart = JSON.parse(JSON.stringify(this.vars.人物 || {}));

    /* 思维链先剥，而且要早于一切 —— 推理里常常照抄格式示例
       （手机标签、变量更新），不先摘掉会被当成真的认领 */
    this.lastReasoning = null;
    if (global.GalRegex) {
      var sr = this.stripCot(text);
      this.lastReasoning = sr;
      if (sr.stripped) { text = sr.text; applied.push(sr.unclosed ? '去思维链(未闭合)' : '去思维链'); }
      text = global.GalRegex.stripPlaceholders(text, applied);
    }

    CLEANERS.forEach(function (c) {
      var before = text;
      text = text.replace(c.re, c.to);
      if (before !== text) applied.push(c.name);
    });

    /* 手机标签要在正则清理之前留存（卡里有条正则会把它们删掉），
       解析完再从正文摘掉，免得被当成台词演出来 */
    var phoneRaw = text;
    if (global.Phone && global.Phone.has(text)) text = global.Phone.strip(text);

    /* 文生图的 <image> 块也要在这里整块抠掉 ——
       必须早于 ScriptParser.parse()。天青踩过这个坑：块里的
       "Character 1 Prompt: …|centers:c3" 含 |，而剧本行正是用 | 分段的，
       不先摘掉就会被切成一串假台词演出来。 */
    var inlinePrompts = [];
    if (global.Snapshot && global.Snapshot.hasInline(text)) {
      var si = global.Snapshot.stripInline(text);
      inlinePrompts = si.prompts;
      text = si.text;
    }

    var updates = this.applyUpdates(text);
    text = text.replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi, '')
               .replace(/<update>[\s\S]*?<\/update>/gi, '');

    /* 卡自带的短正则（省略号优化、标点归一等） */
    (this.regexScripts || []).forEach(function (r) {
      try {
        var before = text;
        text = text.replace(r.re, r.to);
        if (before !== text) applied.push(r.name);
      } catch (e) {}
    });

    /* 预设自带 + 单独导入的正则（只跑作用于 AI 输出、且影响显示的那些） */
    if (global.GalRegex) {
      text = global.GalRegex.run(text, this.regexList('display'), {
        mode: 'display', placement: global.GalRegex.PLACE.AI, depth: 0, applied: applied,
        ctx: { charName: this.card && (this.card.data || this.card).name,
               userName: this.cfg.userName || '指挥官' }
      });
    }

    /* 预设里那些「把某个标签块渲染成 HTML 卡片」的正则（行动选项、特写卡片……）舞台执行不了。
       不处理的话，<w2g> 这种标签会被当成一句旁白演出来。能认出是选项的改成真正的选项按钮，
       其余的去掉标签、内容当旁白 */
    if (global.GalRegex) text = tidyRenderBlocks(text, global.GalRegex.renderTagsOf(this.regexList('display')), applied);

    var parsed = global.ScriptParser.parse(text, { order: this.cfg.scriptOrder });
    var self = this;
    var modules = global.ScriptParser.toModules(parsed.events, {
      maxStage: this.cfg.maxStage,
      loc: sceneAtTurnStart.loc,
      period: sceneAtTurnStart.period,
      outfitOf: function (name) {
        var p = outfitAtTurnStart[name];
        return (p && p.服装) || null;
      },
      skinOf: function (name) {
        var p = outfitAtTurnStart[name];
        return p && p.皮肤 != null ? p.皮肤 : null;
      },
      lockedOf: function (name) {
        var p = outfitAtTurnStart[name];
        return (p && p.皮肤锁定 && p.皮肤 != null) ? p.皮肤 : null;
      }
    });

    /* 剧本自带地点（<背景|> 或『』抬头）时回写进变量，下一轮沿用。
       但若本轮 <update> 明确改过地点，以 update 为准 —— 它表示回合结束时的位置，
       抬头只描述本轮画面。 */
    var updatedLoc = updates.some(function (u) { return /(^|\.)地点\s*=/.test(u); });
    if (!updatedLoc && modules._lastBg && modules._lastBg.loc) {
      this.vars.地点 = modules._lastBg.loc;
      if (modules._lastBg.period) {
        this.vars.时间 = this.vars.时间 || {};
        this.vars.时间.时段 = modules._lastBg.period;
      }
    }

    /* 把每句要用的图直接解析好，顺便记下兜底情况。
       同一个「角色+服装+表情」在这一轮里只抽一次图 ——
       近一半表情有多张差分，每句重抽的话，没说话的人也会跟着换图、播抖动特效。 */
    var misses = [];
    var self = this;
    var picked = this._picked || (this._picked = {});
    function hasExpr(n) {
      var c = global.RESOURCE && global.RESOURCE.characters && global.RESOURCE.characters[n];
      return !!c;
    }
    modules.forEach(function (m) {
      m.sprites = m.stage.map(function (c) {
        /* 优先级：玩家手选的皮肤 > 表情差分 > 登场时随机抽的皮肤。
           有表情差分的角色不随机换皮，否则情绪演出就毁了。 */
        var skin = null;
        if (c.skinLocked != null) skin = c.skinLocked;            // 玩家点过
        else if (!hasExpr(c.name)) skin = self.ensureSkin(c.name); // 只有默认立绘
        var key = c.name + '|' + (c.outfit || '') + '|' + c.expr + '|' + skin;
        if (picked[key]) return picked[key];
        var r = global.Resolver.sprite(c.name, c.expr,
          { outfit: c.outfit, skin: skin });
        if (r) picked[key] = r;
        if (!r) misses.push({ kind: 'sprite', who: c.name, expr: c.expr, via: 'miss' });
        else if (r.via !== 'exact') misses.push({ kind: 'sprite', who: c.name, expr: c.expr, via: r.via });
        return r;
      }).filter(Boolean);
      if (m.bg.loc) {
        m.scene = global.Resolver.scene(m.bg.loc, m.bg.period);
        if (m.scene && m.scene.via !== 'exact') {
          misses.push({ kind: 'scene', loc: m.bg.loc, via: m.scene.via });
        }
      }
    });

    /* 同一个缺口只报一次 */
    var seen = {}, uniq = [];
    misses.forEach(function (m) {
      var k = m.kind + '|' + (m.who || m.loc) + '|' + (m.expr || '') + '|' + m.via;
      if (seen[k]) { seen[k].count++; return; }
      m.count = 1; seen[k] = m; uniq.push(m);
    });

    return {
      text: text, modules: modules, updates: updates,
      cleaners: applied, order: parsed.order, misses: uniq,
      reasoning: this.lastReasoning,
      inlinePrompts: inlinePrompts,
      hasPhone: !!(global.Phone && global.Phone.has(phoneRaw))
    };
  };

  /**
   * 语义检索：把关键词捞不到、但语义上贴近的条目补进来。
   * 单独一步是因为它要发一次 embeddings 请求（异步），而 dryRun 是同步的。
   * 任何一步出问题都只是「这一层没生效」，绝不影响关键词激活。
   */
  Engine.prototype.semanticHits = async function (userText, opt) {
    opt = opt || {};
    if (!global.Vector || !global.Vector.config().enabled) return [];
    try {
      var hist = this.history.filter(function (m) { return !m.phoneOnly; });
      var scan = hist.concat(userText ? [{ role: 'user', content: userText }] : []);
      /* 先按关键词跑一遍，把已经命中的排除掉 —— 语义只补漏，不重复 */
      var pre = global.Worldbook.activate(this.pool, scan, {
        scanDepth: this.cfg.scanDepth, recursion: false,
        rng: function () { return 0.01; }
      });
      var turn = this.log.length ? this.log[this.log.length - 1].turn + 1 : 0;
      return await global.Vector.query(scan, this.pool, { exclude: pre.active, turn: turn });
    } catch (e) {
      return [];
    }
  };

  /** 完整一轮。send(messages, params) => Promise<string> */
  Engine.prototype.turn = async function (userText, opt) {
    opt = opt || {};
    if (opt.semantic == null) opt.semantic = await this.semanticHits(userText, opt);
    var dry = this.dryRun(userText, opt);
    var send = opt.send || this.cfg.send || defaultSend;
    var raw = await send(dry.messages, dry.params);
    /* 抗空回：一个字没有、或者剥掉思维链和占位块后什么都不剩，自动再要一次。
       但如果是「写思维链写到上限被截断」，再要一次也一样，那种交给界面提示调大最大输出。
       （KaiTuoYiShi 的主剧情也是空回自动重试一次） */
    var tries = opt.emptyRetries == null ? 1 : opt.emptyRetries;
    for (var k = 0; k < tries && this.isEmptyReply(raw); k++) {
      var lf = global.GalAPI && global.GalAPI.lastFinish;
      if (lf && lf.info && lf.info.kind === 'length') break;
      if (opt.onEmptyRetry) { try { opt.onEmptyRetry(k + 1); } catch (e) {} }
      raw = await send(dry.messages, dry.params);
    }
    var res = this.processOutput(raw);
    /* 登记这一轮注入了哪些条目，供下一轮的时间衰减降权 */
    if (global.Vector && dry.worldbook) {
      var t = this.log.length ? this.log[this.log.length - 1].turn + 1 : 0;
      global.Vector.noteActivated(dry.worldbook.active, t);
    }
    if (userText) this.history.push({ role: 'user', content: userText });
    this.history.push({ role: 'assistant', content: this.historyTextOf(raw) });
    res.raw = raw;
    res.request = dry;
    return res;
  };

  /** 存进历史的版本：剥掉思维链和占位块。每轮都把上一轮的推理原样发回去，
      token 越滚越大，模型还会照着旧推理写。原文在 res.raw 里，调试面板看得到。 */
  Engine.prototype.historyTextOf = function (raw) {
    var keep = String(raw == null ? '' : raw);
    if (global.GalRegex) {
      keep = this.stripCot(keep).text || keep;
      keep = global.GalRegex.stripPlaceholders(keep, null, true) || keep;
    }
    return keep;
  };

  /** 这条回复有没有能演的正文 */
  Engine.prototype.isEmptyReply = function (raw) {
    var t = String(raw == null ? '' : raw);
    if (!t.trim()) return true;
    var R = global.GalRegex;
    if (!R) return false;
    t = R.stripPlaceholders(this.stripCot(t).text);
    /* 只剥「空壳标签」<content></content> 这种；<背景|港区> 这类剧本行里有内容，不能算空 */
    return !t.replace(/<\/?[A-Za-z_][\w-]*\s*>/g, '').trim();
  };

  function defaultSend(messages, params) {
    if (!global.天青_api || typeof global.天青_api.chat !== 'function') {
      return Promise.reject(new Error('未接入 API：请先配置 天青_api，或在 turn() 里传 send'));
    }
    return global.天青_api.chat({ messages: messages, stream: false });
  }

  var OPT_HEAD = /^(?:[A-Za-z]|[0-9]{1,2}|[一二三四五六七八九十])\s*[.．、:：)）]\s*/;
  function escRe(t) { return String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  /**
   * @param {string[]} tags 渲染器正则负责的标签（GalRegex.renderTagsOf）
   * 块里每行都是「A：…」「1. …」这种 → 转成 <choice>[…][…]</choice>，舞台上就是选项按钮；
   * 否则去掉标签，内容当旁白。最后把落单的纯标签行（<xxx> / </xxx>）清掉 ——
   * 剧本解析会把它当成一句只有标签名的旁白。
   */
  function tidyRenderBlocks(text, tags, applied) {
    (tags || []).forEach(function (t) {
      var re = new RegExp('<' + escRe(t) + '(?:\\s[^<>]*)?>([\\s\\S]*?)<\\/' + escRe(t) + '\\s*>', 'g');
      text = text.replace(re, function (m, inner) {
        var lines = inner.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
        var opts = lines.filter(function (l) { return OPT_HEAD.test(l); });
        if (opts.length >= 2 && opts.length >= lines.length - 1) {
          if (applied) applied.push('<' + t + '> → 选项');
          return '\n<choice>' + opts.map(function (l) {
            return '[' + l.replace(OPT_HEAD, '').replace(/[\[\]]/g, '') + ']';
          }).join('') + '</choice>\n';
        }
        if (applied) applied.push('<' + t + '> → 旁白');
        return '\n' + inner.trim() + '\n';
      });
    });
    return text.replace(/^[ \t]*<\/?([A-Za-z_][\w-]*)[ \t]*>[ \t]*$/gm, function (m, name) {
      return /^(Gal|content|choice|env)$/i.test(name) ? m : '';
    });
  }

  global.Engine = Engine;
  Engine.tidyRenderBlocks = tidyRenderBlocks;
  global.Engine.DEFAULTS = DEFAULTS;
})(typeof window !== 'undefined' ? window : globalThis);
