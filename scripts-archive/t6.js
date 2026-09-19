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

console.log('=== 每个 App 都有回主屏按钮 ===');
const layers=qa('.ph-layer[data-app]').filter(l=>l.dataset.app!=='home');
console.log('  App 层数:', layers.length, '| 带 ⌂ 的:', layers.filter(l=>l.querySelector('.ph-bar .hm')).length);

console.log('\n=== 进 App → 点 ⌂ → 回主屏 ===');
q('.ph-app[data-app="juus"]').click();
console.log('  当前层:', qa('.ph-layer.on').map(l=>l.dataset.app).join(','));
q('.ctl .ct').click();
console.log('  点开会话 .cw.on:', q('.cw').classList.contains('on'));
q('.ph-layer[data-app="juus"] > .ph-bar .hm').click();
console.log('  点 ⌂ → 当前层:', qa('.ph-layer.on').map(l=>l.dataset.app).join(','), '| .cw 已收:', !q('.cw').classList.contains('on'));

console.log('\n=== 编辑器详情页也能一键回 ===');
q('.ph-app[data-app="book"]').click();
d.getElementById('bk-new').click();
console.log('  详情展开:', d.getElementById('bk-detail').classList.contains('on'));
q('.ph-layer[data-app="book"] > .ph-bar .hm').click();
console.log('  点 ⌂ → 主屏:', q('.ph-layer.ph-home').classList.contains('on'), '| 详情已收:', !d.getElementById('bk-detail').classList.contains('on'));

console.log('\n=== .cw 在网格里（不再是兄弟块流） ===');
const juus=q('.ph-layer[data-app="juus"]');
console.log('  .cw 的父元素:', q('.cw').parentElement.className.split(' ').slice(0,2).join('.'));
console.log('  是 .ph-layer 直接子元素:', q('.cw').parentElement===juus);

console.log('\n=== 立绘特效 ===');
const css=fs.readFileSync(p+'app/style.css','utf8');
const fx=['enter-rise','enter-left','enter-right','enter-drop','enter-zoom','enter-far','enter-tilt','enter-pop',
          'chg-bounce','chg-swayx','chg-swayy','chg-tilt','chg-perk'];
console.log('  CSS 类:', fx.filter(f=>css.includes('.layer.'+f)).length+'/'+fx.length);
console.log('  关键帧:', (css.match(/@keyframes (enter|chg)\w+/g)||[]).length+'/13');
process.exit(0);
