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
const card=JSON.parse(fs.readFileSync('/home/claude/card.json','utf8'));
w.__gal.eng.loadCard(card);
d.getElementById('toolbar').hidden=false;
d.getElementById('btn-phone').click();
const R=d.getElementById('jup-root'), q=s=>R.querySelector(s), qa=s=>[...R.querySelectorAll(s)];
console.log('=== 点设置去哪 ===');
d.getElementById('boot').classList.add('gone');
q('.ph-app[data-app="cfg"]').click();
console.log('  当前层:', qa('.ph-layer.on').map(l=>l.dataset.app).join(','), '(应为 cfg)');
console.log('  启动面板是否被打开:', !d.getElementById('boot').classList.contains('gone') ? '✘ 被打开了' : '✔ 没动');
console.log('  侧栏分区:', qa('.kt-nav button[data-sec]').map(b=>b.querySelector('b').textContent).join(' '));
q('.kt-nav [data-sec="book"]').click();
console.log('  世界书条目:', qa('#bk-list .kt-item').length, '| 分组:', qa('#bk-list .kt-group').length);
qa('#bk-list .kt-item')[0].click();
console.log('  点条目后右侧表单字段:', qa('#bk-form input,#bk-form select,#bk-form textarea').length, '个');
console.log('\n=== 主屏 ===');
d.querySelector('.ph-homebar').click();
console.log('  Dock 存在:', !!q('.ph-dock'), '| 图标:', qa('.ph-dock .ph-app').length);
console.log('  小组件:', d.getElementById('ph-widget').textContent.replace(/\s+/g,' ').trim().slice(0,70));
console.log('  主页键是按钮含 svg:', !!d.querySelector('.ph-homebar svg'));
process.exit(0);
