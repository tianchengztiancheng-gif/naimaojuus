/* ============================================================
 * tools/e2e-gallery.mjs —— 端到端：立绘图库怎么拉图（v5.29 重新上线）
 *
 *   v5.28 下线的原因是「一次要太多图，转圈很久甚至加载失败」。这里盯着改过的拉法：
 *   A. 默认开着；?gallery=0 能临时关掉
 *   B. 列表页只拉看得见的那些，同时在途的请求不超过 6 个，全部走 wsrv 小图（w=160 / 320）
 *   C. 关掉页面重新打开：拉过的缩略图从 IndexedDB 读，一个请求都不发
 *   D. 一格挂了：小图试两次就停，不去拉原图（直连没通过），标「加载失败」，顶上出「重试失败的」；网好了点重试能出来
 *   E. 角色页往下快速一划：滚出去还没开始拉的撤掉，排队的都在可视区附近
 *   F. 看大图的时候格子不开新请求（带宽让给大图），关了接着拉
 *   G. 本地缓存有上限，超了按最旧的淘汰
 *
 * 用法：node tools/e2e-gallery.mjs [要测的目录] [截图输出目录]
 * ============================================================ */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const ROOT = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(process.argv[3] || './shots');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 合成卡：40 个只有一张图的角色（列表页用）+ 一个 90 张差分的「测大户」（角色页用）+ 一个图永远挂的「测坏」
   名字都带「测」，本地装了素材包（resource/juus）也能靠搜索框只看这些 */
const C = {};
for (let i = 1; i <= 40; i++) C['测' + String(i).padStart(2, '0')] = { 常服: { 微笑: `https://files.catbox.moe/t${i}.png` } };
const big = {}; for (let i = 1; i <= 90; i++) big['表情' + i] = `https://files.catbox.moe/big${i}.png`;
C['测大户'] = { 常服: big };
C['测坏'] = { 常服: { 微笑: 'https://files.catbox.moe/broken.png' } };
const GAL = `var EXPRESSION_MAP = ${JSON.stringify(C)};\nvar SCENE_MAP = {};\nvar DEFAULT_SPRITES = {};`;
const card = { spec: 'chara_card_v2', data: { name: '图库测试卡', first_mes: '『✨ 08:00 · 港区 · 晴 ✨』|旁白|-|', alternate_greetings: [],
  character_book: { entries: [] }, extensions: { regex_scripts: [{ scriptName: 'gal MVU', replaceString: GAL }] } } };
fs.writeFileSync(OUT + '/gallery-card.json', JSON.stringify(card));

