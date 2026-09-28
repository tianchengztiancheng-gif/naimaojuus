/* ============================================================
 * tools/e2e-memory.mjs —— 端到端：长期记忆 + 删掉导入的正则（v5.26）
 *
 *   A. 玩几轮（假接口）→ 原文超过「保留 + 一块」后自动整理出一块记忆；
 *      下一轮正文请求里带着 <剧情记忆>，被总结掉的原文不再发；设置 · 记忆 能看、能改、能删；存档里带着记忆
 *   B. 撤回到记忆覆盖范围以内 → 那块记忆作废；整理选「副 API」→ 请求发到副 API
 *   C. 导入的正则：资源说明里一键删全部；手机 设置 · 预设 里逐条删
 *
 * 用法：node tools/e2e-memory.mjs [要测的目录] [截图输出目录]
 * ============================================================ */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';

const ROOT = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(process.argv[3] || './shots');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));

const px = (c, w = 300, h = 700) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${c}"/></svg>`).toString('base64');
const GAL = `
var EXPRESSION_MAP = { "测试娘A": { "常服": { "微笑": ["${px('#c47a9e')}"] } } };
var SCENE_MAP = { "港区(朝)": "${px('#1d3d5a', 1200, 700)}" };
var DEFAULT_SPRITES = { "测试娘A": ["${px('#c47a9e')}"] };
`;
const card = { spec: 'chara_card_v2', data: { name: '记忆测试卡',
  first_mes: '『✨ 08:00 · 港区 ✨』|旁白|-|\n「早上好，指挥官。」|测试娘A|微笑|',
  extensions: { regex_scripts: [{ scriptName: 'gal MVU', replaceString: GAL }] } } };
fs.writeFileSync(path.join(OUT, 'memory-card.json'), JSON.stringify(card));
const preset = { prompts: [{ identifier: 'main', role: 'system', content: '你是港区的叙事者。' }, { identifier: 'worldInfoBefore', marker: true },
  { identifier: 'chatHistory', marker: true }],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'worldInfoBefore', enabled: true }, { identifier: 'chatHistory', enabled: true }] }] };
fs.writeFileSync(path.join(OUT, 'memory-preset.json'), JSON.stringify(preset));
fs.writeFileSync(path.join(OUT, 'memory-regex.json'), JSON.stringify([
  { scriptName: '导入正则甲', findRegex: '/甲甲/g', replaceString: '乙', placement: [2], disabled: false },
  { scriptName: '导入正则乙', findRegex: '/丙丙/g', replaceString: '丁', placement: [2], disabled: false }]));

const exe = ['/opt/pw-browsers/chromium'].find(f => fs.existsSync(f));
const b = await chromium.launch(exe ? { executablePath: exe } : {});

async function page(o = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const log = { main: [], sub: [] };
  let n = 0;
  await ctx.route('**/*', async (route) => {
    const u = route.request().url();
    if (u.startsWith('file:') || u.startsWith('data:')) return route.continue();
    const which = u.startsWith('https://main.api/') ? 'main' : u.startsWith('https://sub.api/') ? 'sub' : null;
    if (!which) return route.abort();
    const body = route.request().postData() || '';
    log[which].push(body);
    let content;
    if (/剧情记忆整理/.test(body)) content = '- 第1天 朝 港区\n- 测试娘A答应周末和指挥官去海边（暗号：蓝鲸）';
    else if (/剧情记忆压缩/.test(body)) content = '- 前情：测试娘A答应去海边';
    else { n++; content = `<Gal>\n「这是第${n}次回答，指挥官。」|测试娘A|微笑|\n</Gal>`; }
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }) });
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript((o) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('gal_api_config', JSON.stringify({ protocol: 'openai', baseUrl: 'https://main.api', apiKey: 'k1', model: 'main-m', stream: false }));
    localStorage.setItem('gal_memory_cfg', JSON.stringify(Object.assign({ enabled: true, keepTurns: 2, chunkTurns: 2, via: 'main' }, o.mem || {})));
    if (o.sub) localStorage.setItem('gal_api2_config', JSON.stringify(o.sub));
  }, o);
  await p.goto('file://' + ROOT + '/index.html');
  await p.waitForTimeout(600);
  await p.setInputFiles('#f-card', path.join(OUT, 'memory-card.json'));
  await p.setInputFiles('#f-preset', path.join(OUT, 'memory-preset.json'));
  await p.waitForTimeout(400);
  return { ctx, p, log, errs };
}
async function start(p) {
  await p.evaluate(() => document.querySelector('#boot-steps button[data-step="go"]').click());
  await p.evaluate(() => { const s = document.getElementById('btn-start'); s.click(); if (!document.getElementById('boot').classList.contains('gone')) s.click(); });
  await p.waitForTimeout(900);
}
async function say(p, t) {
  const n0 = await p.evaluate(() => window.__gal.eng.history.filter(m => !m.phoneOnly).length);
  await p.evaluate((t) => window.__gal.submit(t), t);
  await p.waitForFunction((n0) => window.__gal.eng.history.filter(m => !m.phoneOnly).length >= n0 + 2, n0, { timeout: 10000 });
  await p.waitForTimeout(250);
}
const mem = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__gal.eng.memory)));

