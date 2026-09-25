/* ============================================================
 * tools/e2e-mobile.mjs —— 端到端：手机版式（竖屏 / 横屏 / 小屏）与电脑模式不受影响
 *
 * 有人反馈手机上没法玩：小手机的返回键被系统栏挡住点不了、横屏时小手机被裁掉一半、
 * 立绘挤成一团。这里用 Playwright 模拟真手机（触屏、isMobile）逐项量：
 *   · 自动识别成手机，竖屏 / 横屏类名对，转屏会跟着切
 *   · 整页不横向溢出；工具栏、输入栏、发送键、翻页键都在屏幕里、没被别的东西压住、够大
 *   · 竖屏台上只站一个人，横屏多人同台
 *   · 选项多的时候正文还看得见
 *   · 小手机铺满屏幕，顶上的「返回」「收起」看得见、点得到、真能用
 *   · 存档、换装这些弹层的关闭键点得到
 *   · 电脑模式下一条手机样式都不生效；开局界面能手动切模式
 *   · 手动横竖屏：手机转不过来（方向锁）也能横屏 —— 页面自己转 90°，按钮都点得到
 *   · 工具栏一按整排收起、再按回来，收起时有新消息把手亮红点
 *
 * 用法：node tools/e2e-mobile.mjs [要测的目录] [截图输出目录]
 * ============================================================ */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';

const ROOT = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(process.argv[3] || './shots');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));

