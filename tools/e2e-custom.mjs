/* ============================================================
 * tools/e2e-custom.mjs —— 端到端：自定义立绘 / 回看里显示玩家的话 / 动态评论不丢（v5.27）
 *
 *   A. 手机 → 设置 → 自定义立绘：从本机选两张图（文件名当表情名）给卡里没有的角色、贴地址覆盖卡里有的表情
 *      → 素材表里有了、AI 请求里列着这些表情、剧本里写到她就上台用的是你的图；刷新后还在；删掉后卡里的原图回来
 *   B. 回看（手机 → 剧情）：每一轮最前面是玩家这一轮发的话，折叠时摘要也显示
 *   C. 推荐里的动态写评论 → 退出再点进来、刷新读档之后评论都还在
 *
 * 用法：node tools/e2e-custom.mjs [要测的目录] [截图输出目录]
 * ============================================================ */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path'; import zlib from 'zlib';

const ROOT = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(process.argv[3] || './shots');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));

/** 纯色的半透明 PNG（测上传和压缩用） */
function png(w, h, [r, g, b]) {
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.alloc(1 + w * 4); for (let x = 0; x < w; x++) row.set([r, g, b, x < w / 2 ? 255 : 0], 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/* 中文文件名走 buffer 传（这台机器上 setInputFiles 传中文路径会静默失败） */
const FILES = [{ name: '微笑.png', mimeType: 'image/png', buffer: png(400, 2400, [220, 80, 120]) },
               { name: '生气.png', mimeType: 'image/png', buffer: png(300, 600, [80, 120, 220]) }];

const px = (c, w = 300, h = 700) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${c}"/></svg>`).toString('base64');
const CARD_SMILE = px('#c47a9e');
const GAL = `
var EXPRESSION_MAP = { "测试娘A": { "常服": { "微笑": ["${CARD_SMILE}"] } } };
var SCENE_MAP = { "港区(朝)": "${px('#1d3d5a', 1200, 700)}" };
var DEFAULT_SPRITES = { "测试娘A": ["${CARD_SMILE}"] };
`;
const card = { spec: 'chara_card_v2', data: { name: '自定义立绘测试卡',
  first_mes: '『✨ 08:00 · 港区 ✨』|旁白|-|\n「早上好，指挥官。」|测试娘A|微笑|',
  extensions: { regex_scripts: [{ scriptName: 'gal MVU', replaceString: GAL }] } } };
fs.writeFileSync(path.join(OUT, 'custom-card.json'), JSON.stringify(card));
const preset = { prompts: [{ identifier: 'main', role: 'system', content: '你是港区的叙事者。' }, { identifier: 'chatHistory', marker: true }],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }] };
fs.writeFileSync(path.join(OUT, 'custom-preset.json'), JSON.stringify(preset));
const MY_URL = px('#ffaa00');

const exe = ['/opt/pw-browsers/chromium'].find(f => fs.existsSync(f));
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
const log = { main: [] };
let n = 0;
await ctx.route('**/*', async (route) => {
  const u = route.request().url();
  if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  if (!u.startsWith('https://main.api/')) return route.abort();
  const body = route.request().postData() || '';
  log.main.push(body);
  let content;
  if (/动态评论区/.test(body)) content = '[评论|测试娘A|谢谢指挥官！]\n[评论|小新|我也要吃]';
  else if (/剧情记忆/.test(body)) content = '- 要点';
  else { n++; content = `<Gal>\n「第${n}次，指挥官。」|测试娘A|微笑|\n「我是新来的。」|小新|生气|\n</Gal>\n[小红书|测试娘A|今天的晚饭${n}|食堂的咖喱很好吃|12|0|3]`; }
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }) });
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(() => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem('gal_api_config', JSON.stringify({ protocol: 'openai', baseUrl: 'https://main.api', apiKey: 'k1', model: 'main-m', stream: false }));
  localStorage.setItem('gal_memory_cfg', JSON.stringify({ enabled: false }));
});
async function boot() {
  await p.goto('file://' + ROOT + '/index.html'); await p.waitForTimeout(700);
  await p.setInputFiles('#f-card', path.join(OUT, 'custom-card.json'));
  await p.setInputFiles('#f-preset', path.join(OUT, 'custom-preset.json'));
  await p.waitForTimeout(400);
}
async function start() {
  await p.evaluate(() => document.querySelector('#boot-steps button[data-step="go"]').click());
  await p.evaluate(() => { const s = document.getElementById('btn-start'); s.click(); if (!document.getElementById('boot').classList.contains('gone')) s.click(); });
  await p.waitForTimeout(900);
}
async function say(t) {
  const n0 = await p.evaluate(() => window.__gal.eng.history.filter(m => !m.phoneOnly).length);
  await p.fill('#usertext', t); await p.click('#send');
  await p.waitForFunction((n0) => window.__gal.eng.history.filter(m => !m.phoneOnly).length >= n0 + 2, n0, { timeout: 10000 });
  await p.waitForTimeout(400);
}
async function phoneApp(app, sec) {
  if (await p.evaluate(() => document.getElementById('phone-overlay').hidden)) { await p.click('#btn-phone'); await p.waitForTimeout(400); }
  await p.evaluate((app) => window.__gal.openApp ? window.__gal.openApp(app) : document.querySelector('#jup-root .ph-app[data-app="' + app + '"]').click(), app);
  await p.waitForTimeout(300);
  if (sec) { await p.evaluate((sec) => document.querySelector('#jup-root .kt-nav button[data-sec="' + sec + '"]').click(), sec); await p.waitForTimeout(300); }
}
async function closePhone() {
  await p.evaluate(() => { const c = document.getElementById('ph-m-close') || document.querySelector('#phone-overlay .ph-close'); if (c) c.click(); });
  await p.waitForTimeout(300);
}

