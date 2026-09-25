/* 预设相关的单测：正则（思维链）、宏、深度注入、消息规整、停止原因、模型列表。
   对应 v5.21 修的三件事：预设正则没接 → 思维链漏出；预设块位置和宏没生效 → 预设没效果；
   测试连接要先填模型名、下拉看不到 → 拿不到模型列表。 */
import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);

const store = {};
const sb = { console, setTimeout, clearTimeout, AbortController, TextDecoder, Date, Math, JSON,
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
sb.window = sb;
sb.RESOURCE = { characters: {}, defaults: {}, scenes: {} };
vm.createContext(sb);
for (const f of ['regex', 'worldbook', 'prompt', 'script', 'resolver', 'engine', 'api'])
  vm.runInContext(fs.readFileSync(P('core', f + '.js'), 'utf8'), sb);
const { GalRegex: R, PromptBuilder: PB, Engine, GalAPI: A } = sb;

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));

console.log('\n[1] 思维链兜底');
let r = R.stripReasoning('<thinking>我先想想</thinking>\n台词|柴郡|微笑|');
ok('成对标签剥掉', r.text === '台词|柴郡|微笑|' && r.stripped, JSON.stringify(r));
ok('标签名不区分大小写、带属性也认', R.stripReasoning('<Think type="x">a</Think>正文').text === '正文');
ok('中文标签 <思考>', R.stripReasoning('<思考>嗯</思考>正文').text === '正文');
ok('xxx_cot 这类自定义名', R.stripReasoning('<juus_cot>a</juus_cot>正文').text === '正文');
ok('只有闭合标签（开头被吃）→ 前面全删', R.stripReasoning('推理一大段</think>\n正文').text === '正文');
r = R.stripReasoning('<think>推理写到一半就');
ok('没闭合且没正文 → 标记 onlyReasoning', r.onlyReasoning && r.unclosed, JSON.stringify(r));
r = R.stripReasoning('<think>推理\n『港区·白日』\n台词|柴郡|笑|');
ok('没闭合但有正文 → 从正文起点接上', r.text.startsWith('『港区') && r.unclosed, JSON.stringify(r));
ok('没有思维链的正文原样不动', R.stripReasoning('台词|柴郡|笑|').stripped === false);
ok('正文里的 <content> 不被误伤', R.stripReasoning('<content>正文</content>').text === '<content>正文</content>');

console.log('\n[2] 酒馆正则语义');
const preset = {
  extensions: { regex_scripts: [
    { scriptName: '隐藏思维链', findRegex: '/<cot_x>[\\s\\S]*?<\\/cot_x>/g', replaceString: '', placement: [2], markdownOnly: true, promptOnly: true },
    { scriptName: '折叠思维', findRegex: '/<plan>([\\s\\S]*?)<\\/plan>/gs', replaceString: '<details><summary>思考</summary>$1</details>', placement: [2], markdownOnly: true },
    { scriptName: '美化引号', findRegex: '/"(.+?)"/g', replaceString: '<span class="q">"$1"</span>', placement: [2], markdownOnly: true },
    { scriptName: '只改提示词', findRegex: '/【状态栏】[\\s\\S]*?【\\/状态栏】/g', replaceString: '', placement: [2], promptOnly: true, minDepth: 1 },
    { scriptName: '直接改写', findRegex: 'ABC', replaceString: '{{match}}-{{char}}', placement: [2] },
    { scriptName: '用户输入', findRegex: '/草/g', replaceString: '笑', placement: [1] },
    { scriptName: '空正则', findRegex: '', replaceString: 'x', placement: [2] },
    { scriptName: '关着的', findRegex: '/正文/g', replaceString: '坏', placement: [2], disabled: true },
    { scriptName: 'trim', findRegex: '/\\[(.+?)\\]/g', replaceString: '$1', trimStrings: ['!'], placement: [2] }
  ] }
};
const list = R.fromPreset(preset);
ok('读到预设里的 9 条', list.length === 9);
ok('空正则标记跳过', list.find(s => s.name === '空正则').skip !== '');
ok('<details> 折叠当隐藏', list.find(s => s.name === '折叠思维').hideHtml === true);
ok('其它 HTML 替换标记 htmlOnly', list.find(s => s.name === '美化引号').htmlOnly === true);
const ctx = { charName: '柴郡' };
let t = R.run('a<cot_x>xx</cot_x>b<plan>p</plan>c "说" ABC [正文!] 草', list, { mode: 'display', placement: 2, depth: 0, ctx });
ok('显示：隐藏 + 折叠当隐藏 + 直接改写 + trimStrings', t === 'abc "说" ABC-柴郡 正文 草', t);
ok('显示：HTML 美化被跳过（不往剧本里塞标签）', !/span/.test(t));
t = R.run('【状态栏】hp【/状态栏】X', list, { mode: 'prompt', placement: 2, depth: 0 });
ok('promptOnly + minDepth=1：最新一条不动', t.startsWith('【状态栏】'), t);
t = R.run('【状态栏】hp【/状态栏】X', list, { mode: 'prompt', placement: 2, depth: 3 });
ok('promptOnly：旧消息里删掉', t === 'X', t);
ok('promptOnly 不影响显示', R.run('【状态栏】a【/状态栏】', list, { mode: 'display', placement: 2, depth: 5 }).includes('状态栏'));
ok('placement=1 只作用于用户输入', R.run('草', list, { mode: 'prompt', placement: 1 }) === '笑' &&
   R.run('草', list, { mode: 'display', placement: 2 }) === '草');
