/* 对照 KaiTuoYiShi（开拓轶事）补上的那一批：预设解析、宏、正则、接口降级、测试连接、抗空回。
   每一项都对应交接文档七·十二里的一条缺口。 */
import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);

const store = {};
const sb = { console, setTimeout, clearTimeout, AbortController, TextDecoder, Date, Math, JSON, Uint32Array,
  crypto: globalThis.crypto,
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
sb.window = sb;
sb.RESOURCE = { characters: {}, defaults: {}, scenes: {} };
vm.createContext(sb);
for (const f of ['regex', 'worldbook', 'prompt', 'script', 'resolver', 'engine', 'api', 'editors'])
  vm.runInContext(fs.readFileSync(P('core', f + '.js'), 'utf8'), sb);
const { GalRegex: R, PromptBuilder: PB, Engine, GalAPI: A, Editors: E } = sb;

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));
const J = x => JSON.stringify(x);

console.log('\n[1] 预设解析');
const twoOrders = {
  prompts: [{ identifier: 'main', role: 'system', content: '新主提示' }, { identifier: 'old', role: 'system', content: '旧块' },
            { identifier: 'p2', role: 'system', prompt: '用 prompt 字段写的块' }],
  prompt_order: [
    { character_id: 100000, order: [{ identifier: 'old', enabled: true }] },
    { character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'p2', enabled: true }, { identifier: 'chatHistory', enabled: true }] }
  ]
};
let b = PB.build({ preset: twoOrders, history: [{ role: 'user', content: 'u1' }], userText: 'u2' });
let texts = b.messages.map(m => m.content).join('|');
ok('prompt_order 有两组时用 100001（酒馆实际在用的那组）', /新主提示/.test(texts) && !/旧块/.test(texts), texts);
ok('块正文写在 prompt 字段里也认', /用 prompt 字段写的块/.test(texts), texts);
ok('chatHistory 只出现在 prompt_order、prompts 里没定义，照样当占位插历史', /u1/.test(texts) && /u2/.test(texts), texts);
ok('没有 100001 时取条目最多的一组', PB.orderOf({ prompt_order: [{ character_id: 1, order: [{}] }, { character_id: 2, order: [{}, {}] }] }).character_id === 2);
ok('编辑器改的是同一组', (E.setBlockEnabled(twoOrders, 'main', false),
   twoOrders.prompt_order[1].order[0].enabled === false && E.presetBlocks(twoOrders).length === 3));
twoOrders.prompt_order[1].order[0].enabled = true;

const trig = {
  prompts: [{ identifier: 'a', role: 'system', content: '普通', injection_trigger: [] },
            { identifier: 'b', role: 'system', content: '只在续写时', injection_trigger: ['continue'] },
            { identifier: 'c', role: 'system', content: '普通和重roll', injection_trigger: ['normal', 'swipe'] }],
  prompt_order: [{ character_id: 100001, order: ['a', 'b', 'c'].map(i => ({ identifier: i, enabled: true })) }]
};
texts = PB.build({ preset: trig, history: [] }).messages.map(m => m.content).join('|');
ok('injection_trigger 只写了 continue 的块，普通一轮不发', !/只在续写时/.test(texts) && /普通/.test(texts) && /普通和重roll/.test(texts), texts);

const eng = new Engine({});
eng.loadCard({ data: { name: '柴郡', character_book: { entries: [{ id: 1, keys: ['k'], content: '卡内' }] } } });
const basePool = eng.pool.length;
eng.loadPreset({ prompts: [], prompt_order: [], world_info: { entries: {
  7: { uid: 7, key: ['港区'], content: '预设世界书', position: 4, depth: 2, order: 50, disable: false },
  8: { uid: 8, key: ['x'], content: '被禁用的', disable: true } } } });
