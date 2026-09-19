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
E.vars={时间:{天数:3,时段:'黄昏'},地点:'教室',人物:{
  柴郡:{在场:true,好感度:142,是否誓约:true,服装:'常服',当前状态:'愉快',心理活动:'想吃小鱼干'},
  Z23:{在场:true,好感度:88,服装:'制服',当前状态:'认真'},
  长门:{在场:false,好感度:40,服装:'巫女服'}}};
E.log=[{turn:0,who:'柴郡',text:'x',narration:false,stage:[],sprites:[]}];
d.getElementById('toolbar').hidden=false;
d.getElementById('btn-phone').click();
const R=d.getElementById('jup-root'), q=s=>R.querySelector(s), qa=s=>[...R.querySelectorAll(s)];
console.log('=== 主屏 ===');
console.log('  Dock 三列两排:', /repeat\(3,1fr\)/.test(fs.readFileSync(p+'app/phone.css','utf8').match(/\.ph-dock\{[^}]*/)[0])?'✔':'✘');
console.log('  主屏居中:', /\.ph-home\{justify-content:center/.test(fs.readFileSync(p+'app/phone.css','utf8'))?'✔':'✘');
d.getElementById('boot').classList.add('gone');
q('.ph-app[data-app="cfg"]').click();
console.log('\n=== 分区标题带图标框 ===');
console.log('  ', d.getElementById('kt-title').innerHTML.slice(0,60));
console.log('\n=== 变量页 ===');
q('.kt-nav [data-sec="vars"]').click();
const vb=d.getElementById('varsbody');
console.log('  统计磁贴:', vb.querySelectorAll('.kt-tile').length);
console.log('  概览卡 chips:', [...vb.querySelectorAll('.kt-hero .chip')].map(c=>c.textContent).join(' | '));
console.log('  角色卡:', vb.querySelectorAll('.kt-card').length, '| 好感度条:', vb.querySelectorAll('.kt-meter').length);
console.log('  标签串:', vb.querySelectorAll('.kt-chips .c').length, '个');
console.log('\n=== 世界书磁贴筛选 ===');
q('.kt-nav [data-sec="book"]').click();
console.log('  磁贴:', qa('#bk-stat .kt-tile').map(t=>t.querySelector('.lb').textContent+t.querySelector('.nm').textContent).join(' '));
const before=qa('#bk-list .kt-item').length;
q('#bk-stat [data-tile="blue"]').click();
console.log('  点「蓝灯常驻」→', qa('#bk-list .kt-item').length, '条（全部', before, '条）');
q('#bk-stat [data-tile="all"]').click();
console.log('\n=== 人设两列预览 ===');
q('.kt-nav [data-sec="me"]').click();
console.log('  预览区:', !!d.getElementById('me-preview'), '| 宏替换:', d.getElementById('me-macro').textContent.replace(/\s+/g,' ').trim());
process.exit(0);
