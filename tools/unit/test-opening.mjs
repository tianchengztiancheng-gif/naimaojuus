/* 自定义开场（core/opening.js）+ 小手机单独环境（Engine.mainPool / phoneEnvPrompt / phoneEnvTick）+ 副 API 配置（v5.25） */
import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);

const store = {};
const sb = { console, setTimeout, clearTimeout, AbortController, TextDecoder, Date, Math, JSON, Uint32Array,
  crypto: globalThis.crypto,
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } };
sb.window = sb;
sb.RESOURCE = {
  characters: { 甲: { default_outfit: '常服', outfits: { 常服: { 微笑: ['a'], 害羞: ['b'] }, 泳装: { 微笑: ['c'] } } } },
  defaults: { 甲: ['a'], 乙: ['d'], 丙: ['e'] },
  scenes: { 食堂: { 夜: 'bg1' }, 指挥官办公室: { 朝: 'bg2', 夜: 'bg3' } }
};
vm.createContext(sb);
for (const f of ['regex', 'worldbook', 'prompt', 'script', 'resolver', 'phone', 'engine', 'api', 'editors', 'opening'])
  vm.runInContext(fs.readFileSync(P('core', f + '.js'), 'utf8'), sb);
const { Opening: O, Engine, GalAPI: A, Editors: E, ScriptParser: SP } = sb;

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));
const J = x => JSON.stringify(x);

console.log('\n[1] 规整输入');
{
  const s = O.normalize({ cast: [{ name: '甲', favor: 180 }, { name: '甲' }, { name: '乙', favor: 180, oath: true }, { name: '' }] });
  ok('默认：新指挥官、办公室以外按场景表第一个、第 1 天、AI 写开场', s.identity === 'new' && /学院/.test(s.identityText) &&
     s.loc === '食堂' && s.period === '夜' && s.day === 1 && s.aiOpening === true, J(s));
  ok('去重、去空名', s.cast.map(c => c.name).join() === '甲,乙');
  ok('没誓约好感封顶 100，誓约 200', s.cast[0].favor === 100 && s.cast[1].favor === 180);
  ok('服装默认取她的默认服装，状态默认平静', s.cast[0].outfit === '常服' && s.cast[1].outfit === '常服' && s.cast[0].state === '平静');
  const many = O.normalize({ cast: Array.from({ length: 9 }, (_, i) => ({ name: 'x' + i })) });
  ok('最多 ' + O.MAX_CAST + ' 位', many.cast.length === O.MAX_CAST);
  ok('自己写的身份不被预设盖掉', O.normalize({ identity: 'vet', identityText: '我是退役老兵' }).identityText === '我是退役老兵');
  ok('场景没有的时段退回这个场景有的', O.periodsOf('食堂').join() === '夜' && O.periodsOf('不存在').length === 5);
}

console.log('\n[2] 开局变量 + 剧本');
{
  const spec = { loc: '指挥官办公室', period: '夜', day: 3, eventTitle: '雨天', event: '外面下着雨。\n大家窝在办公室。',
    cast: [{ name: '甲', favor: 150, oath: true, outfit: '常服', state: '害羞', note: '刚和好' }, { name: '乙', favor: 20, state: '生气' }] };
  const v = O.vars(spec);
  ok('时间 / 地点', v.时间.天数 === 3 && v.时间.时段 === '夜' && v.地点 === '指挥官办公室', J(v));
  ok('每人好感 / 誓约 / 服装 / 状态 / 备注，全员在场', v.人物.甲.好感度 === 150 && v.人物.甲.是否誓约 === true &&
     v.人物.甲.当前状态 === '害羞' && v.人物.甲.内心想法 === '刚和好' && v.人物.乙.在场 && !('内心想法' in v.人物.乙), J(v.人物));
  const raw = O.script(spec);
  ok('剧本：<Gal> 包着，抬头带第几天和钟点', /^<Gal>\n『✨ 第3天 · 21:00 · 指挥官办公室 ✨』/.test(raw), raw);
  ok('剧本：背景 + 登场（状态是她有的表情就带上）', /<背景\|指挥官办公室\|夜>/.test(raw) && /<登场\|甲:害羞\|乙>/.test(raw), raw);
  ok('剧本：事件按段落变成旁白', /外面下着雨。\|旁白/.test(raw) && /大家窝在办公室。\|旁白/.test(raw));
  ok('事件里的竖线不会把格式弄坏', /a｜b/.test(O.script({ event: 'a|b' })));
  const parsed = SP.parse(raw);
  ok('剧本解析得出来：有台词行', (parsed.lines || parsed.events || []).length > 0, J(Object.keys(parsed)));
  const d = O.directive(spec);
  ok('给 AI 的开场指令：身份、时间地点、每个人的好感和状态、事件', /自定义开场/.test(d) && /第3天 · 夜 · 指挥官办公室/.test(d) &&
     /甲：好感度 150（已誓约）/.test(d) && /「害羞」/.test(d) && /刚和好/.test(d) && /雨天 —— 外面下着雨/.test(d), d);
  ok('没选人时指令里说明', /暂时没有人/.test(O.directive({})));
}

