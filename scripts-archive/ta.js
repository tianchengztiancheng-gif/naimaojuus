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
w.__gal.eng.loadCard(JSON.parse(fs.readFileSync('/home/claude/card.json','utf8')));
d.getElementById('toolbar').hidden=false;
d.getElementById('btn-phone').click();
const R=d.getElementById('jup-root'), q=s=>R.querySelector(s), qa=s=>[...R.querySelectorAll(s)];
console.log('=== 私聊/群聊切换 ===');
q('.ph-app[data-app="juus"]').click();
const subs=()=>qa('.sub').map(x=>x.dataset.sub+(x.classList.contains('on')?'✔':'✘')).join(' ');
console.log('  初始:', subs());
qa('.ph-seg [data-sub]')[1].click();
console.log('  点群聊:', subs());
qa('.ph-seg [data-sub]')[0].click();
console.log('  点私聊:', subs());
const css=fs.readFileSync(p+'app/phone.css','utf8');
console.log('  .sub 默认 display:', /#jup-root \.sub\{[^}]*display:none/.test(css)?'none ✔':'✘');
console.log('\n=== 电量 ===');
console.log('  ph-batt 元素:', d.getElementById('ph-batt')?'仍在（本环境无 Battery API 时应被移除）':'已移除 ✔');
console.log('\n=== 主屏 ===');
d.querySelector('.ph-homebar').click();
const grid=R.querySelector('.ph-grid');
console.log('  Dock 顺序 order:', /\.ph-grid\{[^}]*order:-1/.test(css)?'-1（在时钟下方）✔':'✘');
console.log('  简报含热点:', d.getElementById('ph-widget').innerHTML.includes('whot')?'✔':'（当前无热点数据）');
console.log('  简报字数:', d.getElementById('ph-widget').textContent.replace(/\s+/g,' ').length);
process.exit(0);