const pw = eng.pool.filter(e => String(e.uid).startsWith('preset:'));
ok('预设附带的 world_info 进世界书', pw.length === 2 && eng.presetWiCount === 2, J(pw.map(e => e.uid)));
ok('平铺格式的 position/depth/order 不再丢', pw[0].position === 4 && pw[0].depth === 2 && pw[0].order === 50, J(pw[0]));
ok('平铺格式的 disable 生效', pw[1].enabled === false);
eng.loadPreset({ prompts: [], prompt_order: [] });
ok('换预设时上一份带来的条目摘掉，卡内的留着', !eng.pool.some(e => String(e.uid).startsWith('preset:')) && eng.pool.length === basePool);

console.log('\n[2] 宏：条件块与简写');
const c = { charName: '柴郡', userName: '指挥官', vars: {} };
const M = s => PB.macros(s, c);
ok('{{if}}…{{else}}…{{/if}}', M('{{setvar::模式::R18}}{{if getvar::模式 == R18}}开{{else}}关{{/if}}') === '开');
ok('取反 {{if !.x}}', M('{{if !.未设}}空{{/if}}') === '空');
ok('没选中的分支里的 setvar 不执行', (M('{{if .未设}}{{setvar::坏::1}}{{/if}}'), c.vars['坏'] === undefined));
ok('嵌套 if', M('{{.a = 1}}{{if .a}}外{{if .a == 1}}内{{/if}}{{else}}否{{/if}}') === '外内');
ok('数字比较 >=', M('{{.n = 10}}{{if .n >= 9}}大{{/if}}') === '大');
ok('简写读写 {{.x = v}} {{.x}}', M('{{.心情 = 好}}{{.心情}}') === '好');
ok('{{.n += 2}} {{.n++}}', (M('{{.k = 1}}{{.k += 2}}{{.k++}}'), c.vars.k === '4'), c.vars.k);
ok('全局简写 {{$g = v}}', M('{{$全局 = 3}}{{$全局}}') === '3');
ok('顺序求值：setvar 里嵌 {{char}}，后面马上读得到', M('{{setvar::名::{{char}}}}{{getvar::名}}') === '柴郡');
ok('{{upper::}} {{lower::}} {{trim::}}', M('{{upper::ab}}{{lower::CD}}[{{trim::  x  }}]') === 'ABcd[x]');
ok('{{hasvar::}}', M('{{hasvar::名}}/{{hasvar::无}}') === 'true/false');
ok('不认识的宏原样保留（嵌套的先求值）', M('{{自定义::{{char}}}}') === '{{自定义::柴郡}}');
ok('落单的 {{/if}} 不留残渣', M('a{{/if}}b') === 'ab');

console.log('\n[3] 正则：存放位置与字段');
let rx = R.fromPreset({ extensions: { SPreset: { RegexBinding: { regexes: [
  { script_name: '下划线字段', find_regex: '/甲/g', replace_string: '乙', placement: [2] }] } } } });
ok('SPreset 正则绑定路径 + snake_case 字段', rx.length === 1 && R.run('甲', rx, { mode: 'display', placement: 2 }) === '乙');
rx = R.fromPreset({ regex_scripts: { k1: { scriptName: '映射', findRegex: '/丙/g', replaceString: '丁' } } });
ok('regex_scripts 是 { id: 脚本 } 对象映射也认', rx.length === 1 && rx[0].id === 'preset:k1');
rx = R.fromPreset({ regex_scripts: [{ scriptName: 'a', findRegex: '/x/' }], extensions: { regex_scripts: [{ scriptName: 'a', findRegex: '/x/' }] } });
ok('两个位置放了同一条，只算一次', rx.length === 1);
rx = R.collect([{ scriptName: '宏', findRegex: '/{{char}}说/g', replaceString: '她说', substituteRegex: 1 }], 'user');
ok('substituteRegex：查找正则里的 {{char}} 先替换', R.run('柴郡说', rx, { mode: 'display', ctx: { charName: '柴郡' } }) === '她说');
ok('整份预设拖进「导入正则」也能抠出来', R.fromImport({ extensions: { regex_scripts: [{ findRegex: '/a/' }] } }).length === 1);
ok('抗空回 <Q>…</WF> / 抗截断 <math>…</math> / 注释 兜底删掉',
   R.stripPlaceholders('<Q>声明</WF>正文<math>∫x</math><!-- 备注 -->') === '正文');
