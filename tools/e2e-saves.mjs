/* ============================================================
 * tools/e2e-saves.mjs —— 端到端：玩 A → 退出 → 开 B → 回到 A
 *
 * 这是「多周目存档」那件事的证据。以前 autosave() 固定写死一个 'auto' 槽，
 * 开第二个开局会把第一个悄悄盖掉；「继续上次」又只恢复 history/vars，
 * 读回来剧情记录是空的。这两个都只有真跑一遍完整流程才发现得了。
 *
 * 顺带验死链回退：给角色一个挂掉的主图 + 一个能用的原皮，
 * 看渲染出来的 <img> 最后落在原皮上，而不是留一个破图。
 *
 * 用法：
 *   npm i -D playwright
 *   node tools/e2e-saves.mjs [要测的目录] [截图输出目录]
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

/* 纯色方块，data: URI，离线也能渲染 */
const px = (c) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="700"><rect width="300" height="700" fill="${c}"/></svg>`
).toString('base64');
const bg = (c) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="${c}"/></svg>`
).toString('base64');
/* 一定加载不出来的地址 —— .invalid 是 RFC 2606 保留的，永远解析不到 */
const DEAD = 'https://dead.invalid/gone.png';

const BASE = px('#4a9ec4');     // 原皮，能用
const GAL = `
var EXPRESSION_MAP = { "有差分娘": { "常服": { "微笑": "${px('#c47a9e')}" } } };
var SCENE_MAP = { "港区(朝)": "${bg('#16304a')}", "教室(朝)": "${bg('#2a1f3d')}" };
/* 第 0 张是能用的原皮，后两张是死链 —— 默认必须用第 0 张 */
var DEFAULT_SPRITES = { "只有原皮娘": ["${BASE}", "${DEAD}", "${DEAD}"] };
`;
const card = {
  spec: 'chara_card_v2',
  data: {
    name: '存档测试卡',
    first_mes: '『✨ 08:00 · 港区 · 晴 ✨』|旁白|-|\n「A 开局第一句。」|只有原皮娘|微笑|',
    alternate_greetings: [
      '『✨ 09:00 · 教室 · 晴 ✨』|旁白|-|\n「B 开局第一句。」|有差分娘|微笑|'
    ],
    extensions: { regex_scripts: [{ scriptName: 'gal MVU', replaceString: GAL }] }
  }
};
fs.writeFileSync(path.join(OUT, 'saves-card.json'), JSON.stringify(card));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
await p.goto('file://' + ROOT + '/index.html');
await p.waitForTimeout(900);

await p.setInputFiles('#f-card', path.join(OUT, 'saves-card.json'));
await p.waitForTimeout(600);

/* 引导页最后一步 → 开始（没预设会先警告一次，要点两下） */
const start = async (openingIndex) => {
  await p.evaluate(() => document.querySelector('#boot-steps button[data-step="go"]').click());
  await p.waitForTimeout(250);
  await p.selectOption('#opening-sel', String(openingIndex));
  await p.click('#btn-start');
  await p.waitForTimeout(250);
  if (!(await p.evaluate(() => document.getElementById('boot').classList.contains('gone')))) {
    await p.click('#btn-start');            // 「没载入预设」的二次确认
  }
  await p.waitForTimeout(1200);
  /* 第一句是『』抬头旁白，翻一句才轮到角色说话、立绘才上台 */
  await p.click('#nav-next');
  await p.waitForTimeout(900);
};
const stage = () => p.evaluate(() => ({
  speaker: (document.getElementById('speaker') || {}).textContent,
  text: (document.getElementById('text') || {}).textContent,
  logLen: window.__gal.eng.log.length,
  srcs: [...document.querySelectorAll('#sprites .layer.show img')].map(i => i.src.slice(0, 32)),
  hidden: [...document.querySelectorAll('#sprites .layer.show')]
            .map(l => l.style.visibility),
}));

