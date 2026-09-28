/* 长期记忆（core/memory.js + Engine.memoryTick + 注入位置）（v5.26） */
import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);

const store = {};
const sb = { console, setTimeout, clearTimeout, AbortController, TextDecoder, Date, Math, JSON, Uint32Array,
  crypto: globalThis.crypto,
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } };
sb.window = sb;
sb.RESOURCE = { characters: {}, defaults: {}, scenes: {} };
vm.createContext(sb);
for (const f of ['regex', 'worldbook', 'prompt', 'script', 'resolver', 'phone', 'memory', 'engine', 'api', 'editors'])
  vm.runInContext(fs.readFileSync(P('core', f + '.js'), 'utf8'), sb);
const { Memory: M, Engine } = sb;

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));
const J = x => JSON.stringify(x);

/** n 轮对话：每轮一对 user / assistant */
function turns(n, start = 1) {
  const h = [];
  for (let i = start; i < start + n; i++) {
    h.push({ role: 'user', content: '第' + i + '轮我说的话' });
    h.push({ role: 'assistant', content: '<Gal>\n「第' + i + '轮，柴郡的回答。」|柴郡|微笑|\n第' + i + '轮的旁白。|旁白|-|\n</Gal>\n<UpdateVariable>[{"op":"replace"}]</UpdateVariable>\n[短信|柴郡|文字|手机里的话' + i + ']' });
  }
  return h;
}
const CFG = { enabled: true, keepTurns: 4, chunkTurns: 3, maxChars: 3600 };

console.log('\n[1] 什么时候整理、整理哪一段');
{
  const mem = M.fresh();
  ok('原文没超过「保留 + 一块」：不整理', M.plan(mem, turns(6), CFG) === null);
  const h = turns(7);
  const r = M.plan(mem, h, CFG);
  ok('超过了：整理最早的一块（3 轮 = 6 条）', r && r.from === 0 && r.to === 6, J(r));
  ok('块的末尾是一轮的结尾（assistant）', h[r.to - 1].role === 'assistant');
  ok('整理完原文还剩保留的轮数以上', h.length - r.to >= CFG.keepTurns * 2);
  ok('没开记忆：不整理', M.plan(mem, h, { ...CFG, enabled: false }) === null);
  ok('「现在整理」：不够一块也整理保留轮数之外的', J(M.planNow(mem, turns(6), CFG)) === J({ from: 0, to: 4 }));
  const withOpen = [{ role: 'assistant', content: '开场白' }].concat(turns(7));
  const ro = M.plan(mem, withOpen, CFG);
  ok('开头有开场白（多一条 assistant）：块尾往后挪一条，还是整 3 轮', ro && ro.from === 0 && ro.to === 7 && withOpen[6].role === 'assistant', J(ro));
  ok('「现在整理」：全在保留轮数以内就没得整理', M.planNow(mem, turns(4), CFG) === null);
}

console.log('\n[2] 发给模型的原文窗口');
{
  const h = turns(30), mem = M.fresh();
  ok('没开记忆：老行为，最近 40 条', M.windowOf(mem, h, { enabled: false }, 40).length === 40);
  const cap = (CFG.keepTurns + CFG.chunkTurns) * 2 + 2;
  ok('开了但还没记忆：封顶 ' + cap + ' 条', M.windowOf(mem, h, CFG).length === cap);
  mem.chunks.push(M.makeChunk(h, { from: 0, to: 50 }, '- 前情'));
  ok('记忆覆盖到第 50 条：只发后面的', M.windowOf(mem, h, CFG).length === 10 && M.windowOf(mem, h, CFG)[0] === h[50]);
}

console.log('\n[3] 指纹：撤回 / 重roll / 换分支后自动作废');
{
  const h = turns(10), mem = M.fresh();
  mem.chunks.push(M.makeChunk(h, { from: 0, to: 6 }, '- A'), M.makeChunk(h, { from: 6, to: 12 }, '- B'));
  ok('两块都对得上', M.valid(mem, h).length === 2 && M.covered(mem, h) === 12);
  ok('块上记着第几轮', mem.chunks[0].fromTurn === 1 && mem.chunks[0].toTurn === 3 && mem.chunks[1].fromTurn === 4 && mem.chunks[1].toTurn === 6);
  const h2 = h.slice(); h2[11] = { role: 'assistant', content: '另一个分支' };
  ok('第二块覆盖的最后一条变了：第二块作废，第一块留着', M.valid(mem, h2).length === 1 && M.covered(mem, h2) === 6);
  ok('历史短了（撤回到覆盖范围里）：超出的块作废', M.valid(mem, h.slice(0, 10)).length === 1);
  const m2 = JSON.parse(J(mem)); m2.chunks.splice(0, 1);
  ok('中间断了（不连续）：后面的都不认', M.valid(m2, h).length === 0);
  const m3 = JSON.parse(J(mem));
  ok('prune 真的删掉作废的块', M.prune(m3, h2) === 1 && m3.chunks.length === 1);
}