const px = (c, w = 300, h = 700) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="40" fill="${c}"/></svg>`).toString('base64');
const GAL = `
var EXPRESSION_MAP = {};
var SCENE_MAP = { "港区(朝)": "${px('#1d3d5a', 1200, 700)}" };
var DEFAULT_SPRITES = { "柴郡": ["${px('#c47a9e')}"], "贝尔法斯特": ["${px('#4a9ec4')}"], "长门": ["${px('#9ec44a')}"] };
`;
const card = { spec: 'chara_card_v2', data: { name: '手机适配测试卡',
  first_mes: '『✨ 08:00 · 港区 · 晴 ✨』|旁白|-|\n' +
    '「指挥官，早上好呀～今天的港区也很热闹呢，要不要一起去码头那边看看新到的补给？」|柴郡|微笑|\n' +
    '「主人，早餐已经准备好了。」|贝尔法斯特|微笑|\n' +
    '「哼，吾也来了。今天有演习，别迟到。」|长门|微笑|\n' +
    '<choice>[跟柴郡去码头看补给][先去餐厅吃早餐][问长门演习的安排][留在办公室处理堆积的文件]</choice>',
  extensions: { regex_scripts: [{ scriptName: 'gal MVU', replaceString: GAL }] } } };
fs.writeFileSync(path.join(OUT, 'mobile-card.json'), JSON.stringify(card));

const exe = ['/opt/pw-browsers/chromium'].find(f => fs.existsSync(f));
const b = await chromium.launch(exe ? { executablePath: exe } : {});

/** 元素在不在屏幕里、中心点是不是它自己（没被别的东西压住）、多大 */
const probe = (p, sel) => p.evaluate((sel) => {
  const e = document.querySelector(sel);
  if (!e) return { exists: false };
  const r = e.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return { exists: true, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right,
    inView: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.width > 0,
    onTop: !!hit && (hit === e || e.contains(hit)), vw: innerWidth, vh: innerHeight };
}, sel);
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 &&
  document.body.scrollWidth <= innerWidth + 1);

async function start(p) {
  await p.setInputFiles('#f-card', path.join(OUT, 'mobile-card.json'));
  await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('#boot-steps button[data-step="go"]').click());
  await p.waitForTimeout(200);
  await p.evaluate(() => { const s = document.getElementById('btn-start'); s.click();
    if (!document.getElementById('boot').classList.contains('gone')) s.click(); });
  await p.waitForTimeout(900);
}
const goLine = async (p, i) => { await p.evaluate((i) => window.__gal.goTo(i), i); await p.waitForTimeout(700);
  await p.evaluate(() => document.getElementById('dialogue').click()); await p.waitForTimeout(250); };
const chars = (p) => p.evaluate(() => document.querySelectorAll('#sprites .char:not(.leaving)').length);

const VIEWS = [
  { name: 'iPhone 竖屏', tag: 'port', w: 390, h: 844, orient: 'm-port' },
  { name: '小屏安卓竖屏', tag: 'small', w: 360, h: 640, orient: 'm-port' },
  { name: 'iPhone 横屏', tag: 'land', w: 844, h: 390, orient: 'm-land' },
  { name: '矮横屏', tag: 'land-s', w: 740, h: 340, orient: 'm-land' }
];

for (const v of VIEWS) {
  console.log(`\n[${v.name} ${v.w}×${v.h}]`);
  const ctx = await b.newContext({ viewport: { width: v.w, height: v.h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + ROOT + '/index.html');
  await p.waitForTimeout(600);
  const cls = await p.evaluate(() => document.documentElement.className);
  ok('自动识别成手机，' + (v.orient === 'm-port' ? '竖屏' : '横屏'), /m-mobile/.test(cls) && cls.includes(v.orient), cls);
  ok('开场引导不横向溢出', await noHScroll(p));
  ok('「显示模式」选择看得见', (await probe(p, '#boot .boot-device [data-dev="mobile"]')).inView);
  const nx = await probe(p, '#boot-next');
  ok('「下一步」在屏幕里、点得到、够大', nx.inView && nx.onTop && nx.h >= 40, JSON.stringify(nx));
  await p.screenshot({ path: `${OUT}/m-${v.tag}-1boot.png` });

  await start(p);
  ok('进游戏后不横向溢出', await noHScroll(p));
  for (const id of ['#btn-phone', '#btn-saves', '#send', '#btn-reroll', '#usertext', '#nav-next']) {
    const r = await probe(p, id);
    ok(id + ' 在屏幕里、没被压住', r.inView && r.onTop, JSON.stringify(r));
  }
  const tb = await probe(p, '#btn-phone');
  ok('工具栏按钮至少 40px', tb.w >= 40 && tb.h >= 40, tb.w + '×' + tb.h);
  const nav = await probe(p, '#nav-next');
  ok('翻页键够大（≥30px）', nav.w >= 30 && nav.h >= 30, nav.w + '×' + nav.h);
  const fs1 = await p.evaluate(() => ({ text: parseFloat(getComputedStyle(document.getElementById('text')).fontSize),
    input: parseFloat(getComputedStyle(document.getElementById('usertext')).fontSize) }));
  ok('正文字号够大（竖屏 16 / 横屏 15）', fs1.text >= (v.orient === 'm-port' ? 16 : 15), fs1.text);
  ok('输入框 16px（不然 iOS 一点就整页放大）', fs1.input >= 16, fs1.input);

  await goLine(p, 3);        // 长门那句：台上三个人
  const n = await chars(p);
  if (v.orient === 'm-port') ok('竖屏台上只站说话的那一个', n === 1, n);
  else ok('横屏多人同台', n === 3, n);
  const who = await p.evaluate(() => [...document.querySelectorAll('#sprites .char.active')].length);
  ok('说话的人是高亮的那个', who === 1, who);
  await p.screenshot({ path: `${OUT}/m-${v.tag}-2stage.png` });

  await goLine(p, 3);
  const ch = await p.evaluate(() => {
    const bs = [...document.querySelectorAll('#choices button')];
    const t = document.getElementById('text').getBoundingClientRect();
    const body = document.getElementById('dlg-body').getBoundingClientRect();
    const first = bs[0] && bs[0].getBoundingClientRect();
    return { n: bs.length, minH: Math.min(...bs.map(x => x.getBoundingClientRect().height)), textH: t.height,
      overlap: first ? Math.max(0, Math.min(t.bottom, body.bottom) - first.top) : 0,
      textClipped: document.getElementById('text').scrollHeight > document.getElementById('text').clientHeight + 2 &&
        getComputedStyle(document.getElementById('text')).overflowY === 'visible',
      dlgBottom: document.getElementById('dialogue').getBoundingClientRect().bottom,
      inTop: document.getElementById('inputbar').getBoundingClientRect().top };
  });
  ok('选项都在，每个至少 40px 高', ch.n === 4 && ch.minH >= 40, JSON.stringify(ch));
  ok('选项多的时候正文还看得见（不被挤没）', ch.textH >= 20, ch.textH);
  ok('选项不盖在正文上', ch.overlap <= 1 && !ch.textClipped, JSON.stringify(ch));
  ok('对话框不压到输入栏上', ch.dlgBottom <= ch.inTop + 1, JSON.stringify(ch));
  await p.screenshot({ path: `${OUT}/m-${v.tag}-3choice.png` });

  /* ---- 小手机 ---- */
  await p.click('#btn-phone');
  await p.waitForTimeout(500);
  const back = await probe(p, '#ph-m-back'), close = await probe(p, '#ph-m-close');
  ok('小手机顶上的「返回」看得见、点得到', back.inView && back.onTop && back.h >= 32, JSON.stringify(back));
  ok('小手机顶上的「收起」看得见、点得到', close.inView && close.onTop, JSON.stringify(close));
  const frame = await probe(p, '#jup-root');
  ok('小手机铺满屏幕，没被裁', Math.abs(frame.w - v.w) <= 1 && Math.abs(frame.h - v.h) <= 1, JSON.stringify(frame));
  const dock = await probe(p, '#jup-root .ph-dock');
  ok('主屏图标坞整块在屏幕里', dock.inView, JSON.stringify(dock));
  await p.screenshot({ path: `${OUT}/m-${v.tag}-4phone.png` });
  await p.evaluate(() => document.querySelector('#jup-root .ph-app[data-app="juus"]').click());
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/m-${v.tag}-5juus.png` });
  await p.click('#ph-m-back');
  await p.waitForTimeout(300);
  ok('「返回」从 App 回到主屏', await p.evaluate(() => document.getElementById('jup-root').classList.contains('at-home')));
  await p.evaluate(() => document.querySelector('#jup-root .ph-app[data-app="cfg"]').click());
  await p.waitForTimeout(400);
  const saveBtn = await p.evaluate(() => { const b2 = [...document.querySelectorAll('#jup-root .ph-layer.on button')]
    .filter(x => x.offsetParent); const last = b2[b2.length - 1]; if (!last) return null;
    last.scrollIntoView({ block: 'end' }); const r = last.getBoundingClientRect(); return { bottom: r.bottom, vh: innerHeight }; });
  ok('设置页最下面的按钮能滚到屏幕里', saveBtn && saveBtn.bottom <= saveBtn.vh + 1, JSON.stringify(saveBtn));
  await p.screenshot({ path: `${OUT}/m-${v.tag}-6cfg.png` });
  await p.click('#ph-m-back');
  await p.waitForTimeout(250);
  await p.click('#ph-m-back');
  await p.waitForTimeout(250);
  ok('在主屏再按「返回」就收起小手机', await p.evaluate(() => document.getElementById('phone-overlay').hidden));

  /* ---- 弹层 ---- */
  await p.click('#btn-saves');
  await p.waitForTimeout(500);
  const sx = await probe(p, '#sv-close');
  ok('存档界面的关闭键点得到', sx.inView && sx.onTop && sx.w >= 40, JSON.stringify(sx));
  ok('存档界面不横向溢出', await p.evaluate(() => document.querySelector('.sv-shell').scrollWidth <= innerWidth + 1));
  await p.screenshot({ path: `${OUT}/m-${v.tag}-7saves.png` });
  await p.click('#sv-close');
  await p.waitForTimeout(250);
  await p.click('#btn-skin');
  await p.waitForTimeout(400);
  const kx = await probe(p, '#skin-close');
  ok('换装面板铺满、关闭键点得到', kx.inView && kx.onTop, JSON.stringify(kx));
  const skins = await p.evaluate(() => document.querySelectorAll('#skin-body .sk-char').length);
  ok('换装面板列出这一句的全部登场角色（竖屏台上只有一个人也一样）', skins === 3, skins);
  await p.screenshot({ path: `${OUT}/m-${v.tag}-8skin.png` });
  await p.click('#skin-close');

  ok('没有未捕获错误', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log('\n[转屏：竖 → 横 → 竖]');
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto('file://' + ROOT + '/index.html');
  await p.waitForTimeout(500);
  await start(p);
  await goLine(p, 3);
  ok('竖屏一个人', await chars(p) === 1);
  await p.setViewportSize({ width: 844, height: 390 });
  await p.waitForTimeout(900);
  ok('转成横屏：类名跟着切', await p.evaluate(() => document.documentElement.classList.contains('m-land')));
  ok('转成横屏：三个人都上台', await chars(p) === 3, await chars(p));
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(900);
  ok('转回竖屏：又只剩说话的那个', await chars(p) === 1, await chars(p));
  await ctx.close();
}

