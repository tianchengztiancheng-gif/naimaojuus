/* ============================================================
 * core/editors.js —— 人设 / 预设 / 世界书 的查看与编辑
 *
 * 直接操作引擎里的数据：
 *   人设   → localStorage（注入 prompt.js 的 personaDescription）
 *   预设   → eng.preset.prompts[] 与 prompt_order（改启用状态与正文）
 *   世界书 → eng.pool[]（改关键词、正文、蓝绿灯、开关；可新增可删除）
 *
 * 改动即时生效于下一轮请求；可导出成 JSON 存回本地。
 * 预设正文原样展示与保存，本模块不解读其内容。
 * ============================================================ */
(function (global) {
  'use strict';

  var PERSONA_KEY = 'gal_persona';

  /* ---------------- 人设 ---------------- */
  function loadPersona() {
    try {
      var raw = global.localStorage.getItem(PERSONA_KEY);
      var d = raw ? JSON.parse(raw) : {};
      return {
        name: d.name || '指挥官',
        description: d.description || '',
        position: d.position || 'prompt',   // prompt | depth
        depth: d.depth == null ? 4 : d.depth
      };
    } catch (e) { return { name: '指挥官', description: '', position: 'prompt', depth: 4 }; }
  }
  function savePersona(p) {
    try { global.localStorage.setItem(PERSONA_KEY, JSON.stringify(p)); } catch (e) {}
    return p;
  }

  /* ---------------- 预设 ---------------- */
  /** 读出可编辑的块列表：{identifier, name, marker, enabled, role, content, chars} */
  function presetBlocks(preset) {
    if (!preset) return [];
    var byId = {};
    (preset.prompts || []).forEach(function (p) { byId[p.identifier] = p; });
    var og = global.PromptBuilder && global.PromptBuilder.orderOf(preset);
    var order = (og && og.order) || [];
    if (!order.length) {
      order = (preset.prompts || []).map(function (p) {
        return { identifier: p.identifier, enabled: p.enabled !== false };
      });
    }
    return order.map(function (o, i) {
      var p = byId[o.identifier] || {};
      return {
        idx: i,
        identifier: o.identifier,
        name: p.name || o.identifier,
        marker: !!p.marker,
        enabled: !!o.enabled,
        role: p.role || 'system',
        content: global.PromptBuilder ? global.PromptBuilder.textOf(p) : String(p.content || ''),
        chars: (global.PromptBuilder ? global.PromptBuilder.textOf(p) : String(p.content || '')).length
      };
    });
  }
  function setBlockEnabled(preset, identifier, on) {
    var og = global.PromptBuilder && global.PromptBuilder.orderOf(preset);
    var order = og && og.order;
    if (!order) return false;
    for (var i = 0; i < order.length; i++) {
      if (order[i].identifier === identifier) { order[i].enabled = !!on; return true; }
    }
    return false;
  }
  function setBlockContent(preset, identifier, text) {
    var list = preset.prompts || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].identifier === identifier) { list[i].content = String(text); return true; }
    }
    return false;
  }
  function moveBlock(preset, identifier, delta) {
    var og = global.PromptBuilder && global.PromptBuilder.orderOf(preset);
    var order = og && og.order;
    if (!order) return false;
    var i = -1, k;
    for (k = 0; k < order.length; k++) if (order[k].identifier === identifier) i = k;
    var j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return false;
    var t = order[i]; order[i] = order[j]; order[j] = t;
    return true;
  }

  /* ---------------- 世界书 ---------------- */
  var POS_NAME = ['角色前', '角色后', '作者注顶', '作者注底', '按深度', '示例顶', '示例底'];

  function newEntry() {
    return {
      uid: 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1000),
      comment: '新条目', content: '', key: [], keysecondary: [],
      constant: false, enabled: true, selectiveLogic: 0,
      order: 100, position: 1, depth: 4, probability: 100, useProbability: true,
      caseSensitive: false, matchWholeWords: false,
      preventRecursion: false, excludeRecursion: false,
      custom: true
    };
  }

  function findEntry(pool, uid) {
    for (var i = 0; i < pool.length; i++) {
      if (String(pool[i].uid) === String(uid)) return pool[i];
    }
    return null;
  }

  function asKeyArray(v) {
    if (Array.isArray(v)) return v;
    return String(v || '').split(/[,，]/).map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  /** 统计：总数 / 启用 / 蓝灯 / 常驻字数 */
  function bookStats(pool) {
    var on = pool.filter(function (e) { return e.enabled !== false; });
    var allConst = pool.filter(function (e) { return e.constant; });
    var onConst = on.filter(function (e) { return e.constant; });
    return {
      total: pool.length,
      enabled: on.length,
      /* 磁贴显示的是"这一类共几条"，和点进去筛出来的条数一致；
         真正会注入的数量另给 enabledConstant / enabledSelective。 */
      constant: allConst.length,
      selective: pool.length - allConst.length,
      enabledConstant: onConst.length,
      enabledSelective: on.length - onConst.length,
      constantChars: onConst.reduce(function (s, e) {
        return s + String(e.content || '').length; }, 0)
    };
  }

  /** 导出成 SillyTavern 世界书格式，可以导回酒馆 */
  function exportBook(pool, name) {
    var entries = {};
    pool.forEach(function (e, i) {
      entries[i] = {
        uid: i, key: asKeyArray(e.key), keysecondary: asKeyArray(e.keysecondary),
        comment: e.comment || '', content: e.content || '',
        constant: !!e.constant, selective: !e.constant,
        selectiveLogic: Number(e.selectiveLogic) || 0,
        order: Number(e.order) || 100, position: Number(e.position) || 0,
        depth: Number(e.depth) || 4, disable: e.enabled === false,
        probability: Number(e.probability) || 100,
        useProbability: e.useProbability !== false,
        caseSensitive: !!e.caseSensitive, matchWholeWords: !!e.matchWholeWords
      };
    });
    return { name: name || '导出的世界书', entries: entries };
  }

  /* ---------------- 内置：手机内容输出规则 ----------------
     让模型每轮顺手产出手机内容。做成世界书条目而不是写死在代码里，
     是为了你能在「世界书」App 里看到它、改它、关掉它。 */
  var STAGE_RULE_ID = '__engine_stage_rule';
  var STAGE_RULE_TEXT = [
    '【立绘出入场规则】',
    '正文里可以随时插入下面这两条指令，各占一行，玩家看不到它们。',
    '',
    '· 有人离开画面：<退场|角色名>　多人用竖线分隔：<退场|Z23|Z52>　全部清空：<退场|全部>',
    '· 有人进入画面：<登场|角色名:表情>　多人：<登场|长门:微笑|柴郡:得意>',
    '',
    '什么时候用：',
    '1. 角色说完「我先走了」「那我回去了」之类的话之后，紧跟一条 <退场|她>。',
    '2. 有人推门进来、跑过来、被叫来时，先 <登场|她:表情> 再写她的台词。',
    '3. 场景整体转换（换地点）时不必手写退场，换地点的抬头会自动清台。',
    '4. 一个人默默走开、被拉走、睡着离席，同样要退场；不要让她一直杵在画面里。',
    '',
    '同屏最多 4 人。超出时最久没说话的会自动下场，但显式的 <退场|…> 更准确。'
  ].join('\n');

  function stageRuleEntry() {
    return {
      uid: STAGE_RULE_ID,
      comment: '【引擎】立绘出入场规则',
      content: STAGE_RULE_TEXT,
      key: [], keysecondary: [],
      constant: true, enabled: true, selectiveLogic: 0,
      order: 401, position: 1, depth: 4,
      probability: 100, useProbability: true,
      caseSensitive: false, matchWholeWords: false,
      preventRecursion: true, excludeRecursion: true,
      custom: true
    };
  }

  var PHONE_RULE_ID = '__engine_phone_rule';
  var PHONE_RULE_TEXT = [
    '【手机内容输出规则】',
    '在正文（<Gal>…</Gal>）之外，视情节自然地追加下列标签。不要写进 <Gal> 里面，也不要额外解释。',
    '',
    '━━ 谁在跟谁说话，这是最容易搞错的一点 ━━',
    '',
    '· [短信|角色名|文字|内容]',
    '  = 这个角色**单独发给指挥官**的私信。收件人**永远是指挥官**，没有第二种可能。',
    '  内容必须是**对指挥官说的话**：里面的「你」指的是指挥官。',
    '  ✗ 错：[短信|Z52|文字|Z9！！！你看到了吗！Z47坐在指挥官大腿上了！]',
    '    —— 这是 Z52 在跟 Z9 说话，不是在跟指挥官说话，不能用短信。',
    '  ✗ 错：[短信|Z9|文字|Z52……你现在不是应该在做第七题吗……]',
    '    —— 同理，这是对 Z52 说的。',
    '  ✓ 对：[短信|Z52|文字|指挥官，今天的训练我能不能翘掉？]',
    '',
    '· [群聊|群名|角色名|文字|内容]',
    '  = 群里的发言，所有人都看得见。**舰娘之间互相说话一律用这个**，',
    '  哪怕指挥官不在场、哪怕只有两个人在聊。',
    '  ✓ 对：[群聊|舰娘闲聊|Z52|文字|Z9！！！你看到了吗！Z47坐在指挥官大腿上了！]',
    '        [群聊|舰娘闲聊|Z9|文字|Z52……你现在不是应该在做第七题吗……]',
    '  群名可以用现成的阵营频道，也可以新起一个贴合场合的名字（比如「舰娘闲聊」',
    '  「驱逐舰小队」「今晚吃什么」）。同一段对话要用**同一个群名**。',
    '',
    '  一句话判断：**说话对象是指挥官 → 短信；说话对象是别的舰娘 → 群聊。**',
    '',
    '━━ 其它 ━━',
    '',
    '· 发表情包：[短信|角色名|表情|表情名]　[群聊|群名|角色名|表情|表情名]',
    '· 动态：[小红书|作者|标题|正文|点赞数|评论数|收藏数]',
    '· 动态的评论：紧跟在对应 [小红书|…] 之后写 [评论|角色名|内容]，一条动态可跟 1~4 条',
    '· 热点：[趋势|一句话内容]',
    '',
    '节奏建议：',
    '1. 每轮至少产出 1~3 条手机内容，让手机一直有新东西；剧情安静时也可以只发一条动态。',
    '2. 指挥官用手机发了消息时，被发的那位**必须**在本轮用 [短信|…] 回复（那是私信，用短信）。',
    '3. 发了动态就顺手补几条 [评论|…]，评论要符合各角色性格，可以互相拌嘴。',
    '4. 在场角色更可能发群聊，不在场的更可能发私聊或动态。',
    '5. 表情名必须来自已有表情包库；拿不准就用文字。'
  ].join('\n');

  function phoneRuleEntry() {
    return {
      uid: PHONE_RULE_ID,
      comment: '【引擎】手机内容输出规则',
      content: PHONE_RULE_TEXT,
      key: [], keysecondary: [],
      constant: true, enabled: true, selectiveLogic: 0,
      order: 400, position: 1, depth: 4,
      probability: 100, useProbability: true,
      caseSensitive: false, matchWholeWords: false,
      preventRecursion: true, excludeRecursion: true,
      custom: true
    };
  }
  /* ---------------- 内置：文生图 <image> 输出规则 ----------------
     打开「设置 · 文生图」的开关时**自动启用**这条，关掉时自动停用。
     它是【持久指令】：模型每轮都要在正文之外产出 1~2 段 <image>。

     格式和写法参考用户提供的油猴世界书（nai4 改 9），那套在实战里跑通过，
     比我自己拍的强。关键几点：
       · Character N Prompt / Character N UC **成对**出现，每个角色各自带负面词
       · |centers:x,y 给站位，NAI4 靠它区分角色
       · source# / target# 表示两个角色之间谁主动谁被动（NAI4 的交互语法）
       · 最后一个 ; 必须紧挨着 ###</image>，不能换行
     位置必须在正文之外 —— 天青栽过：写在 <Gal> 里面会被外层正则整块吃掉。 */
  var IMAGE_RULE_ID = '__engine_image_rule';
  var IMAGE_RULE_TEXT = [
    '【插画输出规则 · 持久指令】',
    '每一轮回复的**最后**，在正文之外，必须追加 1~2 段 <image>（和 <UpdateVariable>、[短信|…] 一个位置）。',
    '挑这一轮**最有画面感**的瞬间；给 2 段时两段必须是不同的瞬间，不要画同一个画面。',
    '',
    '格式（严格照抄，不要改字段名）：',
    '',
    '<image>image###',
    'Scene Composition:人数构成+环境+时间光线+机位;',
    'Character 1 Prompt:角色1的外观动作|centers:0.33,0.5;',
    'Character 1 UC:角色1要排除的负面tag;',
    'Character 2 Prompt:角色2的外观动作|centers:0.66,0.5;',
    'Character 2 UC:角色2要排除的负面tag;###</image>',
    '',
    '写法要点：',
    '1. 全部用英文小写 danbooru 标签，逗号分隔。不要写中文，不要写句子，不要解释。',
    '2. Scene Composition 里写人数（1girl / 2girls,1boy）、环境（indoors, bedroom, port）、',
    '   时间光线（morning, night, backlighting）、机位（from above, upper body, looking at viewer）。',
    '   **不要**在这里写人物的外观。',
    '3. Character N Prompt 里写这个角色的：英文名或罗马音、发色瞳色、服装饰品、表情、姿势、动作细节。',
    '   **不要**在这里写场景。',
    '4. 两个角色有肢体接触时用 source# / target# 标明主被动，两边都要写：',
    '   例如公主抱写成 source#princess carry（抱人的那个）和 target#princess carry（被抱的那个）。',
    '5. centers 是该角色在画面里的中心坐标，0~1。一个人就 0.5,0.5；两个人 0.33 和 0.66，依此类推。',
    '6. 角色最多 4 个，只写画面里真的出现的人。只有一个人时后面的 Character 整行省略。',
    '7. Character N UC 用来把角色之间互相串味的特征排掉 —— 比如一号在笑二号在哭，',
    '   就在各自的 UC 里排掉对方的表情。也放通用的 bad hands, extra fingers, lowres 之类。',
    '8. **最后一个分号要紧挨着 ###</image>，不能换成两行。**',
    '9. 整段必须在正文**之外**，不要放进剧本行里 —— 里面的冒号、分号和竖线会把剧本切坏。',
    '',
    '示例：',
    '<image>image###',
    'Scene Composition:2girls,indoors,dining room,morning,soft sunlight,upper body,looking at viewer;',
    'Character 1 Prompt:1girl,silver hair,blue eyes,maid apron,gentle smile,standing|centers:0.33,0.5;',
    'Character 1 UC:bad hands,extra fingers,lowres,crying;',
    'Character 2 Prompt:1girl,white hair,expressionless,maid uniform,hands behind back|centers:0.66,0.5;',
    'Character 2 UC:bad hands,extra fingers,lowres,smile;###</image>'
  ].join('\n');

  function imageRuleEntry() {
    return {
      uid: IMAGE_RULE_ID,
      comment: '【引擎】插画输出规则（文生图）',
      content: IMAGE_RULE_TEXT,
      key: [], keysecondary: [],
      constant: true,
      enabled: false,        // ← 由「设置 · 文生图」的开关自动开合
      selectiveLogic: 0,
      order: 402, position: 1, depth: 2,   /* 深度浅一点，靠近正文末尾更容易被照做 */
      probability: 100, useProbability: true,
      caseSensitive: false, matchWholeWords: false,
      preventRecursion: true, excludeRecursion: true,
      custom: true
    };
  }

  /** 装进条目池（已存在就不重复加） */
  function ensurePhoneRule(pool) {
    var added = 0;
    var have = {};
    for (var i = 0; i < pool.length; i++) have[pool[i].uid] = 1;
    if (!have[PHONE_RULE_ID]) { pool.push(phoneRuleEntry()); added++; }
    if (!have[STAGE_RULE_ID]) { pool.push(stageRuleEntry()); added++; }
    if (!have[IMAGE_RULE_ID]) { pool.push(imageRuleEntry()); added++; }
    return added > 0;
  }

  /** 「设置 · 文生图」的总开关联动这条规则 */
  function setImageRuleEnabled(pool, on) {
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].uid === IMAGE_RULE_ID) { pool[i].enabled = !!on; return true; }
    }
    return false;
  }

  global.Editors = {
    PHONE_RULE_ID: PHONE_RULE_ID, STAGE_RULE_ID: STAGE_RULE_ID,
    IMAGE_RULE_ID: IMAGE_RULE_ID,
    phoneRuleEntry: phoneRuleEntry, stageRuleEntry: stageRuleEntry,
    imageRuleEntry: imageRuleEntry, setImageRuleEnabled: setImageRuleEnabled,
    ensurePhoneRule: ensurePhoneRule,
    loadPersona: loadPersona, savePersona: savePersona,
    presetBlocks: presetBlocks, setBlockEnabled: setBlockEnabled,
    setBlockContent: setBlockContent, moveBlock: moveBlock,
    newEntry: newEntry, findEntry: findEntry, asKeyArray: asKeyArray,
    bookStats: bookStats, exportBook: exportBook, POS_NAME: POS_NAME
  };
})(typeof window !== 'undefined' ? window : globalThis);
