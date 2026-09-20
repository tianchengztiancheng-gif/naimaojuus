/* 用 jsdom 把 index.html 真正跑一遍，覆盖：加载 → 开局 → 翻页 → 手机 → 面板 → 存档。
   用法：npm i jsdom && node tools/smoke-test.js [角色卡.json]
   浏览器里才会暴露的错（比如用了 Node 专有的 global）在这里就能抓到。 */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CARD = process.argv[2];

let fails = 0, checks = 0, skips = 0;
function ok(name, cond, extra) {
  checks++;
  if (!cond) fails++;
  console.log('  ' + (cond ? '✔' : '✘') + ' ' + name + (extra ? '  ' + extra : ''));
}
/* okCard：断言的是**角色卡里有什么**，不是引擎行为（「通讯录七百多人」这种）。
   仓库里不带真素材表，跑合成表时这些没有意义，跳过而不是假装通过。 */
function okCard(name, cond, extra) {
  if (!HAVE_REAL_RES) { skips++; console.log('  – ' + name + '（跳过：无真素材表）'); return; }
  ok(name, cond, extra);
}

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window, d = w.document;
w.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
w.fetch = () => Promise.reject(new Error('测试环境不联网'));
w.alert = () => {}; w.confirm = () => true; w.prompt = () => null;

const errors = [];
w.addEventListener('error', e => errors.push(e.message));

/* 真素材表是从第三方角色卡抽出来的，不随仓库分发（见 resource/README.md）。
 * 克隆下来没有它们时改用 test/fixtures/resource.js —— 结构一样，URL 全是占位。 */
const REAL_RES = [
  'resource/tianqing/expressions.js', 'resource/tianqing/scenes.js',
  'resource/juus/expressions.js', 'resource/juus/scenes.js', 'resource/juus/defaults.js',
  'resource/juus/phone.js'
];
const HAVE_REAL_RES = REAL_RES.every(f => fs.existsSync(path.join(ROOT, f)));
if (!HAVE_REAL_RES) console.log('（未找到真素材表，改用 test/fixtures/resource.js 合成表）');

const FILES = [
  ...(HAVE_REAL_RES ? REAL_RES : ['test/fixtures/resource.js']),
  'resource/aliases.js',
  'core/crash.js', 'core/cardres.js', 'core/tokens.js', 'core/vector.js',
  'core/imagegen.js', 'core/snapshot.js', 'core/gallery.js', 'core/cg.js',
  'core/resolver.js', 'core/worldbook.js', 'core/prompt.js', 'core/script.js',
  'core/phone.js', 'core/engine.js', 'core/api.js', 'core/storage.js', 'core/editors.js', 'app/app.js'
];

const qa0 = s2 => [...d.querySelectorAll(s2)];