console.log('\n[电脑模式不受影响 + 手动切换]');
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await p.goto('file://' + ROOT + '/index.html');
  await p.waitForTimeout(500);
  ok('电脑自动识别成电脑', await p.evaluate(() => document.documentElement.classList.contains('m-pc')));
  await start(p);
  const tb = await probe(p, '#btn-phone');
  ok('电脑模式工具栏还是原来的 34px', Math.round(tb.w) === 34, tb.w);
  await goLine(p, 3);
  ok('电脑模式多人同台', await chars(p) === 3);
  await p.evaluate(() => window.__gal.setDevice('mobile'));
  await p.waitForTimeout(600);
  ok('手动切到手机：类名变了（宽屏按横屏排）', await p.evaluate(() =>
    document.documentElement.classList.contains('m-mobile') && document.documentElement.classList.contains('m-land')));
  ok('手动切的结果记住了', await p.evaluate(() => localStorage.getItem('gal_device')) === 'mobile');
  await p.evaluate(() => window.__gal.setDevice('auto'));
  await p.waitForTimeout(400);
  ok('切回「自动」又是电脑', await p.evaluate(() => document.documentElement.classList.contains('m-pc')));
  await p.screenshot({ path: `${OUT}/m-pc.png` });
  await ctx.close();
}
{
  /* 手机上也能手动切回电脑版（有人就是想要电脑版的样子） */
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto('file://' + ROOT + '/index.html');
  await p.waitForTimeout(400);
  await p.click('#boot .boot-device [data-dev="pc"]');
  await p.waitForTimeout(300);
  ok('手机上点「电脑」能切回电脑版', await p.evaluate(() => document.documentElement.classList.contains('m-pc')));
  await p.reload();
  await p.waitForTimeout(400);
  ok('刷新后还是电脑版（第一帧就是，不闪）', await p.evaluate(() => document.documentElement.classList.contains('m-pc')));
  await ctx.close();
}