console.log('\n[A 自定义立绘]');
await boot(); await start();
await phoneApp('cfg', 'spr');
ok('设置里有「自定义立绘」', !!(await p.$('#spr-host #spr-name')) && !!(await p.$('#spr-file')));
await p.fill('#spr-name', '小新');
ok('填了卡里没有的名字：提示会新建', /会新建/.test(await p.textContent('#spr-who')));
await p.setInputFiles('#spr-file', FILES);
await p.waitForFunction(() => document.querySelectorAll('#spr-host .spr-t').length === 2, null, { timeout: 8000 }).catch(() => {});
const st = await p.evaluate(() => {
  const c = window.RESOURCE.characters['小新'];
  const u = c && c.outfits['常服'] && c.outfits['常服']['微笑'] && c.outfits['常服']['微笑'][0];
  return { exprs: c ? Object.keys(c.outfits['常服'] || {}) : [], webp: /^data:image\/webp/.test(u || ''), len: (u || '').length,
    thumbs: document.querySelectorAll('#spr-host .spr-t').length };
});
ok('选了两张：文件名当表情名，进了素材表', st.thumbs === 2 && st.exprs.sort().join() === '微笑,生气', JSON.stringify(st));
ok('本地图压成 webp 存', st.webp, JSON.stringify(st));
const dims = await p.evaluate(() => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]);
  i.src = window.RESOURCE.characters['小新'].outfits['常服']['微笑'][0]; }));
ok('大图压到长边 1800 以内，透明保留（webp）', Math.max(...dims) <= 1800 && dims[1] === 1800, dims.join('×'));
/* 贴地址覆盖卡里有的 */
await p.fill('#spr-name', '测试娘A'); await p.fill('#spr-outfit', '常服'); await p.fill('#spr-expr', '微笑');
ok('卡里有的角色：提示同格会换成你的', /换成你的图/.test(await p.textContent('#spr-who')));
await p.fill('#spr-url', MY_URL); await p.click('#spr-add-url'); await p.waitForTimeout(300);
ok('覆盖卡里同一格', await p.evaluate((u) => window.RESOURCE.characters['测试娘A'].outfits['常服']['微笑'][0] === u, MY_URL));
await p.screenshot({ path: `${OUT}/custom-sprites.png` });
await closePhone();
await say('你好，新同学');
const req = log.main.filter(x => /你好，新同学/.test(x)).pop() || '';
ok('请求里告诉 AI 这些角色有哪些表情', /自定义立绘/.test(req) && /小新（常服：微笑\/生气）/.test(req), req.slice(0, 200));
await p.evaluate(() => window.__gal.goTo(window.__gal.eng.log.length - 1)); await p.waitForTimeout(900);
const stage = await p.evaluate(() => [...document.querySelectorAll('#sprites .char:not(.leaving)')].map(c => ({ n: '',
  src: [...c.querySelectorAll('img')].map(i => i.getAttribute('src') || '').filter(Boolean).join(' ') })));
ok('剧本写到小新：上台，用的是上传的图', stage.some(s => /data:image\/webp/.test(s.src)), JSON.stringify(stage.map(s => [s.n, s.src.slice(0, 30)])));
ok('测试娘A 的微笑用的是贴的地址', stage.some(s => s.src.indexOf(MY_URL) >= 0), JSON.stringify(stage.map(s => s.src.slice(0, 40))));
/* 刷新后还在 */
await boot();
const after = await p.evaluate(() => ({ x: !!window.RESOURCE.characters['小新'], a: window.RESOURCE.characters['测试娘A'].outfits['常服']['微笑'][0] }));
ok('刷新、重新载卡后还在', after.x && after.a === MY_URL, JSON.stringify(after).slice(0, 120));
await p.evaluate(() => document.querySelector('#btn-continue') && document.querySelector('#btn-continue').click());
await p.waitForTimeout(800);
await phoneApp('cfg', 'spr');
p.once('dialog', d => d.accept());
await p.evaluate(() => document.querySelector('#spr-host [data-sprdelc="测试娘A"]').click()); await p.waitForTimeout(400);
ok('删掉覆盖：卡里的原图回来了', await p.evaluate((u) => window.RESOURCE.characters['测试娘A'].outfits['常服']['微笑'][0] === u, CARD_SMILE));
ok('小新还在', (await p.$$('#spr-host .spr-t')).length === 2);
await closePhone();

