# resource/ —— 素材表

这个目录里只有 `aliases.js` 进了仓库。`juus/` 和 `tianqing/` **不随仓库分发**。

## 为什么

`resource/juus/` 和 `resource/tianqing/` 是用 `tools/build-*.py`
从角色卡里抽出来的派生数据：立绘/场景/头像的 URL 索引、手机通讯录、
预置群、帖子文案，以及卡作者写的 `phone.css`。那些是卡作者的作品，
不是引擎的一部分（详见根目录 `NOTICE`）。

## 没有它们，会怎样

**基本没影响。** 这些表的内容本来就长在角色卡里，
`core/cardres.js` 会在载卡时当场读出来装上：

- 立绘 / 差分 / 默认立绘 → 从卡里的 `EXPRESSION_MAP`、`DEFAULT_SPRITES` 读
- 场景表 → 从 `SCENE_MAP` 读，顺便把「地点(时段)」拆开
- 手机头像 / 表情包 / 预置群 / 种子帖子 → 从卡里那段小手机脚本读

载完卡，开场引导上会直接显示抽到了多少角色、多少地点。
`tools/e2e-card.mjs` 就是专门验这件事的：把素材包挪开，用真浏览器跑一遍，
看舞台上到底有没有立绘。

唯一真正少掉的是**卡自带的手机样式**（`resource/juus/phone.css`）。
没有它时手机 UI 用 `app/phone-inner.css` 这套我们自己写的皮肤，功能一样，
配色是引擎自己的浅色。有那份时它会覆盖掉，外观回到卡自带的样子。

浏览器控制台里会有几条 404，不影响使用。

## 那还留着这些预生成文件干嘛

两个用处：

1. **省一点载卡时间** —— 静态 `<script>` 比运行时解析快一点点（也就几十毫秒）。
2. **多套素材叠加** —— `resource/tianqing/` 是从 Larimar 仓库抽的，不属于任何一张卡，
   想让天青的立绘和 juus 的同时可用就得靠它。

卡里抽出来的会**覆盖**预生成文件里的同名条目 —— 卡才是真源。

## 怎么生成

手上有角色卡的话：

```bash
python3 tools/build-juus.py     /path/to/juus.json      # → resource/juus/
python3 tools/build-tianqing.py /path/to/tianqing.json  # → resource/tianqing/
python3 tools/build-phone.py    /path/to/juus.json      # → resource/juus/phone.js + phone.css
```

生成完可以顺手更新测试用的合成表：

```bash
node tools/build-fixtures.mjs   # → test/fixtures/resource.js
```

## aliases.js

这个是我们自己整理的，166 条地名/场景别名映射（「甜品厅」→「食堂」这类），
跟具体角色卡无关，所以进仓库。
