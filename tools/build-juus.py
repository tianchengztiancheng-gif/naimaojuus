# -*- coding: utf-8 -*-
"""从 juus 角色卡 JSON 抽出立绘表/场景表，转成统一的两级结构。
   用法: python3 build-juus.py <卡片.json> <输出目录>"""
import re, json, sys, os

card, out = sys.argv[1], sys.argv[2]
d = json.load(open(card, encoding='utf-8'))
gal = [r for r in d['data']['extensions']['regex_scripts']
       if 'gal MVU' in r.get('scriptName', '')][0]['replaceString']

def grab(name):
    m = re.search(r'var\s+' + re.escape(name) + r'\s*=', gal)
    if not m: return None
    i = m.start(); j = gal.index('=', i) + 1
    depth = 0; start = None
    for k in range(j, len(gal)):
        c = gal[k]
        if c in '{[':
            if depth == 0: start = k
            depth += 1
        elif c in '}]':
            depth -= 1
            if depth == 0: return json.loads(gal[start:k+1])

EXPR = grab('EXPRESSION_MAP')     # 角色 -> 服装 -> 表情 -> [url]
SCENE = grab('SCENE_MAP')         # 「地点(时段)」-> url
DEFS = grab('DEFAULT_SPRITES')    # 角色 -> [默认立绘...]，覆盖面比 EXPRESSION_MAP 大得多

chars = {}
for name, outfits in EXPR.items():
    norm = {o: {e: (u if isinstance(u, list) else [u]) for e, u in t.items()}
            for o, t in outfits.items()}
    chars[name] = {'default_outfit': list(norm)[0], 'outfits': norm}

# 「游乐场(朝)」「卧室(床上)」-> 地点 + 时段；括号里不是时段词的并入地点名
PERIODS = {'朝','午','夜','清晨','早','晚','黄昏','白日','夜晚','日','傍晚'}
scenes = {}
for key, url in SCENE.items():
    m = re.match(r'^(.*?)[（(]([^（()）]*)[)）]$', key.strip())
    if m and m.group(2) in PERIODS:
        loc, period = m.group(1).strip(), m.group(2)
    else:
        loc, period = key.strip(), '白日'
    scenes.setdefault(loc, {})[period] = url

HDR = ('/* 自动生成 · 请勿手改 · 重跑 tools/build-juus.py */\n'
       'window.RESOURCE = window.RESOURCE || { characters:{}, scenes:{}, defaults:{} };\n'
       'window.RESOURCE.defaults = window.RESOURCE.defaults || {};\n')
open(os.path.join(out, 'juus/expressions.js'), 'w', encoding='utf-8').write(
    HDR + 'Object.assign(window.RESOURCE.characters, ' + json.dumps(chars, ensure_ascii=False) + ');\n')
open(os.path.join(out, 'juus/scenes.js'), 'w', encoding='utf-8').write(
    HDR + 'Object.assign(window.RESOURCE.scenes, ' + json.dumps(scenes, ensure_ascii=False) + ');\n')

defs = {k: (v if isinstance(v, list) else [v]) for k, v in (DEFS or {}).items() if v}
open(os.path.join(out, 'juus/defaults.js'), 'w', encoding='utf-8').write(
    HDR + 'Object.assign(window.RESOURCE.defaults, ' +
    json.dumps(defs, ensure_ascii=False) + ');\n')
print('默认立绘:', len(defs), '个角色 /',
      sum(len(v) for v in defs.values()), '张')

ni = sum(len(u) for c in chars.values() for t in c['outfits'].values() for u in t.values())
print(f'juus: {len(chars)} 角色 / {ni} 张立绘')
print(f'场景: {len(scenes)} 地点 / {sum(len(v) for v in scenes.values())} 图')
multi = sum(1 for c in chars.values() if len(c['outfits']) > 1)
print(f'其中 {multi} 个角色有多套服装')
