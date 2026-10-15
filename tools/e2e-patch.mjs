/* ============================================================
 * tools/e2e-patch.mjs —— 端到端：juus 卡修订包（resource/juus-patch.js）+ 立绘图库（v5.28）
 *
 *   A. 一张合成的「juus」卡（结构照真卡，图全是本地 data:）载进去，修订包自动打上：
 *      贾维斯 / 雅努斯换成新立绘（透明背景），巴尔的摩等删掉差分，威尔士删差分、留默认立绘，飞龙 / 苍龙各自和 META 对调原皮，
 *      世界书加贾维斯设定、换雅努斯差分、关掉删了差分的条目；名字不是 juus 的卡不打
 *   B. 开场列表最后多了「贾维斯、雅努斯 · 医院病房」（开场名一律「在场的人 · 地点」），开局后两人在场、好感 80、立绘上台
 *   C. 立绘图库：角色列表、搜索、点进去全部立绘、大图翻页、Esc
 *
 * 用法：node tools/e2e-patch.mjs [要测的目录] [截图输出目录]
 * ============================================================ */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const ROOT = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(process.argv[3] || './shots');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));

const px = (c, t) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="700"><rect width="300" height="700" fill="${c}"/><text x="150" y="120" font-size="40" text-anchor="middle" fill="#fff">${t || ''}</text></svg>`).toString('base64');
const bg = (c) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="${c}"/></svg>`).toString('base64');

const GAL = `
var EXPRESSION_MAP = {
  "雅努斯": { "常服": { "不安": "${px('#999', '旧')}", "开心": "${px('#999', '旧')}" } },
  "巴尔的摩": { "常服": { "微笑": "${px('#a55', '挂')}" } },
  "布莱默顿": { "常服": { "微笑": "${px('#a55', '挂')}" } },
  "武藏": { "常服": { "微笑": "${px('#a55', '挂')}" } },
  "威尔士": { "常服": { "微笑": "${px('#a55', '挂')}" } },
  "谢菲尔德": { "女仆装": { "微笑": ["${px('#556', '谢菲1')}", "${px('#557', '谢菲2')}"], "害羞": "${px('#558', '谢菲3')}" } } };
var SCENE_MAP = { "医院病房(白日)": "${bg('#dfe9ef')}", "港区(朝)": "${bg('#16304a')}" };
var DEFAULT_SPRITES = { "威尔士": "${px('#a55', '威尔士默认')}", "飞龙": ["${px('#222', '飞龙META图')}", "${px('#2a5', '飞龙换装')}"], "飞龙·META": "${px('#2a5', '飞龙原版')}",
  "苍龙": ["${px('#111', '苍龙META图')}"], "苍龙·META": "${px('#25a', '苍龙原版')}", "巴尔的摩": "${px('#77a', '巴尔的摩默认')}",
  "贾维斯": "${px('#666', '贾维斯旧')}" };`;
const entries = [
  { id: 1, comment: '雅努斯差分', keys: ['雅努斯'], content: '雅努斯:\n  常服:\n    - 不安\n    - 开心', enabled: true, insertion_order: 102, extensions: { position: 4, depth: 1 } },
  { id: 2, comment: '巴尔的摩差分', keys: ['巴尔的摩'], content: '巴尔的摩:\n  常服:\n    - 微笑', enabled: true, insertion_order: 102, extensions: { position: 4, depth: 1 } },
  { id: 3, comment: '港区', keys: [], content: '港区设定', constant: true, enabled: true, insertion_order: 98 }];
const card = (name) => ({ spec: 'chara_card_v2', data: { name, first_mes: '『✨ 08:00 · 港区 · 晴 ✨』|旁白|-|\n「早。」|谢菲尔德|微笑|',
  alternate_greetings: ['『✨ 09:00 · 港区 · 晴 ✨』|旁白|-|', '『✨ 10:00 · 港区 · 晴 ✨』|旁白|-|\n「早上好。」|谢菲尔德|微笑|\n「哼。」|柴郡|开心|\n「早。」|谢菲尔德|微笑|'],
  character_book: { entries },
  extensions: { regex_scripts: [{ scriptName: 'gal MVU', replaceString: GAL }] } } });
fs.writeFileSync(OUT + '/patch-juus.json', JSON.stringify(card('juus 之奶猫崛起')));
fs.writeFileSync(OUT + '/patch-other.json', JSON.stringify(card('别的卡')));