console.log('\n[3] 模板');
{
  O.saveTemplate('A', { loc: '食堂', cast: [{ name: '甲' }] });
  O.saveTemplate('B', { loc: '指挥官办公室' });
  O.saveTemplate('A', { loc: '食堂', cast: [{ name: '乙' }] });
  const t = O.templates();
  ok('同名覆盖、新的排前面', t.length === 2 && t[0].name === 'A' && t[0].spec.cast[0].name === '乙', J(t.map(x => x.name)));
  ok('没起名自动编号', /^我的开场 \d+$/.test(O.saveTemplate('', {})));
  ok('删除', O.deleteTemplate('B') === 2 && !O.templates().some(x => x.name === 'B'));
  store.gal_custom_openings = '坏掉的 JSON';
  ok('存储坏了不炸，当没有', O.templates().length === 0);
}

console.log('\n[4] 小手机单独环境');
{
  const eng = new Engine();
  eng.pool = [
    { uid: 'a', comment: '港区设定', content: '港区', constant: true, enabled: true },
    { uid: 'b', comment: '小手机输出契约', content: '[短信|…]', constant: true, enabled: true },
    { uid: 'c', comment: '表情包名单', content: '开心', constant: true, enabled: true },
    E.phoneRuleEntry()
  ];
  ok('没开：正文池原样', eng.mainPool().length === 4);
  eng.cfg.phoneIndependent = true;
  ok('打开：正文池剔掉手机契约 / 表情包名单 / 内置手机规则', eng.mainPool().map(e => e.uid).join() === 'a', eng.mainPool().map(e => e.uid).join());
  eng.vars = O.vars({ cast: [{ name: '甲', favor: 120, oath: true }, { name: '乙', favor: 30 }] });
  eng.vars.人物.丙 = { 好感度: 50, 在场: false };
  eng.log = [{ who: '甲', text: '指挥官，欢迎回来。' }, { narration: true, text: '雨还在下。' }];
  const pr = eng.phoneEnvPrompt();
  ok('提示词：独立任务、不写 <Gal>', /独立任务 · 港区手机环境/.test(pr) && /不要 <Gal>/.test(pr));
  ok('提示词：在场 / 不在场的人和好感', /在场：甲\(好感120·已誓约\)、乙\(好感30\)/.test(pr) && /不在场但认识的：丙\(好感50\)/.test(pr), pr.slice(0, 400));
  ok('提示词：刚演完的剧情', /甲：指挥官，欢迎回来。/.test(pr) && /旁白：雨还在下。/.test(pr));
  ok('提示词：带手机输出规则', /手机内容输出规则/.test(pr));
  let got = null;
  const r = await eng.phoneEnvTick({ send: async (msgs, o) => { got = { msgs, o }; return '[短信|甲|文字|在吗]\n[群聊|闲聊|乙|文字|哼]'; } });
  ok('跑一次：用传进来的通道，2 条', r.count === 2 && got && /港区手机环境/.test(got.msgs[0].content) && got.o.maxTokens === 1200);
  const last = eng.history[eng.history.length - 1];
  ok('结果进历史，标成 phoneOnly / phoneEnv', last.phoneOnly && last.phoneEnv && /在吗/.test(last.content));
  ok('正文干跑不把它当对话发回去', eng.dryRun('下一句').messages.every(m => !/\[短信\|甲\|文字\|在吗\]/.test(m.content)));
  const n0 = eng.history.length;
  const r2 = await eng.phoneEnvTick({ send: async () => '今天没什么事。' });
  ok('没有标记就不往历史里塞', r2.count === 0 && eng.history.length === n0);
}

console.log('\n[5] 副 API 配置');
{
  ok('默认没开：quietConfig 是 null', A.quietConfig() === null && !A.subReady());
  A.saveSubConfig({ enabled: true, protocol: 'openai', baseUrl: 'https://sub.api/', apiKey: 'k', model: '' });
  ok('没填模型：不算填全', !A.subReady());
  A.saveSubConfig({ enabled: true, protocol: 'openai', baseUrl: 'https://sub.api/', apiKey: 'k', model: 'm', temperature: 0.5 });
  const q = A.quietConfig();
  ok('填全：给出一份独立配置（不开流式）', A.subReady() && q && q.model === 'm' && q.stream === false && q.temperature === 0.5, J(q));
  ok('Gemini 可以不填模型', A.subReady({ enabled: true, protocol: 'gemini', baseUrl: 'x', apiKey: 'k' }));
  A.saveSubConfig({ enabled: false, protocol: 'openai', baseUrl: 'https://sub.api/', apiKey: 'k', model: 'm' });
  ok('关掉就不用', A.quietConfig() === null);
  ok('副 API 存在自己的键里，不碰主 API', 'gal_api2_config' in store && !('gal_api_config' in store));
}

console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
process.exit(fail ? 1 : 0);
