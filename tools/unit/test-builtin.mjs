/* 内置 juus 卡（resource/juus-card.js）+ 奶猫补的立绘（resource/juus-extra.js）+ 修订包机制的新选项（v5.30） */
import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);

const sb = { console, JSON, Math };
sb.window = sb;
vm.createContext(sb);
for (const f of ['core/worldbook.js', 'core/script.js', 'core/cardres.js', 'core/cardpatch.js',
                 'resource/juus-patch.js', 'resource/juus-extra.js', 'resource/juus-card.js'])
  vm.runInContext(fs.readFileSync(P(f), 'utf8'), sb, { filename: f });
const { CardPatch: CP, Worldbook, CardRes, ScriptParser } = sb;
const CARD = sb.JUUS_CARD;

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));
const J = x => JSON.stringify(x);
const lines = c => String(c).split('\n').filter(l => /^\s+- /.test(l)).map(l => l.replace(/^\s+- /, '').trim());

console.log('\n[1] 修订包机制：已合入标记 / addSprites / diffEntries');
{
  CP.register({ id: 'tt', match: () => true,
    addSprites: { 甲: { 常服: { 新表情: ['n1', 'n1'], 微笑: ['a2'] } }, 新人: { 常服: { 开心: 'x' } } },
    diffEntries: true });
  sb.RESOURCE = { characters: { 甲: { default_outfit: '常服', outfits: { 常服: { 微笑: ['a'] }, 泳装: { 微笑: ['s'] } } } }, defaults: {}, scenes: {} };
  const eng = { pool: Worldbook.fromCard({ data: { character_book: { entries: [
    { id: 1, comment: '甲差分', keys: ['甲'], content: '旧', enabled: false, insertion_order: 105, extensions: { position: 4, depth: 2 } },
    { id: 2, comment: '丙差分', keys: ['丙'], content: '丙', enabled: true, insertion_order: 103, extensions: { position: 4, depth: 3 } }] } } }) };
  const st = CP.apply({ data: { name: '随便' } }, eng);
  const R = sb.RESOURCE.characters;
  ok('只加不换：原表情留着、同名表情追加、去重、别的服装不动',
     J(R.甲.outfits) === J({ 常服: { 微笑: ['a', 'a2'], 新表情: ['n1'] }, 泳装: { 微笑: ['s'] } }) && R.甲.default_outfit === '常服', J(R.甲));
  ok('没有的角色新建', J(R.新人.outfits) === J({ 常服: { 开心: ['x'] } }));
  const d甲 = eng.pool.find(e => e.comment === '甲差分');
  ok('已有的差分条目：正文换成立绘表、重新开启，设置不动',
     J(lines(d甲.content)) === J(['微笑', '新表情', '微笑']) && /^甲:\n  常服:\n/.test(d甲.content) && /\n  泳装:\n/.test(d甲.content) &&
     d甲.enabled && d甲.order === 105 && d甲.depth === 2, d甲.content);
  const dNew = eng.pool.find(e => e.comment === '新人差分');
  ok('没有的差分条目新建，照卡里已有差分条目的设置', dNew && dNew.content === '新人:\n  常服:\n    - 开心' && J(dNew.key) === '["新人"]' &&
     dNew.position === 4 && dNew.depth === 3 && dNew.order === 103 && /^patch:tt:/.test(dNew.uid), J(dNew));
  ok('统计', st.sprites === 2 && st.worldbook === 2, J(st));
  const st2 = CP.apply({ data: { name: '随便', extensions: { gal_builtin: { merged_patches: ['tt'] } } } }, eng);
  ok('卡里标了已合入的修订包不再打', st2.ids.indexOf('tt') < 0);
  CP._list().splice(CP._list().findIndex(p => p.id === 'tt'), 1);
}

console.log('\n[2] 内置卡本身');
const d = CARD && CARD.data;
ok('resource/juus-card.js 定义了 window.JUUS_CARD（V3）', d && CARD.spec === 'chara_card_v3' && /奶猫崛起/.test(d.name));
ok('标了已合入 juus 修订包', J(d.extensions.gal_builtin.merged_patches) === '["juus"]');
const ents = d.character_book.entries;
const byC = c => ents.filter(e => e.comment === c);
ok('世界书 140 条，没有重名、没有重复 id', ents.length === 140 && new Set(ents.map(e => e.comment)).size === 140 && new Set(ents.map(e => e.id)).size === 140);
ok('10/24 的新条目都在：初月 / 弗兰德尔 / 雅努斯 / 小舰娘', ['初月', '弗兰德尔', '雅努斯', '小舰娘'].every(c => byC(c).length === 1 && byC(c)[0].content.length > 1000));
ok('贾维斯是新设定（不是修订包里那份 <character_information>）', /^Name: 贾维斯/.test(byC('贾维斯')[0].content) && !/<character_information/.test(byC('贾维斯')[0].content));
ok('卡格式：keys / insertion_order / position 字符串 / 细节在 extensions', ents.every(e => Array.isArray(e.keys) && typeof e.insertion_order === 'number' &&
   /^(before|after)_char$/.test(e.position) && e.extensions && typeof e.extensions.position === 'number'));
const pool = Worldbook.fromCard(CARD);
ok('Worldbook 读得出 140 条，禁用的条目保持禁用', pool.length === 140 && pool.find(e => e.comment === 'nsfw(建议蓝灯手动开)').enabled === false);
ok('开场白 8 个（含医务室那个，只一份）', d.alternate_greetings.length === 8 &&
   d.alternate_greetings.filter(g => /医院病房/.test(g) && /贾维斯/.test(g)).length === 1);

