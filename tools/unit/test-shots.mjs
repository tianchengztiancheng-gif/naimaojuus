import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);
const sandbox = { TextEncoder, console, setTimeout, clearTimeout }; sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(P('core','snapshot.js'),'utf8'), sandbox);
const S = sandbox.Snapshot;
let pass=0, fail=0;
const ok=(n,c,x)=>c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(x?'\n      → '+x:'')));

console.log('\n[8] 多镜头：每轮 2 张图只发 1 次解析请求');
let calls = 0, seenPrompt = '';
const twoShot = async (p) => { calls++; seenPrompt = p; return JSON.stringify({ shots: [
  { title:'推门', scenePrompt:'classroom, morning', characters:[{name:'柴郡',subject:'girl',prompt:'cat ears'}] },
  { title:'并肩', scenePrompt:'rooftop, sunset', characters:[{name:'柴郡',subject:'girl',prompt:'cat ears, smiling'}] }
]});};
const r = await S.resolveShots({ body:'一段剧情', shots:2, mode:'model', quiet:twoShot });
ok('拿到 2 个镜头', r.shots.length === 2, String(r.shots.length));
ok('只发了 1 次请求（不是 2 次）', calls === 1, String(calls));
ok('两个镜头确实不同', r.shots[0].scenePrompt !== r.shots[1].scenePrompt);
ok('提示词里要求了 2 个镜头', /shots 里放 2 个镜头/.test(seenPrompt));
ok('提示词要求镜头彼此不同', /不同的瞬间/.test(seenPrompt));

console.log('\n[9] 模型给少了 → 本地草稿补齐，不整轮退化');
const short = await S.resolveShots({ body:'剧情', shots:3, mode:'model', loc:'重樱神社',
  quiet: async () => JSON.stringify({ shots:[{ scenePrompt:'shrine, day' }] }) });
ok('补齐到 3 个', short.shots.length === 3, String(short.shots.length));
ok('第一个仍是模型给的', /shrine, day/.test(short.shots[0].scenePrompt));
ok('source 仍标 model', short.source === 'model', short.source);

console.log('\n[10] toShots 认三种形状');
ok('{shots:[…]}', S.toShots({shots:[{scenePrompt:'a'},{scenePrompt:'b'}]},2).length === 2);
ok('裸数组', S.toShots([{scenePrompt:'a'}],2).length === 1);
ok('单个对象（老格式）', S.toShots({scenePrompt:'a'},2).length === 1);
ok('超出上限时截断', S.toShots({shots:[{scenePrompt:'a'},{scenePrompt:'b'},{scenePrompt:'c'}]},2).length === 2);

console.log('\n[11] 多个内联 <image> → 多张图，零请求');
let n2 = 0;
const inl = await S.resolveShots({ body:'x', shots:2,
  inlinePrompts:['Scene Composition: classroom;','Scene Composition: rooftop;'],
  quiet: async () => { n2++; return '{}'; } });
ok('两个内联都用上', inl.shots.length === 2);
ok('没发任何请求', n2 === 0, String(n2));
ok('source=inline', inl.source === 'inline');

console.log('\n[12] 单张包装还能用');
const one = await S.resolve({ body:'x', mode:'model', quiet: async () => '{"shots":[{"scenePrompt":"beach"}]}' });
ok('resolve() 返回 context', /beach/.test(one.context.scenePrompt), one.context.scenePrompt);

console.log('\n' + (fail?'✗':'✓') + ' ' + pass + ' 过 / ' + fail + ' 挂\n');
process.exit(fail?1:0);
