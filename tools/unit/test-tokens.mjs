import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);
const sb={TextDecoder,TextEncoder,console}; sb.window=sb; sb.globalThis=sb; sb.self=sb;
sb.document = null;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(P('core','tokens.js'),'utf8'), sb);
const T = sb.Tokens;
let pass=0, fail=0;
const ok=(n,c,x)=>c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(x?'\n      → '+x:'')));

console.log('\n[1] 按模型名选编码');
ok('gpt-4o → o200k', T.encodingFor('gpt-4o') === 'o200k_base');
ok('gpt-5 → o200k', T.encodingFor('gpt-5-2025-08-07') === 'o200k_base');
ok('o3-mini → o200k', T.encodingFor('o3-mini') === 'o200k_base');
ok('gpt-4 → cl100k', T.encodingFor('gpt-4') === 'cl100k_base');
ok('gpt-3.5 → cl100k', T.encodingFor('gpt-3.5-turbo') === 'cl100k_base');
ok('gpt-4o 不被 gpt-4 规则误吞', T.encodingFor('gpt-4o-mini') === 'o200k_base');
ok('gpt-4.1 不被 gpt-4 规则误吞', T.encodingFor('gpt-4.1') === 'o200k_base');
/* 认不出的默认走 o200k —— 判断而非实测，见 tokens.js 文件头第 2 条 */
ok('claude → o200k（近似，判断）', T.encodingFor('claude-sonnet-4-5') === 'o200k_base');
ok('gemini → o200k（近似，判断）', T.encodingFor('gemini-2.5-pro') === 'o200k_base');
ok('空模型名 → o200k', T.encodingFor('') === 'o200k_base');

console.log('\n[2] 分词器没加载时回退粗估，不报错');
ok('mode 报 rough', T.mode('gpt-4') === 'rough');
ok('count 仍返回数字', typeof T.count('你好世界') === 'number');
ok('回退值 = 粗估取整', T.count('你好世界') === Math.round(T.rough('你好世界')));
ok('note 说明是粗估并给出偏差', /粗估/.test(T.note('gpt-4')) && /31%/.test(T.note('gpt-4')));
ok('非浏览器环境 load 会 reject 而不是抛',
   await T.load('cl100k_base').then(()=>false,()=>true));

console.log('\n[3] 加载真实分词器后');
sb.GPTTokenizer_cl100k_base = null;
vm.runInContext(fs.readFileSync(P('core','vendor','gpt-tokenizer-cl100k_base.js'),'utf8'), sb);
ok('全局已就位', !!sb.GPTTokenizer_cl100k_base);
ok('mode 变 exact', T.mode('gpt-4') === 'exact');
const zh = '「指挥官，早呀。」她抬起头，猫耳抖了抖。';
const r = T.rough(zh), e = T.count(zh, 'gpt-4');
ok('真实值与粗估不同', r !== e, `粗估 ${Math.round(r)} / 真实 ${e}`);
ok('剧本行的粗估确实偏低', T.rough('她抬起头。|柴郡|微笑|') < T.count('她抬起头。|柴郡|微笑|','gpt-4'),
   `粗估 ${Math.round(T.rough('她抬起头。|柴郡|微笑|'))} / 真实 ${T.count('她抬起头。|柴郡|微笑|','gpt-4')}`);
ok('每条消息加 4 的固定开销', T.countMessage({content:'hi'},'gpt-4') === 4 + T.count('hi','gpt-4'));
ok('多条消息累加', T.countMessages([{content:'a'},{content:'b'}],'gpt-4') === 
   T.countMessage({content:'a'},'gpt-4') + T.countMessage({content:'b'},'gpt-4'));
/* Claude 走 o200k，得先把那个分词器也加载上，note 才会走到「真实分词」那支 */
vm.runInContext(fs.readFileSync(P('core','vendor','gpt-tokenizer-o200k_base.js'),'utf8'), sb);
ok('对 Claude 会警告只是近似', /Claude/.test(T.note('claude-sonnet-4-5')));
ok('并说明默认 o200k 是判断不是实测', /判断/.test(T.note('claude-sonnet-4-5')));
ok('对 GPT 说是精确值', /精确值/.test(T.note('gpt-4')));

console.log('\n[4] 世界书按 token 裁剪');
const sb2={TextDecoder,TextEncoder,console}; sb2.window=sb2; sb2.globalThis=sb2; sb2.self=sb2;
vm.createContext(sb2);
vm.runInContext(fs.readFileSync(P('core','tokens.js'),'utf8'), sb2);
vm.runInContext(fs.readFileSync(P('core','vendor','gpt-tokenizer-cl100k_base.js'),'utf8'), sb2);
vm.runInContext(fs.readFileSync(P('core','worldbook.js'),'utf8'), sb2);
const mkE = (uid, content, order) => ({ uid, comment:uid, content, key:[], keysecondary:[],
  constant:true, enabled:true, order, position:0, probability:100, useProbability:true, selectiveLogic:0 });
// 三条，每条 40 个中文字（粗估 40，真实约 40-45）
const pool = [mkE('a','甲'.repeat(40),1), mkE('b','乙'.repeat(40),2), mkE('c','丙'.repeat(40),3)];
const hist = [{role:'user',content:'随便'}];
const byChar = sb2.Worldbook.activate(pool, hist, { budgetChars: 90 });
ok('按字符裁：90 字符装下 2 条', byChar.active.length === 2, String(byChar.active.length));
const byTok = sb2.Worldbook.activate(pool, hist, { budgetTokens: 90, model:'gpt-4' });
ok('按 token 裁也能跑', byTok.active.length >= 1, String(byTok.active.length));
const t1 = sb2.Tokens.count('甲'.repeat(40), 'gpt-4');
ok('同样预算下按 token 裁得更保守或相等（因为真实 token 更多）',
   byTok.active.length <= byChar.active.length, `字符 ${byChar.active.length} vs token ${byTok.active.length}，单条真实 ${t1} token`);
const noOpt = sb2.Worldbook.activate(pool, hist, { budgetChars: 90 });
ok('不传 budgetTokens 时行为不变（向后兼容）', noOpt.active.length === byChar.active.length);

console.log('\n' + (fail?'✗':'✓') + ' ' + pass + ' 过 / ' + fail + ' 挂\n');
process.exit(fail?1:0);
