/* ============================================================
 * tools/e2e-reroll.mjs —— 端到端：重roll / 撤回 / 版本切换 / 存档树
 *
 * 用一个假接口（Playwright 拦请求，每次回一版不同的剧本）真跑一遍：
 *   发一句 → 重roll → 翻回第 1 版 → 撤回 → 再发 → 开存档界面 → 读旧节点接着玩（长出分支）
 *   → 手动存档 → 删中间节点（树不断）→ 手机宽度下看一眼
 *
 * 用法：
 *   npm i -D playwright
 *   node tools/e2e-reroll.mjs [要测的目录] [截图输出目录]
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
var EXPRESSION_MAP = {};
var SCENE_MAP = { "港区(朝)": "${bg('#16304a')}" };
var DEFAULT_SPRITES = { "测试娘": ["${px('#4a9ec4')}"] };
`;
const card = {
  spec: 'chara_card_v2',
  data: {
    name: '重roll测试卡',
    first_mes: '『✨ 08:00 · 港区 · 晴 ✨』|旁白|-|\n「开场第一句。」|测试娘|微笑|',
    extensions: { regex_scripts: [{ scriptName: 'gal MVU', replaceString: GAL }] }
  }
};
fs.writeFileSync(path.join(OUT, 'reroll-card.json'), JSON.stringify(card));

const exe = ['/opt/pw-browsers/chromium'].find(f => fs.existsSync(f));
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e).slice(0, 200)));

/* ---- 假接口：第 N 次请求回「第 N 版」 ---- */
let calls = 0;
const bodies = [];
await ctx.route('https://fake.api/**', async (route) => {
  const req = route.request();
  if (req.method() === 'GET') {           // 模型列表
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'm' }] }) });
  }
  calls++;
  bodies.push(req.postData() || '');
  const content = `『✨ 10:00 · 港区 · 晴 ✨』|旁白|-|\n「第${calls}版回复。」|测试娘|微笑|`;
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }) });
});
await p.addInitScript(() => {
  localStorage.setItem('gal_api_config', JSON.stringify({
    protocol: 'openai', baseUrl: 'https://fake.api', apiKey: 'k', model: 'm', stream: false, maxTokens: 4096 }));
});

await p.goto('file://' + ROOT + '/index.html');
await p.waitForTimeout(900);
await p.setInputFiles('#f-card', path.join(OUT, 'reroll-card.json'));
await p.waitForTimeout(500);
await p.evaluate(() => document.querySelector('#boot-steps button[data-step="go"]').click());
await p.waitForTimeout(200);
await p.click('#btn-start');
await p.waitForTimeout(200);
if (!(await p.evaluate(() => document.getElementById('boot').classList.contains('gone')))) await p.click('#btn-start');
await p.waitForTimeout(900);

const st = () => p.evaluate(async () => {
  const g = window.__gal;
  const top = g.turnStack()[g.turnStack().length - 1];
  const list = await window.GalStore.listSaves();
  return {
    log: g.eng.log.map(m => m.text).join('|'),
    hist: g.eng.history.map(m => m.role[0] + ':' + m.content.slice(0, 12)),
    users: g.eng.history.filter(m => m.role === 'user').map(m => m.content),
    stack: g.turnStack().length,
    variants: top ? top.variants.length : 0, vi: top ? top.vi : -1,
    ver: document.getElementById('turn-ver').hidden ? '' : document.getElementById('ver-n').textContent,
    rerollOn: !document.getElementById('btn-reroll').disabled,
    input: document.getElementById('usertext').value,
    nodes: list.filter(s => s.id.indexOf('node:') === 0),
    active: g.activeNode()
  };
});
const send = async (t) => {
  await p.fill('#usertext', t);
  await p.click('#send');
  await p.waitForTimeout(900);
};
const lastText = (s) => s.log.split('|').pop();

console.log('\n[1] 开局与第一轮');
let s = await st();
ok('开场也存了一个根节点', s.nodes.length === 1 && s.nodes[0].name === '开场', JSON.stringify(s.nodes.map(n => n.name)));
ok('还没发话时重roll 不可点', !s.rerollOn);
await send('你好');
s = await st();
ok('第一轮演出来了', /第1版回复/.test(s.log), s.log);
ok('重roll 按钮亮了', s.rerollOn);
ok('这一轮存了自动节点（开场 → 第 1 轮）', s.nodes.length === 2, s.nodes.length);
const turn1Node = s.active;
await p.screenshot({ path: OUT + '/rr-1-first.png' });

console.log('\n[2] 重roll');
await p.click('#btn-reroll');
await p.waitForTimeout(1000);
s = await st();
ok('换成第 2 版了', /第2版回复/.test(s.log) && !/第1版回复/.test(s.log), s.log);
ok('历史里还是只有一句「你好」（没有重复堆上去）', JSON.stringify(s.users) === '["你好"]', JSON.stringify(s.users));
ok('版本切换出现：2/2', s.ver === '2/2', s.ver);
ok('重roll 请求里带了「换一种写法」的要求', /重写要求/.test(bodies[bodies.length - 1]) && /第1版回复/.test(bodies[bodies.length - 1]));
ok('同一轮写回同一个节点，不会一版一个', s.nodes.length === 2 && s.active === turn1Node, s.nodes.length);
await p.screenshot({ path: OUT + '/rr-2-reroll.png' });

