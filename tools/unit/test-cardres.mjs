/* core/cardres.js —— 从角色卡里直接抽素材表
 *
 * 用一张**合成**角色卡测。它刻意复刻了真卡里那些讨厌的地方：
 *   · 立绘表藏在 regex_scripts 某条的 replaceString 里，是 JS 源码不是 JSON
 *   · URL 里带 `}`（截取时不跳字符串就会被它带偏）
 *   · 表情的值有时是单个字符串、有时是数组
 *   · 场景键是「地点(时段)」，但「卧室(床上)」括号里不是时段词
 *   · GROUP_META 引用了另一个变量 FACTION_MEMBERS
 *   · 手机脚本里有注释、裸键、尾逗号、单引号
 */
import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);

const sb = { console }; sb.window = sb; sb.globalThis = sb; sb.self = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(P('core', 'cardres.js'), 'utf8'), sb);
const C = sb.CardRes;

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n))
                          : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));

/* ---------- 合成卡 ---------- */

const GAL_SRC = `
/* 这段在真卡里是个"正则脚本"，其实是整个渲染器 */
var EXPRESSION_MAP = {
  "柴郡": {
    "常服": { "微笑": "https://x.test/a}b.png", "得意": ["https://x.test/c.png", "https://x.test/d.png"] },
    "泳装": { "微笑": "https://x.test/e.png" }
  },
  "Z23": { "学生服": { "认真": "https://x.test/f.png" } }
};
var SCENE_MAP = {
  "食堂(朝)": "https://x.test/s1.png",
  "食堂(夜)": "https://x.test/s2.png",
  "卧室(床上)": "https://x.test/s3.png",
  "港区": "https://x.test/s4.png"
};
var DEFAULT_SPRITES = {
  "雪风": ["https://x.test/y1.png", "https://x.test/y2.png"],
  "长门": "https://x.test/n1.png",
  "空的": []
};
function renderStage() { /* 后面还有几万行，不该影响抽取 */ }
`;

const PHONE_SRC = `
var FACTION_MEMBERS = { '重樱': ['柴郡'], '铁血': ['Z23'] };
// 带注释、裸键、尾逗号、单引号 —— 真卡里就是这样
var AVATARS = { '柴郡': 'https://x.test/av1.png', 'Z23': 'https://x.test/av2.png', };
var STICKERS = { '躺': 'https://x.test/st1.png', '哭': 'https://x.test/st2.png' };
var DEFAULT_AVATARS = ['https://x.test/d1.png', 'https://x.test/d2.png'];
var GROUP_META = {
  '公共频道': { img: 'https://x.test/g1.png', members: null },
  '重樱群':   { img: 'https://x.test/g2.png', members: FACTION_MEMBERS['重樱'] },
};
var BASE_POSTS = [{ author: 'Z23', title: '小课堂', body: '**认真听讲**', likes: '1,024' }];
var BASE_TRENDS = [{ cat: '港区新闻', topic: '加菜', cnt: '排队绕了半圈' }];
var BASE_AREA = [];
`;

const CARD = {
  data: {
    name: '合成测试卡',
    extensions: {
      regex_scripts: [
        { scriptName: '无关脚本', replaceString: 'var NOPE = 1;' },
        { scriptName: 'gal MVU 渲染器', replaceString: GAL_SRC }
      ],
      tavern_helper: {
        scripts: [
          { name: '别的脚本', content: 'var ALSO_NOPE = 1;' },
          { name: 'juus小手机', content: PHONE_SRC }
        ]
      }
    }
  }
};

/* ---------- [1] 截字面量 ---------- */
console.log('\n[1] 从 JS 源码里截出字面量');
ok('认得 var NAME =', C._literalAfter(GAL_SRC, 'SCENE_MAP') !== null);
ok('括号配平到正确位置',
   /^\{[\s\S]*"港区": "https:\/\/x\.test\/s4\.png"\s*\}$/.test(
     C._literalAfter(GAL_SRC, 'SCENE_MAP')));
