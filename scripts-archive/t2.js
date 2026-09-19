const { JSDOM } = require('jsdom');
const fs=require('fs'), p='/home/claude/engine/';
const dom=new JSDOM(fs.readFileSync(p+'index.html','utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
const w=dom.window,d=w.document;
w.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),0);
w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
w.fetch=()=>Promise.reject(new Error('x'));
w.alert=()=>{}; w.confirm=()=>true;
let promptQ=['测试群','柴郡,Z23'];
w.prompt=()=>promptQ.shift()||null;
['resource/tianqing/expressions.js','resource/tianqing/scenes.js','resource/juus/expressions.js',
 'resource/juus/scenes.js','resource/juus/phone.js','resource/juus/phone-shell.js','resource/aliases.js',
 'core/resolver.js','core/worldbook.js','core/prompt.js','core/script.js','core/phone.js',
 'core/engine.js','core/api.js','core/storage.js','app/app.js'].forEach(f=>w.eval(fs.readFileSync(p+f,'utf8')));

d.getElementById('toolbar').hidden=false;
d.getElementById('btn-phone').click();
const R=d.getElementById('jup-root');
const q=s=>R.querySelector(s), qa=s=>[...R.querySelectorAll(s)];

console.log('=== 头像重复 ===');
const pill=q('.xl .pill');
console.log('  每条帖子里的 img 数:', pill.querySelectorAll('img').length, '(应为 1)');

console.log('\n=== 群聊 ===');
console.log('  群列表条目:', qa('.gpl .ct').length, '(含新建入口)');
console.log('  第一条是新建:', q('.gpl .ct').classList.contains('mkgrp'));
console.log('  预置群名:', qa('.gpl .ct').slice(1,4).map(e=>e.querySelector('.cn').textContent).join('、'));
q('.gpl .ct.mkgrp').click();
console.log('  新建后群数:', qa('.gpl .ct').length, '| 会话窗打开:', q('.cw').classList.contains('on'), '| 标题:', q('.ctitle').textContent);

console.log('\n=== 筛选 ===');
const fb=q('.filter');
console.log('  初始文案:', fb.textContent.trim());
const before=qa('.ctl .ct').filter(e=>e.style.display!=='none').length;
fb.click(); console.log('  点一次 →', fb.textContent.trim(), '可见', qa('.ctl .ct').filter(e=>e.style.display!=='none').length);
fb.click(); console.log('  再点   →', fb.textContent.trim(), '可见', qa('.ctl .ct').filter(e=>e.style.display!=='none').length);
fb.click(); console.log('  再点   →', fb.textContent.trim(), '可见', qa('.ctl .ct').filter(e=>e.style.display!=='none').length, '(初始', before, ')');

console.log('\n=== 表情包 ===');
const sp=q('.sp'), eb=q('.eb');
console.log('  表情包条目:', sp.children.length);
eb.click(); console.log('  点😊后面板展开:', sp.classList.contains('on'));

console.log('\n=== 输入框 ===');
console.log('  聊天输入可用:', !q('.cin').disabled, '| 发送键可用:', !q('.snd').disabled);