console.log('\n[手动横竖屏：手机转不过来也能横屏]');
{
  /* 有人反馈「手机捣鼓半天切换不了横屏」（方向锁 / 浏览器不转）。
     手机一直竖着拿（视口 390×844 不变），点工具栏的「横」→ 整页转 90° 按横屏排。 */
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + ROOT + '/index.html');
  await p.waitForTimeout(500);
  const os = await probe(p, '#boot .orient-seg [data-orient="land"]');
  ok('开场引导里有「横竖屏」选择，看得见', os.inView && os.onTop, JSON.stringify(os));
  await p.screenshot({ path: `${OUT}/m-rot-0boot.png` });
  await start(p);
  await goLine(p, 3);
  ok('竖着：台上一个人', await chars(p) === 1);
  const ob = await probe(p, '#btn-orient');
  ok('工具栏上有横竖屏按钮，点得到', ob.inView && ob.onTop && ob.w >= 40, JSON.stringify(ob));
  await p.click('#btn-orient');
  await p.waitForTimeout(900);
  const cls = await p.evaluate(() => document.documentElement.className);
  ok('点一下就按横屏排（手机没转，页面自己转 90°）', /m-land/.test(cls) && /m-rot-cw/.test(cls) && !/m-port/.test(cls), cls);
  ok('记住了手动选的方向', await p.evaluate(() => localStorage.getItem('gal_orient')) === 'land');
  ok('横屏：三个人都上台', await chars(p) === 3, await chars(p));
  const st = await probe(p, '#stage');
  ok('舞台转过来正好铺满屏幕', Math.abs(st.w - 390) <= 1 && Math.abs(st.h - 844) <= 1 && Math.abs(st.left) <= 1 && Math.abs(st.top) <= 1, JSON.stringify(st));
  const dims = await p.evaluate(() => ({ w: document.getElementById('stage').clientWidth, h: document.getElementById('stage').clientHeight,
    sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }));
  ok('舞台自己的宽高是横的（844×390）', dims.w === 844 && dims.h === 390, JSON.stringify(dims));
  ok('转过来之后整页不滚动、不溢出', dims.sw <= 391 && dims.sh <= 845, JSON.stringify(dims));
  for (const id of ['#btn-phone', '#btn-orient', '#btn-tbhide', '#send', '#usertext', '#nav-next']) {
    const r = await probe(p, id);
    ok(id + ' 转过来之后在屏幕里、点得到', r.inView && r.onTop, JSON.stringify(r));
  }
  const lab = await p.evaluate(() => document.getElementById('btn-orient').textContent);
  ok('按钮变成「竖」（再按切回竖屏）', lab === '竖', lab);
  await p.screenshot({ path: `${OUT}/m-rot-1land.png` });
  await p.click('#choices button >> nth=0').catch(() => {});
  await p.waitForTimeout(200);
  await p.evaluate(() => document.getElementById('usertext').blur());
  await p.click('#btn-phone');
  await p.waitForTimeout(500);
  const back = await probe(p, '#ph-m-back'), fr = await probe(p, '#jup-root');
  ok('转过来的小手机：「返回」点得到', back.inView && back.onTop, JSON.stringify(back));
  ok('转过来的小手机铺满屏幕', Math.abs(fr.w - 390) <= 1 && Math.abs(fr.h - 844) <= 1, JSON.stringify(fr));
  await p.screenshot({ path: `${OUT}/m-rot-2phone.png` });
  await p.click('#ph-m-back');
  await p.waitForTimeout(300);
  await p.reload();
  await p.waitForTimeout(50);
  ok('刷新后第一帧就是转好的横屏', await p.evaluate(() => document.documentElement.classList.contains('m-rot-cw')));
  await p.waitForTimeout(500);
  await start(p);
  await p.click('#btn-orient');
  await p.waitForTimeout(600);
  const c2 = await p.evaluate(() => document.documentElement.className);
  ok('再按一下切回竖屏，不再转', /m-port/.test(c2) && !/m-rot/.test(c2), c2);
  /* 手机能转的：选了横屏再真把手机横过来 → 不用再转 */
  await p.evaluate(() => window.__gal.setOrient('land'));
  await p.setViewportSize({ width: 844, height: 390 });
  await p.waitForTimeout(700);
  const c3 = await p.evaluate(() => document.documentElement.className);
  ok('手机真横过来了：直接横屏，不转', /m-land/.test(c3) && !/m-rot/.test(c3), c3);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(700);
  ok('选了横屏后再竖着拿：还是横屏（手动选的优先）', await p.evaluate(() =>
    document.documentElement.classList.contains('m-land') && document.documentElement.classList.contains('m-rot-cw')));
  await p.evaluate(() => window.__gal.setOrient('auto'));
  await p.waitForTimeout(400);
  ok('「跟随手机」：竖着拿就是竖屏', await p.evaluate(() => document.documentElement.classList.contains('m-port') &&
    !document.documentElement.classList.contains('m-rot')));
  ok('没有未捕获错误', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  /* 反过来：手机横着卡住了，想竖屏玩 */
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto('file://' + ROOT + '/index.html');
  await p.waitForTimeout(400);
  await start(p);
  await goLine(p, 3);
  await p.click('#btn-orient');
  await p.waitForTimeout(800);
  const cls = await p.evaluate(() => document.documentElement.className);
  ok('横着拿点「竖」：按竖屏排，逆时针转', /m-port/.test(cls) && /m-rot-ccw/.test(cls), cls);
  ok('竖屏：台上一个人', await chars(p) === 1, await chars(p));
  for (const id of ['#btn-orient', '#send', '#nav-next']) {
    const r = await probe(p, id);
    ok(id + ' 在屏幕里、点得到', r.inView && r.onTop, JSON.stringify(r));
  }
  await p.screenshot({ path: `${OUT}/m-rot-3port.png` });
  await ctx.close();
}

