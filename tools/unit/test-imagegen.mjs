/* imagegen.js 单测：不发网络请求，只验编译、请求体、尺寸、ZIP 解包 */
import fs from 'fs';
import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);

const src = fs.readFileSync(P('core','imagegen.js'), 'utf8');
const sandbox = {
  Blob, Response, DecompressionStream, fetch, AbortController,
  setTimeout, clearTimeout, console
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const IG = sandbox.ImageGen;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      → ' + extra : '')); }
}

console.log('\n[1] sanitize —— 脏货过滤');
const dirty = IG.sanitize('1girl, 蓝色头发, blue hair, NovelAI workflow, blue hair, do not output json, smiling');
ok('中文段被剔掉', !/[一-鿿]/.test(dirty), dirty);
ok('元描述 NovelAI/workflow 被剔掉', !/novelai|workflow/i.test(dirty), dirty);
ok('"do not output" 控制句被剔掉', !/do not output/i.test(dirty), dirty);
ok('重复的 blue hair 去重', (dirty.match(/blue hair/g) || []).length === 1, dirty);
ok('正常标签保留', /1girl/.test(dirty) && /smiling/.test(dirty), dirty);

console.log('\n[2] snapSize —— 必须是 64 的倍数');
ok('1216x832 原样通过', JSON.stringify(IG.snapSize('1216x832')) === '{"width":1216,"height":832}');
ok('1000x700 吸附到 64 倍数', (() => { const s = IG.snapSize('1000x700'); return s.width % 64 === 0 && s.height % 64 === 0; })(), JSON.stringify(IG.snapSize('1000x700')));
ok('默认尺寸像素数在免费档内 (<=1048576)', 1216 * 832 <= 1048576, String(1216 * 832));

console.log('\n[3] compilePrompt —— 多角色分段与站位');
const ctx = {
  scenePrompt: 'port district, shopping street, evening, warm light',
  sceneNegativePrompt: 'solo',
  characters: [
    { name: '柴郡', subjectType: 'girl', visualPrompt: 'cat ears, blue eyes, white hair', negativePrompt: 'bad hands' },
    { name: '长门', subjectType: 'girl', visualPrompt: 'miko outfit, long black hair', negativePrompt: '' }
  ]
};
const c = IG.compilePrompt({ model: 'nai-diffusion-4-5-full', prompt: '', context: ctx, ucPreset: 'heavy' });
ok('两个角色都编译出来', c.characterPrompts.length === 2, JSON.stringify(c.characterPrompts.map(x => x.name)));
ok('站位横向均分 (1/3, 2/3)', Math.abs(c.characterPrompts[0].center.x - 1 / 3) < 1e-6 && Math.abs(c.characterPrompts[1].center.x - 2 / 3) < 1e-6);
ok('人数标签自动加上 2girls', /2girls/.test(c.basePrompt), c.basePrompt);
ok('画质词来自模型档案', /very aesthetic/.test(c.basePrompt), c.basePrompt);
ok('多角色时负面词里的 solo 被剔掉', !/\bsolo\b/.test(c.uc), c.uc);
ok('UC 预设 Heavy 生效', /lowres/.test(c.uc), c.uc.slice(0, 60));

const solo = IG.compilePrompt({
  model: 'nai-diffusion-4-5-full', prompt: '',
  context: { scenePrompt: 'classroom', characters: [{ name: 'A', subjectType: 'girl', visualPrompt: 'blonde hair' }] },
  ucPreset: 'heavy'
});
ok('单角色站位居中 0.5', solo.characterPrompts[0].center.x === 0.5);
ok('单角色人数标签是 1girl', /1girl\b/.test(solo.basePrompt), solo.basePrompt);

