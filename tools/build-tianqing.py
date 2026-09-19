# -*- coding: utf-8 -*-
"""把 Larimar 的扁平立绘表/背景表撑开成统一的两级结构。
   用法: python3 build-tianqing.py <Larimar仓库路径> <输出目录>"""
import re, json, sys, os

repo, out = sys.argv[1], sys.argv[2]
OUTFIT_PREFIXES = ['演出服', '婚纱']       # 新增皮肤只需在这里加一行
DEFAULT_OUTFIT  = '常服'

src = open(os.path.join(repo, 'resource/expressions.js'), encoding='utf-8').read()
pairs = re.findall(r'["\']([^"\']+)["\']\s*:\s*["\'](https?://[^"\']+)["\']', src)

outfits = {}
for key, url in pairs:
    outfit, expr = DEFAULT_OUTFIT, key
    for p in OUTFIT_PREFIXES:
        if key.startswith(p) and len(key) > len(p):
            outfit, expr = p, key[len(p):]
            break
    outfits.setdefault(outfit, {}).setdefault(expr, []).append(url)

chars = {'天青': {'default_outfit': DEFAULT_OUTFIT, 'outfits': outfits}}

bsrc = open(os.path.join(repo, 'resource/backgrounds.js'), encoding='utf-8').read()
scenes = {}
for key, url in re.findall(r'["\']([^"\']+)["\']\s*:\s*["\'](https?://[^"\']+)["\']', bsrc):
    loc, period = key.rsplit('·', 1) if '·' in key else (key, '白日')
    scenes.setdefault(loc.strip(), {})[period.strip()] = url

HDR = ('/* 自动生成 · 请勿手改 · 重跑 tools/build-tianqing.py */\n'
       'window.RESOURCE = window.RESOURCE || { characters:{}, scenes:{} };\n')
open(os.path.join(out, 'tianqing/expressions.js'), 'w', encoding='utf-8').write(
    HDR + 'Object.assign(window.RESOURCE.characters, ' + json.dumps(chars, ensure_ascii=False, indent=1) + ');\n')
open(os.path.join(out, 'tianqing/scenes.js'), 'w', encoding='utf-8').write(
    HDR + 'Object.assign(window.RESOURCE.scenes, ' + json.dumps(scenes, ensure_ascii=False, indent=1) + ');\n')

print('天青服装:', ', '.join(f'{k}({len(v)}表情)' for k, v in outfits.items()))
print(f'背景: {len(scenes)} 地点 / {sum(len(v) for v in scenes.values())} 图')
