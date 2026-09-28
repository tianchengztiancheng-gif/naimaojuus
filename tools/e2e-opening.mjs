/* ============================================================
 * tools/e2e-opening.mjs —— 端到端：自定义开场 + 小手机单独环境（副 API）（v5.25）
 *
 *   A. 自定义开场界面：身份、地点时段、出场舰娘（加 / 删 / 誓约 / 好感 / 服装 / 状态 / 备注）、事件、模板
 *      选「直接开始」→ 不发请求，变量、立绘、背景、人设都按设定来
 *   B. 选「让 AI 写开场」+ 小手机单独环境 + 副 API（假接口，主 / 副两个不同的域名）
 *      → 主 API 收到开场指令（带设定），而且正文请求里没有手机输出规则
 *      → 正文之后副 API 收到「港区手机环境」请求，回来的私聊 / 群聊进了手机
 *      → 手机里私聊发消息也走副 API
 *   C. 副 API 没填全时退回主 API
 *
 * 用法：node tools/e2e-opening.mjs [要测的目录] [截图输出目录]
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
const BG1 = px('#1d3d5a', 1200, 700), BG2 = px('#5a3d1d', 1200, 700);
const GAL = `
var EXPRESSION_MAP = { "测试娘A": { "常服": { "微笑": ["${px('#c47a9e')}"], "平静": ["${px('#c47a9f')}"] }, "泳装": { "微笑": ["${px('#e4a0be')}"] } } };
var SCENE_MAP = { "港区(朝)": "${BG1}", "食堂(夜)": "${BG2}" };
var DEFAULT_SPRITES = { "测试娘A": ["${px('#c47a9e')}"], "测试娘B": ["${px('#4a9ec4')}"], "测试娘C": ["${px('#9ec44a')}"] };
`;
const card = { spec: 'chara_card_v2', data: { name: '自定义开场测试卡',
  first_mes: '『✨ 08:00 · 港区 ✨』|旁白|-|\n「早上好。」|测试娘A|微笑|',
  extensions: { regex_scripts: [{ scriptName: 'gal MVU', replaceString: GAL }] } } };
fs.writeFileSync(path.join(OUT, 'opening-card.json'), JSON.stringify(card));
const preset = { prompts: [{ identifier: 'main', role: 'system', content: '你是港区的叙事者。' }, { identifier: 'worldInfoBefore', marker: true }, { identifier: 'worldInfoAfter', marker: true }, { identifier: 'chatHistory', marker: true }],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'worldInfoBefore', enabled: true }, { identifier: 'worldInfoAfter', enabled: true }, { identifier: 'chatHistory', enabled: true }] }] };
fs.writeFileSync(path.join(OUT, 'opening-preset.json'), JSON.stringify(preset));

const exe = ['/opt/pw-browsers/chromium'].find(f => fs.existsSync(f));
const b = await chromium.launch(exe ? { executablePath: exe } : {});

async function page(o = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const log = { main: [], sub: [] };
  await ctx.route('**/*', async (route) => {
    const u = route.request().url();
    if (u.startsWith('file:') || u.startsWith('data:')) return route.continue();
    const which = u.startsWith('https://main.api/') ? 'main' : u.startsWith('https://sub.api/') ? 'sub' : null;
    if (!which) return route.abort();
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'sub-m1' }, { id: 'sub-m2' }] }) });
    const body = route.request().postData() || '';
    log[which].push(body);
    let content;
    if (/港区手机环境/.test(body)) content = '[短信|测试娘A|文字|指挥官，今天辛苦了。]\n[群聊|舰娘闲聊|测试娘B|文字|测试娘A 刚才是不是脸红了？]\n[趋势|港区新闻|食堂推出新菜单|今晚限定。]';
    else if (/校验码/.test(body)) content = (body.match(/GAL-[A-Z0-9]+/) || ['x'])[0];
    else if (/\[独立任务|私聊|短信/.test(body) && which === 'sub') content = '[短信|测试娘A|文字|收到啦！]';
    else content = '<Gal>\n「指挥官，欢迎回来。」|测试娘A|微笑|\n「……哼。」|测试娘B|-|\n<choice>[打招呼][坐下]</choice>\n</Gal>';
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }) });
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript((o) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('gal_api_config', JSON.stringify({ protocol: 'openai', baseUrl: 'https://main.api', apiKey: 'k1', model: 'main-m', stream: false }));
    if (o.sub) localStorage.setItem('gal_api2_config', JSON.stringify(o.sub));
    if (o.pe) localStorage.setItem('gal_phone_env', JSON.stringify(o.pe));
  }, o);
  await p.goto('file://' + ROOT + '/index.html');
  await p.waitForTimeout(700);
  await p.setInputFiles('#f-card', path.join(OUT, 'opening-card.json'));
  await p.setInputFiles('#f-preset', path.join(OUT, 'opening-preset.json'));
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#boot-steps button[data-step="go"]').click());
  await p.waitForTimeout(200);
  return { ctx, p, log, errs };
}
const draft = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('gal_op_draft') || 'null'));
async function addCast(p, q) { await p.fill('#opc-q', q); await p.waitForTimeout(80); await p.click('#opc-results button >> nth=0'); await p.waitForTimeout(80); }
async function start(p) {
  await p.evaluate(() => { const s = document.getElementById('btn-start'); s.click(); if (!document.getElementById('boot').classList.contains('gone')) s.click(); });
}