ok('单独导入：单条对象', R.fromImport({ scriptName: 'a', findRegex: '/a/' }).length === 1);
ok('单独导入：数组 / {regex_scripts}', R.fromImport([{}, {}]).length === 2 && R.fromImport({ regex_scripts: [{}] }).length === 1);
ok('JS 不认识的旗标被丢掉而不是整条失效', !!R.parseFind('/a/gx'));

console.log('\n[3] 引擎接入');
const eng = new Engine({ userName: '指挥官' });
eng.loadCard({ data: { name: '柴郡', extensions: { regex_scripts: [] } } });
eng.loadPreset({ prompts: [{ identifier: 'chatHistory', marker: true }], prompt_order: [{ order: [{ identifier: 'chatHistory', enabled: true }] }],
  extensions: { regex_scripts: preset.extensions.regex_scripts } });
ok('loadPreset 读到正则', eng.presetRegex.length === 9);
let res = eng.processOutput('<cot_x>秘密推理</cot_x>\n<thinking>也是推理</thinking>\n真正的台词。|柴郡|微笑|');
ok('processOutput 显示里没有思维链', !/推理/.test(res.text), res.text);
ok('cleaners 记录了去思维链', res.cleaners.some(c => /思维链/.test(c)), JSON.stringify(res.cleaners));
eng.history = [
  { role: 'user', content: '你好草' },
  { role: 'assistant', content: '<thinking>旧推理</thinking>【状态栏】hp【/状态栏】旧回复' }
];
const dry = eng.dryRun('新的一句草');
const flat = dry.messages.map(m => m.content).join('\n');
ok('发给模型的历史里没有旧思维链', !/旧推理/.test(flat), flat);
ok('promptOnly 正则按深度作用到历史', !/状态栏/.test(flat), flat);
ok('用户输入的正则也生效', /新的一句笑/.test(flat) && /你好笑/.test(flat), flat);
ok('存档原文不动', /旧推理/.test(eng.history[1].content));
eng.regexOff = { 'preset:用户输入': true };
ok('界面上手动关掉的正则不再生效', /新的一句草/.test(eng.dryRun('新的一句草').messages.map(m => m.content).join('\n')));
eng.regexOff = {};
await eng.turn('嗨', { semantic: [], send: async () => '<think>这轮的推理</think>\n回复|柴郡|笑|' });
const pushed = eng.history[eng.history.length - 1].content;
ok('turn() 存进历史的是剥掉思维链的版本', !/推理/.test(pushed), pushed);