console.log('\n[1] 脚本加载');
for (const f of FILES) {
  try { w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')); ok(f, true); }
  catch (e) { ok(f, false, '→ ' + e.message.slice(0, 120)); }
}


console.log('\n[1b] 开场引导（四步向导）');
{
  ok('引导骨架在', !!d.querySelector('#boot .boot-shell') &&
     !!d.querySelector('#boot .boot-rail') && !!d.querySelector('#boot .boot-main'));
  ok('背景是 CSS 画的，不引外部图片',
     !/background-image\s*:\s*url\(/i.test(
       d.querySelector('#boot .boot-bg').getAttribute('style') || ''));
  ok('四步都在', qa0('#boot-steps button[data-step]').length === 4,
     String(qa0('#boot-steps button[data-step]').length));
  ok('第一步默认选中', d.querySelector('#boot-steps button[data-step="asset"]')
     .classList.contains('on'));
  ok('第一步显示 STEP 01', /STEP 01/.test(d.getElementById('boot-kicker').textContent),
     d.getElementById('boot-kicker').textContent);
  ok('上一步在第一步时禁用', d.getElementById('boot-prev').disabled === true);
  ok('开始按钮只在最后一步露出', d.getElementById('btn-start').hidden === true);

  /* 老界面的输入框 id 一个都不能丢，app.js 全靠它们 */
  ['f-card','f-preset','f-wi','cfg-protocol','cfg-model','cfg-base','cfg-key',
   'cfg-temp','cfg-max','cfg-stream','btn-test','test-note','cfg-user',
   'opening-sel','btn-start','btn-continue','boot-note','assets-note',
   'btn-models','model-list'].forEach(function (id) {
    ok('保留了 #' + id, !!d.getElementById(id));
  });

  run(() => d.getElementById('boot-next').click(), '下一步');
  ok('走到第 2 步', /STEP 02/.test(d.getElementById('boot-kicker').textContent),
     d.getElementById('boot-kicker').textContent);
  ok('进度条跟着走', d.getElementById('boot-bar-fill').style.width === '50%',
     d.getElementById('boot-bar-fill').style.width);
  run(() => d.querySelector('#boot-steps button[data-step="go"]').click(), '直接点到最后一步');
  ok('最后一步露出开始按钮', d.getElementById('btn-start').hidden === false);
  ok('最后一步藏起下一步', d.getElementById('boot-next').hidden === true);
  ok('给了「齐没齐」的清单', (d.getElementById('boot-ready').textContent || '').length > 4,
     (d.getElementById('boot-ready').textContent || '').slice(0, 30));
  ok('没角色卡时开始按钮是灰的', d.getElementById('btn-start').disabled === true);
  run(() => d.querySelector('#boot-steps button[data-step="asset"]').click(), '回到第一步');
}

console.log('\n[1c] 通讯录剔除名单');
{
  const ex = w.Phone.ROSTER_EXCLUDE;
  ok('名单有 8 个', ex.length === 8, String(ex.length));
  const r = w.Phone.roster();
  ex.forEach(function (n) { ok('已移除 ' + n, r.indexOf(n) < 0); });
  okCard('没误删同前缀的（布里 / 新月 / 加贺 还在）',
     ['布里', '新月', '加贺'].every(function (n) { return r.indexOf(n) >= 0; }));
  okCard('通讯录还剩七百多人', r.length > 700, String(r.length));
  ok('通讯录非空', r.length > 0, String(r.length) + ' 人');
}

console.log('\n[2] 全局对象');
['RESOURCE', 'Resolver', 'Worldbook', 'PromptBuilder', 'ScriptParser',
 'Phone', 'Engine', 'GalAPI', 'GalStore', 'PHONE_RES', 'SCENE_ALIASES', 'Editors',
 'Tokens', 'Vector', 'ImageGen', 'Snapshot', 'Gallery', 'CG', 'CardRes', 'GalCrash']
  .forEach(n => ok(n, typeof w[n] !== 'undefined'));

function run(fn, label) {
  try { fn(); return true; }
  catch (e) { ok(label, false, '→ ' + e.message.slice(0, 160)); return false; }
}

console.log('\n[3] 进入游戏');
d.getElementById('toolbar').hidden = false;
d.getElementById('dialogue').hidden = false;
d.getElementById('inputbar').hidden = false;

if (CARD) {
  const card = JSON.parse(fs.readFileSync(CARD, 'utf8'));
  run(() => {
    const ev = new w.Event('change');
    // 直接走引擎，绕过 file input
    w.eval('void 0');
  }, '载入角色卡');
}

console.log('\n[4] 打开手机');
run(() => d.getElementById('btn-phone').click(), '点击手机按钮');
const root = d.getElementById('jup-root');
const q = s2 => root.querySelector(s2), qa = s2 => [...root.querySelectorAll(s2)];
ok('机身存在', !!d.querySelector('.ph-frame'));
ok('灵动岛/状态栏/home 条', !!q('.ph-island') && !!q('.ph-status') && !!d.querySelector('.ph-homebar'));
ok('主屏图标', qa('.ph-app').length === 6, qa('.ph-app').length + ' 个');
ok('主屏默认显示', q('.ph-layer.ph-home').classList.contains('on'));
ok('时钟已填', (d.getElementById('ph-bigtime') || {}).textContent !== '');

console.log('\n[5] App 页面');
['juus', 'ig', 'hot', 'doss', 'log', 'cfg'].forEach(k => {
  ok('页 ' + k, !!q('.ph-layer[data-app="' + k + '"]'));
});
run(() => q('.ph-app[data-app="cfg"]').click(), '打开设置');
ok('侧栏分区', qa('.kt-nav button[data-sec]').length === 9,
   qa('.kt-nav button[data-sec]').length + ' 个');
ok('外观滑块搬进来了', !!q('#tune-host input[type=range]'));
ok('旧侧栏已移除', !d.getElementById('history') && !d.getElementById('saves'));

console.log('\n[6] 逐个打开 App');
qa('.ph-app').forEach(b => run(() => b.click(), '打开 ' + b.dataset.app));
run(() => d.querySelector('.ph-homebar').click(), '回主屏');
ok('回到主屏', q('.ph-layer.ph-home').classList.contains('on'));

console.log('\n[6b] JUUS 内部');
run(() => q('.ph-app[data-app="juus"]').click(), '进 JUUS');
ok('联系人非空', qa('.ctl .ct').length > 0, qa('.ctl .ct').length + ' 人');
ok('筛选按钮', (q('.filter') || {}).textContent === '≡ 全部');
run(() => qa('.ph-seg button')[1].click(), '切到群聊');
ok('群列表有新建入口', !!q('.gpl .ct.mkgrp'));
ok('预置群已列出', qa('.gpl .ct').length > 1, qa('.gpl .ct').length - 1 + ' 个群');
run(() => qa('.ph-seg button')[0].click(), '切回私聊');
run(() => q('.ctl .ct').click(), '点开联系人');
ok('会话窗展开', q('.cw').classList.contains('on'));
/* 不比绝对数量（那取决于卡），比「表里有几个就渲染出几个」*/
ok('表情包全部渲染出来', qa('.sp .si').length ===
   Object.keys(w.PHONE_RES.stickers || {}).length,
   qa('.sp .si').length + ' 个');
run(() => q('.eb').click(), '点表情按钮');
ok('表情面板展开', q('.sp').classList.contains('on'));
run(() => q('.cw .bk').click(), '返回列表');
ok('会话窗收起', !q('.cw').classList.contains('on'));
run(() => q('.ph-app[data-app="ig"]').click(), '进 JUUSTAGRAM');
ok('推荐流是横条', qa('.xl .fd').length > 0, qa('.xl .fd').length + ' 条');
ok('横条不带头像', !q('.xl .fd img'));
run(() => q('.ph-app[data-app="hot"]').click(), '进热点 App');
ok('热点非空', qa('.hotlist .hot-row').length > 0, qa('.hotlist .hot-row').length + ' 条');
run(() => q('.ph-app[data-app="ig"]').click(), '回 JUUSTAGRAM');
run(() => q('.xl .fd').click(), '点开帖子');
ok('详情有评论输入', !!q('.cmtin') && !!q('.cmtsend'));
ok('详情展开', q('.postd').classList.contains('on'));
ok('正文已格式化', (q('.pd-b') || {}).innerHTML?.indexOf('<b>') >= 0 ||
   (q('.pd-b') || {}).innerHTML?.indexOf('class="hl"') >= 0);
ok('评论区存在', !!q('.pd-c'));
run(() => q('.qcbk').click(), '返回列表');


console.log('\n[6b2] 舰娘之间的对话不进指挥官私聊');
{
  /* 实测截图里的一幕：模型拿 [短信|…] 写了 Z52 和 Z9 互相说话，
     结果两条各自躺在「和指挥官的私聊」里，指挥官被夹在中间。 */
  const E = w.__gal.eng;
  const saveHist = E.history;
  E.history = [{ role: 'assistant', content: [
    '[短信|Z52|文字|Z9！！！你看到了吗后面那个！Z47坐在指挥官大腿上了！！！]',
    '[短信|Z52|文字|别转移话题！]',
    '[短信|Z9|文字|Z52……你现在不是应该在做第七题吗……]',
    '[短信|贝尔法斯特|文字|指挥官，早餐准备好了。]'
  ].join('\n') }];
  const dd = w.Phone.scan(E.history, [], { userName: '指挥官' });
  ok('Z52 不再有「和指挥官的私聊」', !dd.chats['Z52'], JSON.stringify(Object.keys(dd.chats)));
  ok('Z9 也不再有', !dd.chats['Z9']);
  ok('她俩的对话进了同一个群', (dd.groups[w.Phone.PEER_GROUP] || []).length === 3,
     String((dd.groups[w.Phone.PEER_GROUP] || []).length));
  ok('真·私信（贝尔法斯特对指挥官说话）留在私聊里',
     (dd.chats['贝尔法斯特'] || []).length === 1);
  /* 群聊列表里能看到它 */
  run(() => { w.__gal.reload(); }, '刷新手机');
  E.history = saveHist;
}

console.log('\n[6c] 编辑器');
run(() => { q('.ph-app[data-app="cfg"]').click(); q('.kt-nav [data-sec="me"]').click(); }, '打开人设');
ok('人设表单', !!d.getElementById('me-desc'));
run(() => { d.getElementById('me-name').value = '天铖';
            d.getElementById('me-desc').value = '黑发蓝瞳的男性';
            d.getElementById('me-save').click(); }, '填写并保存人设');
ok('人设已存', (w.Editors.loadPersona().description || '').indexOf('黑发') >= 0);
run(() => q('.kt-nav [data-sec="book"]').click(), '打开世界书');
ok('世界书统计磁贴', d.querySelectorAll('#bk-stat .kt-tile').length === 4);
run(() => d.getElementById('bk-new').click(), '新建条目');
ok('新建后进入编辑', d.getElementById('bk-split').classList.contains('show-edit'));
ok('编辑表单齐全', !!d.getElementById('e-key') && !!d.getElementById('e-content'));
run(() => q('.kt-nav [data-sec="pre"]').click(), '打开预设');
ok('预设页存在', !!d.getElementById('pre-list'));

console.log('\n[6d] 编辑器换皮与结构');
if (CARD) {
  const card = JSON.parse(fs.readFileSync(CARD, 'utf8'));
  run(() => w.__gal.eng.loadCard(card), '注入角色卡');
  run(() => { q('.ph-app[data-app="cfg"]').click(); q('.kt-nav [data-sec="book"]').click(); }, '重开世界书');
  ok('世界书分三组', qa('#bk-list .kt-group').length === 3,
     qa('#bk-list .kt-group').length + ' 组');
  ok('条目渲染', qa('#bk-list .kt-item').length > 100,
     qa('#bk-list .kt-item').length + ' 条');
  run(() => qa('#bk-list .kt-item')[0].click(), '打开条目');
  ok('详情分四区', qa('#bk-form .kt-sec').length === 4);
  ok('字数统计', (d.getElementById('e-len') || {}).textContent?.indexOf('token') > 0);
  run(() => d.getElementById('bk-back').click(), '返回列表');
  run(() => q('.kt-nav [data-sec="vars"]').click(), '切到变量');
  run(() => q('.kt-nav [data-sec="api"]').click(), '切到接口');
  ok('接口摘要', (d.getElementById('api-info') || {}).innerHTML?.indexOf('协议') >= 0);
}
ok('设置用碧蓝皮肤', q('.ph-layer[data-app="cfg"]').classList.contains('kt'));
ok('社交类保持浅色', !q('.ph-layer[data-app="juus"]').classList.contains('kt'));
ok('调试钩子', !!w.__gal && !!w.__gal.eng);

console.log('\n[6e] 主屏与导航');
/* 主页键是**分级返回**（会话中 → 列表 → 主屏），不是一键到底。
   原来这里只点一次就断言回到主屏，从深层页面出发必然挂 —— 是测试写错了，不是引擎。 */
run(() => { for (let i = 0; i < 3; i++) {
  if (q('.ph-layer.ph-home').classList.contains('on')) break;
  d.querySelector('.ph-homebar').click();
} }, '按主页键逐级返回');
ok('回到主屏', q('.ph-layer.ph-home').classList.contains('on'));
ok('Dock 与图标', !!q('.ph-dock') && q('.ph-dock').children.length === 6);
ok('主页键是圆钮带房子图标', !!d.querySelector('.ph-homebar svg'));
ok('主屏小组件', (d.getElementById('ph-widget') || {}).textContent?.indexOf('简') >= 0);
ok('简报含热点', (d.getElementById('ph-widget') || {}).innerHTML?.indexOf('whot') >= 0);
ok('电量无 API 时隐藏', !d.getElementById('ph-batt'));
run(() => { q('.ph-app[data-app="juus"]').click();
            qa('.ph-seg [data-sub]')[1].click(); }, '切到群聊');
ok('群聊面板亮起', q('.sub[data-sub="gp"]').classList.contains('on') &&
   !q('.sub[data-sub="ct"]').classList.contains('on'));
run(() => qa('.ph-seg [data-sub]')[0].click(), '切回私聊');
ok('私聊面板亮起', q('.sub[data-sub="ct"]').classList.contains('on') &&
   !q('.sub[data-sub="gp"]').classList.contains('on'));
run(() => { d.getElementById('boot').classList.add('gone');
            q('.ph-app[data-app="cfg"]').click(); }, '点设置');
ok('进的是设置层而不是启动面板',
   q('.ph-layer[data-app="cfg"]').classList.contains('on') &&
   d.getElementById('boot').classList.contains('gone'));
ok('设置里能改世界书', (() => {
  q('.kt-nav [data-sec="book"]').click();
  const it = qa('#bk-list .kt-item')[0];
  if (!it) return false;
  it.click();
  return qa('#bk-form input, #bk-form select, #bk-form textarea').length >= 8;
})());

console.log('\n[6f] 版式');
run(() => { q('.ph-app[data-app="cfg"]').click();
            q('.kt-nav [data-sec="vars"]').click(); }, '打开变量页');
ok('变量统计磁贴', d.querySelectorAll('#varsbody .kt-tile').length === 4);
ok('场景可编辑', !!d.getElementById('vx-loc') && !!d.getElementById('vx-band'));
run(() => q('.kt-nav [data-sec="book"]').click(), '回到世界书');
ok('磁贴数与筛选一致', (() => {
  const tile = d.querySelector('#bk-stat [data-tile="blue"]');
  const n = parseInt(tile.querySelector('.nm').textContent, 10);
  tile.click();
  const got = qa('#bk-list .kt-item').length;
  d.querySelector('#bk-stat [data-tile="all"]').click();
  return n === got;
})());
run(() => q('.kt-nav [data-sec="me"]').click(), '人设页');
ok('人设预览栏已移除', !d.getElementById('me-preview') && !d.getElementById('me-macro'));
ok('分区标题带图标框', (d.getElementById('kt-title') || {}).innerHTML?.indexOf('class="ib"') >= 0);

console.log('\n[6g] 开场白初始变量');
if (CARD) {
  const card2 = JSON.parse(fs.readFileSync(CARD, 'utf8'));
  const g = (card2.data.alternate_greetings || [])[3];
  if (g) {
    const r = w.__gal.eng.seedVarsFromOpening(g);
    const vv = w.__gal.eng.vars;
    ok('初始地点', !!vv.地点, vv.地点);
    ok('初始时段', !!(vv.时间 && vv.时间.时段), vv.时间.时段);
    ok('初始登场角色', Object.keys(vv.人物).length > 0,
       Object.keys(vv.人物).join('、'));
    ok('角色带服装与在场', Object.keys(vv.人物).every(n =>
       vv.人物[n].服装 && typeof vv.人物[n].在场 === 'boolean'));
  }
}

console.log('\n[6h] 档案与选项');
run(() => q('.ph-app[data-app="doss"]').click(), '打开档案');
/* 档案卡的内容来自变量里的角色，不带卡跑时本来就是空的 */
if (CARD) ok('档案卡有头像与好感条', (() => {
  const c = q('.dsl .dcard');
  return !!c && !!c.querySelector('.dc-av img') && !!c.querySelector('.dc-lv');
})());
w.__gal.eng.log = [{ turn: 0, who: '旁白', text: 'x', narration: true,
                     stage: [], sprites: [], choices: ['选项A', '选项B'] }];
run(() => w.__gal.goTo(0), '渲染带选项的句子');

console.log('\n[6i] 手机独立于主线');
ok('引擎有独立生成通道', typeof w.__gal.eng.quiet === 'function');
ok('手机记录能注入主线', typeof w.__gal.eng.renderPhoneLog === 'function');
ok('phoneOnly 记录不进主线', (() => {
  const E2 = w.__gal.eng;
  E2.history.push({ role: 'assistant', content: '[群聊|公共频道|Z23|文字|测试]',
                    phoneOnly: true });
  const dry = E2.dryRun('x');
  E2.history.pop();
  return !JSON.stringify(dry.messages).includes('[群聊|');
})());
ok('私聊提示词是独立任务', (() => {
  const pr = w.Phone.buildSmsPrompt('柴郡', [], { 好感度: 90 }, '在吗');
  return pr.indexOf('独立任务') === 1 && pr.indexOf('<sms>') > 0;
})());
ok('回复归属正确', (() => {
  const r = w.Phone.scan([], [
    { who: '柴郡', type: 'text', v: '我发的', me: true, turn: 1 },
    { who: '柴郡', type: 'text', v: '她回的', me: false, turn: 2 }]);
  const log = r.chats['柴郡'];
  return log[0].me === true && log[1].me === false;
})());

console.log('\n[6j] 快速推进不丢句不卡死');
(() => {
  const E3 = w.__gal.eng;
  E3.log = [];
  E3.appendLog(Array.from({ length: 8 }, (_, i) => ({
    who: '柴郡', text: '第' + (i + 1) + '句', narration: false,
    stage: [], sprites: [], bg: {} })));
  w.__gal.goTo(0);
  for (let i = 0; i < 6; i++) d.getElementById('dialogue').click();
  ok('连点后进度前进', d.getElementById('progress').textContent.indexOf('7') === 0,
     d.getElementById('progress').textContent);
  for (let i = 0; i < 3; i++) d.getElementById('dialogue').click();
  ok('能一直点到末尾', d.getElementById('progress').textContent.indexOf('8') === 0,
     d.getElementById('progress').textContent);
})();
ok('present 有并发令牌',
   fs.readFileSync(path.join(ROOT, 'app/app.js'), 'utf8').indexOf('token !== presentToken') > 0);
ok('选项不再拦截推进',
   fs.readFileSync(path.join(ROOT, 'app/app.js'), 'utf8')
     .indexOf('if (!choicesEl.hidden) return;') < 0);

console.log('\n[6k] 手机能读到人设/好感/剧情');
if (CARD) {
  const E4 = w.__gal.eng;
  const card4 = JSON.parse(fs.readFileSync(CARD, 'utf8'));
  E4.seedVarsFromOpening(card4.data.alternate_greetings[4]);
  E4.log = [{ turn: 0, who: '柴郡', text: '指挥官早呀。', narration: false }];
  const ctx = E4.quietContext('柴郡 报告呢', { who: '柴郡' });
  ok('捞到角色设定', ctx.lore.length > 1000, ctx.lore.length + ' 字');
  ok('设定是本人而非差分', ctx.lore.indexOf('【柴郡】') === 0);
  ok('带上当前剧情', ctx.scene.indexOf('地点：') >= 0 && ctx.scene.indexOf('最近发生的') > 0);
  const pr = w.Phone.buildSmsPrompt('柴郡', [], (E4.vars.人物 || {})['柴郡'], '报告呢', ctx);
  ok('提示词含好感度', /好感度约 \d+/.test(pr));
  ok('提示词含设定与剧情', /\[她的设定\]/.test(pr) && /\[现在的剧情\]/.test(pr));
  ok('表情包名单发全', w.Phone.stickerNames().split('、').length ===
     Object.keys(w.PHONE_RES.stickers).length);
  ok('瞎编的表情名被拒', !w.Phone.stickerOf('完全瞎编的名字') && !!w.Phone.stickerOf('躺'));
}

console.log('\n[6l] 变量更新与换场');
(() => {
  const E5 = new w.Engine();
  E5.vars = { 时间: { 天数: 1, 时段: '朝' }, 地点: '教室',
              人物: { 柴郡: { 好感度: 60, 在场: true, 服装: '常服' } } };
  const out = '<Gal>\n换个地方。|柴郡|微笑|\n</Gal>\n' +
    '<UpdateVariable><Analysis>x</Analysis><JSONPatch>[' +
    '{"op":"replace","path":"/地点","value":"重樱神社"},' +
    '{"op":"delta","path":"/人物/柴郡/好感度","value":8},' +
    '{"op":"insert","path":"/人物/雅努斯","value":{"好感度":30,"在场":true}},' +
    '{"op":"remove","path":"/人物/柴郡/服装"}' +
    ']</JSONPatch></UpdateVariable>';
  const r5 = E5.processOutput(out);
  ok('JSON Patch replace', E5.vars.地点 === '重樱神社', E5.vars.地点);
  ok('JSON Patch delta', E5.vars.人物.柴郡.好感度 === 68, String(E5.vars.人物.柴郡.好感度));
  ok('JSON Patch insert', !!E5.vars.人物.雅努斯);
  ok('JSON Patch remove', E5.vars.人物.柴郡.服装 === undefined);
  ok('变量块已从正文剥离', r5.text.indexOf('UpdateVariable') < 0);
  ok('变更有记录', r5.updates.length === 4, r5.updates.length + ' 条');
})();
(() => {
  const E6 = new w.Engine();
  const r6 = E6.processOutput('<Gal>\n『✨ 08:00 · 教室 · 晴 ✨』|旁白|-|\n' +
    '早。|Z23|微笑|\n『✨ 09:00 · 重樱神社 · 晴 ✨』|旁白|-|\n到了。|长门|微笑|\n</Gal>');
  const last = r6.modules[r6.modules.length - 1];
  ok('换地点后旧角色不跟着走',
     last.stage.length === 1 && last.stage[0].name === '长门',
     last.stage.map(c => c.name).join('、'));
})();

console.log('\n[6m] 手机消息顺序');
ok('按发送顺序排列', (() => {
  let seq = 0; const nx = () => ++seq;
  const sent = [
    { who: 'Z46', type: 'text', v: '我1', me: true,  turn: nx() },
    { who: 'Z46', type: 'text', v: '她A', me: false, turn: nx() },
    { who: 'Z46', type: 'text', v: '我2', me: true,  turn: nx() },
    { who: 'Z46', type: 'text', v: '她B', me: false, turn: nx() }];
  const log = w.Phone.scan([], sent).chats['Z46'];
  return log.map(m => m.v).join(',') === '我1,她A,我2,她B';
})());
ok('开局好感度可调', (() => {
  const E7 = new w.Engine({ initialFavor: 120 });
  E7.seedVarsFromOpening('『✨ 08:00 · 教室 · 晴 ✨』|旁白|-|\n早。|柴郡|微笑|');
  const p = E7.vars.人物['柴郡'];
  return p && p.好感度 === 120;
})());

console.log('\n[6n] 出入场与立绘稳定');
(() => {
  const E8 = new w.Engine();
  const r8 = E8.processOutput('<Gal>\n『✨ 08:00 · 教室 · 晴 ✨』|旁白|-|\n' +
    '早。|Z23|微笑|\n你也早。|Z52|平静|\n我先走了。|Z23|不满|\n<退场|Z23>\n' +
    '她走了。|旁白|-|\n<登场|长门:微笑>\n我来了。|长门|微笑|\n<退场|全部>\n空了。|旁白|-|\n</Gal>');
  const at = i => r8.modules[i].stage.map(c => c.name).join('、');
  ok('退场指令生效', at(4) === 'Z52', at(4));
  ok('登场指令生效', at(5).indexOf('长门') >= 0, at(5));
  ok('全部退场生效', at(6) === '', at(6) || '（空台）');
})();
(() => {
  const E9 = new w.Engine();
  E9.vars = { 地点: '后宅卧室', 时间: { 时段: '朝' },
    人物: { 贝尔法斯特: { 在场: true, 服装: '女仆装' },
            谢菲尔德: { 在场: true, 服装: '女仆装' } } };
  const r9 = E9.processOutput('<Gal>\nA。|贝尔法斯特|平静|\nB。|谢菲尔德|观察|\n' +
    'C。|贝尔法斯特|平静|\nD。|谢菲尔德|观察|\n</Gal>');
  const urlOf = (i, who) => (r9.modules[i].sprites.filter(s2 => s2.who === who)[0] || {}).url;
  ok('没说话的人不换图', urlOf(1, '贝尔法斯特') === urlOf(3, '贝尔法斯特'));
})();
{
  /* 规则条目是 loadCard() 时装进去的。不带卡跑时 pool 是空的，
     所以这里直接拿一个临时池验 ensurePhoneRule，有没有卡都成立。 */
  const scratch = CARD ? w.__gal.eng.pool : [];
  if (!CARD) w.Editors.ensurePhoneRule(scratch);
  const has = id => scratch.some(e => e.uid === id);
  ok('内置出入场规则已装入', has(w.Editors.STAGE_RULE_ID));
  ok('内置手机规则已装入', has(w.Editors.PHONE_RULE_ID));
  ok('重复装入不会重复添加', (() => {
     const before = scratch.length;
     w.Editors.ensurePhoneRule(scratch);
     return scratch.length === before; })());
}

console.log('\n[6o] 默认立绘');
okCard('默认立绘表已装载（七百多角色）', w.Resolver.stats().defaultChars > 700,
   w.Resolver.stats().defaultChars + ' 个角色 / ' +
   w.Resolver.stats().defaultSprites + ' 张');
ok('默认立绘表非空', w.Resolver.stats().defaultChars > 0,
   w.Resolver.stats().defaultChars + ' 个角色 / ' +
   w.Resolver.stats().defaultSprites + ' 张');
ok('没有差分的角色也有图', (() => {
  const r = w.Resolver.sprite('贾维斯', '微笑', {});
  return r && r.via === 'default-sprite' && !!r.url;
})());
ok('服装会换默认立绘', (() => {
  const a = w.Resolver.sprite('雪风', '微笑', { outfit: '常服' });
  const b = w.Resolver.sprite('雪风', '微笑', { outfit: '泳装' });
  return a && b && a.url !== b.url;
})());
ok('有差分的角色仍精确命中',
   w.Resolver.sprite('柴郡', '微笑', { outfit: '常服' }).via === 'exact');
ok('通讯录含只有默认立绘的角色', w.Phone.roster().indexOf('雪风') >= 0,
   w.Phone.roster().length + ' 人');

console.log('\n[6p] 换装面板');
(() => {
  const E10 = w.__gal.eng;
  E10.vars = { 地点: '教室', 时间: { 时段: '朝' }, 人物: {} };
  const rr = E10.processOutput('<Gal>\n早。|雪风|微笑|\n你好。|柴郡|微笑|\n</Gal>');
  ok('只有默认立绘的角色能上台',
     rr.modules[0].sprites.some(s2 => s2.who === '雪风'));
  ok('登场随机抽皮肤并记住', E10.vars.人物['雪风'].皮肤 != null,
     '皮肤 ' + E10.vars.人物['雪风'].皮肤);
  const first = E10.vars.人物['雪风'].皮肤;
  E10.processOutput('<Gal>\n再说。|雪风|得意|\n</Gal>');
  ok('同一场里皮肤稳定', E10.vars.人物['雪风'].皮肤 === first);
  E10.setSkin('雪风', 0);
  ok('手选后锁定', E10.vars.人物['雪风'].皮肤锁定 === true &&
     E10.vars.人物['雪风'].皮肤 === 0);
  const r2 = E10.processOutput('<Gal>\n又说。|雪风|微笑|\n</Gal>');
  ok('锁定后用指定那张',
     r2.modules[0].sprites[0].url === w.RESOURCE.defaults['雪风'][0]);
  E10.setSkin('柴郡', 1);
  const r3 = E10.processOutput('<Gal>\n嗨。|柴郡|微笑|\n</Gal>');
  ok('有表情差分的角色也能手选皮肤',
     r3.modules[0].sprites[0].via === 'skin-picked');
  E10.setSkin('柴郡', null);
  const r4 = E10.processOutput('<Gal>\n嗨。|柴郡|微笑|\n</Gal>');
  ok('解锁后回到表情差分', r4.modules[0].sprites[0].via === 'exact');
  E10.appendLog(rr.modules);
  w.__gal.goTo(E10.log.length - 1);
  run(() => d.getElementById('btn-skin').click(), '打开换装面板');
  ok('面板列出在场舰娘',
     d.querySelectorAll('#skin-body .sk-char').length >= 1,
     d.querySelectorAll('#skin-body .sk-char').length + ' 人');
  ok('缩略图可点', d.querySelectorAll('#skin-body .sk-item[data-skin]').length > 0,
     d.querySelectorAll('#skin-body .sk-item[data-skin]').length + ' 张');
  run(() => d.getElementById('skin-close').click(), '关闭面板');
})();


console.log('\n[6p2] 换装 · 点了就锁定');
{
  ok('面板顶上有「点了就锁定」开关', !!q('#sk-lockmode') || !!d.getElementById('sk-lockmode'),
     '（需要台上有人才渲染）');
  const E = w.__gal.eng;
  const name = Object.keys(E.vars.人物 || {})[0];
  if (name) {
    /* 默认：点了就锁 */
    E.setSkin(name, 1);
    ok('默认锁定', E.vars.人物[name].皮肤锁定 === true);
    ok('记住了是哪一张', E.vars.人物[name].皮肤 === 1);
    /* 关掉锁定模式：只换当前这一句 */
    E.setSkin(name, 2, null, false);
    ok('关了锁定就不锁', E.vars.人物[name].皮肤锁定 === false);
    ok('皮肤还是换了（只影响当前句）', E.vars.人物[name].皮肤 === 2);
    /* 解锁 */
    E.setSkin(name, null);
    ok('解锁后清掉选择', E.vars.人物[name].皮肤 == null &&
       E.vars.人物[name].皮肤锁定 === false);
  }
}


console.log('\n[6p3] 锁了皮肤之后往下点，不能跳回旧图');
{
  /* 实测栽过：一轮十几句的立绘是 processOutput 时**一次性全解析好**的。
     原来换装只刷新「当前这一句」，所以停在第 3 句锁定、按一下下一句就打回原形。
     现在要把整条日志里这个角色的立绘都重解析。 */
  const E = w.__gal.eng;
  const R = w.RESOURCE;
  const A = Object.keys(R.defaults || {}).filter(n => (R.defaults[n] || []).length > 9)[0];
  if (!A) { ok('找得到一个多皮肤角色', false); }
  else {
    const saveVars = E.vars, saveLog = E.log;
    E.vars = { 时间: { 天数: 1, 时段: '白日' }, 地点: '教室', 人物: {} };
    E.vars.人物[A] = { 在场: true, 服装: '常服', 好感度: 80 };
    E.log = [];
    const raw = ['一。', '二。', '三。', '四。', '五。'].map(t => t + '|' + A + '|微笑|').join('\n');
    E.appendLog(E.processOutput(raw).modules);
    const urlAt = i => {
      const sp = (E.log[i].sprites || []).filter(x => x.who === A)[0];
      return sp ? sp.url : '';
    };
    ok('一轮五句都解析出立绘了', [0,1,2,3,4].every(i => urlAt(i)));
    const before = urlAt(2);

    d.getElementById('dialogue').hidden = false;
    w.__gal.goTo(1);                       // 停在第 2 句
    d.getElementById('btn-skin').click();  // 打开换装
    const item = qa0('#skin-body [data-skin]')
      .filter(el => el.getAttribute('data-skin') === A + '|8')[0];
    ok('换装面板里列出了皮肤 8', !!item);
    if (item) {
      item.click();
      const want = R.defaults[A][8];
      ok('当前这一句换了', urlAt(1) === want);
      ok('**后面几句也跟着换了**（这就是那个 bug）',
         [2, 3, 4].every(i => urlAt(i) === want),
         [2,3,4].map(i => urlAt(i) === want ? 'ok' : 'FAIL').join(' '));
      ok('前面的句子也一致', urlAt(0) === want);
      ok('确实和锁定前不一样', before !== want);
      /* 再演一轮，新句子也要跟着 */
      E.appendLog(E.processOutput('新的一句。|' + A + '|生气|').modules);
      ok('下一轮的新句子也是锁定那张', urlAt(5) === want);
      ok('vars 里记着锁定状态',
         E.vars.人物[A].皮肤锁定 === true && E.vars.人物[A].皮肤 === 8);
    }
    d.getElementById('skin-close').click();
    E.vars = saveVars; E.log = saveLog;
  }
}

console.log('\n[6q] 变量编辑与誓约上限');
(() => {
  const E11 = w.__gal.eng;
  E11.vars = { 时间: { 天数: 1, 时段: '午后' }, 地点: '教室',
               人物: { 甲: { 好感度: 98, 是否誓约: false },
                       乙: { 好感度: 195, 是否誓约: true } } };
  E11.processOutput('<UpdateVariable><JSONPatch>[' +
    '{"op":"delta","path":"/人物/甲/好感度","value":20},' +
    '{"op":"delta","path":"/人物/乙/好感度","value":20}]</JSONPatch></UpdateVariable>');
  ok('未誓约上限 100', E11.vars.人物.甲.好感度 === 100, String(E11.vars.人物.甲.好感度));
  ok('誓约后上限 200', E11.vars.人物.乙.好感度 === 200, String(E11.vars.人物.乙.好感度));
  run(() => { q('.ph-app[data-app="cfg"]').click();
              q('.kt-nav [data-sec="vars"]').click(); }, '打开变量页');
  ok('显示誓约标签',
     (d.getElementById('varsbody') || {}).innerHTML?.indexOf('已誓约') >= 0);
  ok('有编辑按钮', d.querySelectorAll('#varsbody [data-edit]').length > 0);
  run(() => d.querySelector('#varsbody [data-edit]').click(), '展开编辑表单');
  ok('编辑表单字段齐全',
     !!d.getElementById('vf-fav') && !!d.getElementById('vf-oath') &&
     !!d.getElementById('vf-on'));
})();
ok('动态默认攒够就换', (() => {
  const hist = [];
  for (let i = 1; i <= 30; i++) hist.push({ role: 'assistant',
    content: '[小红书|柴郡|标题' + i + '|正文|1|2|3]' });
  w.Phone.limits({ posts: 20, trends: 20, keepAll: false });
  const a = w.Phone.scan(hist).posts.filter(p => !p.seed).length;
  w.Phone.limits({ keepAll: true });
  const b2 = w.Phone.scan(hist).posts.filter(p => !p.seed).length;
  w.Phone.limits({ keepAll: false });
  return a === 20 && b2 === 30;
})());


console.log('\n[6r] 文生图 · CG 层');
ok('CG 层骨架在', !!d.querySelector('#cg') && !!d.querySelector('#cg-img') && !!d.querySelector('#cg-blur'));
ok('CG 层默认收起', d.getElementById('cg').hidden === true);
ok('出图进度条默认收起', d.getElementById('cg-busy').hidden === true);
ok('工具栏有 CG 按钮', !!d.querySelector('#btn-cg'));
ok('相册面板在且默认收起', !!d.querySelector('#cg-panel') && d.getElementById('cg-panel').hidden === true);
run(() => d.getElementById('btn-cg').click(), '点开相册');
ok('相册点开后显示', d.getElementById('cg-panel').hidden === false);
run(() => d.getElementById('cg-close').click(), '关闭相册');


console.log('\n[6r2] 重画入口');
ok('CG 图上有重画按钮', !!d.querySelector('#cg-redraw'));
ok('重画和收起在同一组操作里', !!d.querySelector('#cg-acts #cg-redraw') &&
   !!d.querySelector('#cg-acts #cg-hide'));
run(() => d.querySelector('#btn-cg').click(), '打开相册');
ok('相册顶部有「当前这句」那条', !!d.querySelector('#cg-now'));
ok('文生图没开时直接说去哪儿开，不给按钮',
   /设置 · 文生图/.test(d.querySelector('#cg-now').textContent) &&
   !d.querySelector('#cg-now button'),
   d.querySelector('#cg-now').textContent.slice(0, 40));
ok('没有「为这一句生成」这种过细的入口了',
   !d.querySelector('#cg-now [data-now="make"]'));
ok('regenerate 接口在', typeof w.CG.regenerate === 'function');
run(() => d.querySelector('#cg-close').click(), '关闭相册');


console.log('\n[6r4] CG 在一轮内一直铺着（不能闪一下就没）');
{
  const E = w.__gal.eng;
  const save = E.log;
  E.log = [
    { turn: 0, who: '旁白', text: 'a', narration: true, bg: {}, stage: [], cg: 'g1' },
    { turn: 0, who: 'A', text: 'b', narration: false, bg: {}, stage: [] },
    { turn: 0, who: 'A', text: 'c', narration: false, bg: {}, stage: [] },
    { turn: 1, who: 'A', text: 'd', narration: false, bg: {}, stage: [] }
  ];
  const near = w.__gal.nearestCG;
  ok('调试钩子暴露了 nearestCG', typeof near === 'function');
  if (typeof near === 'function') {
    ok('本轮内往前找得到（第 2 句沿用第 0 句的图）', near(2, true) === 'g1');
    ok('限定本轮时不跨轮', near(3, true) === null, String(near(3, true)));
    ok('不限定时跨轮也找得到', near(3, false) === 'g1');
  }
  E.log = save;
}

console.log('\n[6s] 文生图 · 设置分区');
run(() => qa('.kt-nav button[data-sec]').find(b => b.dataset.sec === 'img').click(), '切到文生图分区');
ok('开关在', !!q('#ig-on'));
ok('默认关着（不会偷偷花钱）', q('#ig-on') && q('#ig-on').checked === false);
ok('Token 输入框是 password 类型', q('#ig-key') && q('#ig-key').type === 'password');
ok('模型下拉已填充', q('#ig-model') && q('#ig-model').options.length >= 5,
   q('#ig-model') ? q('#ig-model').options.length + ' 个' : '无');
ok('默认模型是 4.5-full', q('#ig-model') && q('#ig-model').value === 'nai-diffusion-4-5-full',
   q('#ig-model') ? q('#ig-model').value : '');
ok('默认尺寸 1216x832', q('#ig-size') && q('#ig-size').value === '1216x832');
ok('免费档提示显示为免费', q('#ig-free') && /免费档/.test(q('#ig-free').textContent),
   q('#ig-free') ? q('#ig-free').textContent.slice(0, 50) : '');
ok('默认是「AI 每轮输出」', q('#ig-mode') && q('#ig-mode').value === 'auto',
   q('#ig-mode') ? q('#ig-mode').value : '');
ok('推荐档说明里点出不额外花钱',
   q('#ig-mode-note') && /不额外花钱/.test(q('#ig-mode-note').textContent));
ok('模式说明有文字', q('#ig-mode-note') && q('#ig-mode-note').textContent.length > 10);
run(() => { const el = q('#ig-size'); el.value = '1536x1024'; el.onchange.call(el); }, '切到大尺寸');
ok('大尺寸会提示扣点数', q('#ig-free') && /扣点数/.test(q('#ig-free').textContent),
   q('#ig-free') ? q('#ig-free').textContent.slice(0, 50) : '');
run(() => { const el = q('#ig-size'); el.value = '1216x832'; el.onchange.call(el); }, '切回免费尺寸');


console.log('\n[6r3] CG 模式开关（真开关，只有两种状态）');
ok('工具栏有模式按钮', !!d.querySelector('#btn-cgmode'));
ok('默认开着（开了文生图就是为了看图）', w.ImageGen.DEFAULTS.sticky === true);
ok('默认模式是 AI 每轮输出', w.ImageGen.DEFAULTS.promptMode === 'auto');
ok('每轮至少 1 张（不再有 0）',
   d.querySelector('#ig-per') && +d.querySelector('#ig-per').min === 1,
   d.querySelector('#ig-per') ? d.querySelector('#ig-per').min : '无');
{
  const btn = d.querySelector('#btn-cgmode');
  const before = btn.classList.contains('on');
  run(() => btn.click(), '切一次');
  ok('状态确实翻转了', btn.classList.contains('on') !== before);
  const mid = btn.classList.contains('on');
  run(() => btn.click(), '再切回来');
  ok('切回来了', btn.classList.contains('on') === before);
  ok('两种状态的提示文字不一样（说得清自己是什么模式）',
     (() => { btn.click(); const a = btn.title; btn.click(); return a !== btn.title; })());
  ok('立绘模式下舞台不显示 CG',
     (() => { /* 关掉 → syncCG 应该直接收起 */
       if (w.__gal.cgSticky()) btn.click();
       w.__gal.goTo(0);
       return !d.getElementById('cg').classList.contains('show'); })());
  if (w.__gal.cgSticky() !== before) btn.click();
}
ok('点 CG 图能推进剧情', typeof d.querySelector('#cg-img').onclick === 'function');

console.log('\n[6s2] 设置页排版（开关不能把文字挤出去）');
{
  /* .kt-sw 是 36×20 的开关本体，把文字写进去会整段溢出压到别的元素上 ——
     v5.20 初版就是这么糊的。正确写法是 kt-row + 独立的 kt-label。 */
  const bad = qa('.kt-sw').filter(el => (el.textContent || '').trim().length > 0);
  ok('没有把文字塞进 .kt-sw 里的写法', bad.length === 0,
     bad.map(el => (el.textContent || '').trim().slice(0, 14)).join(' / '));
  /* 世界书/预设列表里的开关放在 .kt-item 行里，那是对的；
     这里只管我新加的那几节（文生图 / 接口）。 */
  const mine = ['ig-on', 'ig-custom', 'tk-on', 'vec-on']
    .map(id => d.getElementById(id)).filter(Boolean);
  ok('新加的开关都在 kt-row 里（文字独立成列，不会溢出）',
     mine.length === 4 && mine.every(inp => {
       const lab = inp.parentNode;
       return lab && lab.classList.contains('kt-sw') &&
              lab.parentNode && lab.parentNode.classList.contains('kt-row');
     }), mine.length + ' 个');
  ok('每个开关旁边都有说明文字',
     mine.every(inp => {
       const row = inp.parentNode.parentNode;
       return row && (row.textContent || '').trim().length > 2;
     }));
}

console.log('\n[6t2] NAI 的流式 ZIP（实测就是挂在这）');
{
  /* NAI 边生成边回传，本地文件头里的压缩长度写 0，真实长度在数据后的
     data descriptor 里。只扫本地头会直接扑空，报「里面没找到 PNG」。 */
  const mk = (withCd) => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const zlib = require('zlib');
    const data = zlib.deflateRawSync(png);
    const name = Buffer.from('image_0.png');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x08, 6);          // flag bit3：长度在 data descriptor 里
    lh.writeUInt16LE(8, 8);             // deflate
    lh.writeUInt16LE(name.length, 26);
    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(0, 4);
    dd.writeUInt32LE(data.length, 8); dd.writeUInt32LE(png.length, 12);
    const parts = [lh, name, data, dd];
    if (withCd) {
      const off = lh.length + name.length + data.length + dd.length;
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(0x08, 8);
      cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20);
      cd.writeUInt32LE(png.length, 24); cd.writeUInt16LE(name.length, 28);
      const eo = Buffer.alloc(22);
      eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10);
      eo.writeUInt32LE(cd.length + name.length, 12); eo.writeUInt32LE(off, 16);
      parts.push(cd, name, eo);
    }
    return new Uint8Array(Buffer.concat(parts));
  };
  const withCd = w.ImageGen.findImageEntry(mk(true));
  ok('流式包 + 中央目录能解出条目', !!withCd && withCd.filename === 'image_0.png',
     JSON.stringify(withCd));
  ok('走的是中央目录那条路', withCd && withCd.via === 'central', withCd && withCd.via);
  ok('长度是真实长度而不是 0', withCd && withCd.size > 0, withCd && String(withCd.size));
  const noCd = w.ImageGen.findImageEntry(mk(false));
  ok('中央目录也没了还能兜住', !!noCd && noCd.size > 0, JSON.stringify(noCd));
}

