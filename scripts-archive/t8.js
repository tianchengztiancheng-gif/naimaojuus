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
w.__gal.eng.loadPreset({prompts:[
  {identifier:'main',name:'主提示',content:'合成测试',role:'system'},
  {identifier:'jb',name:'尾部指令',content:'合成测试2',role:'system'},
  {identifier:'chatHistory',marker:true,name:'对话历史'}],
  prompt_order:[{order:[{identifier:'main',enabled:true},{identifier:'jb',enabled:false},
  {identifier:'chatHistory',enabled:true}]}]});
d.getElementById('toolbar').hidden=false;
d.getElementById('btn-phone').click();
const R=d.getElementById('jup-root'), q=s=>R.querySelector(s), qa=s=>[...R.querySelectorAll(s)];

console.log('=== 皮肤挂载 ===');
['me','book','pre','debug'].forEach(k=>{
  const l=q('.ph-layer[data-app="'+k+'"]');
  console.log('  '+k.padEnd(6), l.classList.contains('kt')?'✔ .kt':'✘');
});
console.log('  社交类保持浅色:', !q('.ph-layer[data-app="juus"]').classList.contains('kt'));

console.log('\n=== 人设分区 ===');
q('.ph-app[data-app="me"]').click();
console.log('  分区:', qa('.ph-layer[data-app="me"] .kt-sec h4').map(h=>h.textContent.replace(/\s/g,'')).join(' / '));
console.log('  底部保存按钮:', !!d.getElementById('me-save2'));

console.log('\n=== 世界书分组 ===');
q('.ph-app[data-app="book"]').click();
const groups=qa('#bk-list .kt-group');
console.log('  分组数:', groups.length);
groups.forEach(g=>console.log('    '+g.querySelector('.kt-ghead').textContent.replace(/\s+/g,' ').trim()));
console.log('  卡片总数:', qa('#bk-list .ed-row').length);
const gh=groups[1].querySelector('.kt-ghead');
const before=groups[1].classList.contains('open');
gh.click();
console.log('  点分组头折叠:', before!==groups[1].classList.contains('open')?'✔':'✘');

console.log('\n=== 条目详情分区 ===');
qa('#bk-list .ed-row')[0].click();
console.log('  分区:', qa('#bk-form .kt-sec h4').map(h=>h.textContent.replace(/\s/g,'')).join(' / '));
console.log('  字数统计:', d.getElementById('e-len').textContent);
console.log('  开关用 .sw 包裹:', qa('#bk-form .sw input').length, '个');

console.log('\n=== 预设分组 ===');
q('.ph-app[data-app="pre"]').click();
console.log('  统计:', d.getElementById('pre-stat').textContent.replace(/\s+/g,' ').trim());
console.log('  分组:', [...d.querySelectorAll('#pre-list .kt-ghead')].map(h=>h.textContent.replace(/\s+/g,' ').trim()).join(' | '));
process.exit(0);