console.log('\n[3] 翻回第 1 版（不发请求）');
const callsBefore = calls;
await p.click('#ver-prev');
await p.waitForTimeout(500);
s = await st();
ok('回到第 1 版', /第1版回复/.test(s.log) && s.ver === '1/2', s.log + ' ' + s.ver);
ok('没有发请求', calls === callsBefore);
await p.click('#ver-next');
await p.waitForTimeout(400);
s = await st();
ok('再翻到第 2 版', /第2版回复/.test(s.log) && s.ver === '2/2');

console.log('\n[4] 撤回');
await p.click('#btn-undo');
await p.waitForTimeout(600);
s = await st();
ok('那句话放回输入框', s.input === '你好', s.input);
ok('剧情退回开场', !/版回复/.test(s.log) && /开场第一句/.test(s.log), s.log);
ok('历史退回只剩开场白', s.hist.length === 1, JSON.stringify(s.hist));
ok('撤掉的那一轮的自动节点也删了', s.nodes.length === 1, s.nodes.length);
await p.click('#send');
await p.waitForTimeout(900);
await send('继续');
s = await st();
ok('再发两轮都正常', /第3版回复/.test(s.log) && /第4版回复/.test(s.log), s.log);
ok('节点：开场 → 第1轮 → 第2轮', s.nodes.length === 3, s.nodes.length);

console.log('\n[5] 存档界面');
await p.click('#btn-saves');
await p.waitForTimeout(600);
const modal = await p.evaluate(() => ({
  open: !document.getElementById('save-modal').hidden,
  nodes: document.querySelectorAll('#slotlist .sv-node').length,
  cur: document.querySelectorAll('#slotlist .sv-node.cur').length,
  tabs: document.getElementById('sv-tabs').textContent
}));
ok('工具栏 ▤ 直接打开存档界面', modal.open);
ok('时间线列出 3 个节点，标出当前所在', modal.nodes === 3 && modal.cur === 1, JSON.stringify(modal));
await p.screenshot({ path: OUT + '/rr-3-saves.png' });

console.log('\n[6] 读旧节点接着玩 → 分支');
const firstTurn = s.nodes.sort((a, b) => a.at - b.at)[1];     // 第 1 轮的节点
await p.click(`#slotlist [data-load="${firstTurn.id}"]`);
await p.waitForTimeout(900);
s = await st();
ok('读回第 1 轮', /第3版回复/.test(s.log) && !/第4版回复/.test(s.log), s.log);
ok('存档界面关了', await p.evaluate(() => document.getElementById('save-modal').hidden));
await send('走另一条路');
s = await st();
const branchNode = s.nodes.filter(n => n.nodeId === s.active)[0];
ok('新节点挂在第 1 轮下面（分支）', branchNode && branchNode.parentNodeId === firstTurn.nodeId,
   JSON.stringify(branchNode));
const trees = await p.evaluate(async () => window.SaveTree.buildTrees(await window.GalStore.listSaves()));
ok('树上数出 1 个分支，4 个节点', trees.length === 1 && trees[0].branchCount === 1 && trees[0].nodeCount === 4,
   JSON.stringify(trees.map(t => [t.nodeCount, t.branchCount])));

console.log('\n[7] 手动存档');
await p.click('#btn-saves');
await p.waitForTimeout(400);
await p.fill('#save-name', '岔路口');
await p.click('#do-save');
await p.waitForTimeout(600);
const man = await p.evaluate(() => [...document.querySelectorAll('#slotlist .sv-node')]
  .filter(n => /岔路口/.test(n.textContent)).map(n => n.querySelector('.t').textContent));
ok('手动存档出现在时间线上，标「手动」', man.length === 1 && man[0] === '手动', JSON.stringify(man));
await p.click('#sv-tabs [data-tab="manual"]');
await p.waitForTimeout(300);
ok('「手动」标签只剩手动的', await p.evaluate(() => document.querySelectorAll('#slotlist .sv-node').length === 1));
await p.click('#sv-tabs [data-tab="all"]');
await p.waitForTimeout(300);
await p.screenshot({ path: OUT + '/rr-4-branch.png' });

console.log('\n[8] 删中间节点，树不断');
p.once('dialog', d => d.accept());
await p.click(`#slotlist [data-del="${firstTurn.id}"]`);
await p.waitForTimeout(900);
const t2 = await p.evaluate(async () => window.SaveTree.buildTrees(await window.GalStore.listSaves()));
const roots = t2[0].nodes.filter(n => n.depth === 0).length;
ok('删掉后仍是一棵树、只有一个根', t2.length === 1 && roots === 1, JSON.stringify(t2[0].nodes.map(n => [n.s.name || n.s.title, n.depth])));

console.log('\n[9] 手机宽度');
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(400);
await p.screenshot({ path: OUT + '/rr-5-mobile-saves.png' });
const overflow = await p.evaluate(() => document.querySelector('.sv-shell').scrollWidth > window.innerWidth + 1);
ok('存档界面在手机宽度下不横向溢出', !overflow);
await p.click('#sv-close');
await p.waitForTimeout(300);
await p.screenshot({ path: OUT + '/rr-6-mobile-input.png' });
const bar = await p.evaluate(() => {
  const r = document.getElementById('inputbar').getBoundingClientRect();
  const t = document.getElementById('usertext').getBoundingClientRect();
  return { right: r.right, w: window.innerWidth, textW: t.width };
});
ok('手机宽度下输入栏不溢出、输入框还够宽', bar.right <= bar.w + 1 && bar.textW > 150, JSON.stringify(bar));

ok('全程没有未捕获错误', errs.length === 0, errs.join(' | '));
await b.close();
console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
console.log('截图在 ' + OUT);
process.exit(fail ? 1 : 0);