const imgReq = [];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
/* 修订包里的立绘是猫箱地址：拦下来给本地占位图（这台机器连不上猫箱） */
await ctx.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith('file:') || u.startsWith('data:')) return r.continue();
  if (/catbox|wsrv|huggingface/.test(u)) { imgReq.push(u); return r.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' },
    body: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="700"><rect width="300" height="700" fill="#5b4a8c"/><text x="150" y="120" font-size="28" text-anchor="middle" fill="#fff">${u.split('/').pop().slice(0, 10)}</text></svg>`) }); }
  return r.abort();
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
/* 图库 v5.28.6 起默认下线，?gallery=1 才开；先确认默认是藏着的 */
await p.goto('file://' + ROOT + '/index.html?title=0'); await p.waitForTimeout(700);
const sgOff = await p.evaluate(() => ['btn-gallery', 'cg-sg', 'boot-gallery'].map(id => { const e = document.getElementById(id); return !e || getComputedStyle(e).display === 'none'; }));
await p.goto('file://' + ROOT + '/index.html?gallery=1'); await p.waitForTimeout(900);
const E = (f, a) => p.evaluate(f, a);

console.log('\n[A 修订包]');
ok('图库默认下线：工具栏、相册、引导页三个入口都藏着', sgOff.every(Boolean), JSON.stringify(sgOff));
await p.setInputFiles('#f-card', OUT + '/patch-other.json'); await p.waitForTimeout(500);
const o = await E(() => ({ ids: window.__gal.eng.patchStats && window.__gal.eng.patchStats.ids, jervis: !!RESOURCE.characters['贾维斯'],
  ops: document.getElementById('opening-sel').options.length }));
ok('名字不是 juus 的卡：不打修订包', o.ids && o.ids.length === 0 && !o.jervis && o.ops === 3, JSON.stringify(o));
await p.setInputFiles('#f-card', OUT + '/patch-juus.json'); await p.waitForTimeout(600);
const a = await E(() => {
  const R = RESOURCE, eng = window.__gal.eng, cnt = n => { const c = R.characters[n]; return c ? Object.values(c.outfits).reduce((s, o) => s + Object.values(o).flat().length, 0) : 0; };
  const pool = eng.pool;
  return { st: eng.patchStats, jv: cnt('贾维斯'), ja: cnt('雅努斯'), jaExprs: Object.keys((R.characters['雅努斯'] || { outfits: { 常服: {} } }).outfits['常服']),
    gone: ['巴尔的摩', '布莱默顿', '武藏', '威尔士'].map(n => !!R.characters[n]), wales: !!R.defaults['威尔士'], balt: !!R.defaults['巴尔的摩'],
    fl: String(R.defaults['飞龙']), flm: String(R.defaults['飞龙·META']), cl: String(R.defaults['苍龙']),
    wbJ: pool.filter(e => e.comment === '贾维斯').map(e => e.content.length), wbJd: pool.filter(e => e.comment === '贾维斯差分').length,
    wbJa: pool.filter(e => e.comment === '雅努斯差分').map(e => e.content), balEntry: pool.filter(e => e.comment === '巴尔的摩差分').map(e => e.enabled),
    note: document.getElementById('assets-note').textContent, ops: [...document.getElementById('opening-sel').options].map(x => x.textContent) };
});
ok('贾维斯：73 张新立绘', a.jv === 73, a.jv);
ok('雅努斯：整套换成新的 68 张（旧的「不安」没了）', a.ja === 68 && !a.jaExprs.includes('不安') && a.jaExprs.includes('猫耳卖萌'), a.ja + ' ' + a.jaExprs.slice(0, 5));
ok('巴尔的摩 / 布莱默顿 / 武藏 / 威尔士的差分删了', a.gone.every(x => !x));
ok('巴尔的摩的默认立绘还在（之后用它）', a.balt);
ok('威尔士的默认立绘留着（链接是好的）', a.wales);
const sw = await E(() => { const d = u => atob(String(u).split(',')[1]); const D = RESOURCE.defaults;
  return { fl: d(D['飞龙'][0]), fl1: d(D['飞龙'][1]), flm: d(D['飞龙·META'][0]), cl: d(D['苍龙'][0]), clm: d(D['苍龙·META'][0]) }; });
const dec = s => decodeURIComponent(escape(s));
ok('飞龙、苍龙：原皮和 META 对调，换装皮肤不动', /飞龙原版/.test(dec(sw.fl)) && /飞龙换装/.test(dec(sw.fl1)) && /飞龙META图/.test(dec(sw.flm)) &&
   /苍龙原版/.test(dec(sw.cl)) && /苍龙META图/.test(dec(sw.clm)), JSON.stringify(sw).slice(0, 80));
ok('世界书：贾维斯设定（长条目）+ 贾维斯差分', a.wbJ.length === 1 && a.wbJ[0] > 3000 && a.wbJd === 1, JSON.stringify(a.wbJ));
ok('世界书：雅努斯差分换成新表情（同名只留一条）', a.wbJa.length === 1 && /猫耳卖萌/.test(a.wbJa[0]) && !/不安/.test(a.wbJa[0]));
ok('世界书：删了差分的条目关掉', a.balEntry.length === 1 && a.balEntry[0] === false);
ok('引导页写着打了修订包', /修订包/.test(a.note), a.note.slice(-120));
ok('开场列表最后多了修订包的开局，名字是「在场的人 · 地点」，不写好感', a.ops.length === 4 && a.ops[3] === '3. 贾维斯、雅努斯 · 医院病房', a.ops.join(' / '));
ok('卡自带的开场也按「在场的人 · 地点」起名；没人说话的退回抬头', a.ops[2] === '2. 谢菲尔德、柴郡 · 港区' && /^1\. 09:00 · 港区/.test(a.ops[1]) && a.ops[0] === '默认开场', a.ops.join(' / '));

console.log('\n[B 新开场]');
await E(() => document.querySelector('#boot-steps button[data-step="go"]').click());
await E(() => { const s = document.getElementById('opening-sel'); s.value = '3'; s.dispatchEvent(new Event('change')); });
await p.click('#btn-start'); await p.waitForTimeout(300);
if (await E(() => !document.getElementById('boot').classList.contains('gone'))) await p.click('#btn-start');
await p.waitForTimeout(1800);
const v = await E(() => window.__gal.eng.vars);
ok('两人在场、好感度 80，地点医院病房', v.人物 && v.人物.贾维斯 && v.人物.雅努斯 && v.人物.贾维斯.好感度 === 80 && v.人物.雅努斯.好感度 === 80 &&
   v.人物.贾维斯.在场 && v.人物.雅努斯.在场 && v.地点 === '医院病房', JSON.stringify(v).slice(0, 300));
const idx = await E(() => window.__gal.eng.log.findIndex(m => m.who === '雅努斯'));
await E(i => window.__gal.goTo(i), idx); await p.waitForTimeout(1200);
const st = await E(() => ({ chars: [...document.querySelectorAll('#sprites .char:not(.leaving)')].map(c => c.dataset.who || c.getAttribute('data-who')),
  imgs: [...document.querySelectorAll('#sprites .char img')].map(i => i.src).filter(s => /catbox/.test(s)).length,
  spk: document.getElementById('speaker').textContent }));
ok('贾维斯和雅努斯同台，用的是新立绘', st.chars.length === 2 && st.imgs >= 2 && st.spk === '雅努斯', JSON.stringify(st));
await p.screenshot({ path: OUT + '/patch-opening.png' });

console.log('\n[C 立绘图库]');
imgReq.length = 0;
await p.click('#btn-gallery'); await p.waitForTimeout(1500);
const cov = await E(() => ({ boxes: document.querySelectorAll('.sg-char .ph[data-src]').length, ok: document.querySelectorAll('.sg-char .ph.sg-ok img').length }));
ok('列表页：每人一张封面，走缩略图（wsrv 小图），不拉原图', cov.ok >= 1 && imgReq.length >= 1 && imgReq.every(u => /wsrv\.nl.*&w=400/.test(u)), JSON.stringify(cov) + ' ' + imgReq.slice(0, 2).join(' '));
const g1 = await E(() => ({ open: !document.getElementById('sg-modal').hidden, names: [...document.querySelectorAll('.sg-char b')].map(x => x.textContent),
  stat: document.getElementById('sg-stat').textContent }));
/* 本地装了素材包（resource/juus）时角色会多，看包含关系 */
ok('角色列表：有表情差分的都在，删了差分的不在', g1.open && ['贾维斯', '雅努斯', '谢菲尔德'].every(n => g1.names.includes(n)) &&
   !['巴尔的摩', '布莱默顿', '武藏'].some(n => g1.names.includes(n)) && /位 · \d+ 张/.test(g1.stat), JSON.stringify(g1).slice(0, 200));
await p.screenshot({ path: OUT + '/patch-gallery.png' });
await p.fill('#sg-q', '谢菲'); await p.waitForTimeout(200);
ok('搜索', (await p.$$('.sg-char')).length === 1);
imgReq.length = 0;
await p.click('.sg-char'); await p.waitForTimeout(1500);
const g2 = await E(() => ({ title: document.getElementById('sg-title').textContent, n: document.querySelectorAll('.sg-pic').length,
  first: document.querySelector('.sg-pic span').textContent, loaded: document.querySelectorAll('.sg-pic .ph.sg-ok img').length,
  blob: /^blob:/.test((document.querySelector('.sg-pic .ph.sg-ok img') || {}).src || ''), bars: document.querySelectorAll('.sg-pic .sg-bar').length,
  stat: document.getElementById('sg-stat').textContent }));
ok('点进谢菲尔德：按表情标着', g2.title === '谢菲尔德' && g2.n >= 1 && /微笑/.test(g2.first) && g2.loaded === g2.n && g2.blob && g2.bars === g2.n, JSON.stringify(g2));
await p.screenshot({ path: OUT + '/patch-gallery-char.png' });
await p.click('.sg-pic[data-sgi="1"]'); await p.waitForTimeout(400);
ok('点图看大图', await E(() => !document.getElementById('sg-view').hidden && /微笑 2\/2/.test(document.getElementById('sg-cap').textContent)));
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(200);
ok('→ 下一张', /害羞/.test(await p.textContent('#sg-cap')), await p.textContent('#sg-cap'));
const logLen = await E(() => window.__gal.cursor != null ? window.__gal.cursor : -1);
await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(200);
ok('← 翻回去，舞台没跟着翻句', /微笑 1\/2/.test(await p.textContent('#sg-cap')) && (await E(() => window.__gal.cursor != null ? window.__gal.cursor : -1)) === logLen);
await p.screenshot({ path: OUT + '/patch-gallery-view.png' });
await p.keyboard.press('Escape'); await p.waitForTimeout(150);
ok('Esc 关大图', await E(() => document.getElementById('sg-view').hidden && !document.getElementById('sg-modal').hidden));
await p.click('#sg-back'); await p.waitForTimeout(200);
ok('‹ 回角色列表', await E(() => document.querySelectorAll('.sg-char').length >= 1 && document.getElementById('sg-back').hidden));
await p.fill('#sg-q', '贾维斯'); await p.waitForTimeout(300);
imgReq.length = 0;
await p.click('.sg-char'); await p.waitForTimeout(2500);
const g3 = await E(() => ({ n: document.querySelectorAll('.sg-pic').length, ok: document.querySelectorAll('.sg-pic .ph.sg-ok').length }));
ok('点进贾维斯才拉她的差分：缩略图，排队拉', imgReq.length >= 3 && imgReq.length <= g3.n && imgReq.every(u => /wsrv\.nl.*&w=480/.test(u)) && g3.ok >= 3,
   imgReq.length + '/' + g3.n + ' ' + imgReq[0]);
imgReq.length = 0;
await p.click('.sg-pic[data-sgi="0"]'); await p.waitForTimeout(1200);
ok('大图先拉原分辨率的 webp（w=1600、q90，不是缩略图），拉完进度条收起', imgReq.some(u => /wsrv\.nl.*&w=1600.*&q=90/.test(u)) &&
   await E(() => document.getElementById('sg-vbar').hidden && /^blob:/.test(document.getElementById('sg-img').src)), imgReq.join(' '));
await p.keyboard.press('Escape'); await p.waitForTimeout(150);
await p.click('#sg-back'); await p.waitForTimeout(200);
await p.fill('#sg-q', ''); await p.waitForTimeout(200);
await p.keyboard.press('Escape'); await p.waitForTimeout(150);
ok('Esc 关图库', await E(() => document.getElementById('sg-modal').hidden));

/* 开场引导里也有入口 */
await E(() => window.__gal.leaveGame && window.__gal.leaveGame()); await p.waitForTimeout(500);
const bg2 = await E(() => ({ hid: document.getElementById('boot-gallery').hidden, t: document.getElementById('boot-gallery').textContent, gone: document.getElementById('boot').classList.contains('gone') }));
ok('开场引导左栏有「立绘图库」', !bg2.hid && /\d+ 位/.test(bg2.t) && !bg2.gone, JSON.stringify(bg2));

ok('没有报错', errs.length === 0, errs.join(' | '));
await b.close();
console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
process.exit(fail ? 1 : 0);