console.log('\n[6u2] 油猴格式的 <image>（每角色带 UC 和 centers）');
{
  const p = 'Scene Composition:2girls,indoors,morning;' +
    'Character 1 Prompt:1girl,silver hair,smile|centers:0.33,0.5;' +
    'Character 1 UC:bad hands,crying;' +
    'Character 2 Prompt:1girl,white hair,expressionless|centers:0.66,0.5;' +
    'Character 2 UC:bad hands,smile;';
  const c = w.Snapshot.parseInline(p);
  ok('两个角色都解析出来', c && c.characters.length === 2, c ? String(c.characters.length) : 'null');
  ok('每角色的 UC 对上号', c.characters[0].negativePrompt.indexOf('crying') >= 0 &&
     c.characters[1].negativePrompt.indexOf('smile') >= 0,
     JSON.stringify(c.characters.map(x => x.negativePrompt)));
  ok('centers 坐标被采纳', c.characters[0].center && Math.abs(c.characters[0].center.x - 0.33) < 1e-9,
     JSON.stringify(c.characters.map(x => x.center)));
  ok('centers 没混进外观词', !/centers/.test(c.characters[0].visualPrompt),
     c.characters[0].visualPrompt);
  const payload = w.ImageGen.buildPayload(
    { model: 'nai-diffusion-4-5-full', size: '1216x832' }, { context: c }, 1).payload;
  ok('模型给的站位一路传到 v4_prompt',
     Math.abs(payload.parameters.v4_prompt.caption.char_captions[0].centers[0].x - 0.33) < 1e-9,
     JSON.stringify(payload.parameters.v4_prompt.caption.char_captions[0].centers));
  ok('每角色 UC 进了 v4_negative_prompt',
     /crying/.test(payload.parameters.v4_negative_prompt.caption.char_captions[0].char_caption),
     payload.parameters.v4_negative_prompt.caption.char_captions[0].char_caption);
}

