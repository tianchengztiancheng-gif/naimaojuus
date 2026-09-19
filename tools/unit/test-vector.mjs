import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);
const sb={console,setTimeout,clearTimeout}; sb.window=sb;
const kv={};
sb.GalStore={ backend:()=> 'idb', get:async k=>kv[k], set:async(k,v)=>{kv[k]=v;return v;}, del:async k=>{delete kv[k];} };
let embedCalls=0, embedInputs=[];
sb.GalAPI={ loadConfig:()=>({baseUrl:'https://api.example.com', apiKey:'k', model:'gpt-4'}) };
/* 假 embeddings：按文本里的关键字造一个可预测的向量 */
const AXES=['甜','海','战','猫'];
function fakeVec(t){ return AXES.map(a => (String(t).split(a).length-1) + 0.01); }
sb.fetch = async (url, init) => {
  embedCalls++;
  const body = JSON.parse(init.body);
  const inputs = Array.isArray(body.input)? body.input : [body.input];
  embedInputs.push({url, model: body.model, n: inputs.length, dims: body.dimensions});
  return { ok:true, status:200, headers:{get:()=>'application/json'},
    json: async () => ({ data: inputs.map((t,i)=>({index:i, embedding: fakeVec(t)})) }) };
};
vm.createContext(sb);
vm.runInContext(fs.readFileSync(P('core','vector.js'),'utf8'), sb);
const V = sb.Vector;
let pass=0, fail=0;
const ok=(n,c,x)=>c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(x?'\n      → '+x:'')));

const mk=(uid,comment,content,constant=false)=>({uid,comment,content,key:[],enabled:true,constant,order:100});
const pool=[
  mk('e1','甜品厅','港区的甜品厅，甜甜的蛋糕和布丁，柴郡最爱来这里。'),
  mk('e2','海滩','夏天的海滩，泳装活动。'),
  mk('e3','演习','战斗演习规则，战术训练。'),
  mk('e4','柴郡','猫耳，猫猫，黏人。'),
  mk('e5','蓝灯','这条是常驻的', true)
];

console.log('\n[1] 默认关着，不发任何请求');
ok('默认 enabled=false', V.config().enabled === false);
ok('关着时 query 返回空', (await V.query([{role:'user',content:'甜'}], pool)).length === 0);
ok('确实没发请求', embedCalls === 0, String(embedCalls));

console.log('\n[2] 建索引：一次性，按内容哈希缓存');
V.configure({enabled:true, threshold:0.2, topK:3});
const r1 = await V.buildIndex(pool);
ok('索引了 5 条', r1.built === 5, JSON.stringify(r1));
const callsAfterFirst = embedCalls;
const r2 = await V.buildIndex(pool);
ok('再建一次全部命中缓存', r2.built === 0 && r2.skipped === 5, JSON.stringify(r2));
ok('没有重复发请求（不重复花钱）', embedCalls === callsAfterFirst, String(embedCalls));
pool[0].content += '新增一句改了内容';
const r3 = await V.buildIndex(pool);
ok('只有改过的那条重算', r3.built === 1 && r3.skipped === 4, JSON.stringify(r3));

console.log('\n[3] 端点与参数');
ok('自动补 /v1/embeddings', embedInputs[0].url === 'https://api.example.com/v1/embeddings', embedInputs[0].url);
ok('用的是嵌入模型而不是对话模型', embedInputs[0].model === 'text-embedding-3-small', embedInputs[0].model);
ok('带上 dimensions（embedding-3 支持）', embedInputs[0].dims === 512, String(embedInputs[0].dims));
ok('批量发送而不是一条一请求', embedInputs[0].n === 5, String(embedInputs[0].n));
V.configure({model:'bge-m3'});
await V.clearIndex(); embedInputs=[]; await V.buildIndex(pool);
ok('非 embedding-3 模型不带 dimensions（带了会 400）', embedInputs[0].dims === undefined, String(embedInputs[0].dims));
V.configure({model:'text-embedding-3-small'});
await V.clearIndex(); await V.buildIndex(pool);

console.log('\n[4] 语义补捞：关键词一个字都不沾也能捞到');
const hits = await V.query([{role:'user',content:'今天想吃点甜的东西'}], pool, {turn:1});
ok('捞到了东西', hits.length > 0, String(hits.length));
ok('最相关的是甜品厅', hits[0].entry.uid === 'e1', hits[0].entry.uid);
ok('蓝灯常驻条目不参与（本来就每轮都在）', !hits.some(h=>h.entry.uid==='e5'));