console.log('\n[A 自动整理 → 下一轮带着记忆]');
{
  const { ctx, p, log, errs } = await page();
  await start(p);
  for (let i = 1; i <= 3; i++) await say(p, `第${i}句：我们去码头看看`);
  ok('原文还在保留范围内：没整理', (await mem(p)).chunks.length === 0 && !log.main.some(x => /剧情记忆整理/.test(x)));
  await say(p, '第4句：晚上一起吃饭吧');
  await p.waitForFunction(() => window.__gal.eng.memory.chunks.length > 0, null, { timeout: 8000 }).catch(() => {});
  const m = await mem(p);
  ok('超过「保留 + 一块」：自动整理出一块记忆', m.chunks.length === 1 && /蓝鲸/.test(m.chunks[0].text), JSON.stringify(m));
  const sumReq = log.main.find(x => /剧情记忆整理/.test(x)) || '';
  ok('整理请求带着那几轮原文（玩家的话 + 台词），不带手机和变量', /第1句：我们去码头看看/.test(sumReq) && /测试娘A：/.test(sumReq), sumReq.slice(0, 300));
  const n = log.main.length;
  await say(p, '第5句：你还记得约定吗');
  const req = log.main.slice(n).find(x => /第5句/.test(x)) || '';
  ok('下一轮正文请求带着 <剧情记忆>', /剧情记忆/.test(req) && /蓝鲸/.test(req));
  ok('被总结掉的原文不再发', !/第1句：我们去码头看看/.test(req) && /第4句/.test(req));
  /* 设置 · 记忆 */
  await p.click('#btn-phone'); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#jup-root .ph-app[data-app="cfg"]').click()); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('#jup-root .kt-nav button[data-sec="mem"]').click()); await p.waitForTimeout(300);
  const ui = await p.evaluate(() => ({ n: document.querySelectorAll('#mem-host .mem-c').length, stat: document.getElementById('mem-stat').textContent,
    t: (document.querySelector('#mem-host [data-medit]') || {}).value || '' }));
  ok('设置 · 记忆：看得到记忆块和进度', ui.n >= 1 && /蓝鲸/.test(ui.t) && /已整理到第 \d+ 轮/.test(ui.stat), JSON.stringify(ui));
  await p.screenshot({ path: `${OUT}/memory-panel.png` });
  await p.fill('#mem-host [data-medit="0"]', '- 测试娘A答应周末去海边（改过）');
  await p.evaluate(() => document.querySelector('#mem-host [data-medit="0"]').dispatchEvent(new Event('change', { bubbles: true })));
  await p.fill('#mem-notes', '备忘：我怕水');
  await p.evaluate(() => document.getElementById('mem-notes').dispatchEvent(new Event('change', { bubbles: true })));
  const m2 = await mem(p);
  ok('改记忆、写备忘：存进去了', /改过/.test(m2.chunks[0].text) && m2.notes === '备忘：我怕水');
  const dr = await p.evaluate(() => window.__gal.eng.dryRun('x').messages.map(m => m.content).join('\n'));
  ok('改过的记忆和备忘进了提示词', /改过/.test(dr) && /我怕水/.test(dr));
  await p.waitForTimeout(400);
  const saved = await p.evaluate(async () => { const s = await GalStore.loadSlot(window.__gal.autoSlotId()); return s && s.memory; });
  ok('自动存档里带着记忆', saved && saved.chunks && saved.chunks.length === m2.chunks.length && /改过/.test(saved.chunks[0].text) && saved.notes === '备忘：我怕水', JSON.stringify(saved));
  p.once('dialog', d => d.accept());
  await p.click('#mem-host [data-mdel="0"]'); await p.waitForTimeout(200);
  ok('删除第一块（后面的跟着作废）', (await mem(p)).chunks.length === 0 && (await p.$$('#mem-host .mem-c')).length === 0);
  await p.click('#mem-now'); await p.waitForTimeout(1200);
  ok('「现在整理」：重新整理出来', (await mem(p)).chunks.length >= 1);
  ok('没有报错', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log('\n[B 撤回到记忆覆盖范围里 / 整理走副 API]');
{
  const { ctx, p, log, errs } = await page({ mem: { via: 'sub' }, sub: { enabled: true, protocol: 'openai', baseUrl: 'https://sub.api', apiKey: 'k2', model: 'sub-m' } });
  await start(p);
  for (let i = 1; i <= 4; i++) await say(p, `第${i}句`);
  await p.waitForFunction(() => window.__gal.eng.memory.chunks.length > 0, null, { timeout: 8000 }).catch(() => {});
  ok('选了副 API：整理请求发到副 API，主 API 没收到', log.sub.some(x => /剧情记忆整理/.test(x)) && !log.main.some(x => /剧情记忆整理/.test(x)));
  const before = (await mem(p)).chunks.length;
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__gal.undoLast()); await p.waitForTimeout(300); }
  const after = await p.evaluate(() => { const M = window.Memory, e = window.__gal.eng; return { v: M.valid(e.memory, M.mainHist(e.history)).length, n: e.memory.chunks.length }; });
  ok('撤回三轮：记忆回到那一轮之前的样子（那块作废）', before === 1 && after.v === 0 && after.n === 0, JSON.stringify({ before, after }));
  const dr = await p.evaluate(() => window.__gal.eng.dryRun('x').messages.map(m => m.content).join('\n'));
  ok('作废的记忆不再发', !/蓝鲸/.test(dr) && /第1句/.test(dr));
  ok('没有报错', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log('\n[C 删掉导入的正则]');
{
  const { ctx, p, errs } = await page();
  await p.setInputFiles('#f-regex', path.join(OUT, 'memory-regex.json')); await p.waitForTimeout(400);
  ok('导入了 2 条，资源说明里有「删掉」', await p.evaluate(() => window.__gal.eng.userRegex.length) === 2 && /删掉导入的 2 条正则/.test(await p.textContent('#assets-note')));
  await start(p);
  await p.click('#btn-phone'); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#jup-root .ph-app[data-app="cfg"]').click()); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('#jup-root .kt-nav button[data-sec="pre"]').click()); await p.waitForTimeout(300);
  await p.evaluate(() => { const g = document.querySelector('#pre-list [data-g="rx"]'); if (g) g.classList.add('open'); });
  ok('设置 · 预设 · 正则：导入的每条都有「删除」', (await p.$$('#pre-list [data-rxdel]')).length === 2);
  await p.screenshot({ path: `${OUT}/memory-regex.png` });
  p.once('dialog', d => d.accept());
  await p.evaluate(() => document.querySelector('#pre-list [data-rxdel="导入正则甲"]').click()); await p.waitForTimeout(200);
  const left = await p.evaluate(() => ({ n: window.__gal.eng.userRegex.map(r => r.name), st: JSON.parse(localStorage.getItem('gal_user_regex')).map(r => r.scriptName) }));
  ok('逐条删：只剩另一条（引擎里和存的都删了）', left.n.join() === '导入正则乙' && left.st.join() === '导入正则乙', JSON.stringify(left));
  await p.evaluate(() => document.querySelector('#pre-list [data-rx="user:导入正则乙"]').click()); await p.waitForTimeout(200);
  p.once('dialog', d => d.accept());
  await p.click('#rx-del-one'); await p.waitForTimeout(200);
  ok('详情页里删：一条不剩', await p.evaluate(() => window.__gal.eng.userRegex.length) === 0 && (await p.$$('#pre-list [data-rxdel]')).length === 0);
  /* 资源说明里一键删 */
  await p.evaluate(() => window.__gal.leaveGame()); await p.waitForTimeout(500);
  await p.setInputFiles('#f-regex', path.join(OUT, 'memory-regex.json')); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#boot-steps button[data-step="asset"]').click());
  p.once('dialog', d => d.accept());
  await p.click('#rx-clear'); await p.waitForTimeout(200);
  ok('资源说明里一键删全部', await p.evaluate(() => window.__gal.eng.userRegex.length === 0 && JSON.parse(localStorage.getItem('gal_user_regex')).length === 0) &&
     !(await p.$('#rx-clear')));
  await p.reload(); await p.waitForTimeout(600);
  ok('刷新后还是删掉的', await p.evaluate(() => window.__gal.eng.userRegex.length) === 0);
  ok('没有报错', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
console.log('截图在 ' + OUT);
process.exit(fail ? 1 : 0);
