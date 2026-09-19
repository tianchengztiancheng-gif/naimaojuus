/* ============================================================
 * tools/build-fixtures.mjs —— 生成 test/fixtures/resource.js
 *
 * 为什么需要它：
 *   仓库里**不带**真素材表（resource/juus/、resource/tianqing/ 是从第三方角色卡
 *   里抽出来的，见 resource/README.md）。但 tools/smoke-test.js 要有一份结构正确的
 *   素材表才跑得起来。这个脚本从真表里**只抄结构**，把每个 URL 换成
 *   https://example.invalid/ 占位，只保留测试点名的那十来个角色。
 *
 * 所以：
 *   · 有真表的人（比如你，刚跑完 tools/build-juus.py）可以重跑本脚本更新 fixture。
 *   · 没真表的人不需要跑，仓库里已经有生成好的 test/fixtures/resource.js。
 *
 * 用法：node tools/build-fixtures.mjs
 * ============================================================ */
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(ROOT, ...a);

const REAL = ['resource/tianqing/expressions.js', 'resource/tianqing/scenes.js',
              'resource/juus/expressions.js', 'resource/juus/scenes.js',
              'resource/juus/defaults.js', 'resource/juus/phone.js'];

const missing = REAL.filter(f => !fs.existsSync(P(f)));
if (missing.length) {
  console.error('找不到真素材表，没法生成 fixture：\n  ' + missing.join('\n  ') +
                '\n先跑 tools/build-juus.py / build-tianqing.py / build-phone.py。');
  process.exit(1);
}

const sb = { console }; sb.window = sb; sb.globalThis = sb; sb.self = sb;
vm.createContext(sb);
for (const f of REAL) vm.runInContext(fs.readFileSync(P(f), 'utf8'), sb);
const R = sb.RESOURCE;

/* smoke-test 真正点名的角色。加断言用到新角色时，往这里加一个再重跑。 */
const KEEP = ['柴郡', '雪风', '贝尔法斯特', '谢菲尔德', 'Z23', 'Z52', 'Z9',
              '企业', '明石', '天狼星', '长门', '贾维斯', '雅努斯'];

let n = 0;
const ph = () => 'https://example.invalid/sprite-' + (++n) + '.png';
const phs = a => (Array.isArray(a) ? a : [a]).map(ph);

const chars = {}, defaults = {};
const absent = [];
for (const k of KEEP) {
  const c = R.characters[k];
  if (c) {
    const outfits = {};
    for (const [o, exprs] of Object.entries(c.outfits || {})) {
      const e2 = {};
      for (const [e, urls] of Object.entries(exprs)) e2[e] = phs(urls);
      outfits[o] = e2;
    }
    chars[k] = { default_outfit: c.default_outfit, outfits };
  }
  if (R.defaults[k]) defaults[k] = phs(R.defaults[k]);
  if (!c && !R.defaults[k]) absent.push(k);
}
if (absent.length) console.warn('⚠ 真表里也没有这些，fixture 不会包含：' + absent.join('、'));

const scenes = {};
for (const k of Object.keys(R.scenes).slice(0, 12))
  scenes[k] = typeof R.scenes[k] === 'string' ? ph() : phs(R.scenes[k]);

const stickers = {};
for (const k of Object.keys(sb.PHONE_RES.stickers || {}).slice(0, 8)) stickers[k] = ph();
const avatars = {};
for (const k of KEEP) avatars[k] = ph();

const J = o => JSON.stringify(o, null, 1);

/* 手机里的帖子/热点是**手写**的假内容，不从真表抄 —— 那些是卡作者写的文案。
   只要保证字段齐全、正文里有 **加粗** 和 [[色:文字]] 供格式化断言用。 */
const FEED = `
window.PHONE_RES.groupMeta = {
 "公共频道": { "img": "https://example.invalid/group-1.png", "members": null },
 "作战简报": { "img": "https://example.invalid/group-2.png", "members": null },
 "食堂小分队": { "img": "https://example.invalid/group-3.png", "members": ["柴郡", "Z23"] }
};
/* 下面是为测试手写的假内容，不来自任何角色卡 */
window.PHONE_RES.basePosts = [
 { "author": "Z23", "tag": "学习", "title": "今日港区小课堂",
   "likes": "1,024", "comments": 12, "stars": 88,
   "body": "今天讲的是航线规划。\\n**认真听讲的**课后有小饼干。\\n指挥官也来旁听了，[[青:前排就座]]。",
   "avatar": "https://example.invalid/avatar-1.png", "cmts": [] },
 { "author": "柴郡", "tag": "日常", "title": "厨房失窃案",
   "likes": "512", "comments": 7, "stars": 30,
   "body": "点心又少了一块。\\n**不是我**喵。",
   "avatar": "https://example.invalid/avatar-2.png", "cmts": [] }
];
window.PHONE_RES.baseTrends = [
 { "cat": "港区新闻", "topic": "食堂今日加菜", "cnt": "排队已经绕了码头半圈。" },
 { "cat": "训练", "topic": "夜间演习改期", "cnt": "改到明天早上。" }
];
window.PHONE_RES.baseArea = [];
`;

const out = `/* ============================================================
 * test/fixtures/resource.js —— 测试用的**合成**素材表
 *
 * ⚠ 自动生成 · 请勿手改 · 重跑 tools/build-fixtures.mjs
 *
 * 结构与 tools/build-juus.py 生成的真表一致，但：
 *   · 所有立绘/头像 URL 都是 https://example.invalid/ 占位，指向不存在的主机
 *   · 只保留 smoke-test 真正点名的那十来个角色
 *   · 手机帖子/热点是手写的假内容
 *
 * 真表是从第三方角色卡里抽出来的，不随本仓库分发（见 resource/README.md）。
 * 没有真表时 tools/smoke-test.js 自动改用这份，与卡规模有关的断言会跳过。
 * ============================================================ */
window.RESOURCE = window.RESOURCE || { characters:{}, scenes:{}, defaults:{} };
Object.assign(window.RESOURCE.characters, ${J(chars)});
Object.assign(window.RESOURCE.defaults, ${J(defaults)});
Object.assign(window.RESOURCE.scenes, ${J(scenes)});
window.PHONE_RES = window.PHONE_RES || {};
window.PHONE_RES.stickers = ${J(stickers)};
window.PHONE_RES.avatars = ${J(avatars)};
window.PHONE_RES.defaultAvatars = ${J([ph(), ph()])};
${FEED}`;

fs.mkdirSync(P('test', 'fixtures'), { recursive: true });
fs.writeFileSync(P('test', 'fixtures', 'resource.js'), out);
console.log('写入 test/fixtures/resource.js  ' + (out.length / 1024).toFixed(1) + 'KB' +
            '  角色 ' + Object.keys(chars).length +
            ' + 仅默认图 ' + (Object.keys(defaults).length - Object.keys(chars).length) +
            '  场景 ' + Object.keys(scenes).length +
            '  表情包 ' + Object.keys(stickers).length);