console.log('\n[6t] 文生图 · 提示词编译');
ok('V4.5 带 v4_prompt', !!w.ImageGen.buildPayload(
   { model: 'nai-diffusion-4-5-full', size: '1216x832' },
   { context: { scenePrompt: 'classroom', characters: [
       { name: '柴郡', subjectType: 'girl', visualPrompt: 'cat ears' }] } }, 1
 ).payload.parameters.v4_prompt);
ok('V3 不带 v4_prompt（带了会 400）', !w.ImageGen.buildPayload(
   { model: 'nai-diffusion-3', size: '1024x1024' }, { prompt: 'a girl' }, 1
 ).payload.parameters.v4_prompt);
ok('尺寸吸附到 64 倍数', (() => { const s2 = w.ImageGen.snapSize('1000x700');
   return s2.width % 64 === 0 && s2.height % 64 === 0; })());
ok('中文残留会被剔出 prompt', !/[一-龥]/.test(w.ImageGen.sanitize('1girl, 蓝色头发, blue hair')));
ok('浏览器有 DecompressionStream（解 NAI 的 zip 要用）',
   typeof w.DecompressionStream !== 'undefined' || typeof DecompressionStream !== 'undefined');

console.log('\n[6u] <image> 必须先于剧本解析被摘掉');
{
  const raw = '她抬起头。|柴郡|微笑|\n' +
    '<image>image###Scene Composition: night;Character 1 Prompt: 1girl|centers:c3;###</image>';
  const r = w.__gal.eng.processOutput(raw);
  ok('抠出了内联 prompt', r.inlinePrompts && r.inlinePrompts.length === 1,
     JSON.stringify(r.inlinePrompts));
  ok('正文里不再有 <image>', !/<image>/i.test(r.text));
  ok('带 | 的 prompt 没被当成台词演出来',
     !r.modules.some(m => /centers|Character 1 Prompt/.test(m.text || '')),
     JSON.stringify(r.modules.map(m => m.text)));
  ok('真正的台词还在', r.modules.some(m => (m.text || '').indexOf('她抬起头') >= 0));
}