console.log('\n[4] 宏');
const mctx = { charName: '柴郡', userName: '指挥官', vars: {} };
ok('setvar / getvar 前后呼应', PB.macros('{{setvar::模式::R18}}x', mctx) === 'x' && PB.macros('{{getvar::模式}}', mctx) === 'R18');
ok('{{// 注释}} 删掉（可跨行）', PB.macros('a{{// 这是\n注释}}b', mctx) === 'ab');
ok('{{trim}} 连同两侧空行删掉', PB.macros('a\n\n{{trim}}\n\nb', mctx) === 'ab');
ok('不认识的宏原样保留', PB.macros('{{没这个}}', mctx) === '{{没这个}}');
ok('{{random::a::a}} / {{roll:1d1}}', PB.macros('{{random::a::a}}{{roll:1d1}}', mctx) === 'a1');
ok('addvar 数字相加', (PB.macros('{{setvar::n::2}}{{addvar::n::3}}', mctx), mctx.vars.n === '5'));
ok('嵌套：{{setvar::a::{{char}}}}', (PB.macros('{{setvar::a::{{char}}}}', mctx), mctx.vars.a === '柴郡'));
const pre2 = {
  prompts: [
    { identifier: 'main', role: 'system', content: '{{setvar::开关::开}}主提示' },
    { identifier: 'chatHistory', marker: true },
    { identifier: 'jb', role: 'system', content: '后置指令：{{getvar::开关}}' },
    { identifier: 'deep', role: 'system', content: '深度1', injection_position: 1, injection_depth: 1 }
  ],
  prompt_order: [{ order: ['main', 'chatHistory', 'jb', 'deep'].map(i => ({ identifier: i, enabled: true })) }],
  squash_system_messages: false, assistant_prefill: '好的，继续：'
};
const b = PB.build({ preset: pre2, history: [{ role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }], userText: 'u2' });
const roles = b.messages.map(m => m.content);
ok('预设块之间 setvar/getvar 生效', roles.includes('后置指令：开'), JSON.stringify(roles));
ok('深度注入按「历史」数：depth 1 在最新一条之前', JSON.stringify(roles) === JSON.stringify(['主提示', 'u1', 'a1', '深度1', 'u2', '后置指令：开']), JSON.stringify(roles));
ok('读到助手预填', b.params.assistantPrefill === '好的，继续：');

console.log('\n[5] 消息规整');
const msgs = [{ role: 'system', content: 'S' }, { role: 'assistant', content: '开场' }, { role: 'user', content: 'u' }, { role: 'system', content: '破限' }];
let body = A.body({ protocol: 'claude', model: 'm', maxTokens: 8192, temperature: 1 }, msgs, { assistantPrefill: '好的' });
ok('Claude：只有开头的 system 进 system 字段', body.system === 'S');
ok('Claude：对话后面的 system 原地改 user，不再被拎到最前', body.messages[2].content === 'u\n\n破限', JSON.stringify(body.messages));
ok('Claude：预填作为最后一条 assistant', body.messages[3].role === 'assistant' && body.messages[3].content === '好的');
ok('Claude：首条补成 user', body.messages[0].role === 'user');
body = A.body({ protocol: 'openai', model: 'm', maxTokens: 8192, temperature: 1 }, msgs, {});
ok('OpenAI：后置 system 留在历史之后', body.messages[body.messages.length - 1].content.endsWith('破限'), JSON.stringify(body.messages));
ok('OpenAI：不发预填', !body.messages.some(m => m.content === '好的'));
body = A.body({ protocol: 'openai', model: 'm', maxTokens: 8192, midSystem: 'system' }, msgs, {});
ok('OpenAI：midSystem=system 时保留 system 角色', body.messages[body.messages.length - 1].role === 'system');
body = A.body({ protocol: 'gemini', model: 'm', maxTokens: 8192, temperature: 1 }, msgs, {});
ok('Gemini：安全阈值全部放开', body.safetySettings.length === 4 && body.safetySettings.every(s => s.threshold === 'BLOCK_NONE'));
ok('Gemini：后置 system 不进 systemInstruction', body.systemInstruction.parts[0].text === 'S');
ok('最大输出默认 8192', A.DEFAULTS.maxTokens === 8192);
ok('界面上限仍然压住预设的 60000', A.body({ protocol: 'openai', maxTokens: 8192 }, msgs, { maxTokens: 60000 }).max_tokens === 8192);

console.log('\n[6] 停止原因');
ok('length → 截断提示', A.explainFinish('length').kind === 'length');
ok('max_tokens (Claude) / MAX_TOKENS (Gemini)', A.explainFinish('max_tokens').kind === 'length' && A.explainFinish('MAX_TOKENS').kind === 'length');
ok('SAFETY / content_filter / PROHIBITED_CONTENT → 过滤', ['SAFETY', 'content_filter', 'PROHIBITED_CONTENT', 'BLOCKED:OTHER'].every(x => A.explainFinish(x).kind === 'filter'));
ok('正常结束返回 null', [null, '', 'stop', 'end_turn', 'STOP'].every(x => A.explainFinish(x) === null));
ok('Gemini 整段被拦（promptFeedback）', A.finishOf({ protocol: 'gemini' }, { promptFeedback: { blockReason: 'OTHER' } }) === 'BLOCKED:OTHER');

