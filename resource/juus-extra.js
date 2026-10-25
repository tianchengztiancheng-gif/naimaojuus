/* ============================================================
 * resource/juus-extra.js —— 奶猫给 juus 卡补的立绘（v5.30 起，内置卡和玩家自己载的 juus 卡都会打）
 *
 * 机制见 core/cardpatch.js。这里只有数据：
 *   - 初月：39 种表情 / 66 张（透明背景）。卡里原来只有默认立绘（游戏原画），没有表情差分
 *   - 弗兰德尔：36 种表情 / 65 张（透明背景），同上
 *     （第一次上传有 23 张是猫箱空文件，10/25 重传后补齐；新链接在维护者自己的网络下逐个确认过）
 *   - 贾维斯、雅努斯：各补一个「掀起裙子诱惑」（2 张，透明背景）。用的是 add，原来的表情不动
 *   - 开局：初月、弗兰德尔各一个（另一个补丁 juus-openings，卡里已经有了就不加）
 *   - diffEntries：按最终的立绘表重写这四人的「X差分」世界书条目（没有就新建），
 *     AI 只会挑差分条目里列出来的表情，名单跟着图走才触发得到
 *
 * 图是项目自己跑的，链接来自维护者整理的清单（桌面 初月.txt / 弗兰德尔.txt / 补充.txt）。
 * 加新表情：往对应角色的「常服」里加一行「"表情名": ["链接", …]」就行，差分条目会自动跟上。
 * ============================================================ */