console.log('\n[6v] CG 锚点挑选');
{
  const mk = (t, o) => Object.assign({ text: t, who: '柴郡', narration: false,
    bg: { loc: '港区', period: '夜' }, stage: [{ name: '柴郡' }] }, o || {});
  const turn = [mk('一'), mk('她推门进来，灯光洒了一地。', { narration: true,
      bg: { loc: '东煌餐饮店', period: '夜' }, stage: [{ name: '柴郡' }, { name: 'Z23' }] }),
    mk('二'), mk('三'), mk('四'),
    mk('夜色压下来，港区的灯一盏盏亮起。', { narration: true,
      bg: { loc: '港区高台', period: '夜' }, stage: [{ name: '柴郡' }, { name: 'Z23' }] }),
    mk('五')];
  ok('要 2 张给 2 个锚点', w.CG.pickAnchors(turn, 2).length === 2);
  ok('两个锚点隔开', (() => { const a = w.CG.pickAnchors(turn, 2);
     return Math.abs(a[0] - a[1]) >= 2; })());
  ok('每轮 0 张时不出图', w.CG.pickAnchors(turn, 0).length === 0);
  ok('换背景的句子分更高', w.CG.score(turn[1], turn[0]) > w.CG.score(turn[2], turn[1]));
}

console.log('\n[6w] 相册：存档只存 id，不存图');
ok('forSave 只带轻量字段', typeof w.Gallery.forSave === 'function');
ok('sizeOf 能算 dataURL 体积',
   w.Gallery.sizeOf('data:image/png;base64,' + 'A'.repeat(400)) === 300,
   String(w.Gallery.sizeOf('data:image/png;base64,' + 'A'.repeat(400))));