ok('给模型看的历史里保留注释（有的预设拿注释藏状态）', R.stripPlaceholders('a<!--状态-->b<math>1</math>', null, true) === 'a<!--状态-->b');
const dr = R.dryRun(R.collect([{ scriptName: 't', findRegex: '/a/g', replaceString: 'b' }], 'user')[0], 'a a c');
ok('试跑：命中次数和结果', dr.ok && dr.matches === 2 && dr.after === 'b b c', J(dr));
eng.loadPreset({ prompts: [], prompt_order: [] });
let res = eng.processOutput('<Q>抗空回声明</Q></WF>\n台词。|柴郡|微笑|\n<math>高数题</math>');
ok('processOutput 显示里没有占位块', !/声明|高数题/.test(res.text), res.text);

console.log('\n[4] 接口：响应解析');
const oa = { protocol: 'openai' };
ok('content 是分段数组', A.partText([{ type: 'text', text: '甲' }, { type: 'thinking', thinking: '想' }, { type: 'text', text: '乙' }]) === '甲乙');
function sse(lines) {
  const enc = new TextEncoder();
  let i = 0;
  return { ok: true, status: 200, headers: { get: () => null },
    body: { getReader: () => ({ read: async () => i < lines.length
      ? { done: false, value: enc.encode('data: ' + JSON.stringify(lines[i++]) + '\n\n') } : { done: true } }) } };
}
let last;
sb.fetch = async (url, init) => { last = { url, body: JSON.parse(init.body) }; return sse([
  { data: { choices: [{ delta: { content: '信' } }] } },
  { choices: [{ delta: { content: [{ type: 'text', text: '封' }] } }] },
  { choices: [{ delta: { reasoning_content: '不该出现' } }] },
  { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '也不该' } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: '和A格式' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } }]); };
let out = await A.chat([{ role: 'user', content: 'hi' }], { config: { protocol: 'openai', baseUrl: 'https://r', apiKey: 'k', model: 'm', stream: true }, onDelta() {} });
ok('流式：data 信封 / 分段数组 / Anthropic 格式混着来都能读，思考不进正文', out === '信封和A格式', out);
const jr = o => async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(o), json: async () => o });
sb.fetch = jr({ content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'A格式整包' }], stop_reason: 'end_turn' });
out = await A.chat([{ role: 'user', content: 'hi' }], { config: { protocol: 'openai', baseUrl: 'https://r2', apiKey: 'k', model: 'm', stream: false } });
ok('非流式：OpenAI 地址回了 Anthropic 格式也能读', out === 'A格式整包', out);
sb.fetch = jr({ output: [{ content: [{ type: 'output_text', text: 'Responses' }] }] });
out = await A.chat([{ role: 'user', content: 'hi' }], { config: { protocol: 'openai', baseUrl: 'https://r3', apiKey: 'k', model: 'm', stream: false } });
ok('非流式：Responses API 格式', out === 'Responses', out);