console.log('\n[1] 开 A 局');
await start(0);
let a = await stage();
ok('进游戏了', await p.evaluate(() => document.getElementById('boot').classList.contains('gone')));
ok('A 局演出来了', /A 开局/.test(a.text), a.text);
await p.screenshot({ path: OUT + '/sv-1-A.png' });

console.log('\n[2] 死链回退到原皮');
ok('立绘用的是能用的原皮，不是死链',
   a.srcs.length === 1 && a.srcs[0].indexOf('data:image/svg') === 0, JSON.stringify(a.srcs));
ok('立绘没被藏起来（说明没走到"全挂"那一步）',
   a.hidden.every(v => v !== 'hidden'), JSON.stringify(a.hidden));

console.log('\n[3] 退出到开场');
await p.click('#btn-exit');
await p.waitForTimeout(700);
ok('回到引导页', await p.evaluate(() => !document.getElementById('boot').classList.contains('gone')));
ok('工具栏收起来了', await p.evaluate(() => document.getElementById('toolbar').hidden));
ok('舞台清干净了（不留上一局的立绘）',
   await p.evaluate(() => document.querySelectorAll('#sprites .char').length === 0));
let runs = await p.evaluate(() => [...document.querySelectorAll('#boot-runs-body .runrow')]
  .map(r => r.textContent.replace(/\s+/g, ' ').trim()));
ok('周目列表里出现了 A 局', runs.length === 1, JSON.stringify(runs));
await p.screenshot({ path: OUT + '/sv-2-boot.png' });

console.log('\n[4] 开 B 局 —— A 局不能被覆盖');
await start(1);
let bst = await stage();
ok('B 局演出来了', /B 开局/.test(bst.text), bst.text);
await p.click('#btn-exit');
await p.waitForTimeout(700);
runs = await p.evaluate(() => [...document.querySelectorAll('#boot-runs-body .runrow')]
  .map(r => r.textContent.replace(/\s+/g, ' ').trim()));
ok('现在有两个周目，A 局还在', runs.length === 2, JSON.stringify(runs));
const slots = await p.evaluate(async () => (await window.GalStore.listSaves()).map(s => s.id));
ok('两份自动存档在不同的槽里', new Set(slots).size === 2, JSON.stringify(slots));
ok('槽名带周目 id，不是共用的 auto',
   slots.every(s => s.indexOf('auto:') === 0), JSON.stringify(slots));
await p.screenshot({ path: OUT + '/sv-3-two-runs.png' });

console.log('\n[5] 回到 A 局，进度要完整');
/* 列表按时间倒序，A 局是后面那个 */
await p.evaluate(() => {
  const rows = [...document.querySelectorAll('#boot-runs-body .runrow')];
  rows[rows.length - 1].click();
});
await p.waitForTimeout(1200);
const back = await stage();
ok('回到 A 局了', /A 开局/.test(back.text), back.text);
ok('剧情记录完整恢复（不是空的）', back.logLen === a.logLen && back.logLen > 1,
   '原来 ' + a.logLen + ' 条，读回来 ' + back.logLen + ' 条');
ok('光标也停在退出时那一句', back.text === a.text, back.text + ' / 原 ' + a.text);
ok('立绘也回来了', back.srcs.length === 1, JSON.stringify(back.srcs));
await p.screenshot({ path: OUT + '/sv-4-back-to-A.png' });

console.log('\n[6] 接着玩，存回 A 局自己的槽（不新开一个）');
const before = (await p.evaluate(async () => (await window.GalStore.listSaves()).map(s => s.id))).length;
await p.evaluate(() => window.__gal.autosave && window.__gal.autosave());
await p.waitForTimeout(400);
const after = (await p.evaluate(async () => (await window.GalStore.listSaves()).map(s => s.id))).length;
ok('槽数没变多', after === before, before + ' → ' + after);

ok('全程没有未捕获错误', errs.length === 0, errs.join(' | '));
await b.close();
console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
console.log('截图在 ' + OUT);
process.exit(fail ? 1 : 0);
