import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);
const sandbox = { TextEncoder, console, setTimeout, clearTimeout, AbortController };
sandbox.window = sandbox;
const kv = {};
sandbox.GalStore = { backend:()=> 'idb', get:async k=>kv[k], set:async(k,v)=>{kv[k]=v;return v;}, del:async k=>{delete kv[k];} };
vm.createContext(sandbox);
for (const f of ['snapshot','gallery','cg']) vm.runInContext(fs.readFileSync(P('core', f + '.js'),'utf8'), sandbox);
const { CG, Gallery } = sandbox;

let pass=0, fail=0;
const ok=(n,c,x)=>c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(x?'\n      → '+x:'')));

const mk = (text, opt={}) => ({ text, who: opt.who||'柴郡', narration: !!opt.narration,
  bg: { loc: opt.loc||'港区', period:'夜' }, stage: (opt.stage||['柴郡']).map(n=>({name:n})) });

console.log('\n[1] 锚点挑选');
const turn = [
  mk('第一句', {loc:'港区'}),
  mk('她们走进店里，暖黄的灯光洒下来，桌上还摆着没收的餐具。', {narration:true, loc:'东煌餐饮店', stage:['柴郡','Z23']}),
  mk('短', {loc:'东煌餐饮店', stage:['柴郡','Z23']}),
  mk('嗯', {loc:'东煌餐饮店', stage:['柴郡','Z23']}),
  mk('也短', {loc:'东煌餐饮店', stage:['柴郡','Z23']}),
  mk('夜色压下来，港区的灯一盏盏亮起，海风带着咸味。', {narration:true, loc:'港区高台', stage:['柴郡','Z23','长门']}),
  mk('尾句', {loc:'港区高台', stage:['柴郡','Z23','长门']})
];
const a1 = CG.pickAnchors(turn, 1);
ok('要 1 张就给 1 个锚点', a1.length === 1, JSON.stringify(a1));
ok('挑的是换背景+群像+旁白那句', a1[0] === 1 || a1[0] === 5, JSON.stringify(a1));
const a2 = CG.pickAnchors(turn, 2);
ok('要 2 张就给 2 个', a2.length === 2, JSON.stringify(a2));
ok('两个锚点隔开（不挨着）', Math.abs(a2[0]-a2[1]) >= 2, JSON.stringify(a2));
ok('锚点从小到大', a2[0] < a2[1]);
ok('挑中的都是有画面的句子而不是「短」「嗯」', a2.every(i => turn[i].text.length > 3), JSON.stringify(a2.map(i=>turn[i].text)));
ok('perTurn=0 时不出图', CG.pickAnchors(turn, 0).length === 0);
ok('句子比要的图还少时全选', CG.pickAnchors([mk('a'),mk('b')], 3).length === 2);

console.log('\n[2] 打分信号');
const base = mk('一样长的一句话在这里', {loc:'港区', stage:['柴郡']});
ok('换背景加分', CG.score(mk('一样长的一句话在这里',{loc:'新地点'}), base) > CG.score(base, base));
ok('有人上台加分', CG.score(mk('一样长的一句话在这里',{loc:'港区',stage:['柴郡','长门']}), base) > CG.score(base, base));
ok('旁白比台词加分', CG.score(mk('一样长的一句话在这里',{loc:'港区',narration:true}), base) > CG.score(base, base));

console.log('\n[3] 跑一轮：解析 1 次 + 出图 N 次，id 挂到对应句子');
Gallery._reset(); for (const k in kv) delete kv[k];
let quietCalls = 0, genCalls = 0;
sandbox.ImageGen = { generate: async () => { genCalls++; return {
  src:'data:image/png;base64,'+'A'.repeat(200), mimeType:'image/png',
  model:'nai-diffusion-4-5-full', backend:'novelai', seed:1, prompt:'p', negativePrompt:'n' }; } };
const eng = { vars:{ 地点:'港区', 时间:{时段:'夜'}, 人物:{ 柴郡:{在场:true} } },
  log: turn.map((m,i)=>Object.assign({turn:3}, m)), quietContext: () => ({lore:'L', scene:'S'}) };
const evts = [];
const r = await CG.runTurn({
  eng, modules: turn, startIndex: 0, body: '正文', cfg: { enabled:true, perTurn:2 },
  quiet: async () => { quietCalls++; return JSON.stringify({shots:[
    {title:'进店', scenePrompt:'restaurant, indoors'}, {title:'高台', scenePrompt:'rooftop, night'}]}); },
  onUpdate: e => evts.push(e.type)
});
ok('出了 2 张', r.images.length === 2, String(r.images.length));
ok('解析只发 1 次请求', quietCalls === 1, String(quietCalls));
ok('出图调了 2 次', genCalls === 2, String(genCalls));
ok('id 挂到了对应的句子上', r.images.every(im => eng.log[im.logIndex].cg === im.id));
ok('两张挂在不同句子', r.images[0].logIndex !== r.images[1].logIndex);
ok('图进了相册', (await Gallery.list()).length === 2);
ok('相册记了 logIndex', (await Gallery.list()).every(m => m.logIndex >= 0));
ok('进度事件齐全', ['start','resolved','generating','image','done'].every(t => evts.includes(t)), JSON.stringify(evts));

