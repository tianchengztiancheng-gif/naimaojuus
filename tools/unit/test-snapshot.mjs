/* snapshot.js 单测：内联抠取、三段式解析、JSON 容错、收缩、本地草稿、退化链 */
import fs from 'fs';
import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);

const sandbox = { TextEncoder, console, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(P('core','snapshot.js'), 'utf8'), sandbox);
const S = sandbox.Snapshot;

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));

console.log('\n[1] <image> 必须在切分事件流之前整块抠掉（天青踩过的坑）');
const body = [
  '『✨ 2081/09/17 · 星期三 · 22:47 · 港区商业街 · 晴 ✨』|旁白|-|',
  '她抬起头。|柴郡|微笑|',
  '「指挥官早呀。」|柴郡|高兴|',
  '<image>image###Scene Composition: city street, night, neon;Character 1 Prompt: 1girl, cat ears, white hair|centers:c3;###</image>'
].join('\n');
ok('认得出有 <image>', S.hasInline(body));
const st = S.stripInline(body);
ok('抠出 1 个 prompt', st.prompts.length === 1, JSON.stringify(st.prompts));
ok('正文里不再有 <image>', !/<image>/i.test(st.text));
ok('正文里不再有 centers:c3 这种带 | 的脏段', !/centers:c3/.test(st.text), st.text);
ok('剧本行没被破坏（还是 3 行）', st.text.trim().split('\n').filter(Boolean).length === 3, JSON.stringify(st.text.trim()));

console.log('\n[2] NAI 三段式解析 —— 保留分段而不是压平');
const inline = S.parseInline(st.prompts[0]);
ok('场景词抠对', /neon/.test(inline.scenePrompt) && /city street/.test(inline.scenePrompt), inline.scenePrompt);
ok('场景词里没混进角色词', !/cat ears/.test(inline.scenePrompt), inline.scenePrompt);
ok('角色分段保留了 1 个', inline.characters.length === 1, JSON.stringify(inline.characters));
ok('角色词抠对', /cat ears/.test(inline.characters[0].visualPrompt), inline.characters[0].visualPrompt);
ok('centers 记号被丢掉', !/centers/.test(inline.characters[0].visualPrompt), inline.characters[0].visualPrompt);

const two = S.parseInline('Scene Composition: classroom;Character 1 Prompt: 1girl, blonde;Character 2 Prompt: 1boy, glasses;');
ok('两个角色都解析出来', two.characters.length === 2);
ok('boy 认成 boy', two.characters[1].subjectType === 'boy', two.characters[1].subjectType);

const bare = S.parseInline('girl, long hair, rooftop, sunset');
ok('没有分段标记时整段当场景', /rooftop/.test(bare.scenePrompt) && bare.characters.length === 0, bare.scenePrompt);

console.log('\n[3] JSON 容错 —— 模型爱包代码块、留尾逗号、写废话');
ok('裸 JSON', !!S.parseJson('{"title":"a"}'));
ok('```json 代码块', S.parseJson('```json\n{"title":"b"}\n```').title === 'b');
ok('前面有废话', S.parseJson('好的，这是结果：\n{"title":"c"}').title === 'c');
ok('尾逗号', S.parseJson('{"title":"d",}').title === 'd');
ok('带 // 注释', S.parseJson('{ // 说明\n"title":"e"}').title === 'e');
ok('彻底坏掉返回 null', S.parseJson('不是 json') === null);

console.log('\n[4] normalize —— 字段裁剪与 8KB 收缩');
const big = S.normalize({
  title: 'x'.repeat(200),
  scenePrompt: 'a'.repeat(5000),
  sceneNegativePrompt: 'b'.repeat(5000),
  stylePrompt: 'c'.repeat(5000),
  characters: Array.from({ length: 9 }, (_, i) => ({ name: 'n' + i, subject: 'girl', prompt: 'p'.repeat(2000) }))
});
ok('标题裁到 40', big.title.length === 40, String(big.title.length));
ok('角色最多 4 个', big.characters.length === 4, String(big.characters.length));
ok('单字段裁到上限内', big.scenePrompt.length <= 1200);
const enc = new TextEncoder().encode(JSON.stringify(big)).length;
ok('整体压回 8KB 内', enc <= 8192, String(enc));
ok('收缩后场景词仍非空（最后才砍它）', big.scenePrompt.length > 0, String(big.scenePrompt.length));

ok('没有 visualPrompt 的角色被丢掉',
  S.normalize({ scenePrompt: 'x', characters: [{ name: 'a', prompt: '' }, { name: 'b', prompt: 'blonde' }] }).characters.length === 1);
ok('subject 非法时落 other',
  S.normalize({ characters: [{ name: 'a', subject: 'dragon', prompt: 'x' }] }).characters[0].subjectType === 'other');

console.log('\n[5] 本地草稿 —— 按地点关键字转环境词');
ok('神社 → shrine', /shrine/.test(S.envTagsFor('重樱神社')));
ok('商业街 → city street', /city street/.test(S.envTagsFor('港区商业街')));
ok('办公室 → office', /office/.test(S.envTagsFor('指挥官办公室')));
ok('认不出的地点有通用兜底', /anime background/.test(S.envTagsFor('魔法奇异点')));
const draft = S.localDraft('随便一段剧情', { loc: '重樱神社', period: '黄昏', cast: ['长门', '赤城'] });
ok('草稿带环境词', /shrine/.test(draft.scenePrompt), draft.scenePrompt);
ok('草稿带时段光线', /sunset|golden/.test(draft.scenePrompt), draft.scenePrompt);
ok('草稿带在场角色', draft.characters.length === 2, JSON.stringify(draft.characters.map(c => c.name)));
ok('草稿不编造发色（只给名字）', draft.characters[0].visualPrompt === '长门', draft.characters[0].visualPrompt);

