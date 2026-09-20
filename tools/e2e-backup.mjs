/* ============================================================
 * tools/e2e-backup.mjs —— 端到端：导出存档 → 清空浏览器数据 → 导入 → 进度回来了
 *
 * 这是「存档能不能真的备份出来」那件事的证据。
 * 存档躺在浏览器的 IndexedDB 里，清缓存/换设备/换浏览器都会没；
 * 而且 file:// 和 https:// 是两个不同的源，互不相通。
 * 以前只有崩溃兜底页里那颗按钮能导出，等于崩了才能备份。
 *
 * 这个测试做的事，跟玩家真实会做的一模一样：
 *   玩一局 → 点「导出全部」拿到 JSON → 把 IndexedDB 和 localStorage 全清掉
 *   → 刷新（此时应该一份存档都没有）→ 点「导入备份」喂回那个 JSON
 *   → 存档列表回来了 → 读取它 → 剧情记录完整
 *
 * 用法：npm i -D playwright && node tools/e2e-backup.mjs [要测的目录] [截图目录]
 * ============================================================ */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(process.argv[3] || '.');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n))
                          : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));

const px = (c) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="700"><rect width="300" height="700" fill="${c}"/></svg>`
).toString('base64');
const bg = (c) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="${c}"/></svg>`
).toString('base64');

const GAL = `
var EXPRESSION_MAP = { "备份娘": { "常服": { "微笑": "${px('#4a9ec4')}" } } };
var SCENE_MAP = { "港区(朝)": "${bg('#16304a')}" };
var DEFAULT_SPRITES = {};
`;
const card = {
  spec: 'chara_card_v2',
  data: {
    name: '备份测试卡',
    first_mes: '『✨ 08:00 · 港区 · 晴 ✨』|旁白|-|\n「这句话必须在导入后还在。」|备份娘|微笑|',
    extensions: { regex_scripts: [{ scriptName: 'gal MVU', replaceString: GAL }] }
  }
};
fs.writeFileSync(path.join(OUT, 'backup-card.json'), JSON.stringify(card));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
/* 必须用 http 源：file:// 下 Chromium 不给 IndexedDB，测不出真实行为 */
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e).slice(0, 160)));

await p.route('http://gal.test/**', (route) => {
  const u = new URL(route.request().url());
  const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: '' });
  const ext = path.extname(f);
  const type = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css'
             : ext === '.js' || ext === '.mjs' ? 'text/javascript' : 'application/octet-stream';
  route.fulfill({ status: 200, contentType: type + '; charset=utf-8', body: fs.readFileSync(f) });
});
await p.goto('http://gal.test/index.html');
await p.waitForTimeout(900);

console.log('\n[0] 前提：这个源上 IndexedDB 是可用的');
ok('存档后端不是内存降级',
   await p.evaluate(() => window.GalStore.backend() !== 'memory'),
   await p.evaluate(() => window.GalStore.backend()));

console.log('\n[1] 玩一局');
await p.setInputFiles('#f-card', path.join(OUT, 'backup-card.json'));
await p.waitForTimeout(600);
await p.evaluate(() => document.querySelector('#boot-steps button[data-step="go"]').click());
await p.waitForTimeout(250);
await p.click('#btn-start'); await p.waitForTimeout(250);
if (!(await p.evaluate(() => document.getElementById('boot').classList.contains('gone')))) {
  await p.click('#btn-start');
}
await p.waitForTimeout(1200);
await p.click('#nav-next'); await p.waitForTimeout(800);
const before = await p.evaluate(() => ({
  text: document.getElementById('text').textContent,
  logLen: window.__gal.eng.log.length,
}));
ok('演出来了', /必须在导入后还在/.test(before.text), before.text);
const slotsBefore = await p.evaluate(async () => (await window.GalStore.listSaves()).map(s => s.id));
ok('有自动存档', slotsBefore.length >= 1, JSON.stringify(slotsBefore));

console.log('\n[2] 从「存读档」面板点导出');
await p.evaluate(() => {
  document.getElementById('btn-phone').click();
});
await p.waitForTimeout(400);
await p.evaluate(() => document.querySelector('#jup-root .ph-app[data-app="cfg"]').click());
await p.waitForTimeout(500);
await p.evaluate(() => {
  const b2 = [...document.querySelectorAll('#jup-root .kt-nav button[data-sec]')]
    .find(x => /存读档|save/i.test(x.textContent + x.dataset.sec));
  if (b2) b2.click();
});
await p.waitForTimeout(600);
ok('面板上有「导出全部」按钮', await p.evaluate(() => !!document.getElementById('sv-exp')));
ok('面板上有「导入备份」按钮', await p.evaluate(() => !!document.getElementById('sv-imp')));
ok('每条存档都有「导出」', await p.evaluate(() =>
  document.querySelectorAll('#slotlist [data-exp]').length >= 1));