console.log('\n[5] 只追加，不挤掉关键词已命中的');
const ex = await V.query([{role:'user',content:'甜'}], pool, {turn:1, exclude:[pool[0]]});
ok('被排除的条目不再出现', !ex.some(h=>h.entry.uid==='e1'), JSON.stringify(ex.map(h=>h.entry.uid)));

console.log('\n[6] 阈值与条数');
V.configure({threshold:0.01});
const all = await V.query([{role:'user',content:'甜'}], pool, {turn:1});
const maxRaw = Math.max(...all.map(h=>h.raw));
V.configure({threshold: Math.min(0.999999, maxRaw + 1e-6)});
ok('阈值提到最高分之上就捞不到（宁缺毋滥）',
   (await V.query([{role:'user',content:'甜'}], pool, {turn:1})).length === 0,
   '最高 raw ' + maxRaw.toFixed(6));
V.configure({threshold:0.01, topK:2});
ok('topK 限制条数', (await V.query([{role:'user',content:'甜海战猫'}], pool, {turn:1})).length === 2);
V.configure({threshold:0.2, topK:5});

console.log('\n[7] 时间衰减');
V.configure({decayTurns:6, decayStrength:0.45});
V.resetDecay();
ok('没注入过 → 不降权', V.decayFactor('e1', 5) === 1);
V.noteActivated([pool[0]], 10);
ok('刚注入过 → 压到 0.55', Math.abs(V.decayFactor('e1', 10) - 0.55) < 1e-9, String(V.decayFactor('e1',10)));
ok('隔 3 轮 → 恢复到 0.775', Math.abs(V.decayFactor('e1', 13) - 0.775) < 1e-9, String(V.decayFactor('e1',13)));
ok('隔 6 轮 → 完全恢复', V.decayFactor('e1', 16) === 1);
ok('蓝灯不登记衰减', (V.noteActivated([pool[4]], 10), V.decayFactor('e5', 10) === 1));
const decayed = await V.query([{role:'user',content:'甜'}], pool, {turn:10});
const d1 = decayed.filter(h=>h.entry.uid==='e1')[0];
ok('降权体现在 score 上而 raw 不变', d1 && d1.score < d1.raw, d1 ? `raw ${d1.raw.toFixed(3)} score ${d1.score.toFixed(3)}` : 'no hit');
V.configure({decayStrength:0});
ok('衰减强度 0 = 不衰减', V.decayFactor('e1', 10) === 1);
V.configure({decayStrength:0.45});

console.log('\n[8] 端点不支持 embeddings 时安静退回，不影响游戏');
sb.fetch = async () => ({ ok:false, status:404, text: async()=>'Not Found' });
const dead = await V.query([{role:'user',content:'甜'}], pool, {turn:1});
ok('query 返回空数组而不是抛错', Array.isArray(dead) && dead.length === 0);
const st = await V.stats(pool);
ok('报错记在 stats 里，界面能显示', /404/.test(st.lastError), st.lastError);
ok('错误信息解释了「多数中转不转发嵌入接口」', /中转/.test(st.lastError), st.lastError);
let threw = false;
try { await V.buildIndex(pool.map(e=>({...e, content:e.content+'x'}))); } catch(e){ threw = true; }
ok('建索引失败会抛给界面（那是用户主动点的）', threw);

console.log('\n[9] 存储体积');
sb.fetch = async (url, init) => { const b=JSON.parse(init.body); const ins=Array.isArray(b.input)?b.input:[b.input];
  return { ok:true, status:200, headers:{get:()=>'application/json'},
    json: async()=>({data: ins.map((t,i)=>({index:i, embedding: Array.from({length:512},(_,j)=>Math.sin(i*j)*0.123456789)}))}) }; };
await V.clearIndex(); await V.buildIndex(pool);
const idxJson = JSON.stringify(kv['vector:index']);
ok('向量压到 4 位小数', !/0\.\d{6,}/.test(idxJson), idxJson.slice(0,80));
const perEntry = idxJson.length/5;
ok('单条约 4KB 量级（166 条约 0.7MB，IndexedDB 扛得住）', perEntry < 6000, Math.round(perEntry)+' 字节/条');

console.log('\n' + (fail?'✗':'✓') + ' ' + pass + ' 过 / ' + fail + ' 挂\n');
process.exit(fail?1:0);
