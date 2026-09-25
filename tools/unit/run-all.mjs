/* 一次跑完全部单测。冒烟测试（tools/smoke-test.js）用 jsdom 真跑 index.html，
   管的是「浏览器里会不会炸」；这里管的是各模块的逻辑对不对。两个都要过。 */
import { execFileSync } from 'child_process';
import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const files = ['test-imagegen','test-snapshot','test-shots','test-gallery','test-cg','test-cardres','test-tokens','test-vector','test-phone','test-preset','test-kt-parity','test-savetree'];
let bad = 0, total = 0;
for (const f of files) {
  try {
    const out = execFileSync('node', [path.join(here, f + '.mjs')], { encoding: 'utf8' });
    const m = out.match(/✓ (\d+) 过 \/ (\d+) 挂/);
    total += m ? +m[1] : 0;
    console.log(`  ✓ ${f.padEnd(16)} ${m ? m[1] + ' 项' : ''}`);
  } catch (e) {
    bad++;
    console.log(`  ✗ ${f}`);
    console.log((e.stdout || '').split('\n').filter(l => l.includes('✗')).join('\n'));
  }
}
console.log(`\n${bad ? '✗ ' + bad + ' 个文件有失败' : '✓ 全部 ' + total + ' 项通过'}`);
process.exit(bad ? 1 : 0);
