/* ============================================================
 * tools/e2e-imgnet.mjs —— 端到端：图床连不上时图还能不能出来（v5.24）
 *
 * 有人反馈「电脑上好好的，手机上同一个梯子，背景和立绘全裂、开场都加载不出来」。
 * 这里用 Playwright 拦请求模拟几种网络：
 *   A. 图床被墙（连接直接断）、中转能通   → 自动改走中转，背景立绘都出来，提示玩家
 *   B. 图床黑洞（请求挂着不回）、中转能通 → 超时后改走中转，开场照样出来
 *   C. 图床和中转都不通                     → 不卡死：等到上限就开演；不留破图；提示查网络
 *   D. 「测试图片网络」按钮                  → 说清楚是哪一段不通
 *   E. 一切正常                             → 走直连，不绕中转
 *
 * 用法：node tools/e2e-imgnet.mjs [要测的目录] [截图输出目录]
 * ============================================================ */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';

const ROOT = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(process.argv[3] || './shots');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));

/* 一张 40×90 的 PNG（颜色无所谓，能解码就行） */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAABaCAYAAADKFBSnAAAAdElEQVR4nO3OMQGAIAAAQSQ1cYxjK4nAcIMOfwnuetb9jh+bXwdOCqqCqqAqqAqqgqqgKqgKqoKqoCqoCqqCqqAqqAqqgqqgKqgKqoKqoCqoCqqCqqAqqAqqgqqgKqgKqoKqoCqoCqqCqqAqqAqqgqqgKqg2o/oDk4XYjb4AAAAASUVORK5CYII=', 'base64');
const IMG_HDR = { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' };

const BG = 'https://files.catbox.moe/e2ebg1.jpg';
const SP = { '柴郡': 'https://files.catbox.moe/e2esp1.png', '贝尔法斯特': 'https://files.catbox.moe/e2esp2.png' };
const GAL = `
var EXPRESSION_MAP = {};
var SCENE_MAP = { "港区(朝)": "${BG}" };
var DEFAULT_SPRITES = { "柴郡": ["${SP['柴郡']}"], "贝尔法斯特": ["${SP['贝尔法斯特']}"] };
`;
const card = { spec: 'chara_card_v2', data: { name: '图床测试卡',
  first_mes: '『✨ 08:00 · 港区 · 晴 ✨』|旁白|-|\n' +
    '「指挥官，早上好呀～」|柴郡|微笑|\n' +
    '「主人，早餐已经准备好了。」|贝尔法斯特|微笑|',
  extensions: { regex_scripts: [{ scriptName: 'gal MVU', replaceString: GAL }] } } };
fs.writeFileSync(path.join(OUT, 'imgnet-card.json'), JSON.stringify(card));

const exe = ['/opt/pw-browsers/chromium'].find(f => fs.existsSync(f));
const b = await chromium.launch(exe ? { executablePath: exe } : {});

/**
 * net: { catbox: 'ok'|'block'|'hang', relay: 'ok'|'block' }
 * 其它外链一律断掉（真卡的资源包里有几千张 catbox 图，别让它们真出网）
 */
async function page(net, o = {}) {
  const ctx = await b.newContext(o.mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 800 } });
  const hits = { catbox: 0, relay: 0 };
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:') || u.startsWith('data:')) return route.continue();
    if (u.includes('files.catbox.moe') && !u.startsWith('https://wsrv.nl/')) {
      hits.catbox++;
      if (net.catbox === 'ok') return route.fulfill({ status: 200, headers: IMG_HDR, body: PNG });
      if (net.catbox === 'hang') return;             // 不回：模拟被黑洞
      return route.abort('connectionreset');
    }
    if (u.startsWith('https://wsrv.nl/')) {
      hits.relay++;
      if (net.relay === 'ok') {
        const go = () => route.fulfill({ status: 200, headers: Object.assign({}, IMG_HDR, { 'Content-Type': 'image/webp' }), body: PNG });
        return net.relayDelay ? setTimeout(go, net.relayDelay) : go();
      }
      return route.abort('connectionreset');
    }
    return route.abort('connectionrefused');
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  if (o.wait != null) await p.addInitScript((w) => {
    try { if (!localStorage.getItem('gal_imgnet')) localStorage.setItem('gal_imgnet', JSON.stringify({ mode: 'auto', wait: w })); } catch (e) {}
  }, o.wait);
  await p.goto('file://' + ROOT + '/index.html');
  await p.waitForTimeout(400);
  return { ctx, p, hits, errs };
}
async function loadCard(p) {
  await p.setInputFiles('#f-card', path.join(OUT, 'imgnet-card.json'));
  await p.waitForTimeout(300);
}
async function clickStart(p) {
  await p.evaluate(() => document.querySelector('#boot-steps button[data-step="go"]').click());
  await p.waitForTimeout(200);
  await p.evaluate(() => { const s = document.getElementById('btn-start'); s.click();
    if (!document.getElementById('boot').classList.contains('gone')) s.click(); });
}
const stageState = (p) => p.evaluate(() => {
  const bgs = ['bgA', 'bgB'].map(id => document.getElementById(id))
    .filter(e => e.classList.contains('show')).map(e => e.style.backgroundImage);
  const imgs = [...document.querySelectorAll('#sprites .char:not(.leaving) .layer.show img')].map(i => ({
    src: i.getAttribute('src'), w: i.naturalWidth, vis: getComputedStyle(i.parentNode).visibility }));
  return { bg: bgs[0] || '', imgs, text: document.getElementById('text').textContent,
    spinner: !document.getElementById('spinner').hidden, spinT: document.getElementById('spin-t').textContent,
    toasts: [...document.querySelectorAll('#gal-toast > *')].map(t => t.textContent).join(' | ') };
});

