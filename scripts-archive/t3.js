const { JSDOM } = require('jsdom');
const fs=require('fs'), p='/home/claude/engine/';
const dom=new JSDOM(fs.readFileSync(p+'index.html','utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
const w=dom.window,d=w.document;
w.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),0);
w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
w.fetch=()=>Promise.reject(new Error('x')); w.alert=()=>{}; w.confirm=()=>true; w.prompt=()=>null;
['resource/tianqing/expressions.js','resource/tianqing/scenes.js','resource/juus/expressions.js',
 'resource/juus/scenes.js','resource/juus/phone.js','resource/juus/phone-shell.js','resource/aliases.js',
 'core/resolver.js','core/worldbook.js','core/prompt.js','core/script.js','core/phone.js',
 'core/engine.js','core/api.js','core/storage.js','app/app.js'].forEach(f=>w.eval(fs.readFileSync(p+f,'utf8')));

// 手动灌三轮剧情进 app 的 eng（通过开场白路径）
const raw=t=>`<Gal>\n『✨ 0${t}:00 · 教室 · 晴 ✨』|旁白|-|\n第${t}轮第一句。|柴郡|微笑|\n第${t}轮第二句。|Z23|平静|\n第${t}轮第三句。|柴郡|高兴|\n</Gal>`;
// app 的 eng 是闭包私有的，借 btn-start 路径不方便；直接用 opening-sel 注入
const sel=d.getElementById('opening-sel');
sel._list=[{n:'测试',t:raw(1)}];
sel.innerHTML='<option value="0">测试</option>';
d.getElementById('btn-start').disabled=false;
d.getElementById('btn-start').click();  // 第一次会提示缺预设
d.getElementById('btn-start').click();  // 第二次真的开始
d.getElementById('btn-phone').click();
const R=d.getElementById('jup-root');
R.querySelector('.side .sic[data-nav="log"]').click();
const box=d.getElementById('histlist');
console.log('=== 剧情回顾 ===');
console.log('  轮次头数量:', box.querySelectorAll('.histturn').length);
const th=box.querySelector('.histturn');
console.log('  头部文字:', th.textContent.replace(/\s+/g,' ').trim().slice(0,60));
console.log('  展开状态:', th.classList.contains('open'));
console.log('  展开时句数:', box.querySelectorAll('.histline').length);
th.click();
console.log('  点一下收起 → 句数:', box.querySelectorAll('.histline').length, '| 头仍在:', box.querySelectorAll('.histturn').length);
th2=box.querySelector('.histturn'); th2.click();
console.log('  再点展开 → 句数:', box.querySelectorAll('.histline').length);
console.log('\n=== 状态面板排版 ===');
R.querySelector('.side .sic[data-nav="vars"]').click();
const vb=d.getElementById('varsbody');
console.log('  卡片数:', vb.querySelectorAll('.vcard').length);
console.log('  行数:', vb.querySelectorAll('.vrow').length);
console.log('  首行:', vb.querySelector('.vrow')?.textContent.replace(/\s+/g,' ').trim());