ok('URL 里的 } 不会把截取带偏',
   C._literalAfter(GAL_SRC, 'EXPRESSION_MAP').indexOf('"Z23"') > 0,
   '截出来的片段应当一直包到 Z23');
ok('找不到的变量返回 null', C._literalAfter(GAL_SRC, '不存在的变量') === null);
ok('不会把 MY_EXPRESSION_MAP 当成 EXPRESSION_MAP',
   C._literalAfter('var MY_SCENE_MAP = {"a":1};', 'SCENE_MAP') === null);

/* ---------- [2] 放宽成 JSON ---------- */
console.log('\n[2] 非严格 JSON 的放宽');
const relaxed = JSON.parse(C._relax("{ a: 1, 'b': 'x', /* 注释 */ c: [1,2,], }"));
ok('裸键补引号', relaxed.a === 1);
ok('单引号转双引号', relaxed.b === 'x');
ok('去掉注释与尾逗号', Array.isArray(relaxed.c) && relaxed.c.length === 2);
ok('严格 JSON 原样通过', C._parseLiteral('{"a":1}').a === 1);
ok('引用了别的变量时靠 deps 求值',
   C._parseLiteral('{"m": F["重樱"]}', { F: "{'重樱':['柴郡']}" }).m[0] === '柴郡');
ok('关掉 evalFallback 后引用型字面量返回 null',
   C._parseLiteral('{"m": F["重樱"]}', { F: "{'重樱':['柴郡']}" }, false) === null);

/* ---------- [3] 归一化 ---------- */
console.log('\n[3] 归一化');
const got = C.extract(CARD);
const R = got.resource;
ok('抽到两个有差分的角色', Object.keys(R.characters).length === 2,
   Object.keys(R.characters).join('、'));
ok('default_outfit 取第一套', R.characters['柴郡'].default_outfit === '常服');
ok('单张 URL 也包成数组',
   Array.isArray(R.characters['柴郡'].outfits['常服']['微笑']) &&
   R.characters['柴郡'].outfits['常服']['微笑'].length === 1);
ok('多图差分保留全部',
   R.characters['柴郡'].outfits['常服']['得意'].length === 2);
ok('URL 里的 } 原样保留',
   R.characters['柴郡'].outfits['常服']['微笑'][0] === 'https://x.test/a}b.png');

ok('「食堂(朝)」拆成 地点 + 时段',
   R.scenes['食堂'] && R.scenes['食堂']['朝'] === 'https://x.test/s1.png');
ok('同一地点的多个时段并到一起',
   R.scenes['食堂'] && Object.keys(R.scenes['食堂']).length === 2);
ok('括号里不是时段词的并进地点名',
   !!R.scenes['卧室(床上)'] && !R.scenes['卧室'],
   Object.keys(R.scenes).join('、'));
ok('没括号的用默认时段', R.scenes['港区'] && R.scenes['港区']['白日']);

ok('默认立绘：数组原样', R.defaults['雪风'].length === 2);
ok('默认立绘：单张包成数组', R.defaults['长门'].length === 1);
ok('空数组的角色被丢掉', !R.defaults['空的']);

/* ---------- [4] 手机资源 ---------- */
console.log('\n[4] 手机资源');
ok('头像', Object.keys(got.phone.avatars).length === 2);
ok('表情包', Object.keys(got.phone.stickers).length === 2);
ok('默认头像是数组', got.phone.defaultAvatars.length === 2);
ok('GROUP_META 里引用 FACTION_MEMBERS 也能求出来',
   got.phone.groupMeta['重樱群'].members[0] === '柴郡',
   JSON.stringify(got.phone.groupMeta['重樱群']));
ok('种子帖子', got.phone.basePosts.length === 1);
ok('种子热点', got.phone.baseTrends.length === 1);