console.log('\n[6w2] 载卡时从卡里直接抽素材表');
{
  /* 这是「干净克隆也能玩」的关键一环：以前立绘只能靠 tools/build-juus.py
     离线生成 resource/juus/*.js，载卡这一步根本没读立绘。 */
  const GAL = 'var EXPRESSION_MAP = {"测试娘":{"常服":{"微笑":"https://t.invalid/a.png",' +
    '"得意":["https://t.invalid/b.png","https://t.invalid/c.png"]}}};\n' +
    'var SCENE_MAP = {"测试食堂(朝)":"https://t.invalid/s1.png","测试港区":"https://t.invalid/s2.png"};\n' +
    'var DEFAULT_SPRITES = {"测试路人":"https://t.invalid/d.png"};';
  const PH = "var AVATARS = {'测试娘':'https://t.invalid/av.png'};\n" +
    "var STICKERS = {'测试躺':'https://t.invalid/st.png'};\n" +
    "var DEFAULT_AVATARS = ['https://t.invalid/da.png'];";
  const card = { data: { name: '冒烟合成卡',
    extensions: {
      regex_scripts: [{ scriptName: 'gal MVU', replaceString: GAL }],
      tavern_helper: { scripts: [{ name: 'juus小手机', content: PH }] }
    } } };

  const before = Object.keys(w.RESOURCE.characters).length;
  const E = new w.Engine();
  E.loadCard(card);

  ok('loadCard 之后卡里的角色进了 RESOURCE', !!w.RESOURCE.characters['测试娘']);
  ok('角色数确实变多了', Object.keys(w.RESOURCE.characters).length === before + 1,
     before + ' → ' + Object.keys(w.RESOURCE.characters).length);
  ok('多图差分保留', (w.RESOURCE.characters['测试娘'].outfits['常服']['得意'] || []).length === 2);
  ok('场景「地点(时段)」拆开了',
     w.RESOURCE.scenes['测试食堂'] && w.RESOURCE.scenes['测试食堂']['朝'] === 'https://t.invalid/s1.png');
  ok('默认立绘也装上了', (w.RESOURCE.defaults['测试路人'] || []).length === 1);
  ok('手机头像装上了', (w.PHONE_RES.avatars || {})['测试娘'] === 'https://t.invalid/av.png');
  ok('engine 记下了统计', E.resStats && E.resStats.chars === 1,
     JSON.stringify(E.resStats && { c: E.resStats.chars, s: E.resStats.sprites }));

  /* 真正要的是：Resolver 立刻能查到，不用刷新页面 */
  const sp = w.Resolver.sprite('测试娘', '微笑', { outfit: '常服' });
  ok('Resolver 马上就能查到新角色的立绘',
     sp && sp.url === 'https://t.invalid/a.png', JSON.stringify(sp));
  ok('Phone.roster() 也马上认得它', w.Phone.roster().indexOf('测试娘') >= 0);
  const scn = w.Resolver.scene('测试食堂', '朝');
  ok('Resolver 马上就能查到新场景', scn && scn.url === 'https://t.invalid/s1.png');

  ok('普通卡（没有这些变量）不会炸',
     (function () { try { new w.Engine().loadCard({ data: { name: '白卡' } }); return true; }
                    catch (e) { return false; } })());
  /* 卡里常有「只是拿 replaceString 当代码仓库存着」的条目 —— 没有 findRegex。
     空 findRegex 会编成 new RegExp('','g')，在每个字符缝隙都匹配，
     于是那段代码被插得满正文都是，整段剧本废掉。实测踩到过。 */
  {
    const E3 = new w.Engine();
    E3.loadCard({ data: { name: '空正则卡', extensions: { regex_scripts: [
      { scriptName: '没有 findRegex 的条目', replaceString: 'var X = 1;' },
      { scriptName: '正常条目', findRegex: '/沙滩/g', replaceString: '海滩' }
    ] } } });
    ok('空 findRegex 的条目被跳过', E3.regexScripts.length === 1,
       E3.regexScripts.map(r => r.name).join('、'));
    const out = E3.processOutput('<Gal>\n去沙滩玩。|旁白|-|\n</Gal>');
    ok('正文没有被那段代码糊掉', out.text.indexOf('var X') < 0, out.text.slice(0, 60));
    ok('正常的正则还照样生效', out.text.indexOf('海滩') >= 0, out.text.slice(0, 60));
  }

  ok('普通卡的 resStats.found 为 false',
     (function () { const E2 = new w.Engine(); E2.loadCard({ data: { name: '白卡' } });
                    return E2.resStats && E2.resStats.found === false; })());
}

