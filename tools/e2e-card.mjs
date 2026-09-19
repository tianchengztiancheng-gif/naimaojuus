/* ============================================================
 * tools/e2e-card.mjs —— 端到端：**只有引擎、没有任何素材包**时，
 *                       载入一张角色卡能不能真的演出来
 *
 * 这是「干净克隆也能玩」这句话的证据。它用真浏览器（Playwright + Chromium）
 * 打开 index.html，把一张合成卡喂进开场引导的文件框，然后翻页看舞台上
 * 到底有没有立绘和背景 —— 不是断言 DOM 里有个 class，是真的截图。
 *
 * 合成卡里所有图都是 data: URI 的纯色方块，所以离线也能渲染。
 *
 * 用法：
 *   npm i -D playwright            # 不在默认依赖里，这个测试是可选的
 *   node tools/e2e-card.mjs <要测的目录> <截图输出目录>
 *   node tools/e2e-card.mjs . /tmp/shots
 *
 * 想复现「干净克隆」的情形，把素材包挪开再跑：
 *   mv resource/juus /tmp/ && node tools/e2e-card.mjs . /tmp/shots
 * ============================================================ */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(process.argv[2] || '.');
const OUT  = path.resolve(process.argv[3] || '.');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n))
                          : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));

/* 一张合成卡：结构照真卡，URL 全是本地 data: 图，这样离线也能真渲染出来 */
const px = (c) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="700"><rect width="300" height="700" fill="${c}"/></svg>`
).toString('base64');
const bg = (c) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="${c}"/></svg>`
).toString('base64');

const GAL = `
var EXPRESSION_MAP = { "测试娘": { "常服": { "微笑": "${px('#4a9ec4')}", "得意": "${px('#3b86a8')}" } },
                       "同伴": { "常服": { "平静": "${px('#c47a9e')}" } } };
var SCENE_MAP = { "港区(朝)": "${bg('#16304a')}" };
var DEFAULT_SPRITES = { "路人甲": "${px('#7a9e4a')}" };
`;
const PH = `
var AVATARS = { '测试娘': '${px('#4a9ec4')}' };
var STICKERS = { '躺': '${px('#888')}' };
var DEFAULT_AVATARS = ['${px('#666')}'];
`;
const card = { spec:'chara_card_v2', data: { name:'合成卡', first_mes:
  '『✨ 08:00 · 港区 · 晴 ✨』|旁白|-|\n「早呀。」|测试娘|微笑|\n「早。」|同伴|平静|',
  extensions: {
    regex_scripts: [{ scriptName:'gal MVU', replaceString: GAL }],
    tavern_helper: { scripts: [{ name:'juus小手机', content: PH }] }
  } } };
fs.writeFileSync(OUT + '/synthetic-card.json', JSON.stringify(card));

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:1280,height:800} });
const errs=[]; p.on('pageerror', e=>errs.push(String(e).slice(0,160)));
await p.goto('file://' + ROOT + '/index.html');
await p.waitForTimeout(1000);

const before = await p.evaluate(()=>({
  chars: Object.keys(window.RESOURCE.characters).length,
  defs:  Object.keys(window.RESOURCE.defaults).length,
  locs:  Object.keys(window.RESOURCE.scenes).length,
  avatars: Object.keys((window.PHONE_RES||{}).avatars||{}).length,
}));
const CLEAN = before.chars === 0;
console.log('\n[1] 载卡前' + (CLEAN ? '（干净：没装素材包，这是要重点验的情形）'
                                      : '（本地装了素材包，改看增量）'));
console.log('    ' + JSON.stringify(before));
ok('页面起得来', typeof before.chars === 'number');

await p.setInputFiles('#f-card', OUT + '/synthetic-card.json');
await p.waitForTimeout(800);

const after = await p.evaluate(()=>({
  chars: Object.keys(window.RESOURCE.characters).length,
  defs: Object.keys(window.RESOURCE.defaults).length,
  locs: Object.keys(window.RESOURCE.scenes).length,
  avatars: Object.keys((window.PHONE_RES||{}).avatars||{}).length,
  note: document.getElementById('assets-note').textContent.trim(),
  openings: document.getElementById('opening-sel').options.length,
  startDisabled: document.getElementById('btn-start').disabled,
}));
console.log('\n[2] 把卡喂进开场引导的文件框之后');
console.log('    ' + JSON.stringify(after));
/* 看增量，这样本地装没装素材包都能跑 */
ok('卡里的 2 个角色进来了', after.chars - before.chars === 2,
   before.chars + ' → ' + after.chars);
ok('卡里的默认立绘进来了', after.defs - before.defs === 1);
ok('卡里的场景进来了', after.locs - before.locs === 1);
ok('卡里的手机头像进来了', after.avatars - before.avatars === 1);
ok('引导页当场显示出立绘数量', /立绘\s*\d+\s*角色/.test(after.note), after.note);
if (CLEAN) ok('干净情形下数字正好是卡里那些', /立绘\s*3\s*角色/.test(after.note), after.note);
ok('开场白列出来了', after.openings === 1);
ok('开始按钮可点了', after.startDisabled === false);
await p.screenshot({ path: OUT + '/e2e-1-boot.png' });

/* 直接开局（不发请求，用开场白） */
await p.evaluate(()=>document.querySelector('#boot-steps button[data-step="go"]').click());
await p.waitForTimeout(400);
await p.screenshot({ path: process.argv[3] + '/e2e-1b-laststep.png' });
await p.click('#btn-start');          // 第一次是「没载入预设」的确认
await p.waitForTimeout(400);
await p.click('#btn-start');          // 再点一次真进
await p.waitForTimeout(2000);
/* 第一句是抬头旁白，往后翻两句才轮到角色说话 */
for (let i=0;i<2;i++){ await p.click('#nav-next'); await p.waitForTimeout(900); }
const stage = await p.evaluate(()=>({
  sprites: [...document.querySelectorAll('#sprites .char')].map(c=>({
    who: c.dataset.who || c.getAttribute('data-who'),
    img: (c.querySelector('img')||{}).src ? (c.querySelector('img').src.slice(0,40)+'…') : null })),
  bg: [...document.querySelectorAll('.bglayer.show')].map(b=>(b.style.backgroundImage||'').slice(0,46)+'…'),
  speaker: (document.getElementById('speaker')||{}).textContent,
  text: (document.getElementById('text')||{}).textContent,
}));
console.log('\n[3] 真的演出来了没有');
ok('背景铺上了', stage.bg.length === 1, JSON.stringify(stage.bg));
/* 本地装了素材包时，同名地点「港区」可能命中预置包里别的时段那张 ——
   那是正常的合并结果，不是 bug。只有干净情形才能断言它一定来自卡。 */
if (CLEAN) ok('背景就是卡里那张', /^url\("data:image/.test(stage.bg[0]), stage.bg[0]);
ok('舞台上站了两个人', stage.sprites.length === 2, String(stage.sprites.length));
ok('说话人是剧本里那个', stage.speaker === '同伴', stage.speaker);
ok('台词没被卡里的正则糊掉', stage.text === '「早。」', stage.text);
await p.screenshot({ path: OUT + '/e2e-2-stage.png' });
ok('全程没有未捕获错误', errs.length === 0, errs.join(' | '));
await b.close();
console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
console.log('截图在 ' + OUT);
process.exit(fail ? 1 : 0);
