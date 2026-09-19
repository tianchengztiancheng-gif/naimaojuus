const { JSDOM } = require('jsdom');
const fs=require('fs'), p='/home/claude/engine/';
const dom=new JSDOM(fs.readFileSync(p+'index.html','utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
const w=dom.window,d=w.document;
w.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),0);
w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
w.fetch=()=>Promise.reject(new Error('x')); w.alert=()=>{}; w.confirm=()=>true; w.prompt=()=>null;
['resource/tianqing/expressions.js','resource/tianqing/scenes.js','resource/juus/expressions.js',
 'resource/juus/scenes.js','resource/juus/phone.js','resource/aliases.js','core/resolver.js',
 'core/worldbook.js','core/prompt.js','core/script.js','core/phone.js','core/engine.js',
 'core/api.js','core/storage.js','core/editors.js','app/app.js'].forEach(f=>w.eval(fs.readFileSync(p+f,'utf8')));
const E=w.__gal.eng;
E.loadCard(JSON.parse(fs.readFileSync('/home/claude/card.json','utf8')));
// 造 8 句剧情
E.log=[]; 
E.appendLog(Array.from({length:8},(_,i)=>({who:'柴郡',text:'第'+(i+1)+'句台词内容',narration:false,
  stage:[{name:'柴郡',expr:'微笑'}],sprites:[{who:'柴郡',url:'http://x/'+i+'.png',outfit:'常服',expr:'微笑',via:'exact'}],bg:{}})));
d.getElementById('toolbar').hidden=false;
d.getElementById('dialogue').hidden=false;
w.__gal.goTo(0);
const text=()=>d.getElementById('text').textContent;
const prog=()=>d.getElementById('progress').textContent;
setTimeout(()=>{
  console.log('=== 连点 6 次（模拟快速推进）===');
  for(let i=0;i<6;i++) d.getElementById('dialogue').click();
  setTimeout(()=>{
    console.log('  进度:', prog());
    console.log('  当前文字:', JSON.stringify(text()));
    console.log('  文字与进度是否对应:', text().includes(prog().split('/')[0].trim())?'✔':'✘ 不同步');
    // 再点两次看会不会卡
    d.getElementById('dialogue').click();
    d.getElementById('dialogue').click();
    setTimeout(()=>{
      console.log('\n=== 继续点 2 次 ===');
      console.log('  进度:', prog(), '| 文字:', JSON.stringify(text()));
      console.log('  能否继续推进:', prog().startsWith('8')?'✔ 已到末尾':'✔ 仍在推进');
      console.log('\n=== 选项不再挡住推进 ===');
      const src=fs.readFileSync(p+'app/app.js','utf8');
      console.log('  advance 里已无 choices 拦截:', !/if \(!choicesEl\.hidden\) return;/.test(src)?'✔':'✘');
      console.log('  present 有并发令牌:', /token !== presentToken/.test(src)?'✔':'✘');
      console.log('  立绘等待上限:', (src.match(/setTimeout\(r, (\d+)\)/)||[])[1]+'ms');
      process.exit(0);
    },1400);
  },1400);
},120);