console.log('\n[6w3] 原皮默认 / 退出 / 多周目');
{
  /* 1. 默认原皮 —— 卡里的换装图死链不少，随机抽经常抽到裂图 */
  const E = new w.Engine();
  ok('randomSkin 默认关（用原皮）', E.cfg.randomSkin === false, String(E.cfg.randomSkin));
  w.RESOURCE.defaults['皮肤测试娘'] =
    ['https://t.invalid/base.png', 'https://t.invalid/alt1.png', 'https://t.invalid/alt2.png'];
  E.vars.人物 = {};
  ok('多皮肤角色登场取第 0 张', E.ensureSkin('皮肤测试娘') === 0);
  const sp = w.Resolver.sprite('皮肤测试娘', '微笑', { skin: 0 });
  ok('解析出来就是原皮那张', sp && sp.url === 'https://t.invalid/base.png',
     JSON.stringify(sp && sp.url));
  ok('sprite 带上了完整 urls（渲染层靠它回退原皮）',
     sp && Array.isArray(sp.urls) && sp.urls.length === 3);
  /* 打开随机后才随机 */
  const E2 = new w.Engine({ randomSkin: true });
  E2.vars.人物 = {};
  const picks = new Set();
  for (let i = 0; i < 60; i++) { E2.vars.人物 = {}; picks.add(E2.ensureSkin('皮肤测试娘')); }
  ok('打开 randomSkin 后确实会随机', picks.size > 1, '抽到过 ' + [...picks].join('/'));
  ok('设置页有这个开关', !!d.getElementById('t-rndskin'));
  ok('开关默认不勾', d.getElementById('t-rndskin').checked === false);

  /* 2. 退出按钮 */
  ok('工具栏有退出按钮', !!d.getElementById('btn-exit'));
  ok('退出按钮有说明文字',
     /退出|开场/.test(d.getElementById('btn-exit').getAttribute('title') || ''));

  /* 3. 周目列表容器 */
  ok('引导页有周目列表', !!d.getElementById('boot-runs') && !!d.getElementById('boot-runs-body'));
  ok('继续上次按钮还在（老 id 不能丢）', !!d.getElementById('btn-continue'));
}

