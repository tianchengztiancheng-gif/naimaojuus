/* ============================================================
 * tools/e2e-crash.mjs —— 端到端：全局错误兜底 + 输入法组合态
 *
 * 验的是「一个没接住的异常不再让界面装死」：
 * 以前这个单页应用没有任何 window.onerror，渲染路径抛了就断在那儿，
 * 玩家看到的是「点了没反应」，连报错都看不到（错误只进控制台）。
 *
 * 顺带验拼音输入法选词时按回车不会误发送。
 *
 * 用法：npm i -D playwright && node tools/e2e-crash.mjs [截图目录]
 * ============================================================ */
import { chromium } from 'playwright';
const OUT=process.argv[2] || '.';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1280,height:860}});
await p.goto('file://'+process.cwd()+'/index.html');
await p.waitForTimeout(900);
let pass=0,fail=0;
const ok=(n,c,x)=>c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+(x?'\n      → '+x:'')));

ok('正常时不弹兜底页', await p.evaluate(()=>!document.getElementById('gal-crash')));

/* ① 同步异常 */
await p.evaluate(()=>{ setTimeout(()=>{ throw new Error('测试用的同步异常'); },0); });
await p.waitForTimeout(400);
ok('未捕获异常会弹兜底页',
   await p.evaluate(()=>{const e=document.getElementById('gal-crash');return !!e && !e.hidden;}));
ok('页面上能看到错误原文',
   (await p.evaluate(()=>document.getElementById('gal-crash').textContent)).includes('测试用的同步异常'));
ok('有导出存档按钮', await p.evaluate(()=>!!document.getElementById('cr-save')));
ok('有刷新按钮', await p.evaluate(()=>!!document.getElementById('cr-reload')));
await p.screenshot({path:OUT+'/crash.png'});

/* ② Promise rejection */
await p.evaluate(()=>{ document.getElementById('cr-close').click(); });
await p.evaluate(()=>{ Promise.reject(new Error('测试用的 rejection')); });
await p.waitForTimeout(400);
ok('未 catch 的 Promise 也会弹',
   (await p.evaluate(()=>{const e=document.getElementById('gal-crash');
     return e && !e.hidden ? e.textContent : '';})).includes('测试用的 rejection'));

/* ③ 导出存档真的下得下来 */
const dl = p.waitForEvent('download', {timeout:6000}).catch(()=>null);
await p.evaluate(()=>document.getElementById('cr-save').click());
const d = await dl;
ok('导出存档按钮真的产生了下载', !!d, d ? d.suggestedFilename() : '没有触发下载');

/* ④ 死链图片不该弹兜底页 */
await p.evaluate(()=>{ document.getElementById('cr-close').click();
  const i=document.createElement('img'); i.src='https://dead.invalid/x.png';
  document.body.appendChild(i); });
await p.waitForTimeout(900);
ok('死链图片不弹兜底页（立绘死链是常态）',
   await p.evaluate(()=>{const e=document.getElementById('gal-crash');return !e||e.hidden;}));

/* ⑤ 输入法组合态下回车不发送 */
await p.evaluate(()=>{
  document.getElementById('boot').hidden=true;
  ['toolbar','dialogue','inputbar'].forEach(id=>{const e=document.getElementById(id); if(e)e.hidden=false;});
  window.__submitted=0;
  const ta=document.getElementById('usertext'); ta.value='你好';
  ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
});
await p.waitForTimeout(250);
ok('组合态回车没有清空输入框（= 没发送）',
   await p.evaluate(()=>document.getElementById('usertext').value==='你好'));

await b.close();
console.log('\n'+(fail?'✗':'✓')+' '+pass+' 过 / '+fail+' 挂');
process.exit(fail?1:0);