console.log('\n[A 图床被墙，中转能通]');
{
  const { ctx, p, hits, errs } = await page({ catbox: 'block', relay: 'ok', relayDelay: 600 }, { mobile: true });
  await loadCard(p);
  await clickStart(p);
  await p.waitForTimeout(250);
  const early = await stageState(p);
  ok('开演前先等图：显示「加载立绘和背景」，台词先不出', early.spinner && /加载立绘和背景/.test(early.spinT) &&
     /正在加载/.test(early.text), JSON.stringify(early));
  await p.waitForTimeout(2500);
  await p.evaluate(() => window.__gal.goTo(1));
  await p.waitForTimeout(1600);
  const s = await stageState(p);
  ok('背景出来了，走的中转', /wsrv\.nl/.test(s.bg), s.bg);
  ok('立绘出来了（解码成功、没藏起来），走的中转', s.imgs.length === 1 && s.imgs[0].w > 0 && s.imgs[0].vis !== 'hidden' &&
     /wsrv\.nl/.test(s.imgs[0].src), JSON.stringify(s.imgs));
  ok('提示了「直连不通，已改走中转」', /直连加载不出来，已自动改走图片中转/.test(s.toasts), s.toasts);
  ok('等图结束，转圈收起', !s.spinner);
  const hostsLS = await p.evaluate(() => localStorage.getItem('gal_imgnet_hosts'));
  ok('记住了这个图床直连不通', /files\.catbox\.moe/.test(hostsLS || ''), hostsLS);
  await p.screenshot({ path: `${OUT}/imgnet-A.png` });
  /* 刷新：直接走中转，不再去碰被墙的图床 */
  await p.reload(); await p.waitForTimeout(400);
  const before = hits.catbox;
  await loadCard(p); await clickStart(p); await p.waitForTimeout(2500);
  const s2 = await stageState(p);
  ok('刷新后直接走中转（没再去连图床）', hits.catbox === before && /wsrv\.nl/.test(s2.bg), hits.catbox - before + ' 次直连');
  ok('没有未捕获错误', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log('\n[B 图床黑洞（请求挂着不回），中转能通]');
{
  const { ctx, p, errs } = await page({ catbox: 'hang', relay: 'ok' }, { wait: 20 });
  await loadCard(p);
  const t0 = Date.now();
  await clickStart(p);
  await p.waitForFunction(() => document.getElementById('spinner').hidden && document.getElementById('text').textContent &&
    !/正在加载/.test(document.getElementById('text').textContent), null, { timeout: 25000 });
  const dt = Date.now() - t0;
  await p.waitForTimeout(600);
  const s = await stageState(p);
  ok('直连超时后换中转，开场照样出来（' + (dt / 1000).toFixed(1) + 's）', /wsrv\.nl/.test(s.bg) && dt < 15000, s.bg);
  await p.evaluate(() => window.__gal.goTo(1));
  await p.waitForTimeout(1600);
  const s2 = await stageState(p);
  ok('立绘也走中转出来了', s2.imgs.length === 1 && s2.imgs[0].w > 0 && /wsrv\.nl/.test(s2.imgs[0].src), JSON.stringify(s2.imgs));
  ok('没有未捕获错误', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log('\n[C 图床和中转都不通]');
{
  const { ctx, p, errs } = await page({ catbox: 'block', relay: 'block' }, { wait: 6, mobile: true });
  await loadCard(p);
  await clickStart(p);
  await p.waitForFunction(() => document.getElementById('spinner').hidden && !/正在加载/.test(document.getElementById('text').textContent),
    null, { timeout: 12000 });
  await p.evaluate(() => window.__gal.goTo(1));
  await p.waitForTimeout(1800);
  const s = await stageState(p);
  ok('不卡死：到点就开演，台词正常出来', /早上好/.test(s.text), s.text);
  ok('不留破图：拉不到的立绘整层藏起来', s.imgs.every(i => i.w > 0 || i.vis === 'hidden'), JSON.stringify(s.imgs));
  ok('提示玩家查网络', /直连和中转都不通/.test(s.toasts), s.toasts);
  ok('不会误说「已改走中转」', !/已自动改走/.test(s.toasts), s.toasts);
  const fit = await p.evaluate(() => { const d = document.getElementById('dialogue'), t = document.getElementById('text');
    return { dlg: d.getBoundingClientRect().height, clipped: t.scrollHeight > t.clientHeight + 2, h: t.clientHeight }; });
  ok('直接跳到一句（回看）时对话框按这句重新算高度，字不被截', !fit.clipped && fit.h > 10, JSON.stringify(fit));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/imgnet-C.png` });
  ok('没有未捕获错误', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log('\n[C2 等图时点「不等了」]');
{
  const { ctx, p } = await page({ catbox: 'hang', relay: 'block' }, { wait: 30 });
  await loadCard(p);
  await clickStart(p);
  await p.waitForTimeout(500);
  const btn = await p.evaluate(() => ({ t: document.getElementById('btn-abort').textContent, sp: !document.getElementById('spinner').hidden }));
  ok('等图时按钮写的是「不等了」', btn.sp && btn.t === '不等了', JSON.stringify(btn));
  await p.click('#btn-abort');
  await p.waitForTimeout(400);
  const s = await stageState(p);
  ok('点了立刻开演（台词开始出来）', !s.spinner && s.text.length > 0 && !/正在加载/.test(s.text), JSON.stringify(s));
  ok('按钮换回「中断」', await p.evaluate(() => document.getElementById('btn-abort').textContent) === '中断');
  await ctx.close();
}

console.log('\n[D 测试图片网络]');
{
  const { ctx, p } = await page({ catbox: 'block', relay: 'ok' }, { mobile: true });
  await loadCard(p);
  await p.evaluate(() => document.querySelector('#boot-steps button[data-step="api"]').click());
  await p.waitForTimeout(200);
  const btn = await p.$('#boot-netbox .nb-test');
  ok('接口页有「测试图片网络」', !!btn);
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await p.waitForFunction(() => /本站/.test(document.querySelector('#boot-netbox .nb-out').textContent), null, { timeout: 30000 });
  const out = await p.evaluate(() => document.querySelector('#boot-netbox .nb-out').innerText);
  ok('测了本站、图床直连、图床经中转', /本站/.test(out) && /files\.catbox\.moe 直连/.test(out) && /中转/.test(out), out);
  ok('结论：直连不通、走中转能通', /直连不通，走中转能通/.test(out), out);
  ok('告诉玩家该查什么（代理规则 / 分应用代理 / DNS / IPv6）', /分应用代理/.test(out) && /DNS/.test(out) && /IPv6/.test(out));
  await p.evaluate(() => document.querySelector('#boot-netbox .nb-out').scrollIntoView());
  await p.screenshot({ path: `${OUT}/imgnet-D.png` });
  await ctx.close();
}
{
  const { ctx, p } = await page({ catbox: 'block', relay: 'block' });
  await loadCard(p);
  await p.evaluate(() => document.querySelector('#boot-steps button[data-step="api"]').click());
  await p.click('#boot-netbox .nb-test');
  await p.waitForFunction(() => /本站/.test(document.querySelector('#boot-netbox .nb-out').textContent), null, { timeout: 30000 });
  const out = await p.evaluate(() => document.querySelector('#boot-netbox .nb-out').innerText);
  ok('都不通时结论：网络 / 代理的问题，页面补不了', /直连和中转都不通/.test(out) && /网络 \/ 代理/.test(out), out);
  await ctx.close();
}

console.log('\n[E 网络正常]');
{
  const { ctx, p, hits } = await page({ catbox: 'ok', relay: 'ok' });
  await loadCard(p);
  await clickStart(p);
  await p.waitForTimeout(1500);
  await p.evaluate(() => window.__gal.goTo(1));
  await p.waitForTimeout(1500);
  const s = await stageState(p);
  ok('走直连', /files\.catbox\.moe/.test(s.bg) && !/wsrv/.test(s.bg) && s.imgs[0] && /^https:\/\/files\.catbox\.moe/.test(s.imgs[0].src), JSON.stringify(s));
  ok('一次中转都没用', hits.relay === 0, hits.relay);
  ok('没有多余提示', !/中转/.test(s.toasts), s.toasts);
  await ctx.close();
}
{
  /* 设置成「总走中转」：直接走中转，不碰图床 */
  const { ctx, p, hits } = await page({ catbox: 'ok', relay: 'ok' });
  await p.evaluate(() => window.ImgNet.setConfig({ mode: 'relay' }));
  await loadCard(p);
  await clickStart(p);
  await p.waitForTimeout(1500);
  const s = await stageState(p);
  ok('「总走中转」：背景走中转', /wsrv\.nl/.test(s.bg), s.bg);
  ok('「总走中转」：没碰图床', hits.catbox === 0, hits.catbox);
  await ctx.close();
}

await b.close();
console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
console.log('截图在 ' + OUT);
process.exit(fail ? 1 : 0);