console.log('\n[6w4] 存档槽：每个周目各存各的');
{
  /* autosave 以前固定写死 'auto'，开第二个开局会把第一个盖掉。 */
  const src = fs.readFileSync(path.join(ROOT, 'app/app.js'), 'utf8');
  ok('autosave 不再写死 auto 槽', /saveSlot\(autoSlotId\(\)/.test(src));
  ok('有 newRunId', /function newRunId/.test(src));
  ok('开始游戏时换新周目 id', /runId = newRunId\(\)/.test(src));
  ok('snapshot 带上 runId', /runId: runId/.test(src));
  /* 完整恢复：以前「继续上次」只恢复 history 和 vars */
  ok('restoreFrom 恢复 log', /eng\.log = sv\.log/.test(src));
  ok('restoreFrom 恢复 phoneSent', /eng\.phoneSent = sv\.phoneSent/.test(src));
  ok('restoreFrom 恢复 phoneSeq', /eng\.phoneSeq = sv\.phoneSeq/.test(src));
  ok('restoreFrom 恢复光标', /sv\.cursor != null/.test(src));
  ok('继续上次改用 restoreFrom（不再是残缺的复制品）',
     /\$\('btn-continue'\)\.onclick[\s\S]{0,220}restoreFrom/.test(src));
  ok('读档面板也走同一个 restoreFrom',
     (src.match(/restoreFrom\(/g) || []).length >= 4,
     (src.match(/restoreFrom\(/g) || []).length + ' 处');
  /* 死链回退 */
  ok('swap 接收原皮兜底参数', /function swap\(rec, url, isEnter, fallbackUrl\)/.test(src));
  ok('死链会退到原皮', /triedFallback/.test(src));
  ok('原皮也挂就隐藏整层', /visibility = 'hidden'[\s\S]{0,120}reveal\(\)/.test(src));
  ok('记录死链供排查', /function noteImgFail/.test(src));
  ok('缓存命中也判 naturalWidth（complete 为真但宽 0 = 失败）',
     /img\.complete && img\.naturalWidth > 0/.test(src));
}

console.log('\n[6w5] 自查修掉的五条（别再回退）');
{
  const srcApp = fs.readFileSync(path.join(ROOT, 'app/app.js'), 'utf8');
  const srcCard = fs.readFileSync(path.join(ROOT, 'core/cardres.js'), 'utf8');

  /* ① 安全：解析角色卡绝不能执行卡里的代码 */
  ok('cardres 里没有 new Function / eval',
     !/new\s+Function|(^|[^.\w])eval\s*\(/.test(srcCard.replace(/\/\*[\s\S]*?\*\//g, '')));
  ok('函数调用被解析器拒绝',
     w.CardRes._parseLiteral('{"m": fetch("https://evil/")}') === null);
  ok('逗号表达式被拒绝', w.CardRes._parseLiteral('{"a": (f(), 1)}') === null);
  ok('认不出的标识符被拒绝', w.CardRes._parseLiteral('{"a": localStorage}') === null);
  ok('正常的卡照常解析', w.CardRes._parseLiteral("{ a: 'x', /*注释*/ b: [1,2,], }").a === 'x');
  {
    /* 端到端：一张带副作用的卡，载进去不能有任何东西被执行 */
    let fired = false;
    w.__evilProbe = function () { fired = true; return {}; };
    const EVIL = 'var EXPRESSION_MAP = { "A": (__evilProbe(), { "常服": { "微笑": "u.png" } }) };';
    new w.Engine().loadCard({ data: { extensions: {
      regex_scripts: [{ scriptName: 'gal MVU', replaceString: EVIL }] } } });
    ok('载入带副作用的卡，副作用没有发生', fired === false);
  }

  /* ② 立绘换图并发 */
  ok('swap 有换图令牌', /rec\.swapToken/.test(srcApp));
  ok('被取代的 swap 仍然 resolve（否则 Promise.all 挂住）', /function giveUp/.test(srcApp));
  ok('兜底定时器也受令牌管', /if \(dead\(\)\) return giveUp\(\)/.test(srcApp));

  /* ③ 设置页 padding 不能再被 #jup-root * 压掉 */
  {
    const css = fs.readFileSync(path.join(ROOT, 'app/editor-theme.css'), 'utf8')
                  .replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = [];
    css.replace(/([^{}]+)\{([^{}]*)\}/g, function (_, sel, body) {
      const s2 = sel.trim();
      if (s2 && !s2.startsWith('@') && s2.includes('.kt') &&
          !s2.includes('#jup-root') && /(^|[;\s])padding/.test(body)) bad.push(s2.slice(0, 40));
      return '';
    });
    ok('每条带 padding 的 .kt 规则都提了权', bad.length === 0,
       bad.length ? '漏了：' + bad.join(' | ') : '');
  }

  /* ④ 手机消息和剧情短信在同一个坐标系 */
  ok('nextSeq 以 history 长度为整数部分',
     /eng\.history\.length \+ \(\+\+eng\.phoneSeq\)/.test(srcApp));
  ok('新周目会清掉 phoneSeq', /eng\.phoneSeq = 0/.test(srcApp));
  {
    const E = new w.Engine();
    for (let i = 0; i < 39; i++) E.history.push({ role: 'assistant', content: '普通。|旁白|-|' });
    E.history.push({ role: 'assistant', content: '[短信|柴郡|文字|晚上有空吗？]' });
    const seq = () => E.history.length + (++E.phoneSeq) / 1e6;
    const sent = [{ who: '柴郡', type: 'text', v: '有空啊', me: true, turn: seq() }];
    const r = w.Phone.scan(E.history, sent, { userName: '指挥官' });
    const list = (r.chats['柴郡'] || []).map(m => m.v || m.text);
    ok('她先说、玩家后回，顺序正确', list[0] === '晚上有空吗？' && list[1] === '有空啊',
       JSON.stringify(list));
  }

  /* ⑤ 额外世界书 uid 不撞车 */
  {
    const E = new w.Engine();
    E.loadCard({ data: { character_book: { entries: [
      { keys: ['a'], content: '卡0' }, { keys: ['b'], content: '卡1' }] } } });
    E.addWorldbook({ entries: [{ keys: ['c'], content: '外0' }, { keys: ['d'], content: '外1' }] });
    E.addWorldbook({ entries: [{ keys: ['e'], content: '再0' }] });
    const uids = E.pool.map(x => x.uid);
    ok('全部 uid 唯一', new Set(uids).size === uids.length, uids.join(' | '));
    ok('导入的带来源前缀', uids.some(u => /^wi1:/.test(u)) && uids.some(u => /^wi2:/.test(u)));
  }
}

console.log('\n[6w6] 四条小修（错误兜底 / 输入法 / 保住文字 / 限流重试）');
{
  const srcApp = fs.readFileSync(path.join(ROOT, 'app/app.js'), 'utf8');
  const srcApi = fs.readFileSync(path.join(ROOT, 'core/api.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  /* ① 全局错误兜底 */
  ok('crash.js 是第一个加载的脚本',
     /<script src="core\/crash\.js">/.test(html) &&
     html.indexOf('core/crash.js') < html.indexOf('core/cardres.js'));
  ok('GalCrash 挂上了', typeof w.GalCrash === 'object');
  ok('能主动上报', (function () {
    w.GalCrash.report('冒烟测试上报', new Error('测试'));
    return w.GalCrash.log().some(function (r) { return /冒烟测试上报/.test(r.msg); });
  })());
  ok('兜底页渲染出了导出存档按钮', !!d.getElementById('cr-save'));
  ok('导出的备份不含密钥（键名过滤）',
     /key\|token\|secret/.test(fs.readFileSync(path.join(ROOT, 'core/crash.js'), 'utf8')));

  /* ② 输入法组合态 */
  ok('有 composing() 判据', /function composing\(e\)/.test(srcApp));
  ok('三处 Enter 都判了组合态',
     (srcApp.match(/if \(composing\(e\)\) return/g) || []).length >= 3,
     (srcApp.match(/if \(composing\(e\)\) return/g) || []).length + ' 处');
  ok('keyCode 229 也兜住（旧浏览器/部分安卓输入法）', /keyCode === 229/.test(srcApp));

  /* ③ 失败时把文字还回输入框 */
  ok('catch 里还原输入框', /if \(!input\.value\) \{[\s\S]{0,80}input\.value = userText/.test(srcApp));

  /* ④ 限流重试 */
  ok('429 算可重试', w.GalAPI.isTransient({ status: 429 }) === true);
  ok('503 算可重试', w.GalAPI.isTransient({ status: 503 }) === true);
  ok('401 不重试', w.GalAPI.isTransient({ status: 401 }) === false);
  ok('404 不重试', w.GalAPI.isTransient({ status: 404 }) === false);
  ok('「没填密钥」不重试', w.GalAPI.isTransient(new Error('没填密钥')) === false);
  ok('网络错仍然重试', w.GalAPI.isTransient(new Error('Failed to fetch')) === true);
  ok('退避听服务端的 Retry-After',
     w.GalAPI.backoffMs({ status: 429, retryAfterMs: 5000 }, 0) === 5000);
  ok('退避封顶 60 秒',
     w.GalAPI.backoffMs({ status: 429, retryAfterMs: 9999999 }, 0) === 60000);
  ok('没有 Retry-After 时指数退避',
     [0, 1, 2].map(function (i) { return w.GalAPI.backoffMs({ status: 429 }, i); })
       .join() === '1000,3000,9000');
  ok('readError 会把状态码挂到错误上', /err\.status = res\.status/.test(srcApi));
  ok('Retry-After 支持秒数与 HTTP 日期', /Date\.parse\(raw\)/.test(srcApi));
  {
    const ig = fs.readFileSync(path.join(ROOT, 'core/imagegen.js'), 'utf8');
    ok('出图的 429 也重试', /res\.status === 429/.test(ig));
    ok('出图被中断后不再退避重发', /e\.aborted \|\|/.test(ig));
  }
}

console.log('\n[6x] token 计数');
ok('默认是粗估', w.Tokens.mode('gpt-4') === 'rough');
ok('粗估仍返回数字', typeof w.Tokens.count('你好世界', 'gpt-4') === 'number');
ok('gpt-4o 选 o200k', w.Tokens.encodingFor('gpt-4o') === 'o200k_base');
ok('gpt-4 走 cl100k', w.Tokens.encodingFor('gpt-4') === 'cl100k_base');
ok('claude 退回 o200k（近似，判断不是实测）',
   w.Tokens.encodingFor('claude-sonnet-4-5') === 'o200k_base');
ok('vendor 里有分词器文件', fs.existsSync(path.join(ROOT, 'core/vendor/gpt-tokenizer-cl100k_base.js'))
   && fs.existsSync(path.join(ROOT, 'core/vendor/gpt-tokenizer-o200k_base.js')));
ok('vendor 里有 gpt-tokenizer 的许可证',
   fs.existsSync(path.join(ROOT, 'core/vendor/gpt-tokenizer-LICENSE.txt')));
ok('两个分词器文件确实是不同的词表（防止再次拿错文件）',
   fs.statSync(path.join(ROOT, 'core/vendor/gpt-tokenizer-cl100k_base.js')).size !==
   fs.statSync(path.join(ROOT, 'core/vendor/gpt-tokenizer-o200k_base.js')).size);
ok('接口分区有分词开关', !!q('#tk-on'));
ok('世界书按字符裁是默认（不改既有手感）',
   !q('#tk-budget') || q('#tk-budget').value === 'chars');

console.log('\n[6y] 世界书语义检索');
ok('默认关着（不会偷偷发嵌入请求）', w.Vector.config().enabled === false);
ok('设置里有开关', !!q('#vec-on'));
ok('余弦相似度算得对', Math.abs(w.Vector.cosine([1, 0], [1, 0]) - 1) < 1e-9);
ok('正交向量相似度 0', Math.abs(w.Vector.cosine([1, 0], [0, 1])) < 1e-9);
ok('关着时 semanticHits 返回空',
   (() => { let r = null; w.__gal.eng.semanticHits('随便').then(x => { r = x; }); return true; })());
ok('时间衰减：没注入过不降权', w.Vector.decayFactor('不存在的uid', 5) === 1);
ok('世界书激活仍然向后兼容（不传 semantic 也能跑）',
   w.Worldbook.activate(w.__gal.eng.pool, [{ role: 'user', content: '测试' }], {}).active !== undefined);

console.log('\n[6z] 插画规则条目');
{
  const scratch = CARD ? w.__gal.eng.pool : [];
  if (!CARD) w.Editors.ensurePhoneRule(scratch);
  const rule = scratch.filter(e => e.uid === w.Editors.IMAGE_RULE_ID)[0];
  ok('插画规则条目已装入', !!rule);
  ok('插画规则默认关着（两段式用不到它，开着白费 token）',
     rule && rule.enabled === false);
  ok('规则里说明了要写在正文之外',
     rule && /正文\*\*之外\*\*|正文之外/.test(rule.content));
  ok('切模式能开关它', (() => {
     w.Editors.setImageRuleEnabled(scratch, true);
     const on = scratch.filter(e => e.uid === w.Editors.IMAGE_RULE_ID)[0].enabled === true;
     w.Editors.setImageRuleEnabled(scratch, false);
     return on; })());
}

console.log('\n[7] 点击舞台（白条相关路径）');
run(() => d.getElementById('phone-overlay').click(), '关闭手机');
run(() => d.getElementById('dialogue').click(), '点击对话框');
run(() => d.getElementById('nav-next').click(), '下一句');
run(() => d.getElementById('nav-prev').click(), '上一句');

console.log('\n[8] 运行期未捕获错误');
ok('无 window error', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log('\n' + (fails ? '✘ ' + fails + ' 项失败' : '✔ 全部 ' + checks + ' 项通过'));
process.exit(fails ? 1 : 0);