console.log('\n[A 自定义开场界面 + 直接开始]');
{
  const { ctx, p, log, errs } = await page();
  ok('开场这一步有「卡里的开场白 / 自定义开场」两个选项', (await p.$$('[data-opmode]')).length === 2);
  await p.click('[data-opmode="custom"]');
  ok('切到自定义：卡的开场白下拉收起，自定义表单出来', await p.evaluate(() => document.getElementById('op-card').hidden && !document.getElementById('op-custom').hidden));
  await p.click('[data-chip="identity"][data-v="vet"]');
  ok('点身份预设：设定文字跟着填好', /好几年/.test(await p.inputValue('#opc-idtext')));
  await p.fill('#opc-q', '测试');
  const hits = await p.$$eval('#opc-results button', bs => bs.map(b => b.getAttribute('data-add')));
  ok('搜名字：卡里有立绘的舰娘都搜得到', ['测试娘A', '测试娘B', '测试娘C'].every(n => hits.includes(n)), hits.join());
  await addCast(p, '测试娘A'); await addCast(p, '测试娘B'); await addCast(p, '测试娘C');
  ok('加进来 3 位', (await draft(p)).cast.length === 3);
  await p.click('.opc-c[data-n="测试娘C"] [data-del]');
  ok('× 移出一位', (await draft(p)).cast.map(c => c.name).join() === '测试娘A,测试娘B');
  await p.check('.opc-c[data-n="测试娘A"] input[data-f="oath"]');
  ok('勾「已誓约」：好感上限变 200', await p.getAttribute('.opc-c[data-n="测试娘A"] input[data-f="favor"]', 'max') === '200');
  await p.evaluate(() => { const r = document.querySelector('.opc-c[data-n="测试娘A"] input[data-f="favor"]'); r.value = 150; r.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('好感拖到 150，数字跟着变', await p.textContent('.opc-c[data-n="测试娘A"] .opc-fav b') === '150');
  const outs = await p.$$eval('.opc-c[data-n="测试娘A"] select[data-f="outfit"] option', os => os.map(o => o.textContent));
  ok('有多套服装的舰娘可以选服装', outs.join() === '常服,泳装', outs.join());
  await p.selectOption('.opc-c[data-n="测试娘A"] select[data-f="outfit"]', '泳装');
  await p.fill('.opc-c[data-n="测试娘A"] input[data-f="state"]', '害羞');
  await p.fill('.opc-c[data-n="测试娘A"] input[data-f="note"]', '刚和你吵完架');
  await p.evaluate(() => document.querySelector('.opc-c[data-n="测试娘A"] input[data-f="state"]').dispatchEvent(new Event('change', { bubbles: true })));
  const locs = await p.$$eval('#opc-loc option', os => os.map(o => o.textContent));
  ok('地点从场景表里挑', locs.includes('食堂') && locs.includes('港区'), locs.join());
  await p.selectOption('#opc-loc', '食堂'); await p.waitForTimeout(150);
  ok('换地点：时段按这个场景有的来', (await p.$$eval('#opc-period option', os => os.map(o => o.textContent))).join() === '夜');
  await p.fill('#opc-day', '7'); await p.evaluate(() => document.getElementById('opc-day').dispatchEvent(new Event('change', { bubbles: true })));
  ok('场景预览图跟着换', /base64/.test(await p.evaluate(() => document.getElementById('opc-prev').style.backgroundImage)));
  await p.click('[data-chip="event"][data-v="节日庆典"]');
  ok('点事件标签：事件描述填好', /庆典/.test(await p.inputValue('#opc-event')));
  const d = await draft(p);
  ok('草稿都记下来了（关掉再开还在）', d.loc === '食堂' && d.day === 7 && d.cast[0].oath && d.cast[0].favor === 150 && d.cast[0].outfit === '泳装' &&
     d.cast[0].state === '害羞' && d.cast[0].note === '刚和你吵完架' && d.eventTitle === '节日庆典', JSON.stringify(d));
  /* 模板 */
  await p.fill('#opc-tpl-name', '食堂庆典'); await p.click('#opc-tpl-save'); await p.waitForTimeout(150);
  await p.click('.opc-c[data-n="测试娘B"] [data-del]');
  await p.selectOption('#opc-tpl', '食堂庆典'); await p.waitForTimeout(200);
  ok('存成模板、改乱了再读回来：人和设定都回来了', (await draft(p)).cast.length === 2 && (await p.$$('.opc-c')).length === 2);
  await shotSec(p, 'opening-ui');
  await p.reload(); await p.waitForTimeout(600);
  await p.setInputFiles('#f-card', path.join(OUT, 'opening-card.json')); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('#boot-steps button[data-step="go"]').click());
  ok('刷新后还是自定义开场、表单还在', await p.evaluate(() => !document.getElementById('op-custom').hidden) && (await p.$$('.opc-c')).length === 2);
  ok('「齐没齐」清单里写着自定义开场', /自定义开场 · 食堂/.test(await p.textContent('#boot-ready')));
  await p.click('[data-chip="ai"][data-v="self"]');
  await start(p);
  await p.waitForTimeout(1500);
  const st = await p.evaluate(() => ({ gone: document.getElementById('boot').classList.contains('gone'), vars: window.__gal.eng.vars,
    persona: JSON.parse(localStorage.getItem('gal_persona') || '{}') }));
  ok('直接开始：进游戏，一个请求都没发', st.gone && log.main.length === 0, log.main.length);
  ok('开局变量按设定：地点 / 时段 / 第几天', st.vars.地点 === '食堂' && st.vars.时间.时段 === '夜' && st.vars.时间.天数 === 7, JSON.stringify(st.vars));
  const A = st.vars.人物.测试娘A || {};
  ok('舰娘的好感 / 誓约 / 服装 / 状态 / 备注都进了变量，全员在场', A.好感度 === 150 && A.是否誓约 === true && A.服装 === '泳装' && A.当前状态 === '害羞' &&
     A.内心想法 === '刚和你吵完架' && A.在场 && st.vars.人物.测试娘B.在场, JSON.stringify(A));
  ok('身份写进了人设', /好几年/.test(st.persona.description || ''), JSON.stringify(st.persona));
  await p.evaluate(() => window.__gal.goTo(2)); await p.waitForTimeout(1200);
  const stage = await p.evaluate(() => ({ all: [...document.querySelectorAll('.bglayer')].map(e => e.className + ':' + e.style.backgroundImage.slice(0, 50)).join(' ; '), n: document.querySelectorAll('#sprites .char:not(.leaving)').length,
    bg: [...document.querySelectorAll('.bglayer.show')].map(e => e.style.backgroundImage.slice(0, 60)).join() }));
  ok('选的两位都上台了', stage.n === 2, JSON.stringify(stage));
  ok('背景是选的场景（食堂·夜）', stage.bg.indexOf(BG2.slice(0, 40)) >= 0, JSON.stringify(stage));
  await p.screenshot({ path: `${OUT}/opening-start.png` });
  ok('没有报错', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

async function shotSec(p, name) {
  await p.evaluate(() => { const b = document.querySelector('#boot .boot-body'); if (b) b.scrollTop = 0; });
  await p.screenshot({ path: `${OUT}/${name}.png` });
}

console.log('\n[B AI 写开场 + 小手机单独环境 + 副 API]');
{
  const { ctx, p, log, errs } = await page({
    sub: { enabled: true, protocol: 'openai', baseUrl: 'https://sub.api', apiKey: 'k2', model: 'sub-m' },
    pe: { independent: true, every: 1 } });
  await p.evaluate(() => document.querySelector('#boot-steps button[data-step="api"]').click());
  await p.waitForTimeout(150);
  ok('接口页有「小手机单独环境 / 副 API」设置，读出了存的配置', await p.isChecked('#pe-on') && await p.isChecked('#sub-on') &&
     await p.inputValue('#sub-base') === 'https://sub.api' && !(await p.evaluate(() => document.getElementById('sub-box').hidden)));
  await p.click('#btn-sub-test'); await p.waitForTimeout(600);
  ok('测试副 API：请求发到副 API 的地址', log.sub.length === 1 && /通了/.test(await p.textContent('#sub-note')), await p.textContent('#sub-note'));
  await p.click('#btn-sub-models'); await p.waitForTimeout(500);
  ok('副 API 能拉模型列表', (await p.$$('#sub-model-sel option')).length === 3);
  await p.evaluate(() => document.querySelector('#boot-steps button[data-step="go"]').click());
  await p.click('[data-opmode="custom"]');
  await addCast(p, '测试娘A'); await addCast(p, '测试娘B');
  await p.evaluate(() => { const r = document.querySelector('.opc-c[data-n="测试娘B"] input[data-f="favor"]'); r.value = 30; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('[data-chip="event"][data-v="雨天"]');
  const subBefore = log.sub.length;
  await start(p);
  await p.waitForFunction(() => window.__gal && window.__gal.eng.history.some(m => m.phoneEnv), null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(800);
  const main0 = log.main[0] || '';
  ok('AI 写开场：主 API 收到开场指令，带着设定', /自定义开场/.test(main0) && /测试娘B：好感度 30/.test(main0) && /雨/.test(main0), main0.slice(0, 200));
  ok('单独环境：正文请求里没有「手机内容输出规则」', main0 && !/手机内容输出规则/.test(main0));
  const env = log.sub.slice(subBefore).find(x => /港区手机环境/.test(x)) || '';
  ok('正文之后：副 API 收到一次「港区手机环境」请求', !!env && log.main.every(x => !/港区手机环境/.test(x)));
  ok('手机环境请求里带着刚演完的剧情和在场的人', /欢迎回来/.test(env) && /测试娘B\(好感30\)/.test(env), env.slice(0, 300));
  const ph = await p.evaluate(() => { const d = Phone.scan(window.__gal.eng.history, window.__gal.eng.phoneSent, {});
    return { a: (d.chats['测试娘A'] || []).map(m => m.v), g: Object.keys(d.groups), t: (d.trends || []).length }; });
  ok('副 API 回来的私聊、群聊进了手机', ph.a.includes('指挥官，今天辛苦了。') && ph.g.includes('舰娘闲聊'), JSON.stringify(ph));
  ok('手机里有新消息的红点', await p.evaluate(() => !document.getElementById('phone-dot').hidden));
  ok('手机内容不进正文的历史（主 API 下一轮看不到原始标记）', await p.evaluate(() => window.__gal.eng.dryRun('下一句').messages.every(m => !/今天辛苦了/.test(m.content) || /手机/.test(m.content))));
  /* 手机里私聊：走副 API */
  await p.click('#btn-phone'); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#jup-root .ph-app[data-app="juus"]').click()); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('#jup-root .ct[data-c="测试娘A"]').click()); await p.waitForTimeout(300);
  const nSub = log.sub.length, nMain = log.main.length;
  await p.fill('#jup-root .cin', '晚上一起吃饭吗'); await p.click('#jup-root .snd');
  await p.waitForTimeout(1200);
  ok('手机里私聊发消息：走副 API，不碰主 API', log.sub.length === nSub + 1 && log.main.length === nMain, `${log.sub.length - nSub} / ${log.main.length - nMain}`);
  ok('回复出现在聊天里', /收到啦/.test(await p.textContent('#jup-root .ms')));
  await p.screenshot({ path: `${OUT}/opening-phone.png` });
  ok('没有报错', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log('\n[C 副 API 没填全 → 退回主 API；关掉单独环境 → 正文照旧带手机规则]');
{
  const { ctx, p, log, errs } = await page({ sub: { enabled: true, protocol: 'openai', baseUrl: 'https://sub.api', apiKey: '', model: 'sub-m' }, pe: { independent: true, every: 1 } });
  await p.evaluate(() => document.querySelector('#boot-steps button[data-step="api"]').click());
  ok('副 API 没填全：提示先用主 API', /没填全/.test(await p.textContent('#sub-note')));
  await p.evaluate(() => document.querySelector('#boot-steps button[data-step="go"]').click());
  await start(p); await p.waitForTimeout(800);
  await p.fill('#usertext', '你好'); await p.click('#send');
  await p.waitForFunction(() => window.__gal.eng.history.some(m => m.phoneEnv), null, { timeout: 15000 }).catch(() => {});
  ok('手机环境请求退回主 API', log.sub.length === 0 && log.main.some(x => /港区手机环境/.test(x)), `${log.sub.length} sub`);
  await ctx.close();
}
{
  const { ctx, p, log } = await page({ pe: { independent: false, every: 1 } });
  await start(p); await p.waitForTimeout(800);
  await p.fill('#usertext', '你好'); await p.click('#send');
  await p.waitForTimeout(1500);
  ok('没开单独环境：正文请求照旧带手机规则，也不另外跑手机环境', /手机内容输出规则/.test(log.main[0] || '') && !log.main.some(x => /港区手机环境/.test(x)));
  await ctx.close();
}

await b.close();
console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
console.log('截图在 ' + OUT);
process.exit(fail ? 1 : 0);