console.log('\n[5] 接口：参数不兼容自动降级');
function scripted(errors, okBody) {
  const seen = [];
  sb.fetch = async (url, init) => {
    const body = JSON.parse(init.body); seen.push({ url, body });
    const e = errors.shift();
    if (e) return { ok: false, status: 400, headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: e } }) };
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(okBody), json: async () => okBody };
  };
  return seen;
}
const okO = { choices: [{ message: { content: '好' }, finish_reason: 'stop' }] };
let seen = scripted(["Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."], okO);
let cfg = { protocol: 'openai', baseUrl: 'https://o1', apiKey: 'k', model: 'o3', stream: false, maxTokens: 8192, temperature: 1 };
let notes = [];
out = await A.chat([{ role: 'user', content: 'hi' }], { config: cfg, onCompat: w => notes.push(w) });
ok('max_tokens → max_completion_tokens', out === '好' && seen[1].body.max_completion_tokens === 8192 && !('max_tokens' in seen[1].body), J(seen[1].body));
ok('降级时回调告诉界面', notes.length === 1, J(notes));
seen = scripted([], okO);
await A.chat([{ role: 'user', content: 'hi' }], { config: cfg });
ok('记住了：同一个模型下一次直接用降级后的参数，不再先吃一个 400', seen.length === 1 && 'max_completion_tokens' in seen[0].body);
seen = scripted(["Unsupported value: 'temperature' does not support 1.2 with this model. Only the default (1) value is supported."], okO);
await A.chat([{ role: 'user', content: 'hi' }], { config: Object.assign({}, cfg, { baseUrl: 'https://o2', temperature: 1.2 }) });
ok('temperature 不支持 → 去掉', seen.length === 2 && !('temperature' in seen[1].body), J(seen[1] && seen[1].body));
seen = scripted(['max_tokens: 8192 > 4096, which is the maximum allowed number of output tokens for this model'], okO);
await A.chat([{ role: 'user', content: 'hi' }], { config: Object.assign({}, cfg, { baseUrl: 'https://o3', model: 'small' }) });
ok('最大输出超过模型上限 → 按报错里的数字调小', seen.length === 2 && seen[1].body.max_tokens === 4096, J(seen.map(x => x.body.max_tokens)));
seen = scripted(['This model does not support assistant message prefill. The conversation must end with a user message.'],
  { content: [{ type: 'text', text: '好' }], stop_reason: 'end_turn' });
out = await A.chat([{ role: 'user', content: 'hi' }], { config: { protocol: 'claude', baseUrl: 'https://c', apiKey: 'k', model: 'claude-new', stream: false, maxTokens: 8192 },
  params: { assistantPrefill: '好的，' } });
const lastMsg = seen[1] && seen[1].body.messages.slice(-1)[0];
ok('新一代 Claude 拒收预填 → 去掉预填、以 user 结尾', out === '好' && seen[0].body.messages.slice(-1)[0].role === 'assistant' && lastMsg.role === 'user', J(seen.map(x => x.body.messages)));
seen = scripted(['some other bad request'], okO);
let err = null;
try { await A.chat([{ role: 'user', content: 'hi' }], { config: Object.assign({}, cfg, { baseUrl: 'https://o4' }) }); } catch (e) { err = e; }
ok('认不出的 400 照常报错，不瞎重试', err && err.status === 400 && seen.length === 1, err && err.message);