console.log('\n[B 回看里显示玩家的话]');
await say('第二句：我们去食堂吧');
await phoneApp('log');
await p.evaluate(() => { const t = [...document.querySelectorAll('#histlist .histturn')]; t.forEach(x => { if (!x.classList.contains('open')) x.click(); }); });
await p.waitForTimeout(300);
const hist = await p.evaluate(() => ({ me: [...document.querySelectorAll('#histlist .histline.me span')].map(x => x.textContent),
  sum: [...document.querySelectorAll('#histlist .histturn .tsum')].map(x => x.textContent) }));
ok('每一轮最前面是玩家发的话', hist.me.includes('你好，新同学') && hist.me.includes('第二句：我们去食堂吧'), JSON.stringify(hist.me));
ok('开场那一轮没有（玩家还没说话）', hist.me.length === 2);
ok('折叠的摘要里也显示玩家的话', hist.sum.some(s => /指挥官：第二句/.test(s)), JSON.stringify(hist.sum));
await p.screenshot({ path: `${OUT}/custom-history.png` });
const rerolled = await p.evaluate(async () => { await window.__gal.rerollLast(); return true; });
await p.waitForTimeout(800);
await phoneApp('log');
await p.evaluate(() => { [...document.querySelectorAll('#histlist .histturn')].forEach(x => { if (!x.classList.contains('open')) x.click(); }); });
ok('重roll 之后还在', rerolled && (await p.evaluate(() => [...document.querySelectorAll('#histlist .histline.me span')].map(x => x.textContent))).includes('第二句：我们去食堂吧'));
/* 老存档（没有 said）：按轮次对上 */
const legacy = await p.evaluate(() => { window.__gal.eng.log.forEach(m => { delete m.said; }); window.__gal.openApp('log');
  return [...document.querySelectorAll('#histlist .histline.me span')].map(x => x.textContent); });
ok('老存档没记：按轮次对上玩家的话', legacy.includes('你好，新同学') && legacy.includes('第二句：我们去食堂吧'), JSON.stringify(legacy));
await closePhone();

console.log('\n[C 动态评论不丢]');
await phoneApp('ig');
const title = await p.evaluate(() => { const a = document.querySelector('#jup-root .xl .fd'); return a && a.querySelector('.fd-t').textContent; });
await p.evaluate(() => document.querySelector('#jup-root .xl .fd').click()); await p.waitForTimeout(300);
await p.fill('#jup-root .cmtin', '看起来好好吃'); await p.click('#jup-root .cmtsend');
await p.waitForFunction(() => /谢谢指挥官/.test(document.querySelector('#jup-root .pd-c').textContent), null, { timeout: 8000 }).catch(() => {});
ok('发评论：自己的和回复都显示', /看起来好好吃/.test(await p.textContent('#jup-root .pd-c')) && /谢谢指挥官/.test(await p.textContent('#jup-root .pd-c')));
await p.evaluate(() => { const pd = document.querySelector('#jup-root .postd'); pd.classList.remove('on'); });
await p.evaluate(() => window.__gal.reload());
await p.evaluate((t) => [...document.querySelectorAll('#jup-root .xl .fd')].find(a => a.querySelector('.fd-t').textContent === t).click(), title);
await p.waitForTimeout(300);
const c1 = await p.textContent('#jup-root .pd-c');
ok('退出再点进来：评论还在', /看起来好好吃/.test(c1) && /谢谢指挥官/.test(c1) && /我也要吃/.test(c1), c1.slice(0, 120));
ok('列表里的评论数也加上了', await p.evaluate((t) => /💬 3/.test([...document.querySelectorAll('#jup-root .xl .fd')].find(a => a.querySelector('.fd-t').textContent === t).textContent), title));
await p.screenshot({ path: `${OUT}/custom-comments.png` });
await closePhone();
await p.waitForTimeout(500);
await boot();
await p.evaluate(() => document.querySelector('#btn-continue').click()); await p.waitForTimeout(900);
await phoneApp('ig');
await p.evaluate((t) => [...document.querySelectorAll('#jup-root .xl .fd')].find(a => a.querySelector('.fd-t').textContent === t).click(), title);
await p.waitForTimeout(300);
ok('刷新、继续游戏之后：评论还在', /看起来好好吃/.test(await p.textContent('#jup-root .pd-c')));
ok('没有报错', errs.length === 0, errs.join(' | '));

await b.close();
console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
console.log('截图在 ' + OUT);
process.exit(fail ? 1 : 0);
