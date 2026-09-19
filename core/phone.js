/* ============================================================
 * core/phone.js —— 小手机：从对话记录里解析出通讯内容
 *
 * 标签格式与 juus 卡原脚本完全一致：
 *   [短信|角色名|文字/表情|内容]
 *   [群聊|群名|角色名|文字/表情|内容]
 *   [小红书|作者|标题|正文|赞|评论|收藏]
 *   [评论|角色名|内容]            —— 挂到它前面最近那条 [小红书|…]
 *   [趋势|内容]
 *
 * 只做解析与去重，渲染在 app 层。资源表由 resource/juus/phone.js 提供。
 * ============================================================ */
(function (global) {
  'use strict';

  var RE = {
    sms:   /\[短信\|([^|\]\n]+)\|(文字|表情)\|([^\]\n]+)\]/g,
    group: /\[群聊\|([^|\]\n]*)\|([^|\]\n]*)\|(文字|表情)\|([^\]\n]*)\]/g,
    post:  /\[小红书\|([^|\n]*)\|([^|\n]*)\|([\s\S]*?)\|([^|\]\n]*)\|([^|\]\n]*)\|([^|\]\n]*)\]/g,
    cmt:   /\[评论\|([^|\]\n]*)\|([^\]\n]*)\]/g,
    trend: /\[趋势\|([^\]\n]+)\]/g
  };
  var ALL = /\[(?:短信|群聊|小红书|评论|趋势)\|[\s\S]*?\]/g;
  var DEFAULT_GROUP = '公共频道';

  /* ============================================================
     [短信|…] 是**发给指挥官的私信**，收件人永远是指挥官。
     但模型很爱拿它写舰娘之间的对话 —— 实测会出现：
       [短信|Z52|文字|Z9！！！你看到了吗！Z47坐在指挥官大腿上了！！！]
       [短信|Z9 |文字|Z52……你现在不是应该在做第七题吗……]
     这两条各自躺在「Z52 和指挥官」「Z9 和指挥官」两个私聊里，
     实际上她俩在互相说话，指挥官被莫名其妙地夹在中间。

     世界书那条规则已经写明了，但模型照样会错。所以引擎这边也拦一道：
     认出「这条其实是说给别的舰娘听的」，就改投到一个群聊里。
     ============================================================ */
  var PEER_GROUP = '舰娘闲聊';

  /** 这个名字是不是一个我们认识的角色（用来判断呼格） */
  function knownName(n) {
    n = String(n || '').trim();
    if (!n) return false;
    var R = global.RESOURCE || {};
    if (R.characters && R.characters[n]) return true;
    if (R.defaults && R.defaults[n]) return true;
    var av = res().avatars;
    if (av && av[n]) return true;
    return false;
  }

  /**
   * 判断一条「私信」是不是其实在跟别的舰娘说话。
   * 两个信号：
   *   ① 开头是呼格 —— 「Z9！！！…」「Z52……你…」，且那个名字是别的角色
   *   ② 把指挥官当第三人称提 —— 「Z47 坐在指挥官大腿上了」。
   *      真给指挥官发消息时会说「你」，不会说「指挥官」加第三人称叙述。
   * 返回被叫到的那个名字，或 null。
   */
  function peerDirected(sender, text, userName) {
    var s = String(text || '').trim().replace(/^[「『"'“”\s]+/, '');
    var me = String(userName || '指挥官').trim();
    if (!s) return null;

    /* 开头就喊指挥官 = 标准的私信开场（「指挥官，早呀～」），直接放行。
       这一条必须排在最前面：不然「指挥官，早呀～今天也要加油哦」会因为
       「出现了指挥官三个字 + 通篇没有『你』」被信号②误判成第三人称叙述。 */
    var vocativeMe = new RegExp('^' + me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                                '\\s*[！!？?，,。.、…～~:：\\s]');
    if (vocativeMe.test(s)) return null;

    /* ① 呼格：开头一个短名字 + 语气标点 */
    var m = s.match(/^([A-Za-z0-9一-龥·\-]{1,10})\s*[！!？?，,。.、…～~:：\s]/);
    if (m) {
      var cand = m[1].trim();
      if (cand !== me && cand !== sender && knownName(cand)) return cand;
    }

    /* ② 把指挥官当第三人称叙述，且通篇没有第二人称。
       「Z47 坐在指挥官大腿上了」—— 真给指挥官发消息不会这么说话。 */
    if (s.indexOf(me) >= 0 && !/[你您]/.test(s)) return '(第三人称提及' + me + ')';

    return null;
  }

  /* 动态和热点默认「攒够就换」：超过上限后新的顶掉最旧的，
     免得几十轮之后注入主线的 <手机记录> 把 token 撑爆。
     打开「只累积」就不裁，全部留着。 */
  var LIMITS = { posts: 20, trends: 20, keepAll: false };
  function limits(o) {
    if (o) {
      if (o.posts != null) LIMITS.posts = o.posts;
      if (o.trends != null) LIMITS.trends = o.trends;
      if (o.keepAll != null) LIMITS.keepAll = !!o.keepAll;
    }
    return { posts: LIMITS.posts, trends: LIMITS.trends, keepAll: LIMITS.keepAll };
  }

  function res() { return global.PHONE_RES || {}; }

  function avatarOf(name) {
    var A = res().avatars || {}, D = res().defaultAvatars || [];
    if (!name) return D[0] || '';
    if (A[name]) return A[name];
    var ks = Object.keys(A), i;
    for (i = 0; i < ks.length; i++) if (ks[i].indexOf(name) === 0) return A[ks[i]];   // 皮肤名
    for (i = 0; i < ks.length; i++) if (name.indexOf(ks[i]) === 0) return A[ks[i]];
    return D[hash(name) % (D.length || 1)] || '';
  }
  function stickerOf(word) {
    var S = res().stickers || {};
    word = String(word || '').trim();
    if (!word) return null;
    if (S[word]) return S[word];
    /* 模糊匹配要求至少两个字的包含关系 —— 原来单字也算命中，
       模型随便编个名字都能撞上一张不相干的表情。 */
    if (word.length < 2) return null;
    var ks = Object.keys(S), i;
    /* 只认"名单里的名字是这段话的开头"或反之，且重合部分至少占一半 ——
       否则模型随口编一个名字就会撞上一张不相干的表情。 */
    for (i = 0; i < ks.length; i++) {
      var k = ks[i];
      if (k.length < 2) continue;
      if (k === word) return S[k];
      if (k.indexOf(word) === 0 && word.length * 2 >= k.length) return S[k];
      if (word.indexOf(k) === 0 && k.length * 2 >= word.length) return S[k];
    }
    return null;
  }
  function hash(s) {
    var h = 0;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  /* 通讯录里排除掉的名字。
     立绘表里混进了一些不该当联系人的条目 —— 别的卡带进来的角色（天青）、
     META / 泛用型这类非角色条目、以及重名变体。
     用户在「设置 · 外观」里看不到这张表，要加减直接改这里。 */
  var ROSTER_EXCLUDE = [
    '阿尔贝托', '奥斯塔', '布里·META', '泛用型布里',
    '天青',            /* 是 Larimar 的角色，跟着天青素材包进来的，不属于这张卡 */
    '乌戈里诺·', '新月JP', '小加贺'
  ];
  var EXCLUDE_SET = null;
  function excluded(n) {
    if (!EXCLUDE_SET) {
      EXCLUDE_SET = {};
      ROSTER_EXCLUDE.forEach(function (x) { EXCLUDE_SET[String(x).trim()] = 1; });
    }
    return !!EXCLUDE_SET[String(n || '').trim()];
  }

  /** 常驻联系人：所有有立绘的角色。原脚本的 ROSTER 就是这个意思。 */
  function roster() {
    var R = global.RESOURCE || {};
    var set = {};
    Object.keys(R.characters || {}).forEach(function (n) { set[n] = 1; });
    /* 六百多个只有默认立绘的舰娘也该出现在通讯录里 */
    Object.keys(R.defaults || {}).forEach(function (n) { set[n] = 1; });
    return Object.keys(set).filter(function (n) {
      return !/频道$/.test(n) && n.length <= 12 && !excluded(n);
    });
  }

  /**
   * @param {Array} history [{role, content}]，只扫 assistant 的
   * @param {Array} [sent] 玩家在手机里发过的消息，合并进来做本地回显
   * @returns {{chats, groups, posts, trends, counts}}
   */
  function scan(history, sent, opt) {
    opt = opt || {};
    var userName = opt.userName || '指挥官';
    var chats = {}, groups = {}, posts = [], trends = [];
    var seen = { sms: {}, grp: {}, post: {}, cmt: {}, tr: {} };
    var postIndex = {};

    (history || []).forEach(function (msg, turn) {
      if (!msg || msg.role !== 'assistant') return;
      var s = String(msg.content || ''), m;

      /* 先把这一轮的私信全收上来，**不要**马上分发 ——
         要按「发信人 + 本轮」整组判断是不是在跟别的舰娘说话。
         一组里只要有一条露馅（比如开头喊了别人的名字），整组都改投群聊：
         对话是连着的，「别转移话题！」这种单看没有任何线索，
         但它和前一句属于同一段对话，不能一半在私聊一半在群里。 */
      var batch = [], bySender = {};
      RE.sms.lastIndex = 0;
      while ((m = RE.sms.exec(s))) {
        var who = m[1].trim(), key = who + '|' + m[2] + '|' + m[3].trim();
        if (seen.sms[key]) continue;
        seen.sms[key] = 1;
        var v = m[3].trim(), type = m[2] === '表情' ? 'sticker' : 'text';
        if (type === 'sticker') { var st = stickerOf(v); if (!st) continue; v = st; }
        var item = { who: who, type: type, v: v, turn: turn, raw: m[3].trim() };
        batch.push(item);
        (bySender[who] = bySender[who] || []).push(item);
      }
      Object.keys(bySender).forEach(function (sender) {
        var list = bySender[sender];
        var to = null;
        for (var i = 0; i < list.length && !to; i++) {
          if (list[i].type !== 'text') continue;
          to = peerDirected(sender, list[i].raw, userName);
        }
        list.forEach(function (it) {
          delete it.raw;
          if (to) {
            it.rerouted = to;                     // 调试面板里能看出这条是被改投的
            (groups[PEER_GROUP] = groups[PEER_GROUP] || []).push(it);
          } else {
            (chats[sender] = chats[sender] || []).push(it);
          }
        });
      });

      RE.group.lastIndex = 0;
      while ((m = RE.group.exec(s))) {
        var gn = m[1].trim() || DEFAULT_GROUP, gw = m[2].trim();
        var gk = gn + '|' + gw + '|' + m[3] + '|' + m[4].trim();
        if (seen.grp[gk]) continue;
        seen.grp[gk] = 1;
        var gv = m[4].trim(), gt = m[3] === '表情' ? 'sticker' : 'text';
        if (gt === 'sticker') { var gs = stickerOf(gv); if (!gs) continue; gv = gs; }
        (groups[gn] = groups[gn] || []).push({ who: gw, type: gt, v: gv, turn: turn });
      }

      RE.post.lastIndex = 0;
      while ((m = RE.post.exec(s))) {
        var pk = m[1].trim() + '|' + m[2].trim();
        if (seen.post[pk]) continue;
        seen.post[pk] = 1;
        var post = {
          id: 'p' + hash(pk), author: m[1].trim(), title: m[2].trim(),
          body: m[3].trim(), likes: (m[4] || '').trim() || '—',
          comments: (m[5] || '').trim() || '0', stars: (m[6] || '').trim() || '0',
          cmts: [], turn: turn
        };
        posts.unshift(post);
        postIndex[pk] = post;
      }

      /* 评论认领：找它前面最近的那条 [小红书|…]，按 作者|标题 对应 */
      RE.cmt.lastIndex = 0;
      while ((m = RE.cmt.exec(s))) {
        var before = s.slice(0, m.index);
        var at = before.lastIndexOf('[小红书|');
        if (at < 0) continue;
        var head = /\[小红书\|([^|\n]*)\|([^|\n]*)\|/.exec(s.slice(at));
        if (!head) continue;
        var key2 = head[1].trim() + '|' + head[2].trim();
        var target = postIndex[key2];
        if (!target) continue;
        var ck = key2 + '|' + m[1].trim() + '|' + m[2].trim();
        if (seen.cmt[ck]) continue;
        seen.cmt[ck] = 1;
        target.cmts.push({ who: m[1].trim(), text: m[2].trim() });
      }

      RE.trend.lastIndex = 0;
      while ((m = RE.trend.exec(s))) {
        var tv = m[1].trim();
        if (seen.tr[tv]) continue;
        seen.tr[tv] = 1;
        trends.push({ text: tv, turn: turn });
      }
    });

    /* 种子内容：原版自带的推荐帖与热点，没有它们手机开起来是空的 */
    var R = res();
    (R.basePosts || []).forEach(function (p) {
      posts.push({
        id: 'seed' + hash(p.author + p.title), author: p.author, title: p.title,
        body: p.body || '', likes: p.likes, comments: p.comments, stars: p.stars,
        avatar: p.avatar, tag: p.tag, cmts: [], seed: true
      });
    });
    (R.baseTrends || []).forEach(function (t) {
      trends.push({ text: t.topic || t, cat: t.cat, cnt: t.cnt, seed: true });
    });

    /* 手机里产生的消息：玩家自己发的（me=true）和独立生成的对方回复（me=false）。
       原来这里一律标成 me，导致角色的回信在注入主线时被写成"指挥官说的"。 */
    (sent || []).forEach(function (m) {
      if (!m.type) return;                      // 跳过非消息类记录
      var bucket = m.group ? (groups[m.group] = groups[m.group] || [])
                           : (chats[m.who] = chats[m.who] || []);
      bucket.push({ who: m.who, type: m.type, v: m.v, me: !!m.me, turn: m.turn });
    });
    Object.keys(chats).forEach(function (k) {
      chats[k].sort(function (a, b) { return (a.turn || 0) - (b.turn || 0); });
    });
    Object.keys(groups).forEach(function (k) {
      groups[k].sort(function (a, b) { return (a.turn || 0) - (b.turn || 0); });
    });

    /* 裁剪：种子内容永远留着（它们是开局的底子），只裁剧情产出的部分。
       posts 是 unshift 进来的，越靠前越新，所以从尾部裁。 */
    if (!LIMITS.keepAll) {
      var seedP = posts.filter(function (p) { return p.seed; });
      var liveP = posts.filter(function (p) { return !p.seed; });
      if (liveP.length > LIMITS.posts) liveP = liveP.slice(0, LIMITS.posts);
      posts = liveP.concat(seedP);

      var seedT = trends.filter(function (t) { return t.seed; });
      var liveT = trends.filter(function (t) { return !t.seed; });
      if (liveT.length > LIMITS.trends) liveT = liveT.slice(-LIMITS.trends);
      trends = liveT.concat(seedT);
    }

    var nChat = 0;
    Object.keys(chats).forEach(function (k) { nChat += chats[k].length; });
    var nGrp = 0;
    Object.keys(groups).forEach(function (k) { nGrp += groups[k].length; });

    return {
      chats: chats, groups: groups, posts: posts, trends: trends,
      limits: { posts: LIMITS.posts, trends: LIMITS.trends, keepAll: LIMITS.keepAll },
      counts: {
        contacts: Object.keys(chats).length, messages: nChat,
        groups: Object.keys(groups).length, groupMessages: nGrp,
        posts: posts.length, trends: trends.length,
        total: nChat + nGrp + posts.length + trends.length
      }
    };
  }

  /** 把手机标签从正文里摘掉，免得当成台词演出来 */
  function strip(text) {
    return String(text || '').replace(ALL, '');
  }
  function has(text) {
    ALL.lastIndex = 0;
    return ALL.test(String(text || ''));
  }

  /* 帖子正文里的轻量标记：**粗体** 和 [[青:高亮文字]] */
  var HL = { '青':'#0a9fb8', '粉':'#e0568f', '金':'#c98a1a', '黄':'#c98a1a',
             '紫':'#7a52d6', '红':'#d94b4b', '蓝':'#2b7fd0', '绿':'#1c8a52' };
  function formatBody(text, escFn) {
    var e = escFn || function (x) { return String(x); };
    return e(String(text || ''))
      .replace(/\[\[([^:：\]]{1,4})[:：]([^\]]*)\]\]/g, function (m, c, t) {
        return '<span class="hl" style="color:' + (HL[c] || '#0a9fb8') + '">' + t + '</span>';
      })
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\n/g, '<br>');
  }

  /* ============================================================
     独立生成：私聊与群聊不走主线，各自发一次性请求。
     照搬原脚本的设计 —— 正文和聊天分开触发，但手机记录会注入主线上下文，
     所以剧情里的人知道你在手机上说过什么，反过来也一样。
     ============================================================ */

  function stickerNames(limit) {
    var S = res().stickers || {};
    var ks = Object.keys(S);
    return (limit ? ks.slice(0, limit) : ks).join('、');
  }

  function recentText(log, n) {
    return (log || []).slice(-(n || 12)).map(function (m) {
      var who = m.me ? '指挥官' : (m.who || '对方');
      return who + '：' + (m.type === 'sticker' ? '[表情包]' : m.v);
    }).join('\n');
  }

  /** 私聊：让某个角色回一条短信 */
  function buildSmsPrompt(name, log, person, userMsg, ctx) {
    var p = person || {};
    var hint = p.好感度 != null
      ? '（她对指挥官的好感度约 ' + p.好感度 + (p.是否誓约 ? '，已誓约' : '') +
        '，当前状态：' + (p.当前状态 || '平静') +
        (p.服装 ? '，现在穿着' + p.服装 : '') + '）'
      : '';
    ctx = ctx || {};
    var lore = ctx.lore ? '[她的设定]\n' + ctx.lore + '\n\n' : '';
    var scene = ctx.scene ? '[现在的剧情]\n' + ctx.scene + '\n\n' : '';
    return '[独立任务 · 手机短信回复，忽略之前的角色扮演格式]\n' +
      '你现在是【' + name + '】，在手机上回复指挥官的私聊。按她的性格说话。' + hint + '\n\n' +
      lore + scene +
      '【回复格式】文字和表情包可以混着发，按想发的顺序写：\n' +
      '  · 文字：<sms>一句话</sms>（1~3 句短信口语，不要动作、旁白、括号、markdown）\n' +
      '  · 表情包：<stk>贴纸名</stk>\n\n' +
      '【表情包只能从这份名单里原样照抄】（写别的发不出去）：\n' + stickerNames() + '\n' +
      '【什么时候发表情包】想撒娇、被逗到、懒得打字、或指挥官明确要求时。别每条都发。\n\n' +
      '[最近的对话]\n' + (recentText(log) || '（第一次聊）') +
      '\n\n[指挥官刚发来]\n「' + userMsg + '」\n\n直接输出' + name + '的回复：';
  }

  /** 群聊：生成一段多人接龙 */
  function buildGroupPrompt(group, log, members, userMsg, ctx) {
    var roster = (members && members.length) ? members.join('、') : '港区的舰娘们';
    ctx = ctx || {};
    var lore = ctx.lore ? '[相关设定]\n' + ctx.lore + '\n\n' : '';
    var scene = ctx.scene ? '[现在的剧情]\n' + ctx.scene + '\n\n' : '';
    return '[独立任务 · 群聊生成，忽略之前的角色扮演格式]\n' + lore + scene +
      '这是舰娘群「' + group + '」。指挥官刚发了一条消息，生成接下来群里的 3~8 条回复。\n' +
      '群成员从这些角色里挑（也可以让别人冒泡，注意进群/潜水的平衡，别每次都同一批人）：' +
      roster + '\n每个角色严格按性格说话，口语、短句，允许互相拌嘴接梗。\n\n' +
      '【输出格式】一行一条，不要任何别的内容：\n' +
      '[群聊|' + group + '|角色名|文字|消息内容]\n' +
      '发表情包时写：[群聊|' + group + '|角色名|表情|贴纸名]\n' +
      '【贴纸名只能从这份名单里原样照抄】：\n' + stickerNames(50) + '\n\n' +
      '[最近的群消息]\n' + (recentText(log, 16) || '（群里还没人说话）') +
      '\n\n[指挥官刚发来]\n「' + userMsg + '」\n\n直接输出群消息：';
  }

  /** 解析私聊回复里的 <sms> / <stk> */
  function parseSmsReply(raw) {
    var out = [];
    var re = /<(sms|stk)>([\s\S]*?)<\/\1>/g, m;
    while ((m = re.exec(String(raw || '')))) {
      var v = m[2].replace(/<[^>]*>/g, '').replace(/\*\*/g, '')
        .replace(/^[「」"'\s]+|[「」"'\s]+$/g, '').trim();
      if (!v) continue;
      if (m[1] === 'stk') {
        var url = stickerOf(v);
        if (url) out.push({ type: 'sticker', v: url });
      } else {
        out.push({ type: 'text', v: v.slice(0, 200) });
      }
    }
    /* 模型没照格式写时，退而求其次把整段当一条短信 */
    if (!out.length) {
      var plain = String(raw || '').replace(/<[^>]*>/g, '')
        .replace(/\*\*/g, '').trim();
      if (plain) out.push({ type: 'text', v: plain.slice(0, 200) });
    }
    return out;
  }

  /** 把手机记录压成一段，注入主线上下文 —— 剧情里的人才知道你在手机上说过什么 */
  function renderForStory(data, limit) {
    if (!data) return '';
    var lines = [];
    Object.keys(data.chats).forEach(function (n) {
      var last = data.chats[n].slice(-(limit || 6));
      if (!last.length) return;
      lines.push('· 与 ' + n + ' 的私聊：' + last.map(function (m) {
        return (m.me ? '指挥官' : n) + '「' +
          (m.type === 'sticker' ? '[表情包]' : m.v) + '」';
      }).join('　'));
    });
    Object.keys(data.groups).forEach(function (g) {
      var last = data.groups[g].slice(-(limit || 6));
      if (!last.length) return;
      lines.push('· 群「' + g + '」：' + last.map(function (m) {
        return (m.me ? '指挥官' : m.who) + '「' +
          (m.type === 'sticker' ? '[表情包]' : m.v) + '」';
      }).join('　'));
    });
    if (data.posts.length) {
      var recent = data.posts.filter(function (p) { return !p.seed; }).slice(0, 3);
      recent.forEach(function (p) {
        lines.push('· 动态 @' + p.author + '「' + p.title + '」' +
          (p.cmts.length ? '（评论：' + p.cmts.map(function (c) {
            return c.who + '说' + c.text; }).join('；') + '）' : ''));
      });
    }
    if (!lines.length) return '';
    return '<手机记录>\n' + lines.join('\n') + '\n</手机记录>';
  }

  global.Phone = {
    formatBody: formatBody,
    buildSmsPrompt: buildSmsPrompt, buildGroupPrompt: buildGroupPrompt,
    parseSmsReply: parseSmsReply, renderForStory: renderForStory,
    stickerNames: stickerNames,
    scan: scan, strip: strip, has: has, roster: roster, limits: limits,
    avatarOf: avatarOf, stickerOf: stickerOf,
    DEFAULT_GROUP: DEFAULT_GROUP,
    PEER_GROUP: PEER_GROUP, peerDirected: peerDirected, knownName: knownName,
    ROSTER_EXCLUDE: ROSTER_EXCLUDE, excluded: excluded
  };
})(typeof window !== 'undefined' ? window : globalThis);
