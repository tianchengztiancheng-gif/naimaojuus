/* ============================================================
 * tools/e2e-stage.mjs —— 端到端：立绘出入场（v5.28.7）
 *
 *   A. 退场后紧跟旁白：人留着，不空台；下一个人开口才走
 *   B. 用过 <登场> 后，没登场的人开口也有立绘；刚写了退场又接着说话的人还在
 *   C. 立绘死链：按顺序换备用图（同表情另一张 → 默认立绘 → 平静），不会名字牌是她、画面上没她
 *
 * 开场白就是测试剧本（开局时走的也是 processOutput），不用假接口。
 * 用法：node tools/e2e-stage.mjs [要测的目录] [截图输出目录]
 * ============================================================ */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const ROOT = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(process.argv[3] || './shots');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));
const px = (c, t) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="700"><rect width="300" height="700" fill="${c}"/><text x="150" y="80" font-size="40" text-anchor="middle" fill="#fff">${t}</text></svg>`).toString('base64');
const bgi = (c) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="${c}"/></svg>`).toString('base64');
const DEAD = 'https://dead.test/gone.png';
const GAL = `
var EXPRESSION_MAP = {
  "甲": { "常服": { "微笑": "${px('#4a9ec4', 'A')}", "平静": "${px('#4a9ec4', 'A')}" } },
  "乙": { "常服": { "微笑": "${px('#c47a9e', 'B')}", "平静": "${px('#c47a9e', 'B')}" } },
  "丙": { "常服": { "生气": ["${DEAD}"], "平静": "${px('#7ac49e', 'C平静')}" } } };
var SCENE_MAP = { "港区(朝)": "${bgi('#16304a')}" };
var DEFAULT_SPRITES = {};`;
const SCRIPT = [
  '『✨ 08:00 · 港区 · 晴 ✨』|旁白|-|',          // 0
  '早。|甲|微笑|',                                  // 1
  '早上好。|乙|微笑|',                              // 2
  '我先走了。|甲|微笑|',                            // 3
  '<退场|甲>',
  '她挥挥手，转身往门口走去。|旁白|-|',             // 4  甲 还在
  '走廊里很安静。|旁白|-|',                         // 5  甲 还在
  '……她走了呢。|乙|平静|',                          // 6  甲 下场
  '<登场|丙:平静>',
  '我来了。|丙|平静|',                              // 7
  '还有我！|甲|微笑|',                              // 8  没写登场的甲开口 → 上台
  '<退场|乙>',
  '等等，我还没说完。|乙|微笑|',                    // 9  乙 写了退场又说话 → 还在
  '哼！|丙|生气|',                                  // 10 丙 生气 = 死链 → 换平静
].join('\n');
const card = { spec: 'chara_card_v2', data: { name: '出入场测试卡', first_mes: SCRIPT,
  extensions: { regex_scripts: [{ scriptName: 'gal MVU', replaceString: GAL }] } } };
fs.writeFileSync(OUT + '/stage-card.json', JSON.stringify(card));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.route('**/*', r => { const u = r.request().url();
  if (u.startsWith('file:') || u.startsWith('data:')) return r.continue();
  return r.abort(); });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await p.goto('file://' + ROOT + '/index.html?title=0'); await p.waitForTimeout(700);
await p.setInputFiles('#f-card', OUT + '/stage-card.json'); await p.waitForTimeout(500);
await p.evaluate(() => document.querySelector('#boot-steps button[data-step="go"]').click());
await p.evaluate(() => { const s = document.getElementById('btn-start'); s.click(); if (!document.getElementById('boot').classList.contains('gone')) s.click(); });
await p.waitForTimeout(1200);
const E = (f, a) => p.evaluate(f, a);
async function at(i) {
  await E(i => window.__gal.goTo(i, { instant: true }), i); await p.waitForTimeout(1900);
  return E(() => ({
    spk: document.getElementById('speaker').textContent,
    /* 画面上真看得见：前台那层（.layer.show）没被藏，图加载出来了 */
    on: [...document.querySelectorAll('#sprites .char:not(.leaving)')].filter(c => {
      const lay = c.querySelector('.layer.show'); const im = lay && lay.querySelector('img');
      return lay && getComputedStyle(lay).visibility !== 'hidden' && im && im.naturalWidth > 0; }).map(c => c.dataset.who)
  }));
}
const names = async i => (await at(i)).on.join('、');

console.log('\n[A 退场后紧跟旁白]');
ok('退场的人在随后的旁白里还在（不空台）', /甲/.test(await names(4)) && /甲/.test(await names(5)), await names(4) + ' / ' + await names(5));
ok('下一个人开口，退场才生效', !/甲/.test(await names(6)) && /乙/.test(await names(6)), await names(6));

console.log('\n[B 说话的人一定有立绘]');
ok('用过登场后，没登场的甲开口也上台', /甲/.test(await names(8)), await names(8));
ok('乙写了退场又接着说话：还在', /乙/.test(await names(9)), await names(9));
const all = [];
for (let i = 1; i <= 10; i++) { const s = await at(i); if (!/旁白/.test(s.spk) && s.spk) all.push([i, s.spk, s.on.join('、')]); }
const miss = all.filter(([i, spk, on]) => !spk.split(/\s*&\s*/).every(n => on.includes(n)));
ok('每句说话的人都在画面上', miss.length === 0, JSON.stringify(miss));

console.log('\n[C 死链换备用图]');
const c10 = await E(async () => { window.__gal.goTo(10, { instant: true }); await new Promise(r => setTimeout(r, 2500));
  const el = [...document.querySelectorAll('#sprites .char:not(.leaving)')].find(c => c.dataset.who === '丙');
  const lay = el && el.querySelector('.layer.show'), im = lay && lay.querySelector('img');
  return el ? { vis: lay ? getComputedStyle(lay).visibility : 'none', w: im ? im.naturalWidth : 0, src: im ? String(im.getAttribute('src')).slice(0, 22) : '' } : null; });
ok('丙「生气」那张挂了：换成她的「平静」，人还在画面上', c10 && c10.w > 0 && c10.vis !== 'hidden' && /^data:/.test(c10.src), JSON.stringify(c10));
await p.screenshot({ path: OUT + '/stage.png' });

ok('没有报错', errs.length === 0, errs.join(' | '));
await b.close();
console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
process.exit(fail ? 1 : 0);