console.log('\n[4] buildPayload —— V4.5 要 v4_prompt，V3 不能有');
const p45 = IG.buildPayload({ model: 'nai-diffusion-4-5-full', size: '1216x832', ucPreset: 'heavy', sampler: 'k_euler_ancestral', noiseSchedule: 'karras' }, { context: ctx }, 12345).payload;
ok('action=generate', p45.action === 'generate');
ok('V4.5 带 v4_prompt', !!p45.parameters.v4_prompt);
ok('v4_prompt 里两个 char_caption', p45.parameters.v4_prompt.caption.char_captions.length === 2);
ok('每个 char_caption 带 centers', p45.parameters.v4_prompt.caption.char_captions.every(x => Array.isArray(x.centers) && x.centers.length === 1));
ok('V4.5 带 v4_negative_prompt', !!p45.parameters.v4_negative_prompt);
ok('seed 透传', p45.parameters.seed === 12345);
ok('步数取模型推荐 23（免费档 ≤28）', p45.parameters.steps === 23, String(p45.parameters.steps));
ok('宽高进了 parameters', p45.parameters.width === 1216 && p45.parameters.height === 832);

const p3 = IG.buildPayload({ model: 'nai-diffusion-3', size: '1024x1024', ucPreset: 'heavy' }, { context: ctx }, 7).payload;
ok('V3 不带 v4_prompt', !p3.parameters.v4_prompt);
ok('V3 不带角色分段', p3.parameters.characterPrompts.length === 0);

const custom = IG.buildPayload({ model: 'nai-diffusion-4-5-full', parameterMode: 'custom', steps: 50, cfgScale: 9, size: '1216x832' }, { prompt: 'a cat' }, 1).payload;
ok('custom 模式下用自填步数', custom.parameters.steps === 50);
ok('model_default 模式忽略自填步数', p45.parameters.steps === 23);

console.log('\n[5] 零成本路径 —— 没有 context 时走单段 prompt');
const bare = IG.compilePrompt({ model: 'nai-diffusion-4-5-full', prompt: 'girl, long hair, sunset, rooftop', ucPreset: 'light' });
ok('单段 prompt 进 basePrompt', /rooftop/.test(bare.basePrompt), bare.basePrompt);
ok('没有角色分段', bare.characterPrompts.length === 0);
ok('没有人数标签', !/\d+girls?/.test(bare.basePrompt), bare.basePrompt);

console.log('\n[6] ZIP 解包 —— NAI 回的是 zip 不是 png');
const zipBytes = new Uint8Array(fs.readFileSync(P('tools','unit','nai.zip')));
const entry = IG.findImageEntry(zipBytes);
ok('找到图片条目', !!entry, JSON.stringify(entry));
ok('文件名对', entry && entry.filename === 'image_0.png', entry && entry.filename);
ok('压缩方式是 deflate(8)', entry && entry.method === 8, entry && String(entry.method));

const raw = zipBytes.slice(entry.offset, entry.offset + entry.size);
const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
const out = new Uint8Array(await new Response(stream).arrayBuffer());
ok('解出来是合法 PNG 头', out[0] === 0x89 && out[1] === 0x50 && out[2] === 0x4e && out[3] === 0x47,
   Array.from(out.slice(0, 4)).join(','));
ok('解出来长度对 (70)', out.length === 70, String(out.length));

console.log('\n[7] 错误信息分级');
const e401 = IG.describeHttpError(401, '', 'nai-diffusion-4-5-full');
ok('401 说的是 token 不是额度', /Token/.test(e401) && !/额度不足/.test(e401));
ok('401 提示要用持久 token', /持久 token/.test(e401));
const e402 = IG.describeHttpError(402, '', 'nai-diffusion-4-5-full');
ok('402 说明免费档的两个门槛', /1,048,576/.test(e402) && /28/.test(e402), e402);
const e400 = IG.describeHttpError(400, '', 'nai-diffusion-4-5-full');
ok('400 首先提尺寸 64 倍数', /64 的倍数/.test(e400));

