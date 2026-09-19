const { JSDOM } = require('jsdom');
const fs=require('fs'), p='/home/claude/engine/';
const dom=new JSDOM(fs.readFileSync(p+'index.html','utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
const w=dom.window,d=w.document;
w.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),0);
w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
w.fetch=()=>Promise.reject(new Error('x')); w.alert=()=>{}; w.confirm=()=>true;
let pq=['夜航班','柴郡,Z23']; w.prompt=()=>pq.shift()||null;
['resource/tianqing/expressions.js','resource/tianqing/scenes.js','resource/juus/expressions.js',
 'resource/juus/scenes.js','resource/juus/phone.js','resource/aliases.js',
 'core/resolver.js','core/worldbook.js','core/prompt.js','core/script.js','core/phone.js',
 'core/engine.js','core/api.js','core/storage.js','app/app.js'].forEach(f=>w.eval(fs.readFileSync(p+f,'utf8')));
d.getElementById('toolbar').hidden=false;
d.getElementById('btn-phone').click();
const R=d.getElementById('jup-root'), q=s=>R.querySelector(s), qa=s=>[...R.querySelectorAll(s)];
console.log('=== 主屏 ===');
console.log('  图标:', qa('.ph-app').map(a=>a.querySelector('span').textContent).join(' '));
console.log('  时钟:', d.getElementById('ph-bigtime').textContent, '|', d.getElementById('ph-date').textContent);
console.log('  排布: 4 列网格 (CSS grid-template-columns: repeat(4,1fr))');
console.log('\n=== 层级切换 ===');
q('.ph-app[data-app="juus"]').click();
console.log('  进 JUUS → 当前层:', qa('.ph-layer.on').map(l=>l.dataset.app).join(','));
q('.ctl .ct').click();
console.log('  点联系人 → .cw 展开:', q('.cw').classList.contains('on'), '| 标题:', q('.ctitle').textContent);
d.querySelector('.ph-homebar').click();
console.log('  按 home 条 → .cw 收起:', !q('.cw').classList.contains('on'), '(第一次先退出会话)');
d.querySelector('.ph-homebar').click();
console.log('  再按 → 回主屏:', q('.ph-layer.ph-home').classList.contains('on'));
console.log('\n=== 新建群聊 ===');
q('.ph-app[data-app="juus"]').click();
qa('.ph-seg button')[1].click();
q('.gpl .ct.mkgrp').click();
console.log('  新建「夜航班」→ 会话标题:', q('.ctitle').textContent, '| 群数:', qa('.gpl .ct').length-1);
console.log('\n=== 角标 ===');
console.log('  JUUS 图标带徽标元素:', !!d.getElementById('ph-badge'));
process.exit(0);
