/* 存档树单测：摘要、建树（分支 / 老存档兼容 / 重复导入）、自动节点裁剪 */
import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sb = { console, Date, Math, JSON };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'core', 'savetree.js'), 'utf8'), sb);
const T = sb.SaveTree;

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));
const J = x => JSON.stringify(x);

console.log('\n[1] 摘要');
const hist = [{ role: 'assistant', content: '开场' }, { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' },
              { role: 'assistant', content: '群聊', phoneOnly: true }, { role: 'user', content: 'c' }];
const log = [{ text: '『港区 · 白日』', narration: true }, { who: '柴郡', text: '指挥官，早上好呀～' }, { text: '『教室 · 黄昏』', narration: true }];
let s = T.summarize('node:n1', { at: 5, type: 'auto', tree: { rootId: 'r1', nodeId: 'n1', parentNodeId: 'n0' }, history: hist, log, opening: '默认开场' });
ok('轮数只数玩家说的话（手机群聊不算）', s.round === 2, s.round);
ok('摘要跳过『』抬头，取最后一句台词', s.summary === '柴郡：指挥官，早上好呀～', s.summary);
ok('树信息读出来', s.rootId === 'r1' && s.nodeId === 'n1' && s.parentNodeId === 'n0' && s.type === 'auto');
s = T.summarize('auto:r9', { at: 1, runId: 'r9', node: 'n5', history: hist });
ok('「最新进度」指针：type=latest，站在它记着的节点上', s.type === 'latest' && s.rootId === 'r9' && s.nodeId === 'n5' && s.auto === true, J(s));
s = T.summarize('我的存档', { at: 1, runId: 'r2', history: hist });
ok('老版本的手动存档：按 runId 归树，名字就是槽名', s.type === 'manual' && s.rootId === 'r2' && s.name === '我的存档');
s = T.summarize('老存档', { at: 1, history: [] });
ok('没有 runId 的老存档自成一棵树', s.rootId === 'solo:老存档');
ok('导入副本认得出来', T.summarize('x(导入2)', {}).imported === true && T.summarize('node:a', { imported: true }).imported === true);

console.log('\n[2] 建树');
const N = (id, at, parent, extra) => Object.assign({ id: 'node:' + id, at, type: 'auto', rootId: 'R', nodeId: id, parentNodeId: parent || '', kb: 1 }, extra || {});
let list = [
  N('root', 1, '', { name: '开场', opening: '默认开场' }),
  N('t1', 2, 'root'), N('t2', 3, 't1'), N('t3', 4, 't2'),
  N('b2', 5, 't1'),                                   // 读了 t1 之后另走一条路
  N('m1', 6, 'b2', { type: 'manual', name: '岔路口' }),
  { id: 'auto:R', at: 7, type: 'latest', rootId: 'R', nodeId: 'm1' }
];
let trees = T.buildTrees(list);
ok('一棵树', trees.length === 1);
const g = trees[0];
ok('指针不算节点（树里有节点时）', g.nodeCount === 6 && g.pointer && g.pointer.id === 'auto:R', g.nodeCount);
ok('数出 1 个分支（t1 下面分了两路）', g.branchCount === 1, g.branchCount);
ok('深度：root 0，t1 1，t2/b2 2，m1 3', J(g.nodes.map(n => [n.s.nodeId, n.depth])) ===
   J([['root', 0], ['t1', 1], ['t2', 2], ['t3', 3], ['b2', 2], ['m1', 3]]), J(g.nodes.map(n => [n.s.nodeId, n.depth])));
ok('最新节点标出来', g.nodes.filter(n => n.isLatest).map(n => n.s.nodeId)[0] === 'm1');
ok('树名取开局名', g.title === '默认开场');
trees = T.buildTrees([{ id: 'auto:old', at: 1, type: 'latest', rootId: 'old', nodeId: '' }]);
ok('老版本只有指针的开局：指针本身当节点显示', trees[0].nodeCount === 1 && trees[0].nodes[0].s.id === 'auto:old');
trees = T.buildTrees([N('a', 1), N('a', 2, '', { id: 'node:a(导入2)', imported: true })]);
ok('重复导入同一个节点：两份都在，不互相覆盖', trees[0].nodeCount === 2 && trees[0].nodes.length === 2);
trees = T.buildTrees([N('x', 1, 'gone')]);
ok('父节点不在了：自己当根，不报错', trees[0].nodes[0].depth === 0);
trees = T.buildTrees([N('a', 1), Object.assign(N('b', 9), { rootId: 'S' })]);
ok('多棵树按最近活动排序', trees[0].rootId === 'S');
ok('slotsOfTree 带上指针', J(T.slotsOfTree(list, 'R').sort()) === J(list.map(x => x.id).sort()));

console.log('\n[3] 自动节点裁剪');
list = [N('root', 0, '', { name: '开场' })];
for (let i = 1; i <= 12; i++) list.push(N('t' + i, i, i === 1 ? 'root' : 't' + (i - 1)));
let plan = T.planPrune(list, 'R', 't12', 8);
ok('13 个自动节点留 8 个', plan.del.length === 5, J(plan.del));
ok('当前节点和它的父节点不删', !plan.del.includes('node:t12') && !plan.del.includes('node:t11'));
const kept = list.filter(s => !plan.del.includes(s.id));
const orphan = kept.filter(s => s.parentNodeId && !kept.some(k => k.nodeId === s.parentNodeId) &&
  !plan.reparent.some(r => r.id === s.id));
ok('被删节点的子节点改挂到留下的祖先上，树不断', orphan.length === 0, J(plan.reparent));
list.push(N('m', 13, 't3', { type: 'manual', name: '手动' }));
plan = T.planPrune(list, 'R', 't12', 8);
ok('手动节点永远不删', !plan.del.includes('node:m'));
const mr = plan.reparent.filter(r => r.id === 'node:m')[0];
ok('挂在被删自动节点下面的手动节点，改挂到最近的留存祖先', !mr || !plan.del.includes('node:' + mr.parentNodeId), J(mr));
list = [N('a', 1), N('b', 2, 'a', { imported: true }), N('c', 3, 'b')];
plan = T.planPrune(list, 'R', 'c', 1);
ok('导入的节点不参与裁剪', !plan.del.includes('node:b'));
list = [N('x1', 1), N('x2', 2, 'x1'), Object.assign(N('y1', 3), { rootId: 'OTHER' })];
plan = T.planPrune(list, 'R', 'x2', 1);
ok('只裁这棵树的，不碰别的开局', !plan.del.includes('node:y1'));

console.log(`\n✓ ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