console.log('\n[8] ZIP 六种形态 —— NAI 实际回的是流式包');
import('zlib').then(async ({ default: zlib }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  /** 造一个 zip。stream=true 时本地头长度写 0、真实长度放 data descriptor（NAI 就是这样） */
  function mk({ stream = false, cd = true, store = false, extraFile = false, comment = 0 } = {}) {
    const data = store ? png : zlib.deflateRawSync(png);
    const method = store ? 0 : 8;
    const crc = zlib.crc32 ? zlib.crc32(png) : 0;
    const parts = [], central = [];
    let off = 0;
    const add = (nameStr, body, isStream) => {
      const name = Buffer.from(nameStr);
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
      lh.writeUInt16LE(isStream ? 0x08 : 0, 6);
      lh.writeUInt16LE(method, 8);
      lh.writeUInt32LE(isStream ? 0 : crc, 14);
      lh.writeUInt32LE(isStream ? 0 : body.length, 18);
      lh.writeUInt32LE(isStream ? 0 : png.length, 22);
      lh.writeUInt16LE(name.length, 26);
      const chunk = [lh, name, body];
      if (isStream) {
        const dd = Buffer.alloc(16);
        dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc, 4);
        dd.writeUInt32LE(body.length, 8); dd.writeUInt32LE(png.length, 12);
        chunk.push(dd);
      }
      const cdr = Buffer.alloc(46);
      cdr.writeUInt32LE(0x02014b50, 0); cdr.writeUInt16LE(isStream ? 0x08 : 0, 8);
      cdr.writeUInt16LE(method, 10); cdr.writeUInt32LE(crc, 16);
      cdr.writeUInt32LE(body.length, 20); cdr.writeUInt32LE(png.length, 24);
      cdr.writeUInt16LE(name.length, 28); cdr.writeUInt32LE(off, 42);
      central.push(cdr, name);
      chunk.forEach(b => { parts.push(b); off += b.length; });
    };
    if (extraFile) add('meta.json', Buffer.from('{"a":1}'), false);
    add('image_0.png', data, stream);
    if (!cd) return new Uint8Array(Buffer.concat(parts));
    const cdOff = off;
    const cdBuf = Buffer.concat(central);
    const cmt = Buffer.alloc(comment, 0x78);
    const eo = Buffer.alloc(22);
    eo.writeUInt32LE(0x06054b50, 0);
    eo.writeUInt16LE(extraFile ? 2 : 1, 8); eo.writeUInt16LE(extraFile ? 2 : 1, 10);
    eo.writeUInt32LE(cdBuf.length, 12); eo.writeUInt32LE(cdOff, 16);
    eo.writeUInt16LE(comment, 20);
    return new Uint8Array(Buffer.concat([...parts, cdBuf, eo, cmt]));
  }

  async function unpack(bytes) {
    const e = IG.findImageEntry(bytes);
    if (!e) return null;
    const raw = bytes.slice(e.offset, e.offset + e.size);
    const out = e.method === 0 ? raw
      : new Uint8Array(await new Response(new Blob([raw]).stream()
          .pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    return { e, out };
  }
  const isPng = o => o && o[0] === 0x89 && o[1] === 0x50 && o.length === 70;

  const cases = [
    ['普通包（本地头有长度）', {}],
    ['流式包 + 中央目录 ← NAI 实际形态', { stream: true }],
    ['流式包 + 中央目录被截断', { stream: true, cd: false }],
    ['流式 + 不压缩(STORE)', { stream: true, store: true }],
    ['前面还有个非图片文件', { stream: true, extraFile: true }],
    ['带 zip 注释（EOCD 不在末尾）', { stream: true, comment: 300 }]
  ];
  for (const [label, opt] of cases) {
    const r = await unpack(mk(opt));
    ok(label, !!r && isPng(r.out), r ? `via=${r.e.via} ${r.out.length} 字节` : '找不到条目');
  }

  console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂\n');
  process.exit(fail ? 1 : 0);
});

