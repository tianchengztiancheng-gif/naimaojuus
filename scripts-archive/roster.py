import json, re, io, sys
src = open('/home/claude/engine/resource/juus/expressions.js', encoding='utf-8').read()
data = json.loads(re.search(r'Object\.assign\(window\.RESOURCE\.characters, (\{.*\})\);', src, re.S).group(1))
rows = []
for n, c in data.items():
    outfits = c['outfits']
    exprs = imgs = multi = 0
    for k, t in outfits.items():
        for e, u in t.items():
            exprs += 1; imgs += len(u)
            if len(u) > 1: multi += 1
    rows.append((n, list(outfits.keys()), exprs, imgs, multi))
rows.sort(key=lambda r: -r[3])

out = io.StringIO()
out.write('# juus 卡立绘清单\n\n')
out.write('自动生成自 `resource/juus/expressions.js`，共 **%d 名舰娘 / %d 张立绘**。\n\n'
          % (len(rows), sum(r[3] for r in rows)))
out.write('- **服装**：同一角色的不同套装，靠变量 `人物.X.服装` 选中\n')
out.write('- **表情**：该套装下可用的表情名，模型只能从中挑\n')
out.write('- **差分**：有多张图的表情数（同一表情随机抽一张，换表情时才重抽）\n\n')

multi_out = [r for r in rows if len(r[1]) > 1]
out.write('## 有多套服装的（%d 人）\n\n' % len(multi_out))
out.write('| 舰娘 | 服装 | 表情数 | 立绘数 |\n|---|---|---:|---:|\n')
for n, o, e, i, m in multi_out:
    out.write('| %s | %s | %d | %d |\n' % (n, ' / '.join(o), e, i))

out.write('\n## 全部舰娘（按立绘数排序）\n\n')
out.write('| # | 舰娘 | 服装 | 表情数 | 立绘数 | 多图差分 |\n|---:|---|---|---:|---:|---:|\n')
for idx, (n, o, e, i, m) in enumerate(rows, 1):
    out.write('| %d | %s | %s | %d | %d | %s |\n'
              % (idx, n, ' / '.join(o), e, i, (str(m) if m else '—')))

single = [r[0] for r in rows if r[4] == 0]
out.write('\n## 没有多图差分的（%d 人）\n\n' % len(single))
out.write('每个表情只有一张图，画面不会有随机变化：\n\n%s\n' % '、'.join(single))
open('/home/claude/engine/docs/立绘清单.md', 'w', encoding='utf-8').write(out.getvalue())
print('已生成，%d 行' % out.getvalue().count('\n'))
