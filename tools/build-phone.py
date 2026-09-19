# -*- coding: utf-8 -*-
"""从 juus 卡里抽出小手机的头像与表情包资源表。
   用法: python3 build-phone.py <卡片.json> <输出目录>"""
import json, sys, os

card, out = sys.argv[1], sys.argv[2]
d = json.load(open(card, encoding='utf-8'))
ph = [s for s in d['data']['extensions']['tavern_helper']['scripts']
      if s['name'] == 'juus小手机'][0]['content']

def grab(name):
    i = ph.index('var ' + name)
    j = ph.index('=', i) + 1
    depth = 0; start = None
    for k in range(j, len(ph)):
        c = ph[k]
        if c in '{[':
            if depth == 0: start = k
            depth += 1
        elif c in '}]':
            depth -= 1
            if depth == 0:
                raw = ph[start:k+1]
                try: return json.loads(raw)
                except Exception: return raw      # 非严格 JSON 的（带注释/裸键）原样交给浏览器

data = {
    'avatars':  grab('AVATARS'),
    'stickers': grab('STICKERS'),
    'defaultAvatars': grab('DEFAULT_AVATARS'),
    'groupMeta': grab('GROUP_META'),      # 里面会引用 FACTION_MEMBERS
    'basePosts': grab('BASE_POSTS'),      # 原版自带的种子内容 —— 没有这些手机是空的
    'baseTrends': grab('BASE_TRENDS'),
    'baseArea': grab('BASE_AREA')
}
# ROSTER 在原脚本里是 filter 出来的表达式，不是字面量；
# 它的含义就是"有立绘的舰娘"，运行时从 RESOURCE.characters 直接算，更稳。
faction = grab('FACTION_MEMBERS')
os.makedirs(os.path.join(out, 'juus'), exist_ok=True)
HDR = ('/* 自动生成 · 请勿手改 · 重跑 tools/build-phone.py */\n'
       'window.PHONE_RES = window.PHONE_RES || {};\n')
parts = []
for k, v in data.items():
    parts.append('  ' + json.dumps(k) + ': ' +
                 (v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)))
fac = faction if isinstance(faction, str) else json.dumps(faction or {}, ensure_ascii=False)
with open(os.path.join(out, 'juus/phone.js'), 'w', encoding='utf-8') as f:
    f.write(HDR + '(function () {\n'
            '/* GROUP_META 引用了 FACTION_MEMBERS，一起带出来并关在闭包里 */\n'
            'var FACTION_MEMBERS = ' + fac + ';\n'
            'Object.assign(window.PHONE_RES, {\n' + ',\n'.join(parts) + '\n});\n'
            '})();\n')

def n(x): return len(x) if hasattr(x, '__len__') else '?'
# ---------- 样式与骨架 ----------
import re
i = ph.index('<style id="jup-style">')
j = ph.index('</style>', i)
css = ph[i + len('<style id="jup-style">'):j].replace('\\\n', '\n').replace("\\'", "'")

# 命名空间化：
#   #jup-mask（全屏遮罩）→ #phone-overlay
#   #jup-root（1108x640 面板）保持不变
#   #jup-ball（悬浮球）整条丢弃——这边用工具栏按钮开
#   其余裸选择器挂到 #jup-root 下
KEYFRAME_SEL = re.compile(r'^(?:[\d.]+%|from|to)$')

def scope(text):
    out, pos, depth = [], 0, 0
    at_depths = set()                 # 哪些层级是 @规则内部
    for m in re.finditer(r'([^{}]*)([{}])', text):
        chunk, brace = m.group(1), m.group(2)
        out.append(text[pos:m.start()])
        pos = m.end()
        if brace == '}':
            depth -= 1
            at_depths.discard(depth + 1)
            out.append(chunk + '}')
            continue
        sel = chunk.strip()
        lead = chunk[:len(chunk) - len(chunk.lstrip())]
        if sel.startswith('@'):
            at_depths.add(depth + 1)
            depth += 1
            out.append(chunk + '{')
            continue
        inside_at = (depth in at_depths)
        depth += 1
        if inside_at and all(KEYFRAME_SEL.match(x.strip()) for x in sel.split(',') if x.strip()):
            out.append(chunk + '{')        # 关键帧百分比，原样
            continue
        parts = []
        for one in sel.split(','):
            one = one.strip()
            if not one or one.startswith('#jup-ball'):
                continue
            one = one.replace('#jup-mask', '#phone-overlay')
            if '#jup-root' in one or '#phone-overlay' in one:
                parts.append(one)
            else:
                parts.append('#jup-root ' + one)
        out.append(lead + (', '.join(parts) if parts else '#jup-root .__none') + '{')
    out.append(text[pos:])
    return ''.join(out)

css = scope(css)
open(os.path.join(out, 'juus/phone.css'), 'w', encoding='utf-8').write(
    '/* 自动生成 · 取自 juus 卡的小手机样式，已加 #jup-root 命名空间 */\n' + css)

# 注：HTML 骨架不再抽取 —— 外壳改成了 iPhone 竖屏版（app/phone.css + app.js 的 APP_HTML），
# 只沿用 juus 的内部组件样式（.ct/.bb/.pill 等），骨架本身用不上了。

print('样式', len(css), '字符')

print('种子: 帖子', n(data['basePosts']), '| 趋势', n(data['baseTrends']),
      '| 同城', n(data['baseArea']))
print('头像', n(data['avatars']), '| 表情包', n(data['stickers']),
      '| 默认头像', n(data['defaultAvatars']),
      '| 群组元数据', '原样嵌入' if isinstance(data['groupMeta'], str) else n(data['groupMeta']))
