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
d.getElementById('toolbar').hidden=false;
d.getElementById('btn-phone').click();
const R=d.getElementById('jup-root'), q=s=>R.querySelector(s), qa=s=>[...R.querySelectorAll(s)];
console.log('主屏 App:', qa('.ph-app').map(a=>a.dataset.app).join(' '));
console.log('  热点已并入 ig:', !qa('.ph-app').some(a=>a.dataset.app==='hot'));
console.log('  at-home 类:', R.classList.contains('at-home'), '(用于隐藏状态栏重复时钟)');
q('.ph-app[data-app="juus"]').click();
console.log('\nJUUS 顶栏结构:', [...q('.ph-layer[data-app="juus"] > .ph-bar').children].map(c=>c.className||c.tagName).join(' | '));
console.log('  at-home 已关:', !R.classList.contains('at-home'));
q('.ph-app[data-app="ig"]').click();
console.log('\nJUUSTAGRAM 页签:', qa('.ig-seg button').map(b=>b.textContent).join('/'));
console.log('  帖子卡结构:', [...q('.xl .pcard2').querySelectorAll('[class]')].map(e=>e.className).slice(0,5).join(' '));
q('.xl .pcard2').click();
const b=q('.pd-b').innerHTML;
console.log('  详情正文含粗体:', b.includes('<b>'), '| 含高亮:', b.includes('class="hl"'), '| 无残留标记:', !b.includes('[[')&&!b.includes('**'));
const css=fs.readFileSync(p+'app/phone.css','utf8');
console.log('\n平板宽度:', (css.match(/--w:(\d+)px/)||[])[1]+'px', '| 主屏列数:', (css.match(/repeat\((\d+),1fr\);gap:28px/)||[])[1]);
process.exit(0);