(function () {
  'use strict';
  if (!window.CardPatch) return;

  /* 整套表情（这两人卡里没有表情差分，等于新建） */
  var FULL = {
   "初月": {
    "常服": {
     "高兴": [
      "https://files.catbox.moe/erhv8u.png",
      "https://files.catbox.moe/nmib1o.png"
     ],
     "害羞": [
      "https://files.catbox.moe/y7jz5h.png",
      "https://files.catbox.moe/08424x.png"
     ],
     "暧昧地打量": [
      "https://files.catbox.moe/dm5ejy.png"
     ],
     "比心": [
      "https://files.catbox.moe/xvpkda.png",
      "https://files.catbox.moe/xr4rg9.png"
     ],
     "比耶": [
      "https://files.catbox.moe/jrldhh.png",
      "https://files.catbox.moe/d9vypk.png"
     ],
     "不满": [
      "https://files.catbox.moe/qdzyuv.png",
      "https://files.catbox.moe/ylqahk.png"
     ],
     "沉醉": [
      "https://files.catbox.moe/dpcbzq.png"
     ],
     "吃醋": [
      "https://files.catbox.moe/0ztgx5.png",
      "https://files.catbox.moe/bt8lqd.png"
     ],
     "得意": [
      "https://files.catbox.moe/pxmvnm.png"
     ],
     "嘟嘴": [
      "https://files.catbox.moe/08lojy.png"
     ],
     "飞吻": [
      "https://files.catbox.moe/630dl9.png",
      "https://files.catbox.moe/rmjlcz.png"
     ],
     "非常开心": [
      "https://files.catbox.moe/o7cf35.png"
     ],
     "刚醒或困倦": [
      "https://files.catbox.moe/py82k0.png",
      "https://files.catbox.moe/ldc30q.png"
     ],
     "俏皮": [
      "https://files.catbox.moe/yva36q.png",
      "https://files.catbox.moe/4vc93g.png"
     ],
     "红温": [
      "https://files.catbox.moe/5n4355.png",
      "https://files.catbox.moe/enqf5l.png"
     ],
     "疲惫或无语": [
      "https://files.catbox.moe/iv0cpw.png",
      "https://files.catbox.moe/9ptz06.png"
     ],
     "假装很生气": [
      "https://files.catbox.moe/0sf1gz.png",
      "https://files.catbox.moe/e6g5qm.png"
     ],
     "祈祷": [
      "https://files.catbox.moe/dd81aq.png",
      "https://files.catbox.moe/mgt44d.png"
     ],
     "惊讶": [
      "https://files.catbox.moe/jfyvj8.png",
      "https://files.catbox.moe/fg4czj.png"
     ],
     "警觉": [
      "https://files.catbox.moe/jshawp.png",
      "https://files.catbox.moe/aekgxx.png"
     ],
     "窘迫": [
      "https://files.catbox.moe/jfj3qw.png",
      "https://files.catbox.moe/rupd98.png"
     ],
     "流泪": [
      "https://files.catbox.moe/bwyz9d.png",
      "https://files.catbox.moe/313raa.png"
     ],
     "卖萌": [
      "https://files.catbox.moe/vhd2c2.png",
      "https://files.catbox.moe/rzvf3n.png"
     ],
     "撒娇": [
      "https://files.catbox.moe/rj8hw6.png"
     ],
     "失落": [
      "https://files.catbox.moe/bcagj7.png"
     ],
     "思考": [
      "https://files.catbox.moe/s5loxe.png",
      "https://files.catbox.moe/gs31ob.png"
     ],
     "微笑": [
      "https://files.catbox.moe/33f7wj.png",
      "https://files.catbox.moe/wz9kum.png"
     ],
     "委屈": [
      "https://files.catbox.moe/4rbahb.png",
      "https://files.catbox.moe/3k32g3.png"
     ],
     "无语": [
      "https://files.catbox.moe/b4p2ca.png"
     ],
     "掀起裙子诱惑": [
      "https://files.catbox.moe/0hrhin.png",
      "https://files.catbox.moe/b771iz.png"
     ],
     "嫌弃或厌恶": [
      "https://files.catbox.moe/5ksmxf.png",
      "https://files.catbox.moe/1gjaox.png"
     ],
     "小恶魔笑容": [
      "https://files.catbox.moe/vkjf05.png"
     ],
     "星星眼": [
      "https://files.catbox.moe/8xrf5v.png"
     ],
     "羞涩": [
      "https://files.catbox.moe/hkc4rq.png"
     ],
     "疑惑": [
      "https://files.catbox.moe/0pbmwk.png",
      "https://files.catbox.moe/kwvg7t.png"
     ],
     "诱惑": [
      "https://files.catbox.moe/x9jrva.png"
     ],
     "真的很生气": [
      "https://files.catbox.moe/ns7h05.png",
      "https://files.catbox.moe/h4gxb7.png"
     ],
     "自信": [
      "https://files.catbox.moe/gnz38l.png",
      "https://files.catbox.moe/k9kg2i.png"
     ],
     "做鬼脸": [
      "https://files.catbox.moe/qr4prw.png",
      "https://files.catbox.moe/ly1v4o.png"
     ]
    }
   },
   "弗兰德尔": {
    "常服": {
     "暧昧地打量": [
      "https://files.catbox.moe/952gb5.png",
      "https://files.catbox.moe/ykmozc.png"
     ],
     "非常高兴": [
      "https://files.catbox.moe/utsana.png",
      "https://files.catbox.moe/cy0hhn.png"
     ],
     "刚睡醒或困倦": [
      "https://files.catbox.moe/y7an6l.png",
      "https://files.catbox.moe/6kifza.png"
     ],
     "比心": [
      "https://files.catbox.moe/svg7wf.png",
      "https://files.catbox.moe/jbszsf.png"
     ],
     "比耶": [
      "https://files.catbox.moe/hj6j8m.png",
      "https://files.catbox.moe/sd94jn.png"
     ],
     "不满": [
      "https://files.catbox.moe/l5e54u.png",
      "https://files.catbox.moe/9r6hkz.png"
     ],
     "沉醉": [
      "https://files.catbox.moe/7m0yp6.png",
      "https://files.catbox.moe/wvpcvm.png"
     ],
     "吃醋": [
      "https://files.catbox.moe/lagqqt.png",
      "https://files.catbox.moe/p798p6.png"
     ],
     "得意": [
      "https://files.catbox.moe/wgv7qj.png",
      "https://files.catbox.moe/31n0bl.png"
     ],
     "飞吻": [
      "https://files.catbox.moe/jfp3pp.png",
      "https://files.catbox.moe/ygv5v6.png"
     ],
     "害羞": [
      "https://files.catbox.moe/vw7xgo.png",
      "https://files.catbox.moe/dqapie.png"
     ],
     "红温": [
      "https://files.catbox.moe/vacqhq.png",
      "https://files.catbox.moe/ygiwz0.png"
     ],
     "假装很生气": [
      "https://files.catbox.moe/yk37ku.png",
      "https://files.catbox.moe/f2lwht.png"
     ],
     "惊讶": [
      "https://files.catbox.moe/74gbfw.png",
      "https://files.catbox.moe/shl7sn.png"
     ],
     "警觉": [
      "https://files.catbox.moe/lqrdhc.png",
      "https://files.catbox.moe/n8a38a.png"
     ],
     "窘迫": [
      "https://files.catbox.moe/4s3mzn.png",
      "https://files.catbox.moe/yw4osm.png"
     ],
     "开心": [
      "https://files.catbox.moe/8y9vg1.png",
      "https://files.catbox.moe/59urf3.png"
     ],
     "流泪": [
      "https://files.catbox.moe/tvjydh.png",
      "https://files.catbox.moe/6olw1m.png"
     ],
     "卖萌": [
      "https://files.catbox.moe/6r79e7.png",
      "https://files.catbox.moe/c80x92.png"
     ],
     "疲惫或无语": [
      "https://files.catbox.moe/ytkpzr.png"
     ],
     "祈祷": [
      "https://files.catbox.moe/vmmw7i.png",
      "https://files.catbox.moe/j68k34.png"
     ],
     "俏皮": [
      "https://files.catbox.moe/0k67h4.png",
      "https://files.catbox.moe/v4mug4.png"
     ],
     "撒娇": [
      "https://files.catbox.moe/x38wjr.png"
     ],
     "胜利": [
      "https://files.catbox.moe/7miaza.png",
      "https://files.catbox.moe/udzgtk.png"
     ],
     "失落": [
      "https://files.catbox.moe/g3vr2z.png"
     ],
     "思考": [
      "https://files.catbox.moe/rof58b.png",
      "https://files.catbox.moe/kqjm6k.png"
     ],
     "微笑": [
      "https://files.catbox.moe/nfxto4.png",
      "https://files.catbox.moe/idxhha.png"
     ],
     "委屈": [
      "https://files.catbox.moe/kb6dce.png"
     ],
     "无语": [
      "https://files.catbox.moe/1gzeu7.png",
      "https://files.catbox.moe/nkctg4.png"
     ],
     "掀起裙子诱惑": [
      "https://files.catbox.moe/v6g84x.png",
      "https://files.catbox.moe/aex2zy.png"
     ],
     "嫌弃或厌恶": [
      "https://files.catbox.moe/hey31u.png",
      "https://files.catbox.moe/eo034x.png"
     ],
     "星星眼": [
      "https://files.catbox.moe/wvlkvg.png",
      "https://files.catbox.moe/1lfoib.png"
     ],
     "羞涩": [
      "https://files.catbox.moe/zmw6ed.png"
     ],
     "真的很生气": [
      "https://files.catbox.moe/rkin8o.png",
      "https://files.catbox.moe/7axtzs.png"
     ],
     "自信": [
      "https://files.catbox.moe/j3lvcr.png"
     ],
     "做鬼脸": [
      "https://files.catbox.moe/ntsfb2.png"
     ]
    }
   }
  };

  /* 只追加的表情 */
  var ADD = {
   "贾维斯": {
    "常服": {
     "掀起裙子诱惑": [
      "https://files.catbox.moe/fkllvc.png",
      "https://files.catbox.moe/0tfoj8.png"
     ]
    }
   },
   "雅努斯": {
    "常服": {
     "掀起裙子诱惑": [
      "https://files.catbox.moe/7kq325.png",
      "https://files.catbox.moe/nx4kws.png"
     ]
    }
   }
  };

  var ALL = {};
  [FULL, ADD].forEach(function (src) {
    Object.keys(src).forEach(function (who) { ALL[who] = src[who]; });
  });

  window.CardPatch.register({
    id: 'juus-extra',
    match: function (card) {
      var d = (card && (card.data || card)) || {};
      return /juus|奶猫崛起/i.test(String(d.name || ''));
    },
    addSprites: ALL,
    diffEntries: true
  });
  /* 两个新开局（v5.30.1）：初月 · 重樱入港处、弗兰德尔 · 指挥官办公室。
     和酒馆版 v4 卡里追加的是同一份（源码在酒馆版 tavern/openings/）。
     卡里已经带了这两个开局的（比如酒馆版 v4 卡被载进来）就不再加，免得列表里出现两遍 */
  var OPENINGS = [
    { n: '初月 · 重樱入港处', t: "<Gal>\n『✨ 2081/07/03 · 星期四 · 18:12 · 重樱入港处 · 天气:晴转薄暮 ✨』|旁白|-|\n傍晚的重樱入港处。演习舰队的运输艇靠上栈桥，夕阳把海面切成一片碎金，被晒了一整天的木板踩上去还带着余温。|旁白|-|\n七天的联合演习，七天没回港区。指挥官提着行李走下舷梯，栈桥尽头立着一块歪歪扭扭的木牌，上面用红漆写着「欢迎回来♡」，字迹一看就是赶出来的。|旁白|-|\n木牌旁边没有人。|旁白|-|\n下一秒，一双微凉的手从背后蒙住了指挥官的眼睛。|旁白|-|\n「猜——猜——我——是——谁♪」|初月|小恶魔笑容|\n甜得发腻的声音贴着耳朵响起，带着一点压不住的笑意。发尾的红色装饰结扫过指挥官的脖子，痒痒的。|初月|小恶魔笑容|\n「……初月。」|旁白|-|\n「诶嘿嘿，答对啦～奖励是——」她松开手，绕到指挥官面前，银白的小角跟着歪头的动作偏向一侧，「初月本人！不可以退货哦♪」|初月|比耶|\n黑红交错的长发在海风里荡开，深红色的眼睛弯成两道月牙。她很自然地挽住了指挥官空着的那只手，整个人贴上来，像是要确认什么似的用力蹭了两下。|初月|撒娇|\n「指挥官出门这么久，初月一个人在港区好～无聊的。不过办公室的文件、明天的日程、委托组的报告，全部都处理好了哦。」|初月|自信|\n「明天上午有三个会议，初月帮你错开了，中间留了二十分钟休息。急件放在最上面，要签字的都夹了标签。」|初月|思考|\n说起工作，她的语速一下子变得又快又稳，像换了一个人。可说完最后一个字，那副正经的表情就绷不住了，嘴角又翘了回去。|初月|微笑|\n「——好了，汇报完毕♪ 接下来是初月的时间。」|初月|得意|\n「……你在这儿等了多久？」|旁白|-|\n「诶？才、才没有等很久啦。初月只是刚好路过码头，刚好看到运输艇，刚好手边有一块写着字的木牌而已。」|初月|窘迫|\n她别开视线，攥着指挥官袖口的手指却收得更紧了。|初月|窘迫|\n「七天而已嘛。初月才没有数呢。」|初月|嘟嘴|\n「……一百六十九个小时。」|初月|失落|\n声音忽然轻了下去，「诶嘿嘿」和「♪」一起不见了。她低着头，额前的刘海挡住了眼睛，只能看见抿紧的嘴角。|初月|失落|\n「多出来的那一个小时，是运输艇晚点了。初月在这里站了一个小时，一直在想——要是船不回来了怎么办。」|初月|委屈|\n海风吹过栈桥，木牌上的红漆还没完全干透。|旁白|-|\n「……不过！」她猛地抬起头，刚才那一瞬间的空白像是从来没出现过，「指挥官现在回来了，所以这些都不重要啦♪」|初月|非常开心|\n「欠下的一百六十九个小时，初月要一个小时一个小时地讨回来哦。第一项——」|初月|小恶魔笑容|\n她踮起脚，把脸凑到几乎碰到鼻尖的距离，深红色的瞳孔里倒映着落日。|初月|暧昧地打量|\n「今天晚上，指挥官的膝盖是初月的专座。不接受反驳♪」|初月|飞吻|\n<env>傍晚 · 重樱入港处，夕阳沉进海平线，栈桥尽头立着一块红漆未干的「欢迎回来♡」木牌，运输艇的汽笛在身后拉长。</env>\n<choice>[揉揉她的头：“我回来了，让你久等了。”][故意逗她：“一百六十九个小时，记得这么清楚还说没数？”][把带回来的伴手礼递给她，看她会不会当场拆开]</choice>\n</Gal>\n\n<UpdateVariable>\n<Analysis>\n- Time: dusk, 18:12, the commander just returned from a seven-day joint exercise.\n- Dramatic updates: yes, opening scene sets a fresh cast.\n- Location: 重樱入港处. 初月 is present, already oath-bound, affection high; she is clinging to the commander.\n</Analysis>\n<JSONPatch>\n[\n  {\"op\":\"replace\",\"path\":\"/时间/时段\",\"value\":\"傍晚\"},\n  {\"op\":\"replace\",\"path\":\"/地点\",\"value\":\"重樱入港处\"},\n  {\"op\":\"replace\",\"path\":\"/人物\",\"value\":{\n    \"初月\":{\"好感度\":130,\"是否誓约\":true,\"服装\":\"常服\",\"穿着细节\":\"黑白红三色立领改良连衣裙，黑色半透明丝袜配红色系带短靴，腰间斜挎红白缠柄的太刀，发尾系着红色装饰结\",\"当前状态\":\"黏着不放\",\"内心想法\":\"一百六十九个小时……不对，从现在开始清零了。今天晚上说什么都不放他走了♪\",\"所在位置\":\"栈桥尽头\",\"在场\":true}\n  }}\n]\n</JSONPatch>\n</UpdateVariable>" },
    { n: '弗兰德尔 · 指挥官办公室', t: "<Gal>\n『✨ 2081/05/18 · 星期日 · 07:26 · 指挥官办公室 · 天气:晴 ✨』|旁白|-|\n清晨的指挥官办公室还没开灯。百叶窗拉起了一半，阳光斜斜地铺在地板上，空气里飘着刚拧干的抹布和柠檬清洁剂的味道。|旁白|-|\n指挥官比平时早到了半个小时。门没关严，门缝里传出一个很轻、很慢的声音，在一个字一个字地念。|旁白|-|\n「指挥官的桌子……擦一擦。」|弗兰德尔|思考|\n「指挥官的椅子……擦一擦。」|弗兰德尔|思考|\n银白色的双马尾在窗前的光里晃了一下。弗兰德尔踮着脚，用长过手指的灯笼袖裹着一块抹布，一寸一寸地擦着那把办公椅的扶手。身后那件巨大的黑天鹅绒披风拖了一地，下摆已经蹭上了一道水痕。|旁白|-|\n窗台上停着一只小麻雀，歪着脑袋看她。|旁白|-|\n「指挥官……擦一擦……」|弗兰德尔|沉醉|\n她把脸贴近椅背，停了一会儿。|弗兰德尔|沉醉|\n「……呵呵。」|弗兰德尔|微笑|\n声音轻得几乎听不见。那张总是平静得像人偶一样的脸上，嘴角往上翘了大概两毫米。|弗兰德尔|微笑|\n指挥官推开了门。|旁白|-|\n「……！」|弗兰德尔|惊讶|\n弗兰德尔整个人僵在原地，抹布还举在半空。浅灰紫色的眼睛眨了一下，又眨了一下，耳尖以肉眼可见的速度红了起来。|弗兰德尔|窘迫|\n「指、指挥官……早安。弗兰德尔在打扫。只是在打扫。」|弗兰德尔|窘迫|\n「……刚才那个『呵呵』呢？」|旁白|-|\n「弗兰德尔没有笑。是小鸟。是小鸟在笑。」|弗兰德尔|羞涩|\n窗台上的麻雀适时地「啾」了一声。|旁白|-|\n弗兰德尔转过身，想要若无其事地去擦桌子另一头——披风的下摆缠住了靴跟。|旁白|-|\n她踉跄了一步，灯笼袖扫过桌角。桌上那只插着白色鸢尾的花瓶晃了晃，然后以一种几乎是慢动作的姿态倒了下去。|旁白|-|\n哗啦。|旁白|-|\n水漫过桌面，漫过摊开的作战报告，一路滴到地板上。鸢尾花躺在一份盖着「机密」红章的文件正中央，花瓣上挂着水珠。|旁白|-|\n办公室里安静了三秒。|旁白|-|\n「……」|弗兰德尔|委屈|\n弗兰德尔低头看着那一桌狼藉，眼眶慢慢泛红。她提着裙摆小跑到指挥官面前，膝盖上的丝袜又破了一个小洞。|弗兰德尔|委屈|\n「指挥官……弗兰德尔又犯了罪行。」|弗兰德尔|流泪|\n「花瓶被弗兰德尔碰倒了。水洒在了文件上。是盖着红章的那份。」|弗兰德尔|流泪|\n声音在发抖，眼睛湿漉漉的。可如果仔细看——那双浅灰紫色的眼睛里，除了委屈，分明还亮着一点别的东西。|弗兰德尔|暧昧地打量|\n她又往前凑了半步，仰起脸。|弗兰德尔|羞涩|\n「请……指挥官惩罚弗兰德尔。」|弗兰德尔|害羞|\n「不惩罚的话，弗兰德尔下次还会犯的。」|弗兰德尔|撒娇|\n「……弗兰德尔说的是真的。」|弗兰德尔|红温|\n窗台上的小麻雀拍拍翅膀，飞到了文件柜顶上，像是在找一个看戏的好位置。|旁白|-|\n<env>清晨 · 指挥官办公室，阳光从半开的百叶窗里斜进来，桌上的鸢尾花和机密文件泡在一滩水里，窗台的小麻雀在看戏。</env>\n<choice>[“那就罚你——今天一整天都待在我身边。”][先拿毛巾帮她擦干袖子，假装没听懂她在暗示什么][捡起那份泡水的机密文件：“这个……确实要好好罚一罚。”]</choice>\n</Gal>\n\n<UpdateVariable>\n<Analysis>\n- Time: early morning, 07:26, the commander arrived half an hour early.\n- Dramatic updates: yes, opening scene sets a fresh cast.\n- Location: 指挥官办公室. 弗兰德尔 is present, already oath-bound, affection high; she just knocked over a vase and is asking to be punished.\n</Analysis>\n<JSONPatch>\n[\n  {\"op\":\"replace\",\"path\":\"/时间/时段\",\"value\":\"清晨\"},\n  {\"op\":\"replace\",\"path\":\"/地点\",\"value\":\"指挥官办公室\"},\n  {\"op\":\"replace\",\"path\":\"/人物\",\"value\":{\n    \"弗兰德尔\":{\"好感度\":130,\"是否誓约\":true,\"服装\":\"常服\",\"穿着细节\":\"纯白抹胸束腰配垂过指尖的灯笼袖，黑色过膝丝袜膝盖处破了个小洞，身后拖着黑天鹅绒外层、深红内衬的大披风，头戴飘着白蕾丝的黑色软帽\",\"当前状态\":\"请罪中\",\"内心想法\":\"花瓶真的不是故意的……但是指挥官会怎么惩罚弗兰德尔呢。……有一点期待。\",\"所在位置\":\"办公桌旁\",\"在场\":true}\n  }}\n]\n</JSONPatch>\n</UpdateVariable>" }
  ];
  window.CardPatch.register({
    id: 'juus-openings',
    match: function (card) {
      var d = (card && (card.data || card)) || {};
      if (!/juus|奶猫崛起/i.test(String(d.name || ''))) return false;
      var g = (d.alternate_greetings || []).join('\n');
      return g.indexOf('一百六十九个小时') < 0 && g.indexOf('请……指挥官惩罚弗兰德尔') < 0;
    },
    openings: OPENINGS
  });
})();
