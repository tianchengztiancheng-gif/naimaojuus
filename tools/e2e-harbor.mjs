/* ============================================================
 * tools/e2e-harbor.mjs —— 端到端：标题画面「港区」（v5.30）
 *
 *   A. 打开就是港区：标题 / 英文副标题 / 秘书舰台词来自 resource/juus-title.js，点对话框换下一句；
 *      背景图拉到了才淡入（地址拦下来给一张本地图），没有存档时「继续」是灰的
 *   B. 出击：没预设 → 开场引导第一步；有预设没接口 → 第二步；都齐了 → 直接到「开场」那步
 *   C. 存档 / 图鉴：港区先让开，弹窗关掉回到港区；设置 → 开场引导第一步；引导页「回到港区」
 *   D. 开一局 → 港区收起；退出游戏 → 回到港区，「继续」亮了、写着最近那一份；点「继续」续上
 *   E. ?title=0 不出现；背景图地址拉不到 → 留着 CSS 画的底色，不报错
 *   F. 手机竖屏：按钮都在画面里、不重叠
 *
 * 用法：node tools/e2e-harbor.mjs [要测的目录] [截图输出目录]
 * ============================================================ */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const ROOT = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(process.argv[3] || './shots');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));
const J = x => JSON.stringify(x);

const preset = { prompts: [{ identifier: 'main', role: 'system', content: '你是港区的叙事者。' }, { identifier: 'chatHistory', marker: true }],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }] };
fs.writeFileSync(OUT + '/harbor-preset.json', J(preset));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9Qz0AEYBxVSF8AAP0lA/1mAsSGAAAAAElFTkSuQmCC', 'base64');
const titleJs = (bg) => fs.readFileSync(ROOT + '/resource/juus-title.js', 'utf8').replace(/bg: '[^']*',/, "bg: '" + bg + "',");

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
async function page(opt = {}) {
  const ctx = await b.newContext({ viewport: opt.vp || { width: 1280, height: 800 }, isMobile: !!opt.mobile, hasTouch: !!opt.mobile });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/juus-title\.js/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: titleJs(opt.bg == null ? 'https://files.catbox.moe/hbtest.png' : opt.bg) });
    if (u.includes('hbtest')) return r.fulfill({ status: 200, contentType: 'image/png', body: PNG, headers: { 'Access-Control-Allow-Origin': '*' } });
    if (u.startsWith('file:') || u.startsWith('data:')) return r.continue();
    if (!opt.offline && /catbox|wsrv|huggingface/.test(u)) return r.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="700"><rect width="300" height="700" fill="#5b4a8c"/></svg>') });
    return r.abort();
  });
  if (opt.api) await ctx.addInitScript(() => {
    if (!localStorage.getItem('gal_api_config'))
      localStorage.setItem('gal_api_config', JSON.stringify({ protocol: 'openai', baseUrl: 'https://main.api', apiKey: 'k1', model: 'main-m', stream: false }));
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto('file://' + ROOT + '/index.html' + (opt.q || '')); await p.waitForTimeout(opt.wait || 1500);
  return { p, ctx, errs, E: (f, a) => p.evaluate(f, a) };
}
const vis = (E, id) => E(id => { const e = document.getElementById(id); if (!e) return false;
  const s = getComputedStyle(e); return !e.hidden && s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.01; }, id);
const step = E => E(() => (document.getElementById('boot-kicker').textContent.match(/STEP (\d+)/) || [])[1]);

console.log('\n[A 打开就是港区]');
let { p, ctx, errs, E } = await page();
ok('港区盖在开场引导上面', await vis(E, 'harbor') && (await E(() => window.__gal.harbor().on)));
const a = await E(() => ({ title: document.getElementById('hb-title').textContent, en: document.getElementById('hb-en').textContent,
  who: document.getElementById('hb-sec-name').textContent, line: document.getElementById('hb-sec-line').textContent,
  bg: document.getElementById('hb-bg').classList.contains('on'), bgImg: getComputedStyle(document.getElementById('hb-bg')).backgroundImage,
  cont: document.getElementById('hb-continue').disabled, ver: document.getElementById('hb-ver').textContent, doc: document.title,
  clock: document.getElementById('hb-clock').textContent }));
ok('标题 / 副标题 / 网页标题来自 juus-title.js', a.title === 'juus 之奶猫崛起' && a.en === 'RISE OF THE MILKCAT' && a.doc === 'juus 之奶猫崛起', J(a));
ok('秘书舰在说话', !!a.who && a.line.length > 10, J([a.who, a.line]));
ok('背景图拉到了才淡入', a.bg && /hbtest/.test(a.bgImg), a.bgImg.slice(0, 80));
ok('没有存档：「继续」是灰的', a.cont === true);
ok('顶栏有时间和版本号', /^\d\d:\d\d$/.test(a.clock) && /^v\d+\.\d+/.test(a.ver), J([a.clock, a.ver]));
const l0 = a.line;
await p.click('#hb-sec'); await p.waitForTimeout(450);
ok('点对话框换下一句', (await E(() => document.getElementById('hb-sec-line').textContent)) !== l0);
await p.screenshot({ path: OUT + '/harbor-desk.png' });

console.log('\n[B 出击]');
await p.click('#hb-start'); await p.waitForTimeout(600);
ok('没预设：港区收起，到开场引导第一步', !(await vis(E, 'harbor')) && (await step(E)) === '01', await step(E));
await p.click('#boot-home'); await p.waitForTimeout(500);
ok('引导页「回到港区」', await vis(E, 'harbor'));
await p.setInputFiles('#f-preset', OUT + '/harbor-preset.json'); await p.waitForTimeout(300);
await p.click('#hb-start'); await p.waitForTimeout(500);
ok('有预设没接口：到第二步（接口）', (await step(E)) === '02', await step(E));
await ctx.close();
({ p, ctx, errs, E } = await page({ api: true }));
await p.setInputFiles('#f-preset', OUT + '/harbor-preset.json'); await p.waitForTimeout(300);
await p.click('#hb-start'); await p.waitForTimeout(500);
ok('预设接口都齐：直接到「开场」那步', (await step(E)) === '04', await step(E));

console.log('\n[C 存档 / 图鉴 / 设置]');
await p.click('#boot-home'); await p.waitForTimeout(400);
await p.click('#hb-saves'); await p.waitForTimeout(500);
ok('存档：港区让开，存档界面出来', !(await vis(E, 'harbor')) && (await vis(E, 'save-modal')));
await p.click('#sv-close'); await p.waitForTimeout(500);
ok('关掉存档界面回到港区', await vis(E, 'harbor') && !(await vis(E, 'save-modal')));
ok('图鉴按钮在（内置卡有立绘）', await vis(E, 'hb-gallery'));
await p.click('#hb-gallery'); await p.waitForTimeout(600);
ok('图鉴：立绘图库出来', !(await vis(E, 'harbor')) && (await vis(E, 'sg-modal')));
await p.click('#sg-close'); await p.waitForTimeout(500);
ok('关掉图鉴回到港区', await vis(E, 'harbor'));
await p.click('#hb-settings'); await p.waitForTimeout(500);
ok('设置：到开场引导第一步', !(await vis(E, 'harbor')) && (await step(E)) === '01');

console.log('\n[D 开局 / 退出 / 继续]');
await E(() => window.__gal.gotoBoot(3));
await E(() => { const s = document.getElementById('btn-start'); s.click(); });
await p.waitForTimeout(1800);
ok('开局后港区收起', !(await vis(E, 'harbor')) && (await vis(E, 'dialogue')));
await E(() => window.__gal.goTo(3)); await p.waitForTimeout(300);
await E(() => window.__gal.leaveGame()); await p.waitForTimeout(1200);
const d = await E(() => ({ cont: document.getElementById('hb-continue').disabled, resume: document.getElementById('hb-resume').textContent,
  hidden: document.getElementById('hb-resume').hidden, sub: document.getElementById('hb-sub').textContent }));
ok('退出游戏回到港区', await vis(E, 'harbor'));
ok('「继续」亮了，写着最近那一份', !d.cont && !d.hidden && /^继续：.+第 \d+ 轮$/.test(d.resume) && /存档 1 份/.test(d.sub), J(d));
await p.screenshot({ path: OUT + '/harbor-resume.png' });
await p.click('#hb-continue'); await p.waitForTimeout(1500);
ok('点「继续」续上，港区收起', !(await vis(E, 'harbor')) && (await vis(E, 'dialogue')));
ok('A~D 没有报错', errs.length === 0, errs.join(' | '));
await ctx.close();

console.log('\n[E 跳过 / 没有背景图]');
({ p, ctx, errs, E } = await page({ q: '?title=0' }));
ok('?title=0：不出现，直接是开场引导', !(await vis(E, 'harbor')) && (await E(() => !window.__gal.harbor().enabled)));
await ctx.close();
/* 外网全断（直连和中转都不通） */
({ p, ctx, errs, E } = await page({ bg: 'https://files.catbox.moe/dead00.png', offline: true, wait: 9000 }));
ok('背景图拉不到：港区照样出来，留着底色，不报错', (await vis(E, 'harbor')) && !(await E(() => document.getElementById('hb-bg').classList.contains('on'))) && errs.length === 0, errs.join(' | '));
await ctx.close();

console.log('\n[F 手机竖屏]');
({ p, ctx, errs, E } = await page({ vp: { width: 390, height: 844 }, mobile: true }));
const f = await E(() => {
  const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
  return { start: r('hb-start'), tiles: ['hb-continue', 'hb-saves', 'hb-gallery', 'hb-settings'].map(r), sec: r('hb-sec'), brand: r('hb-title'), W: innerWidth, H: innerHeight };
});
const inside = x => x.l >= 0 && x.r <= f.W && x.t >= 0 && x.b <= f.H;
const apart = (x, y) => x.b <= y.t || y.b <= x.t || x.r <= y.l || y.r <= x.l;
ok('出击和四个舰务按钮都在画面里', inside(f.start) && f.tiles.every(inside), J(f));
ok('对话框 / 标题 / 按钮互不重叠', apart(f.sec, f.brand) && apart(f.brand, f.start) && f.tiles.every(t => apart(t, f.start)), J(f));
await p.screenshot({ path: OUT + '/harbor-phone.png' });
ok('手机上没有报错', errs.length === 0, errs.join(' | '));
await ctx.close();

await b.close();
console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
process.exit(fail ? 1 : 0);
