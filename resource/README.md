# resource/ —— 素材表

这个目录里只有 `aliases.js` 进了仓库。`juus/` 和 `tianqing/` **不随仓库分发**。

## 为什么

`resource/juus/` 和 `resource/tianqing/` 是用 `tools/build-*.py`
从角色卡里抽出来的派生数据：立绘/场景/头像的 URL 索引、手机通讯录、
预置群、帖子文案，以及卡作者写的 `phone.css`。那些是卡作者的作品，
不是引擎的一部分（详见根目录 `NOTICE`）。

## 没有它们，会怎样

引擎照常启动，功能齐全，只是：

- 立绘和场景图查不到 → 舞台上没有图，对话照跑
- 手机通讯录是空的 → 剧情里出现 `[短信|某某|...]` 时会按名字新建会话
- 手机 UI 用 `app/phone-inner.css` 这套我们自己写的皮肤
  （有 `resource/juus/phone.css` 时它会覆盖掉，外观回到卡自带的样子）

浏览器控制台里会有几条 404，不影响使用。

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
