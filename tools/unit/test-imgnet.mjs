/* 图片网络单测：直连 / 中转候选、「直连不通」判定与记忆、load 超时换中转、预加载封顶、诊断 */
import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'core', 'imgnet.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 造一个环境。net(src) 返回 'ok' | 'err' | 'hang' */
function env(net, store) {
  store = store || {};
  const sb = { console, setTimeout, clearTimeout, Date, Math, JSON, Promise, encodeURIComponent, decodeURIComponent };
  sb.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  sb.Image = class {
    constructor() { this.naturalWidth = 0; this.width = 0; this.onload = null; this.onerror = null; this._s = ''; }
    set src(v) {
      this._s = v;
      if (!v) return;
      const r = net(v);
      if (r === 'hang') return;
      setTimeout(() => {
        if (this._s !== v) return;
        if (r === 'ok') { this.naturalWidth = this.width = 100; this.onload && this.onload(); }
        else this.onerror && this.onerror();
      }, 5);
    }
    get src() { return this._s; }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(SRC, sb);
  return { N: sb.ImgNet, store, sb };
}
const CAT = 'https://files.catbox.moe/abc123.jpg';
const CAT2 = 'https://files.catbox.moe/def456.png';
const CAT3 = 'https://files.catbox.moe/ghi789.png';
const isRelay = s => s.startsWith('https://wsrv.nl/');

console.log('\n[1] 候选地址');
{
  const { N } = env(() => 'ok');
  const c = N.candidates(CAT);
  ok('自动模式：先直连，再中转', c[0] === CAT && isRelay(c[1]), JSON.stringify(c));
  ok('中转地址带完整原地址（编码过）、限长边、转 webp、不放大', c[1].includes(encodeURIComponent(CAT)) &&
     /&w=2048&h=2048&fit=inside&we&output=webp/.test(c[1]), c[1]);
  ok('中转地址能反推回原图', N.originOf(c[1]) === CAT);
  ok('gif 保留动图（n=-1）', /&n=-1/.test(N.relayOf('https://files.catbox.moe/x.gif')));
  ok('data: / 本地路径不碰', N.srcFor('data:image/png;base64,xx') === 'data:image/png;base64,xx' &&
     N.candidates('img/a.png').length === 1);
  N.setMaxEdge(1600);
  ok('手机上压到 1600', /&w=1600&h=1600/.test(N.relayOf(CAT)));
  N.setConfig({ mode: 'relay' });
  ok('总走中转：中转在前，直连兜底', isRelay(N.candidates(CAT)[0]) && N.candidates(CAT)[1] === CAT);
  N.setConfig({ mode: 'direct' });
  ok('只直连：只有直连', N.candidates(CAT).length === 1);
  N.setConfig({ mode: 'custom', tpl: 'https://my.proxy/img?u={url}' });
  ok('自定义中转：按模板换', N.candidates(CAT)[0] === 'https://my.proxy/img?u=' + encodeURIComponent(CAT));
  N.setConfig({ mode: 'custom', tpl: 'https://my.proxy/' });
  ok('自定义模板没写 {url}：退回自动', N.config().mode === 'auto');
  N.setConfig({ wait: 999 });
  ok('等图上限封顶 60 秒', N.config().wait === 60);
}

console.log('\n[2] 直连不通 → 改走中转，并且记住');
{
  const store = {};
  const events = [];
  const { N } = env(s => isRelay(s) ? 'ok' : 'err', store);
  N.on((t, h) => events.push(t + ':' + h));
  ok('一开始走直连', N.srcFor(CAT) === CAT);
  const alt = N.next(CAT);
  ok('直连挂了，下一个是中转', isRelay(alt), alt);
  ok('中转也挂了就没有下一个', N.next(alt) === null);
  N.next(CAT2);
  ok('同一个图床直连连挂两张（一张没成过）：判「直连不通」', N.stats()['files.catbox.moe'].bad > 0);
  ok('光判了不通、中转还没拉到图：先不提示', events.filter(e => e.startsWith('hostbad')).length === 0, events.join());
  N.note(N.relayOf(CAT3), true); N.note(N.relayOf(CAT2), true);
  ok('中转真拉到图了才提示「已改走中转」，只提示一次', events.filter(e => e.startsWith('hostbad')).length === 1, events.join());
  ok('之后这个图床的图直接用中转', isRelay(N.srcFor(CAT3)));
  ok('记进 localStorage', /files\.catbox\.moe/.test(store.gal_imgnet_hosts || ''));
  const again = env(() => 'ok', store).N;
  ok('下次打开页面：直接走中转，不再先等直连超时', isRelay(again.srcFor(CAT3)));
  again.note(CAT3, true);
  ok('直连又成功了一张：撤掉「直连不通」', !again.stats()['files.catbox.moe'].bad && again.srcFor(CAT) === CAT);
}
{
  const { N } = env(() => 'ok');
  N.note(CAT, true);
  N.next(CAT2); N.next(CAT3);
  ok('图床直连成功过：死链再多也不判不通（死链是常态）', !N.stats()['files.catbox.moe'].bad);
}
{
  const events = [];
  const { N } = env(() => 'err');
  N.on((t, h) => events.push(t));
  ['a', 'b', 'c'].forEach(k => { const u = 'https://files.catbox.moe/' + k + '.png'; const r = N.next(u); if (r) N.next(r); });
  ok('直连和中转都不通：发一次 allbad（让页面提示玩家查网络）', events.filter(e => e === 'allbad').length === 1, events.join());
  ok('都不通时不说「已改走中转」', !events.includes('hostbad'), events.join());
}

console.log('\n[3] load / preload');
{
  const { N } = env(s => isRelay(s) ? 'ok' : 'hang');
  const t0 = Date.now();
  const src = await N.load(CAT, 60);
  ok('直连一直挂着不回：超时后换中转', isRelay(src) && Date.now() - t0 < 1000, src);
  ok('拉成功的地址记住了', N.srcFor(CAT) === src);
  ok('再 load 直接给', await N.load(CAT) === src);
}
{
  const { N } = env(() => 'ok');
  const p1 = N.load(CAT), p2 = N.load(CAT);
  ok('同一张图同时只拉一次', p1 === p2);
  ok('data: 直接返回', await N.load('data:x') === 'data:x');
}
{
  const { N } = env(s => s.includes('slow') ? 'hang' : 'ok');
  const prog = [];
  const r = await N.preload([CAT, CAT, CAT2, 'data:x', 'https://files.catbox.moe/slow.png'],
    { wait: 0.3, onProgress: (d, t) => prog.push(d + '/' + t) });
  ok('去重、只拉外链（3 张）', r.total === 3, JSON.stringify(r));
  ok('到点就不等了（timedOut）', r.timedOut && r.ok === 2, JSON.stringify(r));
  ok('有进度回调', prog.join() === '1/3,2/3', prog.join());
  const r2 = await N.preload([CAT, CAT2]);
  ok('都在缓存里：立刻好', r2.ok === 2 && !r2.timedOut);
  let skip; const sp = new Promise(res => { skip = res; });
  const p3 = N.preload(['https://files.catbox.moe/slow2.png'], { wait: 30, skip: sp });
  skip();
  const r3 = await p3;
  ok('玩家点「不等了」立刻放行', r3.skipped === true);
  const r4 = await N.preload([], {});
  ok('没有图：直接 resolve', r4.total === 0);
}

console.log('\n[4] 诊断');
{
  const { N, sb } = env(() => 'ok');
  const calls = [];
  sb.AbortController = class { constructor() { this.signal = {}; } abort() {} };
  sb.fetch = (u) => {
    calls.push(u);
    if (u.startsWith('index.html')) return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve({ size: 2000 }) });
    if (isRelay(u)) return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve({ size: 110000 }) });
    if (u.includes('dead')) return Promise.resolve({ ok: false, status: 404, blob: () => Promise.resolve({ size: 10 }) });
    return Promise.reject(Object.assign(new TypeError('Failed to fetch'), {}));
  };
  const d = await N.diagnose([CAT, CAT2, 'https://huggingface.co/x/dead.png']);
  ok('每个图床只测一张', d.hosts.length === 2, JSON.stringify(d.hosts.map(h => h.host)));
  ok('本站通', d.site.ok);
  const cat = d.hosts[0];
  ok('catbox 直连不通（fetch 失败后又用 <img> 试了一次）', cat.direct.ok === true || cat.direct.via === 'img', JSON.stringify(cat.direct));
  ok('中转通，带大小', cat.relay.ok && cat.relay.bytes === 110000);
  const hf = d.hosts[1];
  ok('404：记下状态码（连上了，是图没了）', hf.direct.status === 404 && !hf.direct.ok);
  ok('测的时候不走缓存', calls.length >= 5);
}

console.log(`\n✓ ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
