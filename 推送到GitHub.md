# 怎么把这个仓库推到 GitHub

> 这个文件本身不进仓库（`.gitignore` 没挡它，但你推之前可以删掉，随意）。

## 先确认一下你拿到的是什么

解压出来的文件夹里有个隐藏的 `.git/`，已经做好了第一次提交。也就是说：

- **双击 `index.html` 就能玩**，素材齐全（`resource/juus/` 那些都在）
- **但 `git push` 只会推引擎**，角色卡和素材被 `.gitignore` 挡住了

这两件事不冲突，是故意这么排的：本地是完整的游戏，推上去的是干净的引擎。

确认一下：

```bash
cd 解压后的文件夹
git log --oneline          # 应该看到一条「初始提交：gal 引擎 v5.20」
git ls-files | wc -l       # 77 个文件
git status                 # 应该是 clean
ls resource/juus/          # 素材在本地，但上面那条命令看不到它们
```

## 推上去

1. 去 github.com，右上角 **+** → **New repository**
2. 名字随便起（比如 `gal-engine`），Public 或 Private 都行
3. **不要**勾 "Add a README file"、"Add .gitignore"、"Choose a license" ——
   这三样仓库里已经有了，勾了会冲突
4. Create repository
5. 回到终端：

```bash
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

要是提示认证失败，GitHub 现在不收密码了，得用 Personal Access Token：
Settings → Developer settings → Personal access tokens → Tokens (classic)
→ Generate new token，勾 `repo`，生成后把那串字符当密码填。

## 开 GitHub Pages（拿网址）

仓库页 **Settings → Pages** → Source 选 `Deploy from a branch`
→ 分支 `main`、目录 `/ (root)` → Save。等一两分钟刷新，顶部会出现网址。

推上去的仓库不含素材，但**不影响玩**：网址打开后在开场引导里载入你自己的
角色卡，立绘和背景会从卡里读出来（`core/cardres.js` 干的）。
卡存在你自己浏览器里，不会上传，所以公开的网址上也没有别人的作品。

想连预置素材包一起上去（省那几十毫秒的解析，或者要天青那套素材），
就用 **Cloudflare Pages**：免费版支持私有仓库，新建一个私有仓库，
把 `.gitignore` 里 `resource/juus/` 那几行删掉再推。

## 以后怎么改

```bash
git add -A
git commit -m "改了什么"
git push
```

`git add -A` 不会误传素材和角色卡，`.gitignore` 挡着。
想确认的话 `git status` 看一眼再提交。

## 跑测试

```bash
npm install     # 只装 jsdom，玩游戏不需要
npm test        # 307 项冒烟 + 332 项单元
```

素材在本地时是 307 项；干净克隆（没素材）时是 299 项 + 4 项跳过 ——
跳过的那几项断言的是「这张卡里有七百多个角色」这种，没卡就没意义。
