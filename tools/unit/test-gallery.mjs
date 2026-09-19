/* gallery.js 单测：用一个假 GalStore 模拟 IndexedDB */
import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);
const sandbox = { console, setTimeout, clearTimeout };
sandbox.window = sandbox;
const kv = {};
sandbox.GalStore = {
  backend: () => 'idb',
  get: async k => kv[k],
  set: async (k, v) => { kv[k] = v; return v; },
  del: async k => { delete kv[k]; }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(P('core','gallery.js'),'utf8'), sandbox);
const G = sandbox.Gallery;
let pass=0, fail=0;
const ok=(n,c,x)=>c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(x?'\n      → '+x:'')));
const fakeSrc = n => 'data:image/png;base64,' + 'A'.repeat(n);

console.log('\n[1] 存与取');
const id1 = await G.put({ src: fakeSrc(4000), title: '夜市', turn: 0, prompt: 'city street, night', model: 'nai-diffusion-4-5-full', seed: 42, source: 'model' });
ok('put 返回 id', !!id1, id1);
const r1 = await G.get(id1);
ok('get 拿回图片本体', r1 && r1.src.length > 4000);
ok('元数据保留', r1.title === '夜市' && r1.seed === 42 && r1.source === 'model');
ok('src() 直接给 URL', (await G.src(id1)).startsWith('data:image/png'));

console.log('\n[2] 图片本体不进索引（这是整个模块存在的理由）');
const idxRow = kv['gallery:index'];
ok('索引里有这条', idxRow.length === 1);
ok('索引里没有 src 字段', !('src' in idxRow[0]), JSON.stringify(Object.keys(idxRow[0])));
ok('索引记了字节数', idxRow[0].bytes > 2900, String(idxRow[0].bytes));
ok('图片本体在自己的键里', !!kv['img:' + id1]);
const idxBytes = JSON.stringify(idxRow).length;
ok('索引本身很小（<1KB）', idxBytes < 1024, String(idxBytes));

console.log('\n[3] forSave —— 存档只带 id');
const save = await G.forSave();
ok('只有 id/turn/logIndex/title', JSON.stringify(Object.keys(save[0]).sort()) === '["id","logIndex","title","turn"]', JSON.stringify(Object.keys(save[0])));
ok('存档体积极小', JSON.stringify(save).length < 200, String(JSON.stringify(save).length));

console.log('\n[4] 列表与按轮次查');
await G.put({ src: fakeSrc(100), title: 'b', turn: 1 });
await G.put({ src: fakeSrc(100), title: 'c', turn: 1 });
ok('总共 3 张', (await G.list()).length === 3);
ok('按轮次筛出 2 张', (await G.byTurn(1)).length === 2);
ok('最新的排最前', (await G.list())[0].title === 'c');

console.log('\n[5] 收藏与删除');
await G.pin(id1, true);
ok('pin 生效', (await G.meta(id1)).pinned === true);
const some = (await G.list())[0].id;
await G.remove(some);
ok('remove 后索引少一条', (await G.list()).length === 2);
ok('remove 后图片本体也删了', !kv['img:' + some]);

console.log('\n[6] 超上限淘汰，收藏的不动');
G._reset(); for (const k in kv) delete kv[k];
const pinnedId = await G.put({ src: fakeSrc(100), title: '要留的', turn: 0, pinned: true });
for (let i = 0; i < 12; i++) await G.put({ src: fakeSrc(100), title: 't' + i, turn: i });
ok('淘汰前 13 张', (await G.list()).length === 13);
const dropped = await G.gc(5);
ok('gc 淘汰了 7 张（12 普通 - 留 5）', dropped === 7, String(dropped));
const left = await G.list();
ok('剩 5 张普通 + 1 张收藏 = 6', left.length === 6, String(left.length));
ok('收藏的还在', left.some(m => m.id === pinnedId));
ok('留下的是最新那批', left.some(m => m.title === 't11') && !left.some(m => m.title === 't0'));
ok('被淘汰的图片本体也清了', Object.keys(kv).filter(k => k.startsWith('img:')).length === 6, String(Object.keys(kv).filter(k => k.startsWith('img:')).length));

console.log('\n[7] IndexedDB 不可用时降级：图只留内存，不往 localStorage 塞');
G._reset(); for (const k in kv) delete kv[k];
sandbox.GalStore.backend = () => 'local';
const vid = await G.put({ src: fakeSrc(4000), title: '降级图', turn: 0 });
ok('索引照常记', (await G.list()).length === 1);
ok('标记成 volatile', (await G.meta(vid)).volatile === true);
ok('没往存储里塞图片本体', !kv['img:' + vid], JSON.stringify(Object.keys(kv)));
ok('本次会话内还能读到', (await G.src(vid)).length > 4000);
ok('forSave 跳过 volatile（读档回来必失效）', (await G.forSave()).length === 0);
const st = await G.stats();
ok('stats 报告不持久', st.persistent === false && st.volatile === 1);

console.log('\n' + (fail?'✗':'✓') + ' ' + pass + ' 过 / ' + fail + ' 挂\n');
process.exit(fail?1:0);