/* 用假 fetch 跑 chat / listModels / probe */
function fakeFetch(routes) {
  sb.fetch = async (url, init) => {
    for (const [re, fn] of routes) if (re.test(url)) return fn(url, init);
    return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'nope' };
  };
}
const jsonRes = (o, status = 200) => ({ ok: status < 300, status, headers: { get: () => null },
  json: async () => o, text: async () => JSON.stringify(o) });

fakeFetch([[/chat\/completions/, () => ({ ok: true, status: 200, headers: { get: () => null },
  text: async () => 'data: {"choices":[{"delta":{"content":"o"}}]}\n\ndata: {"choices":[{"delta":{"content":"k"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n' })]]);
let out = await A.chat([{ role: 'user', content: 'hi' }], { config: { protocol: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm', stream: false } });
ok('中转无视 stream:false 回 SSE 也能读', out === 'ok', out);

fakeFetch([[/chat\/completions/, () => jsonRes({ choices: [{ message: { content: '写到一半' }, finish_reason: 'length' }] })]]);
out = await A.chat([{ role: 'user', content: 'hi' }], { config: { protocol: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm', stream: false } });
ok('截断时记下 lastFinish', A.lastFinish.info && A.lastFinish.info.kind === 'length');

fakeFetch([[/enerateContent/i, () => jsonRes({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] })]]);
let err = null;
try { await A.chat([{ role: 'user', content: 'hi' }], { config: { protocol: 'gemini', baseUrl: 'https://g', apiKey: 'k', model: 'm', stream: false } }); }
catch (e) { err = e; }
ok('空回复 + 被过滤 → 报清楚的错，且不重试', err && /过滤/.test(err.message) && A.isFatal(err), err && err.message);

fakeFetch([[/enerateContent/i, () => jsonRes({ candidates: [{ content: { parts: [{ text: '想法', thought: true }, { text: '正文' }] } }] })]]);
out = await A.chat([{ role: 'user', content: 'hi' }], { config: { protocol: 'gemini', baseUrl: 'https://g', apiKey: 'k', model: 'm', stream: false } });
ok('Gemini 的 thought 部分不进正文', out === '正文', out);

console.log('\n[7] 模型列表与测试连接');
ok('完整地址也能推出 /models', A.modelsUrl({ protocol: 'openai', baseUrl: 'https://x.com/v1/chat/completions' }) === 'https://x.com/v1/models');
ok('根地址自动补 /v1', A.modelsUrl({ protocol: 'openai', baseUrl: 'https://x.com/' }) === 'https://x.com/v1/models');
ok('Anthropic 完整地址', A.modelsUrl({ protocol: 'claude', baseUrl: 'https://api.anthropic.com/v1/messages' }).startsWith('https://api.anthropic.com/v1/models'));
ok('Gemini 补 /v1beta', A.modelsUrl({ protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' }).startsWith('https://generativelanguage.googleapis.com/v1beta/models'));
ok('/api/v3 这类版本号不再重复补 /v1', A.modelsUrl({ protocol: 'openai', baseUrl: 'https://ark.x.com/api/v3' }) === 'https://ark.x.com/api/v3/models');

fakeFetch([[/\/models/, () => jsonRes({ models: [
  { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }] })]]);
const ms = await A.listModels({ protocol: 'gemini', baseUrl: 'https://g', apiKey: 'k' });
ok('Gemini 只留能对话的模型、去掉 models/ 前缀', JSON.stringify(ms) === '["gemini-2.5-pro"]', JSON.stringify(ms));

fakeFetch([
  [/\/models/, () => jsonRes({ data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'a-model' }] })],
  [/chat\/completions/, () => jsonRes({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })]
]);
let pr = await A.probe({ protocol: 'openai', baseUrl: 'https://x', apiKey: 'k', model: '' });
ok('没填模型名也能测：先拿到列表（排序、去重）', JSON.stringify(pr.models) === '["a-model","b-model"]' && !pr.chat, JSON.stringify(pr));
pr = await A.probe({ protocol: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'a-model' });
ok('填了模型名：列表 + 真发一句', pr.models.length === 2 && pr.chat && pr.chat.reply === 'ok', JSON.stringify(pr));
fakeFetch([[/chat\/completions/, () => jsonRes({ choices: [{ message: { content: 'ok' } }] })]]);
pr = await A.probe({ protocol: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm' });
ok('列表拉不到不影响对话测试', pr.listError && pr.chat && pr.chat.reply === 'ok', JSON.stringify(pr));
pr = await A.probe({ protocol: 'openai', baseUrl: 'https://x', apiKey: '', model: 'm' });
ok('没填密钥给出明确原因', pr.listError === '没填密钥');

console.log(`\n✓ ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