console.log('\n[6] 预填与后处理');
seen = scripted([], okO);
await A.chat([{ role: 'user', content: 'hi' }], { config: { protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat', stream: false, maxTokens: 8192 },
  params: { assistantPrefill: '<thinking>' } });
ok('DeepSeek 官方：预填走 /beta + prefix:true', /\/beta\/chat\/completions$/.test(seen[0].url) && seen[0].body.messages.slice(-1)[0].prefix === true, seen[0].url);
seen = scripted([], okO);
await A.chat([{ role: 'user', content: 'hi' }], { config: { protocol: 'openai', baseUrl: 'https://relay', apiKey: 'k', model: 'x', stream: false, maxTokens: 8192 },
  params: { assistantPrefill: '<thinking>' } });
ok('普通 OpenAI 兼容默认不发预填', seen[0].body.messages.slice(-1)[0].role === 'user');
let bd = A.body({ protocol: 'gemini', maxTokens: 8192, prefillMode: 'all' }, [{ role: 'user', content: 'u' }], { assistantPrefill: 'P' });
ok('prefillMode=all：Gemini 也作为最后一条 model 发', bd.contents.slice(-1)[0].role === 'model' && bd.contents.slice(-1)[0].parts[0].text === 'P');
bd = A.body({ protocol: 'openai', maxTokens: 8192, postProcess: 'single' }, [{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }, { role: 'assistant', content: 'a' }], {});
ok('后处理「全部合成一条」', bd.messages.length === 1 && bd.messages[0].role === 'user' && bd.messages[0].content === 'S\n\nu\n\na', J(bd.messages));
bd = A.body({ protocol: 'openai', maxTokens: 8192, postProcess: 'keep' }, [{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }, { role: 'system', content: 'J' }], {});
ok('后处理「保留 system」', bd.messages.slice(-1)[0].role === 'system');
bd = A.body({ protocol: 'claude', maxTokens: 8192 }, [{ role: 'user', content: 'u' }, { role: 'assistant', content: 'a' }], {});
ok('Claude 没有预填时不以 assistant 结尾', bd.messages.slice(-1)[0].role === 'user');

ok('对话地址：/api/v3、/beta 这类自带版本段的不再重复补 /v1',
   A.endpoint({ protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' }) === 'https://ark.cn-beijing.volces.com/api/v3/chat/completions' &&
   A.endpoint({ protocol: 'openai', baseUrl: 'https://x.com' }) === 'https://x.com/v1/chat/completions');

console.log('\n[7] 测试连接');
let urls = [];
sb.fetch = async (url) => { urls.push(url);
  if (url === 'https://x.com/api/v3/models') return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'no' };
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: [{ id: 'm1' }] }) }; };
let ms = await A.listModels({ protocol: 'openai', baseUrl: 'https://x.com/api/v3', apiKey: 'k' });
ok('第一个模型地址 404 → 自动试下一个', J(ms) === '["m1"]' && urls.length === 2, J(urls));
urls = [];
sb.fetch = async (url) => { urls.push(url); return { ok: false, status: 401, headers: { get: () => null }, text: async () => 'bad key' }; };
err = null;
try { await A.listModels({ protocol: 'openai', baseUrl: 'https://x.com/v1', apiKey: 'k' }); } catch (e) { err = e; }
ok('401 不再换地址瞎试，直接报密钥问题', err && err.status === 401 && urls.length === 1);
sb.fetch = async (url, init) => { const code = init.body.match(/GAL-[0-9A-F]{8}/)[0];
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: '<think>嗯</think>' + code } }] }) }; };
let t = await A.test({ protocol: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm' });
ok('随机校验码：照抄了 → verified（带思维链也认）', t.verified === true, J(t));
sb.fetch = jr({ choices: [{ message: { content: 'ok' } }] });
t = await A.test({ protocol: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm' });
ok('随机校验码：回了别的 → 不算验证通过', t.verified === false && t.reply === 'ok');

console.log('\n[8] 抗空回');
const e2 = new Engine({});
e2.loadCard({ data: { name: '柴郡' } });
let calls = 0, retried = 0;
sb.GalAPI.lastFinish = null;
await e2.turn('嗨', { semantic: [], onEmptyRetry: () => retried++, send: async () => (++calls === 1 ? '' : '回复|柴郡|笑|') });
ok('空回复自动再要一次', calls === 2 && retried === 1);
calls = 0;
await e2.turn('嗨', { semantic: [], send: async () => (++calls === 1 ? '<thinking>只有推理</thinking><content></content>' : '回复|柴郡|笑|') });
ok('只有思维链 + 空壳标签也算空回', calls === 2);
ok('<背景|港区> 这种剧本行不算空', e2.isEmptyReply('<背景|港区|白日>') === false);
calls = 0;
sb.GalAPI.lastFinish = { info: { kind: 'length' } };
await e2.turn('嗨', { semantic: [], send: async () => { ++calls; return '<thinking>写到上限'; } });
ok('写思维链写到上限被截断的，不白白重试', calls === 1);
sb.GalAPI.lastFinish = null;

console.log(`\n✓ ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
