const { JSDOM } = require('jsdom');
const fs=require('fs'), p='/home/claude/engine/';
const dom=new JSDOM(fs.readFileSync(p+'index.html','utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
const w=dom.window,d=w.document;
w.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),0);
w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
w.fetch=()=>Promise.reject(new Error('x')); w.alert=()=>{}; w.confirm=()=>true; w.prompt=()=>null;
['resource/tianqing/expressions.js','resource/tianqing/scenes.js','resource/juus/expressions.js',
 'resource/juus/scenes.js','resource/juus/defaults.js','resource/juus/phone.js','resource/aliases.js',
 'core/resolver.js','core/worldbook.js','core/prompt.js','core/script.js','core/phone.js',
 'core/engine.js','core/api.js','core/storage.js','core/editors.js','app/app.js']
 .forEach(f=>w.eval(fs.readFileSync(p+f,'utf8')));
const E=w.__gal.eng;
E.vars={地点:'教室',时间:{时段:'朝'},人物:{}};
const r=E.processOutput('<Gal>\n早。|雪风|微笑|\n你好。|柴郡|微笑|\n</Gal>');
E.appendLog(r.modules);
d.getElementById('toolbar').hidden=false;
d.getElementById('dialogue').hidden=false;
w.__gal.goTo(E.log.length-1);
setTimeout(()=>{
  d.getElementById('btn-skin').click();
  const body=d.getElementById('skin-body');
  console.log('=== 换装面板 ===');
  console.log('  面板已开:', !d.getElementById('skin-panel').hidden);
  [...body.querySelectorAll('.sk-char')].forEach(c=>{
    const nm=c.querySelector('.sk-hd b');
    const items=c.querySelectorAll('.sk-item');
    const outs=c.querySelectorAll('[data-outfit]');
    console.log('  '+(nm?nm.textContent:'?').padEnd(6),
      items.length+' 套皮肤', outs.length?('| '+outs.length+' 套带表情服装'):'');
  });
  const first=body.querySelector('.sk-item[data-skin]');
  console.log('\n=== 点一张皮肤 ===');
  console.log('  点:', first.getAttribute('data-skin'));
  first.click();
  const nm=first.getAttribute('data-skin').split('|')[0];
  console.log('  锁定状态:', E.vars.人物[nm].皮肤锁定, '| 皮肤索引:', E.vars.人物[nm].皮肤);
  console.log('  面板显示已锁定:', !!body.querySelector('.lock'));
  console.log('  当前句立绘已换:', E.log[E.log.length-1].sprites.map(s=>s.who+'['+s.via+']').join(' '));
  const un=body.querySelector('[data-unlock]');
  if(un){ un.click(); console.log('\n=== 解除锁定 ===');
    console.log('  锁定:', !!E.vars.人物[nm].皮肤锁定, '| 索引:', E.vars.人物[nm].皮肤); }
  process.exit(0);
},500);
