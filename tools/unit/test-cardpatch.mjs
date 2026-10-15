/* 卡修订包（core/cardpatch.js）+ juus 卡的修订数据（resource/juus-patch.js）（v5.28） */
import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);

const sb = { console, JSON, Math };
sb.window = sb;
vm.createContext(sb);
for (const f of ['core/worldbook.js', 'core/script.js', 'core/cardpatch.js', 'resource/juus-patch.js', 'core/customsprites.js'])
  vm.runInContext(fs.readFileSync(P(f), 'utf8'), sb);
const { CardPatch: CP, Worldbook, ScriptParser } = sb;

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));
const J = x => JSON.stringify(x);
const fresh = () => {
  sb.RESOURCE = { characters: { 甲: { default_outfit: '常服', outfits: { 常服: { 微笑: ['a'] } } }, 乙: { default_outfit: '常服', outfits: { 常服: { 微笑: ['b'] } } } },
    defaults: { 甲: ['da', 'da2'], 乙: ['db'], 丙: ['dc'] }, scenes: {} };
};

console.log('\n[1] 机制');
{
  CP.register({ id: 't', match: c => c.data.name === '测试',
    sprites: { 乙: { 常服: { 开心: ['n1', 'n1', 'n2'] }, 泳装: { 微笑: 'n3' } }, 新人: { 常服: { 微笑: ['x'] } } },
    dropSprites: ['甲', '不存在'], dropDefaults: ['丙'], swapDefaults: [['甲', '乙'], ['丁', '戊']],
    worldbook: [{ id: 1, comment: '乙差分', keys: ['乙'], content: '新的', enabled: true }],
    disableEntries: ['甲差分'], openings: [{ n: '新开局', t: '『✨ 08:00 · 港区 ✨』|旁白|-|' }] });
  fresh();
  const eng = { pool: Worldbook.fromCard({ data: { character_book: { entries: [
    { id: 1, comment: '甲差分', keys: ['甲'], content: '旧', enabled: true }, { id: 2, comment: '乙差分', keys: ['乙'], content: '旧', enabled: true }] } } }) };
  const st0 = CP.apply({ data: { name: '别的' } }, eng);
  ok('认不出的卡不打', st0.ids.length === 0 && sb.RESOURCE.characters.甲 && eng.pool.length === 2);
  const st = CP.apply({ data: { name: '测试' } }, eng);
  const R = sb.RESOURCE;
  ok('统计', J(st.ids) === '["t"]' && st.sprites === 2 && st.dropped === 2 && st.swapped === 1 && st.worldbook === 1 && st.disabled === 1 && st.openings === 1, J(st));
  ok('整个角色换成新的一套，去重，单个地址也认', J(R.characters.乙.outfits) === J({ 常服: { 开心: ['n1', 'n2'] }, 泳装: { 微笑: ['n3'] } }) && R.characters.乙.default_outfit === '常服');
  ok('新角色建上', R.characters.新人.outfits.常服.微笑[0] === 'x');
  ok('删差分', !R.characters.甲);
  ok('删默认立绘', !R.defaults.丙);
  ok('对调原皮（第 0 张），后面的皮肤不动；有一边没有的跳过', J(R.defaults.甲) === J(['db', 'da2']) && J(R.defaults.乙) === J(['da']) && !('丁' in R.defaults));
  ok('同名世界书换成修订包的', eng.pool.filter(e => e.comment === '乙差分').length === 1 && eng.pool.find(e => e.comment === '乙差分').content === '新的' &&
     /^patch:t:/.test(eng.pool.find(e => e.comment === '乙差分').uid));
  ok('关掉条目', eng.pool.find(e => e.comment === '甲差分').enabled === false);
  ok('开场', J(CP.openings({ data: { name: '测试' } })) === J([{ n: '新开局', t: '『✨ 08:00 · 港区 ✨』|旁白|-|', patch: 't' }]) && CP.openings({ data: { name: 'x' } }).length === 0);
  ok('没有引擎也能只改素材', (fresh(), CP.apply({ data: { name: '测试' } }).sprites === 2));
  sb.window.CardPatch._list().splice(sb.window.CardPatch._list().findIndex(p => p.id === 't'), 1);
}

console.log('\n[2] juus 卡的修订数据');
{
  const p = CP._list().find(x => x.id === 'juus');
  ok('注册了', !!p);
  ok('认 juus / 奶猫崛起，不认别的', p.match({ data: { name: 'juus 之奶猫崛起' } }) && p.match({ data: { name: 'JUUS' } }) && !p.match({ data: { name: '天青' } }));
  ok('贾维斯 / 雅努斯的新立绘先撤了（没抠图），不换立绘', J(p.sprites) === '{}');
  ok('删 / 对调的名单', J(p.dropSprites) === J(['巴尔的摩', '布莱默顿', '武藏', '威尔士', '威尔士亲王']) && J(p.dropDefaults) === J([]) &&
     J(p.swapDefaults) === J([['飞龙', '飞龙·META'], ['苍龙', '苍龙·META']]));
  const wb = p.worldbook;
  ok('世界书：只有贾维斯设定（差分条目跟着立绘一起撤了）', J(wb.map(e => e.comment)) === J(['贾维斯']) &&
     /<character_information character="贾维斯">/.test(wb[0].content) && /<\/character_information>\s*$/.test(wb[0].content));
  const pool = Worldbook.fromCard({ data: { character_book: { entries: wb } } });
  ok('世界书条目按卡格式读得出来：@深度、关键词', pool[0].position === 4 && pool[0].depth === 5 && pool[0].key.includes('贾维斯'));
  ok('关掉三位的差分条目', J(p.disableEntries) === J(['巴尔的摩差分', '布莱默顿差分', '武藏差分', '威尔士差分', '威尔士亲王差分']));
  const op = p.openings[0].t;
  const ev = ScriptParser.parse(op).events;
  const says = ev.filter(e => e.type === 'say' && !e.narration);
  /* 卡里雅努斯原来那套差分；贾维斯卡里只有默认立绘，表情名不查 */
  const OLD = ['不安', '好奇', '比心', '伤心', '思考', '内心惊讶', '害羞', '开心', '性邀请', '严肃', '惊讶', '撒娇', '发情'];
  const bad = says.filter(e => e.who === '雅努斯' && !OLD.includes(e.expr));
  ok('开场：贾维斯 / 雅努斯说话，雅努斯的表情都在卡里原来的差分里', says.length > 15 && says.some(e => e.who === '贾维斯') && says.some(e => e.who === '雅努斯') && bad.length === 0,
     J(bad.map(e => e.who + '|' + e.expr)));
  ok('开场：地点医院病房，有选项和变量块（两人好感 80）', ev.some(e => e.type === 'bg' && e.loc === '医院病房') && /<choice>\[/.test(op) &&
     /"\/人物\/贾维斯\/好感度","value":80/.test(op) && /"\/人物\/雅努斯\/好感度","value":80/.test(op));
}

console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
process.exit(fail ? 1 : 0);
