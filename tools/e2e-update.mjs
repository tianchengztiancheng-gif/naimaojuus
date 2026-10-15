/* ============================================================
 * tools/e2e-update.mjs —— 端到端：「有新版本」提示 + 一键更新（v5.28.4）
 *
 *   线上 version.json 比页面新 → 顶上出提示；点「稍后」收起；点「立即更新」→ 网址带 ?u=新版本号重新打开
 *   → 回来后网址里的 ?u= 去掉、提示「已更新到」；版本一样不提示；「检查更新」按钮说「已经是最新版」
 *   用 http 源（file:// 下不查更新）
 *
 * 用法：node tools/e2e-update.mjs [要测的目录] [截图输出目录]
 * ============================================================ */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const ROOT = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(process.argv[3] || './shots');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));

const PAGE_VER = (fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/name="gal-version" content="([^"]+)"/) || [])[1];
let remote = { version: '99.0.0', notes: '测试用的新版本' };
const docs = [];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.route('**/*', route => {
  const u = new URL(route.request().url());
  if (u.host !== 'gal.test') return route.abort();
  if (u.pathname === '/version.json') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remote) });
  if (route.request().resourceType() === 'document') docs.push(u.pathname + u.search);
  const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: '' });
  const ext = path.extname(f);
  const type = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.json' ? 'application/json' : 'text/javascript';
  route.fulfill({ status: 200, contentType: type + '; charset=utf-8', body: fs.readFileSync(f) });
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
const E = (f, a) => p.evaluate(f, a);

console.log('\n[1] 线上有新版本');
await p.goto('http://gal.test/index.html?title=0'); await p.waitForTimeout(3800);
const bar = await E(() => { const b = document.getElementById('ver-bar'); return b && !b.hidden ? b.textContent : ''; });
ok('页面版本号读得到，和 version.json / package.json 一致', !!PAGE_VER && await E(() => window.__gal.appVer) === PAGE_VER &&
   JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version === PAGE_VER &&
   JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version === PAGE_VER, PAGE_VER);
ok('打开 3 秒后提示「有新版本 v99.0.0」，带说明和当前版本', /有新版本 v99\.0\.0/.test(bar) && /测试用的新版本/.test(bar) && bar.includes('v' + PAGE_VER), bar);
await p.screenshot({ path: OUT + '/update-bar.png' });
await p.click('#ver-later');
ok('「稍后」收起', await E(() => document.getElementById('ver-bar').hidden));
await E(() => window.__gal.checkUpdate(false)); await p.waitForTimeout(300);
ok('同一个版本点过「稍后」，自动检查不再弹', await E(() => document.getElementById('ver-bar').hidden));
await E(() => document.getElementById('boot-vercheck').click()); await p.waitForTimeout(400);
ok('手动「检查更新」还是会弹', await E(() => !document.getElementById('ver-bar').hidden));

console.log('\n[2] 一键更新');
remote = { version: PAGE_VER };            // 「更新」回来后线上就是这个版本了
docs.length = 0;
await p.click('#ver-go');
await p.waitForURL(/gal\.test\/index\.html/, { timeout: 8000 }).catch(() => {});
await p.waitForTimeout(1500);
ok('换了网址重新打开（带 ?u=，原来的参数留着）', docs.some(d => /[?&]u=99\.0\.0/.test(d) && /title=0/.test(d)), docs.join(' '));
const url = p.url();
ok('回来后网址里的 ?u= 去掉，别的参数还在', !/[?&]u=/.test(url) && /title=0/.test(url), url);
await p.waitForTimeout(2500);
ok('版本一样：不提示', await E(() => { const b = document.getElementById('ver-bar'); return !b || b.hidden; }));
await E(() => document.getElementById('boot-vercheck').click()); await p.waitForTimeout(400);
ok('「检查更新」：已经是最新版', /已经是最新版/.test(await E(() => (document.getElementById('gal-toast') || {}).textContent || '')));

console.log('\n[3] 版本号按数字比，不按字符串比');
const cmp = await E(() => [window.__gal.verNewer('5.28.10', '5.28.9'), window.__gal.verNewer('5.29', '5.28.9'),
  window.__gal.verNewer('5.28.10', '5.28.10'), window.__gal.verNewer('5.28.9', '5.28.10'), window.__gal.verNewer('6', '5.99.99')]);
ok('5.28.10 > 5.28.9、5.29 > 5.28.9、一样的不算新、旧的不算新、6 > 5.99.99', JSON.stringify(cmp) === '[true,true,false,false,true]', JSON.stringify(cmp));

ok('没有报错', errs.length === 0, errs.join(' | '));
await b.close();
console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
process.exit(fail ? 1 : 0);