/* ---------- [5] 统计 ---------- */
console.log('\n[5] 统计（界面上要显示的数字）');
ok('found', got.stats.found === true);
ok('角色数', got.stats.chars === 2, String(got.stats.chars));
ok('立绘张数', got.stats.sprites === 5, String(got.stats.sprites));   // 柴郡 1+2+1，Z23 1
ok('只有默认图的角色数', got.stats.defaultChars === 2, String(got.stats.defaultChars));
ok('地点数', got.stats.locations === 3, String(got.stats.locations));
ok('场景张数', got.stats.scenes === 4, String(got.stats.scenes));

/* ---------- [6] 就地合并，不换对象 ---------- */
console.log('\n[6] apply 必须就地合并');
{
  const sb2 = { console }; sb2.window = sb2; sb2.globalThis = sb2; sb2.self = sb2;
  vm.createContext(sb2);
  /* 先装一份"预生成素材包"，再载卡，模拟真实顺序 */
  sb2.RESOURCE = {
    characters: { '预置角色': { default_outfit: 'a', outfits: { a: { b: ['u'] } } } },
    scenes: { '食堂': { '午': 'https://old.test/noon.png' } },
    defaults: { '预置默认': ['https://old.test/x.png'] }
  };
  const held = sb2.RESOURCE;                 // resolver.js 就是这样抓住引用的
  const heldChars = sb2.RESOURCE.characters;
  vm.runInContext(fs.readFileSync(P('core', 'cardres.js'), 'utf8'), sb2);
  const st = sb2.CardRes.apply(CARD);

  ok('没有替换 window.RESOURCE 对象本身', sb2.RESOURCE === held);
  ok('也没有替换 characters 子对象', sb2.RESOURCE.characters === heldChars);
  ok('预置的角色还在', !!sb2.RESOURCE.characters['预置角色']);
  ok('卡里的角色装上了', !!sb2.RESOURCE.characters['柴郡']);
  ok('预置默认立绘还在', !!sb2.RESOURCE.defaults['预置默认']);
  ok('场景按地点合并，不整个顶掉',
     sb2.RESOURCE.scenes['食堂']['午'] === 'https://old.test/noon.png' &&
     sb2.RESOURCE.scenes['食堂']['朝'] === 'https://x.test/s1.png',
     JSON.stringify(sb2.RESOURCE.scenes['食堂']));
  ok('PHONE_RES 也装上了', Object.keys(sb2.PHONE_RES.avatars).length === 2);
  ok('返回统计', st.chars === 2);
}

/* ---------- [7] 别的卡不能炸 ---------- */
console.log('\n[7] 没有这些变量的卡');
{
  const bare = { data: { name: '一张普通卡', description: '你好' } };
  const g = C.extract(bare);
  ok('不抛异常并且 found=false', g.stats.found === false);
  ok('三张表都是空的', Object.keys(g.resource.characters).length === 0 &&
     Object.keys(g.resource.scenes).length === 0 &&
     Object.keys(g.resource.defaults).length === 0);
  ok('phone 是空对象', Object.keys(g.phone).length === 0);

  ok('null 不炸', C.extract(null).stats.found === false);
  ok('undefined 不炸', C.extract(undefined).stats.found === false);
  ok('字段类型不对也不炸',
     C.extract({ data: { extensions: { regex_scripts: '不是数组' } } }).stats.found === false);
}

/* ---------- [8] 改过脚本名的分叉卡 ---------- */
console.log('\n[8] 分叉卡改了脚本名，按内容也要找得到');
{
  const forked = {
    data: {
      extensions: {
        regex_scripts: [{ scriptName: '我自己改的名字', replaceString: GAL_SRC }],
        tavern_helper: { scripts: [{ name: '我的手机', content: PHONE_SRC }] }
      }
    }
  };
  const g = C.extract(forked);
  ok('立绘照样抽到', Object.keys(g.resource.characters).length === 2);
  ok('手机资源照样抽到', Object.keys(g.phone.avatars || {}).length === 2);
}

console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂\n');
process.exit(fail ? 1 : 0);