console.log('\n[4] 关掉 / 出错的行为');
const off = await CG.runTurn({ eng, modules: turn, cfg: { enabled:false, perTurn:2 } });
ok('没开时直接跳过', off.skipped === true && off.images.length === 0);
const zero = await CG.runTurn({ eng, modules: turn, cfg: { enabled:true, perTurn:0 } });
ok('每轮 0 张时跳过', zero.skipped === true);

let n = 0;
sandbox.ImageGen.generate = async () => { n++; if (n === 1) throw new Error('429 限流'); return {
  src:'data:image/png;base64,AAAA', mimeType:'image/png', model:'m', backend:'novelai', seed:1 }; };
Gallery._reset(); for (const k in kv) delete kv[k];
const partial = await CG.runTurn({ eng, modules: turn, startIndex:0, body:'x', cfg:{enabled:true, perTurn:2},
  quiet: async () => JSON.stringify({shots:[{scenePrompt:'a'},{scenePrompt:'b'}]}), onUpdate: ()=>{} });
ok('第一张失败不影响第二张', partial.images.length === 1, String(partial.images.length));

sandbox.ImageGen.generate = async () => { throw new Error('文生图没开。到「设置 · 文生图」里打开。'); };
let stopped = 0;
await CG.runTurn({ eng, modules: turn, startIndex:0, body:'x', cfg:{enabled:true, perTurn:2},
  quiet: async () => JSON.stringify({shots:[{scenePrompt:'a'},{scenePrompt:'b'}]}),
  onUpdate: e => { if (e.type==='generating') stopped++; } });
ok('配置类错误整轮停掉，不白试第二张', stopped === 1, String(stopped));

console.log('\n[5] 解析失败时仍然用本地草稿出图（不整条断掉）');
Gallery._reset(); for (const k in kv) delete kv[k];
sandbox.ImageGen.generate = async () => ({ src:'data:image/png;base64,AAAA', mimeType:'image/png', model:'m', backend:'novelai', seed:1 });
const draft = await CG.runTurn({ eng, modules: turn, startIndex:0, body:'正文', cfg:{enabled:true, perTurn:1},
  quiet: async () => '模型不给 JSON', onUpdate: ()=>{} });
ok('照样出了图', draft.images.length === 1);
ok('标明来源是 local', draft.source === 'local', draft.source);
ok('带上了退化原因', !!draft.warning, draft.warning);


console.log('\n[6] 重画：删旧出新，但收藏过的不删');
Gallery._reset(); for (const k in kv) delete kv[k];
let gen = 0;
sandbox.ImageGen.generate = async () => ({ src:'data:image/png;base64,'+'B'.repeat(80+(gen++)),
  mimeType:'image/png', model:'m', backend:'novelai', seed:gen });
const eng2 = { vars:{ 地点:'港区', 时间:{时段:'夜'}, 人物:{} },
  log: turn.map((m,i)=>Object.assign({turn:3}, m)), quietContext: () => ({lore:'',scene:''}) };
const quiet2 = async () => JSON.stringify({shots:[{title:'重画的',scenePrompt:'rooftop, night'}]});

const first = await CG.runTurn({ eng: eng2, modules: turn, startIndex:0, body:'正文',
  cfg:{enabled:true, perTurn:1}, quiet: quiet2, onUpdate: ()=>{} });
const idx = first.images[0].logIndex;
const oldId = eng2.log[idx].cg;
ok('先有一张图', !!oldId);

await CG.regenerate({ eng: eng2, logIndex: idx, cfg:{enabled:true}, quiet: quiet2, body:'整轮正文' });
const newId = eng2.log[idx].cg;
ok('重画后换了新 id', newId && newId !== oldId, `${oldId} → ${newId}`);
ok('旧图被删掉，不留垃圾', (await Gallery.list()).every(m => m.id !== oldId));
ok('相册里只剩新的那张', (await Gallery.list()).length === 1);

await Gallery.pin(newId, true);
await CG.regenerate({ eng: eng2, logIndex: idx, cfg:{enabled:true}, quiet: quiet2, body:'整轮正文' });
const thirdId = eng2.log[idx].cg;
ok('再重画一次还是换了新图', thirdId !== newId);
ok('★ 收藏过的旧图保留下来了', (await Gallery.list()).some(m => m.id === newId),
   JSON.stringify((await Gallery.list()).map(m=>m.id)));
ok('收藏的那张仍标着 pinned', (await Gallery.meta(newId)).pinned === true);

console.log('\n[7] 给原本没有图的句子补一张');
const bare = 2;
ok('这句本来没图', !eng2.log[bare].cg);
await CG.regenerate({ eng: eng2, logIndex: bare, cfg:{enabled:true}, quiet: quiet2, body:'整轮正文' });
ok('补上了', !!eng2.log[bare].cg);
ok('没有误删别的图', (await Gallery.list()).some(m => m.id === newId));

console.log('\n' + (fail?'✗':'✓') + ' ' + pass + ' 过 / ' + fail + ' 挂\n');
process.exit(fail?1:0);