console.log('\n[3] 载卡流程：CardRes → 修订包 → 补充立绘');
sb.RESOURCE = { characters: {}, defaults: {}, scenes: {} };
const res = CardRes.apply(CARD);
const R = sb.RESOURCE;
const fl0 = R.defaults['飞龙'][0];
ok('从卡里抽出立绘 / 默认立绘 / 场景', Object.keys(R.characters).length >= 70 && Object.keys(R.defaults).length >= 700 && Object.keys(R.scenes).length > 50, J(res));
const eng = { pool: Worldbook.fromCard(CARD) };
const st = CP.apply(CARD, eng);
ok('juus 修订包没再打，只打了补充立绘和新开局', J(st.ids) === '["juus-extra","juus-openings"]', J(st));
ok('飞龙原皮没被对调回去', R.defaults['飞龙'][0] === fl0);
ok('额外开场只有初月、弗兰德尔两个新的（医务室那个不重复）', J(CP.openings(CARD).map(o => o.n)) === J(['初月 · 重樱入港处', '弗兰德尔 · 指挥官办公室']), J(CP.openings(CARD).map(o => o.n)));
{
  /* 卡里已经带了这两个开局（酒馆版 v4 卡）：不再加 */
  const c4 = JSON.parse(J(CARD));
  c4.data.alternate_greetings = c4.data.alternate_greetings.concat(CP.openings(CARD).map(o => o.t));
  ok('卡里已经有这两个开局：juus-openings 不打', CP.openings(c4).length === 0 && !CP.matching(c4).some(p => p.id === 'juus-openings'));
}
ok('新贾维斯设定没被修订包盖掉', /^Name: 贾维斯/.test(eng.pool.find(e => e.comment === '贾维斯').content));
for (const who of ['初月', '弗兰德尔', '贾维斯', '雅努斯']) {
  const t = R.characters[who];
  const diff = eng.pool.filter(e => e.comment === who + '差分');
  ok(who + '：有表情差分，差分条目只有一条且名单 = 立绘表', t && diff.length === 1 && diff[0].enabled &&
     J(lines(diff[0].content)) === J(Object.keys(t.outfits[t.default_outfit])), who);
}
ok('初月 39 种 / 66 张，弗兰德尔 36 种 / 65 张', (() => {
  const n = w => { const o = R.characters[w].outfits['常服']; return [Object.keys(o).length, Object.values(o).reduce((s, a) => s + a.length, 0)]; };
  return J(n('初月')) === '[39,66]' && J(n('弗兰德尔')) === '[36,65]';
})());
{
  /* 第一次上传的 23 个猫箱空文件（200 但 0 字节），10/25 重传过，不能再混进来 */
  const EMPTY = 'j7n2qs gug5vq vkgcvo fotquq y38iqs 03c14g u4v5gu i1v0yv gzw4li 5clj4y m66hya xywu0n rkqngv q3m6ne kk9zyn lmolsn g85ejp v8phzw f8ie3b 3r3w9w fhde8m qqmdec 3lqshq'.split(' ');
  const all = [];
  for (const w of Object.keys(R.characters)) Object.values(R.characters[w].outfits).forEach(o => Object.values(o).forEach(a => all.push(...a)));
  ok('没混进第一次上传的空文件链接', !EMPTY.some(id => all.some(u => u.includes(id))));
}
ok('贾维斯 / 雅努斯多了「掀起裙子诱惑」，原来的表情一个没少', (() => {
  const orig = w => lines(byC(w + '差分')[0].content);
  return ['贾维斯', '雅努斯'].every(w => {
    const now = Object.keys(R.characters[w].outfits['常服']);
    return orig(w).every(x => now.includes(x)) && now.includes('掀起裙子诱惑') && now.length === orig(w).length + 1 &&
      R.characters[w].outfits['常服']['掀起裙子诱惑'].length === 2;
  });
})());
const extra = [];
for (const w of ['初月', '弗兰德尔', '贾维斯', '雅努斯']) Object.values(R.characters[w].outfits['常服']).forEach(a => extra.push(...a));
ok('立绘链接都是猫箱 png，没有重复', extra.every(u => /^https:\/\/files\.catbox\.moe\/[a-z0-9]{6}\.png$/.test(u)) && new Set(extra).size === extra.length);
ok('初月 / 弗兰德尔原来的默认立绘还在（没有表情时兜底）', R.defaults['初月'] && R.defaults['初月'].length >= 1 && R.defaults['弗兰德尔'].length >= 1);

console.log('\n[4] AI 写出来的剧本能点到图');
{
  const line = '<Gal>\n「指挥官～」|初月|小恶魔笑容|\n「……打扫完了。」|弗兰德尔|胜利|\n「真是的。」|贾维斯|掀起裙子诱惑|\n「诶……」|雅努斯|掀起裙子诱惑|\n</Gal>';
  const says = ScriptParser.parse(line).events.filter(e => e.type === 'say');
  ok('四个人的表情都在立绘表里', says.length === 4 && says.every(e => R.characters[e.who] &&
     R.characters[e.who].outfits['常服'][e.expr]), J(says.map(e => e.who + '|' + e.expr)));
}

console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
process.exit(fail ? 1 : 0);