await p.screenshot({ path: OUT + '/bk-1-panel.png' });

const dl = p.waitForEvent('download', { timeout: 8000 });
await p.evaluate(() => document.getElementById('sv-exp').click());
const d = await dl;
const packPath = path.join(OUT, 'exported.json');
await d.saveAs(packPath);
ok('导出真的下载了文件', fs.existsSync(packPath), d.suggestedFilename());
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
ok('包的格式对', pack.kind === 'gal-saves' && pack.v === 1);
ok('包里有存档', Object.keys(pack.saves).length === slotsBefore.length,
   Object.keys(pack.saves).join(' | '));
ok('包里不含 API 密钥',
   !/apiKey|sk-[A-Za-z0-9]/.test(JSON.stringify(pack)));

console.log('\n[3] 把浏览器数据整个清掉（模拟清缓存/换设备）');
await p.evaluate(async () => {
  localStorage.clear();
  const dbs = await indexedDB.databases ? await indexedDB.databases() : [{ name: 'gal' }];
  await Promise.all(dbs.map(x => new Promise(r => {
    const q = indexedDB.deleteDatabase(x.name); q.onsuccess = q.onerror = q.onblocked = r;
  })));
});
await p.goto('http://gal.test/index.html');
await p.waitForTimeout(1000);
const wiped = await p.evaluate(async () => (await window.GalStore.listSaves()).length);
ok('清干净了（一份存档都没有）', wiped === 0, '还剩 ' + wiped + ' 份');

console.log('\n[4] 导入那个备份');
await p.evaluate(() => { document.getElementById('boot').hidden = true;
  ['toolbar','dialogue','inputbar'].forEach(id => { const e = document.getElementById(id); if (e) e.hidden = false; });
  document.getElementById('btn-phone').click(); });
await p.waitForTimeout(400);
await p.evaluate(() => document.querySelector('#jup-root .ph-app[data-app="cfg"]').click());
await p.waitForTimeout(400);
await p.evaluate(() => {
  const b2 = [...document.querySelectorAll('#jup-root .kt-nav button[data-sec]')]
    .find(x => /存读档|save/i.test(x.textContent + x.dataset.sec));
  if (b2) b2.click();
});
await p.waitForTimeout(500);
await p.setInputFiles('#sv-file', packPath);
await p.waitForTimeout(1200);
const after = await p.evaluate(async () => (await window.GalStore.listSaves()).map(s => s.id));
ok('存档回来了', after.length === slotsBefore.length, JSON.stringify(after));
ok('界面给了反馈', /导入了/.test(await p.evaluate(() =>
  (document.getElementById('sv-note') || {}).textContent || '')));
await p.screenshot({ path: OUT + '/bk-2-imported.png' });

console.log('\n[5] 读回来，进度要完整');
await p.evaluate(() => {
  const btn = document.querySelector('#slotlist [data-load]');
  if (btn) btn.click();
});
await p.waitForTimeout(1200);
const back = await p.evaluate(() => ({
  text: document.getElementById('text').textContent,
  logLen: window.__gal.eng.log.length,
}));
ok('剧情记录条数一致', back.logLen === before.logLen,
   '原 ' + before.logLen + ' → 现 ' + back.logLen);
ok('停在同一句', back.text === before.text, back.text);
await p.screenshot({ path: OUT + '/bk-3-restored.png' });

console.log('\n[6] 重名不覆盖');
await p.setInputFiles('#sv-file', packPath);      // 再导一次同一个包
await p.waitForTimeout(1200);
const dup = await p.evaluate(async () => (await window.GalStore.listSaves()).map(s => s.id));
ok('重名的另存了副本，没有覆盖', dup.length === after.length * 2, JSON.stringify(dup));
ok('副本名字带「导入」标记', dup.some(x => /导入/.test(x)), JSON.stringify(dup));

ok('全程没有未捕获错误', errs.length === 0, errs.join(' | '));
await b.close();
console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
console.log('截图在 ' + OUT);
process.exit(fail ? 1 : 0);