console.log('\n[工具栏收起]');
for (const v of [{ name: '手机竖屏', w: 360, h: 640, mob: true }, { name: '电脑', w: 1280, h: 800, mob: false }]) {
  const ctx = await b.newContext(v.mob ? { viewport: { width: v.w, height: v.h }, isMobile: true, hasTouch: true }
    : { viewport: { width: v.w, height: v.h } });
  const p = await ctx.newPage();
  await p.goto('file://' + ROOT + '/index.html');
  await p.waitForTimeout(400);
  await start(p);
  const all = await p.evaluate(() => [...document.querySelectorAll('#toolbar button')].filter(x => x.offsetWidth).map(x => {
    const r = x.getBoundingClientRect(); return { id: x.id, l: r.left, r: r.right }; }));
  ok(v.name + '：一排键全在屏幕里', all.every(x => x.l >= 0 && x.r <= v.w), JSON.stringify(all));
  ok(v.name + '：横竖屏按钮只在手机上有', (await p.evaluate(() => !!document.getElementById('btn-orient').offsetWidth)) === v.mob);
  const hb = await probe(p, '#btn-tbhide');
  ok(v.name + '：收起把手在最右边、点得到', hb.inView && hb.onTop && hb.right >= Math.max(...all.map(x => x.r)) - 1, JSON.stringify(hb));
  await p.click('#btn-tbhide');
  await p.waitForTimeout(500);
  const hid = await p.evaluate(() => {
    const e = document.getElementById('btn-phone'), r = e.getBoundingClientRect();
    return { collapsed: document.getElementById('toolbar').classList.contains('collapsed'),
      op: getComputedStyle(document.getElementById('tb-items')).opacity,
      gone: r.left >= innerWidth - 1 || document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== e };
  });
  ok(v.name + '：一按整排收起来（滑走、点不到）', hid.collapsed && hid.op === '0' && hid.gone, JSON.stringify(hid));
  const hb2 = await probe(p, '#btn-tbhide');
  ok(v.name + '：收起后把手还在原地', hb2.inView && hb2.onTop && Math.abs(hb2.left - hb.left) <= 1, JSON.stringify(hb2));
  if (v.mob) await p.screenshot({ path: `${OUT}/m-tb-hidden.png` });
  await p.evaluate(() => { document.getElementById('phone-dot').hidden = false; window.__gal.setTbHidden(true); });
  ok(v.name + '：收起时有新消息，把手上亮红点', await p.evaluate(() => !document.getElementById('tb-dot').hidden));
  await p.reload();
  await p.waitForTimeout(400);
  await start(p);
  ok(v.name + '：刷新后还是收起的', await p.evaluate(() => document.getElementById('toolbar').classList.contains('collapsed')));
  await p.click('#btn-tbhide');
  await p.waitForTimeout(500);
  const ph = await probe(p, '#btn-phone');
  ok(v.name + '：再按一下整排回来，按钮又能点', ph.inView && ph.onTop, JSON.stringify(ph));
  ok(v.name + '：展开后红点收掉（红点回到各自按钮上）', await p.evaluate(() => document.getElementById('tb-dot').hidden));
  await ctx.close();
}

await b.close();
console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
console.log('截图在 ' + OUT);
process.exit(fail ? 1 : 0);
