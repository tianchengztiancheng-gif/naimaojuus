/* ============================================================
 * tools/e2e-builtin.mjs —— 端到端：内置 juus 卡（v5.30）
 *
 *   A. 干净打开（没载过任何卡）：内置卡已经装上 —— 世界书、立绘、开场都有，开始按钮可点
 *   B. 初月 / 弗兰德尔 / 贾维斯 / 雅努斯：写到名字时「X差分」条目亮，剧本里的表情都点到对的图（猫箱地址）
 *   C. 附加世界书：挂上、刷新还在、删掉、刷新也没了
 *   D. 换用自己的卡：内置卡的立绘不残留；刷新还是自己的卡；「换回内置卡」回来，刷新也是内置卡
 *   E. v5.29 及以前存下来的 juus 卡（没有 custom 标记）：换成内置卡，旧卡删掉
 *   F. 酒馆版 v4 卡（首条是 <Harbor> 标题画面、已经带了新开局）：标题那条不进开场列表，开局不重复
 *
 * 猫箱的图全拦下来给本地占位图（这台机器连不上猫箱，也不该在测试里拉几百张真图）。
 * 用法：node tools/e2e-builtin.mjs [要测的目录] [截图输出目录]
 * ============================================================ */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const ROOT = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(process.argv[3] || './shots');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));
const J = x => JSON.stringify(x);

/* 附加世界书：酒馆导出格式 */
fs.writeFileSync(OUT + '/builtin-wb.json', J({ entries: {
  0: { uid: 0, key: ['测试暗号'], keysecondary: [], comment: '附加条目甲', content: '附加世界书的内容甲', constant: false, selective: true, order: 100, position: 1, disable: false, depth: 4 },
  1: { uid: 1, key: [], keysecondary: [], comment: '附加条目乙', content: '附加世界书的内容乙', constant: true, selective: false, order: 100, position: 0, disable: false, depth: 4 } } }));
/* 自己的卡：名字不是 juus */
const px = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="700"><rect width="300" height="700" fill="#4a9ec4"/></svg>').toString('base64');
fs.writeFileSync(OUT + '/builtin-own.json', J({ spec: 'chara_card_v2', data: { name: '我自己的卡', first_mes: '『✨ 08:00 · 港区 ✨』|旁白|-|\n早。|小甲|微笑|',
  character_book: { entries: [{ id: 1, comment: '自己卡的设定', keys: [], content: 'x', constant: true, enabled: true, insertion_order: 100 }] },
  extensions: { regex_scripts: [{ scriptName: 'gal MVU', replaceString: 'var EXPRESSION_MAP = { "小甲": { "常服": { "微笑": "' + px + '" } } };\nvar SCENE_MAP = {};\nvar DEFAULT_SPRITES = {};' }] } } }));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const imgReq = [];
