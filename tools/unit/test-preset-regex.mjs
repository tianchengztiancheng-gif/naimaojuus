/* 自带正则的预设（TG 破限 V2.1.6 那种写法）走一遍。
   不把别人的预设放进仓库，这里用结构相同的合成正则：
     思维链美化  ([\s\S]*?)</draft_notes> → 两三千字的 <details> 折叠卡片（仅显示）
     思维隐藏    [\s\S]*?</draft_notes> → ''（仅提示词）
     行动选项美化 <w2g>(…)</w2g> → 一万多字的 HTML 页面（仅显示）
     特写        <SexualScene>(…)</SexualScene> → 带 <details> 的 HTML 卡片（仅显示）
     别关        用户输入 → <player_input>$1{{getvar::supernsfw}}</player_input>（仅提示词，深度 ≤1）
     巡回        最近两条 AI 输出 → <ai_last_output>$1</ai_last_output>（仅提示词，深度 ≤2） */
import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sb = { console, setTimeout, clearTimeout, Date, Math, JSON, localStorage: { getItem: () => null, setItem() {} } };
sb.window = sb; sb.RESOURCE = { characters: {}, defaults: {}, scenes: {} };
vm.createContext(sb);
for (const f of ['regex', 'worldbook', 'prompt', 'script', 'resolver', 'engine'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'core', f + '.js'), 'utf8'), sb);
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));

const big = (inner) => '<div class="card">' + 'x'.repeat(2500) + inner + '</div>';
const rx = [
  { scriptName: 'X-思维链美化', findRegex: '/([\\s\\S]*?)</draft_notes>/g', replaceString: big('<details><summary>思考</summary>$1</details>'),
    placement: [2], markdownOnly: true, promptOnly: false, disabled: false },
  { scriptName: 'X-思维隐藏', findRegex: '/[\\s\\S]*?</draft_notes>/g', replaceString: '', placement: [2], promptOnly: true, disabled: false },
  { scriptName: 'X-行动选项美化', findRegex: '/<w2g>([\\s\\S]*?)<\\/w2g>/g', replaceString: '```\n<!DOCTYPE html>' + big('$1') + '\n```',
    placement: [2], markdownOnly: true, maxDepth: 1, disabled: false },
  { scriptName: 'X-特写', findRegex: '/<SexualScene>([\\s\\S]*?)</SexualScene>/g', replaceString: '<details><summary>特写</summary><div>$1</div></details>',
    placement: [2], markdownOnly: true, disabled: false },
  { scriptName: 'X-别关', findRegex: '^([\\s\\S]*)$', replaceString: '<player_input>\n$1{{getvar::supernsfw}}\n</player_input>',
    placement: [1], promptOnly: true, maxDepth: 1, disabled: false },
  { scriptName: 'X-巡回', findRegex: '^([\\s\\S]*)$', replaceString: '<ai_last_output>\n$1\n</ai_last_output>',
    placement: [2], promptOnly: true, maxDepth: 2, disabled: false },
  { scriptName: 'X-关着的', findRegex: '/港区/g', replaceString: '坏掉', placement: [2], disabled: true }
];
const preset = {
  prompts: [
    { identifier: 'main', role: 'system', content: '{{setvar::supernsfw::（按要求写）}}主提示' },
    { identifier: 'chatHistory', marker: true }
  ],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }],
  extensions: { regex_scripts: rx, tavern_helper: { scripts: [{ name: '悬浮球', enabled: true }] } }
};
const eng = new sb.Engine({ userName: '指挥官' });
eng.loadCard({ data: { name: '柴郡' } });
eng.loadPreset(preset);

console.log('\n[1] 默认启用');
const list = eng.regexList('prompt');
ok('预设里的正则全读到', list.length === 7);
ok('按各自的 disabled 开关：没关的都开着，关着的保持关着',
   list.filter(s => !s.disabled).length === 6 && list.find(s => s.name === 'X-关着的').disabled);
ok('从名字认出思维链标签 <draft_notes>', JSON.stringify(eng.cotTags()) === '["draft_notes"]', JSON.stringify(eng.cotTags()));
ok('思维链的 <details> 折叠卡片（再长）也当隐藏，不当渲染器跳过', list.find(s => s.name === 'X-思维链美化').hideHtml === true);
ok('非思维链的 <details> 卡片不隐藏（特写内容要能看到）', !list.find(s => s.name === 'X-特写').hideHtml);

console.log('\n[2] 舞台上');
const raw = '<draft_notes>\n一大段思维链……\n</draft_notes>\n' +
  '『✨ 08:00 · 港区 · 晴 ✨』|旁白|-|\n「早上好呀～」|柴郡|微笑|\n' +
  '<SexualScene>\n柴郡的嘴：唇色偏粉。\n</SexualScene>\n' +
  '<w2g>\nA：去码头：跟柴郡去看补给\nB：吃早餐：先去餐厅\nC. 留下：处理文件\n</w2g>';
const r = eng.processOutput(raw);
const said = r.modules.map(m => m.text).join('|');
ok('思维链没演出来', !/思维链|draft_notes/.test(said), said);
ok('没有「旁白：w2g」这种只有标签名的句子', !r.modules.some(m => /^\/?(w2g|SexualScene|draft_notes)$/.test(m.text)), said);
const ch = r.modules.map(m => m.choices).filter(Boolean)[0] || [];
ok('<w2g> 行动选项变成了选项按钮（去掉 A：前缀）', JSON.stringify(ch) === JSON.stringify(['去码头：跟柴郡去看补给', '吃早餐：先去餐厅', '留下：处理文件']), JSON.stringify(ch));
ok('特写卡片的内容当旁白显示', /柴郡的嘴/.test(said), said);
ok('关着的正则没生效', /港区/.test(said));
const t2 = sb.Engine.tidyRenderBlocks('<Gal>\n<背景|港区>\n</Gal>\n<foo>\n台词|柴郡|笑|', [], []);
ok('剧本自己的 <Gal> <背景|…> 不会被当成落单标签删掉', /<Gal>/.test(t2) && /<背景\|港区>/.test(t2) && !/<foo>/.test(t2), t2);

console.log('\n[3] 发给模型');
eng.history = [{ role: 'assistant', content: '开场' }, { role: 'user', content: '你好' }, { role: 'assistant', content: eng.historyTextOf(raw) }];
const msgs = eng.dryRun('我们走吧').messages;
const all = msgs.map(m => m.content).join('\n');
ok('历史里没有思维链', !/一大段思维链/.test(all));
ok('玩家输入被包进 <player_input>，里面的 {{getvar}} 展开成预设设的值', /<player_input>\n我们走吧（按要求写）\n<\/player_input>/.test(all), all.slice(-200));
ok('没有残留的 {{…}}', !/\{\{[^}]*\}\}/.test(all), (all.match(/\{\{[^}]*\}\}/g) || []).join(' '));
ok('上一条 AI 输出被包进 <ai_last_output>', /<ai_last_output>[\s\S]*早上好呀[\s\S]*<\/ai_last_output>/.test(all));
ok('深度外的旧消息不包（「你好」深度 2，只包用户输入深度 ≤1 的）', !/<player_input>\n你好/.test(all));

console.log(`\n✓ ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