console.log('\n[4] 原文整理成可读的记录');
{
  const t = M.transcript(turns(2), { userName: '老王' });
  ok('玩家的话带名字', /【老王】第1轮我说的话/.test(t));
  ok('台词写成「谁：说什么」，旁白原样', /柴郡：「第1轮，柴郡的回答。」/.test(t) && /\n第1轮的旁白。/.test(t), t);
  ok('变量更新、手机标记不进记录', !/UpdateVariable|短信|手机里的话/.test(t), t);
  const p = M.summaryPrompt(M.fresh(), turns(7), { from: 0, to: 6 }, { userName: '老王' });
  ok('整理指令：独立任务、写清第几轮、带原文、要求保留约定和关系变化', /独立任务 · 剧情记忆整理/.test(p) && /第 1～3 轮/.test(p) &&
     /第3轮，柴郡的回答/.test(p) && !/第4轮/.test(p) && /约定/.test(p) && /关系变化/.test(p), p.slice(0, 300));
}

console.log('\n[5] 注入：记忆块在对话历史前面，备忘永远带上');
{
  const preset = { prompts: [{ identifier: 'main', role: 'system', content: '主提示' }, { identifier: 'chatHistory', marker: true }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }] };
  const eng = new Engine();
  eng.loadPreset(preset);
  eng.memCfg = CFG;
  eng.history = turns(20);
  const main = M.mainHist(eng.history);
  eng.memory.chunks.push(M.makeChunk(main, { from: 0, to: 20 }, '- 柴郡答应周末去海边'));
  eng.memory.notes = 'Z23 知道了我的真实身份';
  const msgs = eng.dryRun('下一句').messages.map(m => m.content);
  const all = msgs.join('\n@@\n');
  const iMem = msgs.findIndex(x => /<剧情记忆>/.test(x));
  ok('记忆块发出去了，带备忘', iMem >= 0 && /柴郡答应周末去海边/.test(msgs[iMem]) && /Z23 知道了我的真实身份/.test(msgs[iMem]));
  ok('位置：主提示之后、对话历史之前', all.indexOf('主提示') < all.indexOf('<剧情记忆>') &&
     all.indexOf('</剧情记忆>') < all.indexOf('我说的话'), all.slice(0, 300));
  ok('被记忆覆盖的原文不再发', !msgs.some(x => /第10轮我说的话/.test(x)));
  eng.memCfg = { ...CFG, enabled: false };
  const off = eng.dryRun('下一句').messages.map(m => m.content).join('\n');
  ok('关掉记忆：记忆块不发，备忘照发，原文回到最近 40 条', !/柴郡答应周末去海边/.test(off) && /真实身份/.test(off) && /第1轮我说的话/.test(off));
}

console.log('\n[6] Engine.memoryTick');
{
  const eng = new Engine();
  eng.memCfg = { ...CFG, maxChars: 800 };
  eng.history = turns(7);
  eng.history.splice(3, 0, { role: 'assistant', content: '[群聊|闲聊|甲|文字|手机]', phoneOnly: true });
  const sent = [];
  const send = async (msgs) => { sent.push(msgs[0].content); return /压缩/.test(msgs[0].content) ? '- 合并后的前情' : '<think>想一想</think>- 第' + sent.length + '块要点：柴郡答应了约会' + '。细节'.repeat(100); };
  let r = await eng.memoryTick({ send });
  ok('够一块：整理一块（手机记录不算主线）', r.added === 1 && eng.memory.chunks.length === 1 && eng.memory.chunks[0].to === 6, J(r));
  ok('思维链剥掉了', !/想一想/.test(eng.memory.chunks[0].text) && /约会/.test(eng.memory.chunks[0].text));
  r = await eng.memoryTick({ send });
  ok('不够下一块：什么都不做、不发请求', r.added === 0 && sent.length === 1);
  eng.history = eng.history.concat(turns(6, 8));
  r = await eng.memoryTick({ send });
  ok('攒够了又整理（追赶时一次可以整理多块）', r.added === 2 && eng.memory.chunks.length >= 1, J(r));
  ok('总字数超上限：最早的几块合并成前情提要', r.merged >= 2 && eng.memory.chunks[0].merged && /合并后的前情/.test(eng.memory.chunks[0].text), J(eng.memory.chunks.map(c => c.text)));
  ok('合并后仍然连续、对得上', M.valid(eng.memory, M.mainHist(eng.history)).length === eng.memory.chunks.length);
  /* 请求期间撤回了：这一块不要 */
  const e2 = new Engine(); e2.memCfg = CFG; e2.history = turns(7);
  const r2 = await e2.memoryTick({ send: async () => { e2.history = e2.history.slice(0, 4); return '- 过时的'; } });
  ok('整理期间历史变了（撤回 / 读档）：结果丢掉', r2.added === 0 && e2.memory.chunks.length === 0);
  let threw = false;
  try { await new Engine({}).memoryTick({ send: async () => '' }); } catch (e) { threw = true; }
  ok('没什么可整理时空回也不报错', !threw);
  const e3 = new Engine(); e3.memCfg = CFG; e3.history = turns(7);
  threw = false;
  try { await e3.memoryTick({ send: async () => '   ' }); } catch (e) { threw = true; }
  ok('总结回来是空的：报错（界面提示），不存空块', threw && e3.memory.chunks.length === 0);
}

console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
process.exit(fail ? 1 : 0);