await ctx.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith('file:') || u.startsWith('data:')) return r.continue();
  if (/catbox|wsrv|huggingface/.test(u)) { imgReq.push(u); return r.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' },
    body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="700"><rect width="300" height="700" fill="#5b4a8c"/></svg>') }); }
  return r.abort();
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
const URL0 = 'file://' + ROOT + '/index.html?title=0';
await p.goto(URL0); await p.waitForTimeout(1500);
const E = (f, a) => p.evaluate(f, a);
const state = () => E(() => {
  const R = window.RESOURCE, eng = window.__gal.eng;
  const cnt = n => { const c = R.characters[n]; return c ? Object.values(c.outfits).reduce((s, o) => s + Object.values(o).flat().length, 0) : 0; };
  return { src: window.__gal.cardSrc(), name: eng.card && (eng.card.data || eng.card).name, pool: eng.pool.length,
    note: document.getElementById('assets-note').textContent.replace(/\s+/g, ' ').trim(),
    start: !document.getElementById('btn-start').disabled, assetDone: window.__gal.bootDone('asset'),
    ops: [...document.getElementById('opening-sel').options].map(o => o.textContent),
    chars: Object.keys(R.characters).length, cy: cnt('初月'), fl: cnt('弗兰德尔'), jv: cnt('贾维斯'), ja: cnt('雅努斯'), own: cnt('小甲'),
    books: window.__gal.extraBooks(), patch: eng.patchStats && eng.patchStats.ids };
});

console.log('\n[A 干净打开]');
let s = await state();
ok('没载卡就用上了内置 juus 卡', s.src === 'builtin' && /奶猫崛起/.test(s.name), J([s.src, s.name]));
/* 池 = 卡里 140 条 + 初月 / 弗兰德尔新建的两条差分 + 引擎自己的 3 条规则（手机 / 出入场 / 插画） */
const BASE = s.pool;
const kinds = await E(() => { const P = window.__gal.eng.pool; return { card: P.filter(e => /^\d+$/.test(String(e.uid))).length, diff: P.filter(e => /^patch:juus-extra:/.test(e.uid)).length, eng: P.filter(e => /^__engine_/.test(e.uid)).length }; });
ok('世界书：卡里 140 条 + 新建差分 2 条 + 引擎规则 3 条', kinds.card === 140 && kinds.diff === 2 && kinds.eng === 3 && BASE === 145, J([kinds, BASE]));
ok('素材这一步算完成，开始按钮可点', s.assetDone && s.start);
ok('引导页写明用的是内置卡，不再提示缺卡', /内置 juus 卡/.test(s.note) && !/还缺角色卡/.test(s.note), s.note.slice(0, 120));
ok('开场白：默认 + 8 个 + 新加的初月、弗兰德尔，医务室那个只有一个', s.ops.length === 11 && s.ops.filter(o => /贾维斯/.test(o) && /雅努斯/.test(o)).length === 1, J(s.ops));
ok('新开局排在最后：初月 · 重樱入港处、弗兰德尔 · 指挥官办公室', /^9\. 初月 · 重樱入港处$/.test(s.ops[9]) && /^10\. 弗兰德尔 · 指挥官办公室$/.test(s.ops[10]), J(s.ops.slice(9)));
ok('只打了补充立绘和新开局（juus 修订包已经合在卡里）', J(s.patch) === '["juus-extra","juus-openings"]', J(s.patch));
ok('立绘：初月 66 / 弗兰德尔 65 / 贾维斯 75 / 雅努斯 70', s.cy === 66 && s.fl === 65 && s.jv === 75 && s.ja === 70, J([s.cy, s.fl, s.jv, s.ja]));
const labels = await E(() => [...document.querySelectorAll('#boot .files label')].map(l => l.textContent.trim()));
ok('文件框：预设在前，角色卡变成「换用自己的角色卡（可选）」放最后', /^预设/.test(labels[0]) && /换用自己的角色卡（可选）/.test(labels[labels.length - 1]), J(labels));
await p.screenshot({ path: OUT + '/builtin-boot.png' });

console.log('\n[B 四个人能被触发]');
const trig = await E(() => {
  const eng = window.__gal.eng;
  const fired = t => Worldbook.activate(eng.pool, [{ role: 'user', content: t }], { rng: () => 0 }).active.map(e => e.comment);
  const out = eng.processOutput('<Gal>\n『✨ 2081/06/20 · 14:20 · 医院病房 · 天气:晴 ✨』|旁白|-|\n「指挥官～」|初月|小恶魔笑容|\n「……打扫完了。」|弗兰德尔|胜利|\n「真是的。」|贾维斯|掀起裙子诱惑|\n「诶……」|雅努斯|掀起裙子诱惑|\n</Gal>');
  const R = window.RESOURCE.characters;
  const want = (w, ex) => R[w].outfits['常服'][ex];
  const got = out.modules.filter(m => m.sprites && m.sprites.length).map(m => {
    const sp = m.sprites.find(x => x.who === m.who) || {};
    return { who: m.who, expr: sp.expr, url: sp.url };
  });
  return { cy: fired('今天初月来了'), fl: fired('弗兰德尔在打扫'), jv: fired('贾维斯'), ja: fired('雅努斯'),
    got, okUrls: got.map(g => (want(g.who, g.expr) || []).indexOf(g.url) >= 0) };
});
ok('提到初月：「初月」设定 +「初月差分」亮', trig.cy.includes('初月') && trig.cy.includes('初月差分'), J(trig.cy));
ok('提到弗兰德尔：「弗兰德尔」设定 +「弗兰德尔差分」亮', trig.fl.includes('弗兰德尔') && trig.fl.includes('弗兰德尔差分'), J(trig.fl));
ok('提到贾维斯 / 雅努斯：设定和差分都亮', ['贾维斯', '贾维斯差分'].every(c => trig.jv.includes(c)) && ['雅努斯', '雅努斯差分'].every(c => trig.ja.includes(c)), J([trig.jv, trig.ja]));
ok('剧本里四个人的表情都点到自己那张图', trig.got.length === 4 && trig.okUrls.every(Boolean) &&
   J(trig.got.map(g => g.who + '|' + g.expr)) === J(['初月|小恶魔笑容', '弗兰德尔|胜利', '贾维斯|掀起裙子诱惑', '雅努斯|掀起裙子诱惑']), J(trig.got));

console.log('\n[C 附加世界书]');
await p.setInputFiles('#f-wi', OUT + '/builtin-wb.json'); await p.waitForTimeout(500);
s = await state();
ok('挂上了：池 +2，引导页列出来', s.pool === BASE + 2 && J(s.books) === J([{ name: 'builtin-wb', n: 2 }]) && /附加世界书：builtin-wb（2 条）/.test(s.note), J([s.pool, s.books]));
await p.reload(); await p.waitForTimeout(1500);
s = await state();
ok('刷新之后还在（以前刷新就没了）', s.pool === BASE + 2 && s.books.length === 1 && s.src === 'builtin', J([s.pool, s.books]));
await E(() => document.querySelector('#assets-note [data-wb-del="0"]').click()); await p.waitForTimeout(300);
s = await state();
ok('删掉：池回到原样', s.pool === BASE && s.books.length === 0, J([s.pool, s.books]));
await p.reload(); await p.waitForTimeout(1500);
s = await state();
ok('删掉后刷新也没了', s.pool === BASE && s.books.length === 0);
await p.setInputFiles('#f-wi', OUT + '/builtin-wb.json'); await p.waitForTimeout(400);

console.log('\n[D 换用自己的卡 / 换回内置卡]');
await p.setInputFiles('#f-card', OUT + '/builtin-own.json'); await p.waitForTimeout(600);
s = await state();
ok('用的是自己的卡，附加世界书还挂着', s.src === 'custom' && s.name === '我自己的卡' && s.pool === 1 + 3 + 2 && s.books.length === 1, J([s.src, s.pool]));
ok('内置卡的立绘不残留（初月、贾维斯都没了），自己卡的在', s.cy === 0 && s.jv === 0 && s.own === 1, J([s.cy, s.jv, s.own]));
ok('引导页有「换回内置卡」', /你自己的卡「builtin-own\.json」/.test(s.note) && /换回内置卡/.test(s.note), s.note.slice(0, 100));
await p.reload(); await p.waitForTimeout(1500);
s = await state();
ok('刷新之后还是自己的卡', s.src === 'custom' && s.name === '我自己的卡' && s.cy === 0, J([s.src, s.name]));
await E(() => document.getElementById('card-builtin').click()); await p.waitForTimeout(500);
s = await state();
ok('点「换回内置卡」：回到内置卡，立绘回来，附加世界书还在', s.src === 'builtin' && s.pool === BASE + 2 && s.cy === 66 && s.own === 0, J([s.src, s.pool, s.cy, s.own]));
await p.reload(); await p.waitForTimeout(1500);
s = await state();
ok('刷新之后也是内置卡（存的那张删了）', s.src === 'builtin' && !(await E(async () => { const v = await GalStore.getCard(); return !!(v && v.json); })));

console.log('\n[E 旧版本存下来的 juus 卡]');
await E(() => GalStore.set('card', { json: { spec: 'chara_card_v2', data: { name: 'juus 之奶猫崛起', first_mes: '旧卡', character_book: { entries: [] } } }, name: 'juus.json', at: 1 }));
await p.reload(); await p.waitForTimeout(1500);
s = await state();
ok('没有 custom 标记的 juus 卡：用内置卡代替', s.src === 'builtin' && s.pool === BASE + 2 && s.ops.length === 11, J([s.src, s.pool]));
ok('旧卡从浏览器里删掉了', !(await E(async () => { const v = await GalStore.getCard(); return !!(v && v.json); })));
await E(() => GalStore.set('card', { json: JSON.parse(JSON.stringify({ spec: 'chara_card_v2', data: { name: '别人的老卡', first_mes: '早', character_book: { entries: [] } } })), name: 'old.json', at: 1 }));
await p.reload(); await p.waitForTimeout(1500);
s = await state();
ok('没有 custom 标记、但不是 juus 的卡：照旧用', s.src === 'custom' && s.name === '别人的老卡', J([s.src, s.name]));

console.log('\n[F 酒馆版 v4 卡载进来]');
/* v4 卡：首条开场白是 <Harbor> 标题画面，两个新开局已经在 alternate_greetings 里 */
const v4 = await E(() => {
  const c = JSON.parse(JSON.stringify(window.JUUS_CARD));
  const ops = window.CardPatch._list().find(p => p.id === 'juus-openings').openings;
  c.data.first_mes = '<Harbor>港区</Harbor>';
  c.data.alternate_greetings = c.data.alternate_greetings.concat(ops.map(o => o.t));
  delete c.data.extensions.gal_builtin;
  c.data.extensions.gal_builtin = { merged_patches: ['juus'] };
  return c;
});
fs.writeFileSync(OUT + '/builtin-v4.json', J(v4));
await p.setInputFiles('#f-card', OUT + '/builtin-v4.json'); await p.waitForTimeout(800);
s = await state();
ok('标题画面那条不进开场列表，新开局也不重复：一共 10 个', s.src === 'custom' && s.ops.length === 10 && !s.ops.some(o => /默认开场|Harbor|港区<\/?/.test(o)), J(s.ops));
ok('v4 卡已经带了新开局：不再打 juus-openings', J(s.patch) === '["juus-extra"]', J(s.patch));
ok('第 1 个是恶毒那个，最后是弗兰德尔', /^1\. 恶毒/.test(s.ops[0]) && /^10\. 弗兰德尔/.test(s.ops[9]), J([s.ops[0], s.ops[9]]));

ok('没有报错', errs.length === 0, errs.join(' | '));
await b.close();
console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
process.exit(fail ? 1 : 0);