console.log('\n[6] resolve 退化链');
const r1 = await S.resolve({ body, inlinePrompt: st.prompts[0], mode: 'auto' });
ok('有内联时走 inline，不花请求', r1.source === 'inline', r1.source);

let called = 0;
const r2 = await S.resolve({
  body: '柴郡在港区商业街抬起头。', mode: 'model', loc: '港区商业街', period: '夜',
  quiet: async () => { called++; return '```json\n{"title":"夜市偶遇","scenePrompt":"city street, night","characters":[{"name":"柴郡","subject":"girl","prompt":"cat ears, white hair"}]}\n```'; }
});
ok('两段式走 model', r2.source === 'model', r2.source);
ok('只发了一次请求', called === 1, String(called));
ok('解析出场景词', /night/.test(r2.context.scenePrompt), r2.context.scenePrompt);
ok('解析出角色', r2.context.characters[0].name === '柴郡');

let tries = 0;
const r3 = await S.resolve({
  body: '一段剧情', mode: 'model', loc: '重樱神社', period: '午',
  quiet: async () => { tries++; return '模型今天不想输出 JSON'; }
});
ok('连着两次解析不出来时落本地草稿', r3.source === 'local', r3.source);
ok('确实重试了一次（共 2 次）', tries === 2, String(tries));
ok('草稿仍然可用于出图', !!r3.context.scenePrompt, r3.context.scenePrompt);
ok('带警告说明为什么退化', !!r3.warning, r3.warning);

let boom = 0;
const r4 = await S.resolve({
  body: '一段剧情', mode: 'model', loc: '教室',
  quiet: async () => { boom++; throw new Error('429 限流'); }
});
ok('请求抛错时也落草稿而不是整条断掉', r4.source === 'local', r4.source);
ok('警告里带上原始错误', /429/.test(r4.warning || ''), r4.warning);

const r5 = await S.resolve({ body: '一段剧情', mode: 'auto', loc: '海边' });
ok('没有 quiet 通道时落草稿', r5.source === 'local', r5.source);

console.log('\n[7] 画风词透传');
const r6 = await S.resolve({ body: 'x', inlinePrompt: 'classroom, day', style: 'watercolor, soft lighting' });
ok('内联路径补上画风词', /watercolor/.test(r6.context.stylePrompt), r6.context.stylePrompt);


console.log('\n[8] 油猴世界书格式：每角色 UC + centers');
const oil = 'Scene Composition:2girls,1boy,indoors,bedroom,night,from above;' +
  'Character 1 Prompt:1girl,gotoh hitori,butterfly_hair_ornament,embarrassed,target#princess carry|centers:0.3,0.5;' +
  'Character 1 UC:one arms,lowres,bad hands,angry;' +
  'Character 2 Prompt:1boy,smiling,source#princess carry|centers:0.7,0.5;' +
  'Character 2 UC:one arms,lowres,bad hands,crying;';
const oc = S.parseInline(oil);
ok('三个字段都解析了', !!oc && oc.scenePrompt && oc.characters.length === 2, JSON.stringify(oc && oc.characters.length));
ok('场景词对', /bedroom/.test(oc.scenePrompt) && /from above/.test(oc.scenePrompt), oc.scenePrompt);
ok('角色 1 的 UC 挂在角色 1 上', /angry/.test(oc.characters[0].negativePrompt), oc.characters[0].negativePrompt);
ok('角色 2 的 UC 挂在角色 2 上', /crying/.test(oc.characters[1].negativePrompt), oc.characters[1].negativePrompt);
ok('UC 没有串位', !/crying/.test(oc.characters[0].negativePrompt));
ok('centers 解析成坐标', oc.characters[0].center && Math.abs(oc.characters[0].center.x - 0.3) < 1e-9,
   JSON.stringify(oc.characters.map(c => c.center)));
ok('centers 不留在外观词里', !/centers/.test(oc.characters[0].visualPrompt), oc.characters[0].visualPrompt);
ok('source#/target# 交互标签保留下来',
   /target#princess carry/.test(oc.characters[0].visualPrompt) &&
   /source#princess carry/.test(oc.characters[1].visualPrompt));
ok('1boy 认成 boy', oc.characters[1].subjectType === 'boy', oc.characters[1].subjectType);

const pct = S.parseInline('Character 1 Prompt:1girl|centers:30,50;');
ok('百分比写法也认', pct.characters[0].center && Math.abs(pct.characters[0].center.x - 0.3) < 1e-9,
   JSON.stringify(pct.characters[0].center));
const loose = S.parseInline('Character 1 Prompt:1girl|centers:中间;');
ok('写不出坐标时丢掉，交给引擎均分', !loose.characters[0].center);
const sceneUc = S.parseInline('Scene Composition:classroom;Scene UC:blurry,lowres;');
ok('整段负面词也认', /blurry/.test(sceneUc.sceneNegativePrompt), sceneUc.sceneNegativePrompt);

console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂\n');
process.exit(fail ? 1 : 0);