/* 图片网络：wsrv 每张慢 DELAY 毫秒；broken 永远 500（BROKEN_OK 打开后就好了）；直连猫箱的请求单独记 */
let DELAY = 250, BROKEN_OK = false, inflight = 0, maxIn = 0;
const wsrv = [], direct = [];
const svg = t => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="320"><rect width="160" height="320" fill="#5b4a8c"/><text x="80" y="60" font-size="22" text-anchor="middle" fill="#fff">${t}</text></svg>`);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.route('**/*', async r => {
  const u = r.request().url();
  if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
  if (/wsrv\.nl/.test(u)) {
    const orig = decodeURIComponent(u.split('url=')[1].split('&')[0]);
    wsrv.push(u); inflight++; maxIn = Math.max(maxIn, inflight);
    await sleep(DELAY);
    inflight--;
    if (/broken/.test(orig) && !BROKEN_OK) return r.fulfill({ status: 500, body: 'nope', headers: { 'Access-Control-Allow-Origin': '*' } }).catch(() => {});
    return r.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: svg(orig.split('/').pop().slice(0, 8)) }).catch(() => {});
  }
  if (/catbox|huggingface/.test(u)) { direct.push(u); return r.abort(); }   // 直连「被墙」
  return r.abort();
});
const errs = [];
async function page(q) {
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('file://' + ROOT + '/index.html' + (q || '')); await p.waitForTimeout(800);
  return p;
}
const shown = (p, id) => p.evaluate(id => { const e = document.getElementById(id); return !!e && !e.hidden && getComputedStyle(e).display !== 'none'; }, id);

console.log('\n[A 默认开着]');
let p = await page('?gallery=0');
ok('?gallery=0：工具栏、相册、引导页三个入口都藏着', !(await shown(p, 'btn-gallery')) && !(await shown(p, 'cg-sg')) && !(await shown(p, 'boot-gallery')));
await p.close();
p = await page('');
await p.setInputFiles('#f-card', OUT + '/gallery-card.json'); await p.waitForTimeout(600);
ok('不带参数：引导页左栏有「立绘图库」', await shown(p, 'boot-gallery'));
const E = (f, a) => p.evaluate(f, a);

console.log('\n[B 列表页只拉看得见的]');
wsrv.length = 0; maxIn = 0;
await p.click('#boot-gallery'); await p.fill('#sg-q', '测'); await p.waitForTimeout(2500);
const l1 = await E(() => ({ boxes: document.querySelectorAll('.sg-char .ph[data-src]').length, ok: document.querySelectorAll('.sg-char .ph.sg-ok').length,
  load: document.getElementById('sg-load').textContent }));
ok('列表页 42 格，只拉了前面看得见的（不是全部）', l1.boxes === 42 && l1.ok >= 8 && wsrv.length < 42, JSON.stringify(l1) + ' 请求 ' + wsrv.length);
ok('全走 wsrv 小图（w=160 / 320），不拉原图', wsrv.length && wsrv.every(u => /&w=(160|320)&/.test(u)) && direct.length === 0, wsrv[0] + ' 直连 ' + direct.length);
ok('同时在途不超过 6 个', maxIn >= 2 && maxIn <= 6, 'max ' + maxIn);
ok('顶上写着「已加载 n / 42」', /已加载 \d+ \/ 42/.test(l1.load), l1.load);
await E(() => { const b = document.getElementById('sg-body'); b.scrollTop = b.scrollHeight; }); await p.waitForTimeout(3500);
const l2 = await E(() => ({ ok: document.querySelectorAll('.sg-char .ph.sg-ok').length, bad: document.querySelectorAll('.sg-char .ph.sg-bad').length,
  load: document.getElementById('sg-load').textContent }));
ok('滚到底：其余的也出来了，「测坏」那格标加载失败', l2.ok >= 30 && l2.bad === 1, JSON.stringify(l2));
await p.screenshot({ path: OUT + '/gallery-list.png' });

console.log('\n[D 挂了的格子]');
const brokenTries = wsrv.filter(u => /broken/.test(decodeURIComponent(u))).length;
ok('「测坏」：小图试了 2 次就停，没去直连拉原图', brokenTries === 2 && direct.length === 0, '小图 ' + brokenTries + ' 次，直连 ' + direct.length);
const bad = await E(() => { const x = document.querySelector('.sg-char .ph.sg-bad'); return { t: x && x.textContent, retry: !!document.getElementById('sg-retry'), load: document.getElementById('sg-load').textContent }; });
ok('格子上写「加载失败 · 点一下重试」，顶上有「重试失败的」', /加载失败/.test(bad.t) && /点一下重试/.test(bad.t) && bad.retry && /失败 1/.test(bad.load), JSON.stringify(bad));
BROKEN_OK = true;
await p.click('.sg-char .ph.sg-bad'); await p.waitForTimeout(1200);
const fixed = await E(() => ({ bad: document.querySelectorAll('.sg-char .ph.sg-bad').length, title: document.getElementById('sg-title').textContent }));
ok('网好了点那格：重新拉出来了，而且没被当成「点进这个角色」', fixed.bad === 0 && /立/.test(fixed.title), JSON.stringify(fixed));
BROKEN_OK = false;

console.log('\n[E 角色页快速往下划]');
DELAY = 1500; wsrv.length = 0;
await p.fill('#sg-q', '测大户'); await p.waitForTimeout(200);
await p.click('.sg-char'); await p.waitForTimeout(300);
for (let i = 0; i < 6; i++) { await E(k => { const b = document.getElementById('sg-body'); b.scrollTop = (k + 1) * b.scrollHeight / 6; }, i); await p.waitForTimeout(120); }
await p.waitForTimeout(300);
const far = await E(() => {
  const body = document.getElementById('sg-body').getBoundingClientRect();
  const q = [...document.querySelectorAll('.sg-pic .ph.sg-queued')];
  return { queued: q.length, far: q.filter(x => { const r = x.getBoundingClientRect(); return r.bottom < body.top - 400 || r.top > body.bottom + 400; }).length,
    n: document.querySelectorAll('.sg-pic').length };
});
ok('90 张差分：一路划下来，排队的全在可视区附近（滚过去的撤了）', far.n === 90 && far.far === 0 && far.queued <= 40, JSON.stringify(far));
ok('请求数远少于 90', wsrv.length < 40, '请求 ' + wsrv.length);

console.log('\n[F 看大图时格子让路]');
DELAY = 600;
await E(() => { const b = document.getElementById('sg-body'); b.scrollTop = 0; }); await p.waitForTimeout(2500);
await p.click('.sg-pic.sg-pic'); await p.waitForTimeout(100);
const before = wsrv.length;
await E(() => { const b = document.getElementById('sg-body'); b.scrollTop = b.scrollHeight / 2; }); await p.waitForTimeout(1500);
const during = wsrv.slice(before);
ok('大图开着：格子没开新请求，只拉了大图（和预取的下一张）', during.length >= 1 && during.every(u => /&w=1600/.test(u)) && during.length <= 2, during.map(u => u.match(/&w=\d+/)[0]).join(' '));
await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
ok('关了大图：格子接着拉', wsrv.slice(before).some(u => /&w=(160|320)&/.test(u)));

console.log('\n[C 重新打开：从本地缓存读]');
DELAY = 250;
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
await p.close();
await sleep(500);
p = await page('');
await p.setInputFiles('#f-card', OUT + '/gallery-card.json'); await p.waitForTimeout(600);
wsrv.length = 0;
await p.click('#boot-gallery'); await p.fill('#sg-q', '测'); await p.waitForTimeout(1200);
const c1 = await p.evaluate(() => ({ ok: document.querySelectorAll('.sg-char .ph.sg-ok').length, blob: /^blob:/.test((document.querySelector('.sg-char .ph.sg-ok img') || {}).src || ''),
  cache: window.ThumbCache && ThumbCache.available() }));
const cachedHit = wsrv.filter(u => /catbox\.moe\/(t\d+|big\d+|broken)\.png/.test(decodeURIComponent(u)));   // 本地装了素材包时，搜索前那一下会拉别的角色
ok('重新打开：看得见的封面全从 IndexedDB 出来，没发请求', c1.cache && c1.ok >= 8 && c1.blob && cachedHit.length === 0, JSON.stringify(c1) + ' 请求 ' + wsrv.length + ' ' + (cachedHit[0] || ''));
await p.screenshot({ path: OUT + '/gallery-cached.png' });

console.log('\n[G 缓存有上限]');
const pr = await p.evaluate(async () => {
  await ThumbCache.clear();
  for (let i = 0; i < 30; i++) await ThumbCache.put('k' + i, new Blob(['x'.repeat(100)], { type: 'image/webp' }));
  const before = await ThumbCache.stats();
  await ThumbCache.prune(20);
  const after = await ThumbCache.stats();
  return { before: before.n, after: after.n, oldGone: !(await ThumbCache.get('k0')), newKept: !!(await ThumbCache.get('k29')) };
});
ok('超过上限按最旧的淘汰到九成：30 张、上限 20 → 剩 18，最早的没了、最新的还在', pr.before === 30 && pr.after === 18 && pr.oldGone && pr.newKept, JSON.stringify(pr));

ok('没有报错', errs.length === 0, errs.join(' | '));
await b.close();
console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
process.exit(fail ? 1 : 0);
