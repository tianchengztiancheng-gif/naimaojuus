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

// 直接操作内部 eng：通过重跑一段等价逻辑
w.eval(`
  var __eng = null;
  // app.js 的 eng 是闭包私有的，这里用一段模拟输出走 UI：直接调 file input 的回调不方便，
  // 改为验证：引擎单独实例 + 手机解析 + 面板渲染函数是否能对真实数据工作
`);
const E=new w.Engine();
E.vars={地点:'教室',时间:{时段:'朝',天数:1},人物:{柴郡:{在场:true,好感度:88,服装:'常服'}}};
const txt=`<Gal>
早上好。|柴郡|微笑|
</Gal>
[短信|柴郡|文字|指挥官起床没]
[群聊|公共频道|Z23|文字|演习几点]
[小红书|柴郡|早安|新的一天|999|12|30]
[趋势|港区今日天气]`;
E.history=[{role:'assistant',content:txt}];
const r=E.processOutput(txt);
console.log('引擎解析:', r.modules.length, '句 | hasPhone', r.hasPhone);
const pd=w.Phone.scan(E.history);
console.log('手机扫描:', JSON.stringify(pd.counts));
console.log('  含种子: 帖子', pd.posts.length, '(3种子+1新)', '| 趋势', pd.trends.length, '(3种子+1新)');
// 打开手机检查 DOM
d.getElementById('toolbar').hidden=false;
d.getElementById('btn-phone').click();
const root=d.getElementById('jup-root');
const ctl=root.querySelector('.ctl');
console.log('\nDOM 检查:');
console.log('  联系人', ctl.children.length, '| 第一位:', ctl.children[0]?.querySelector('.cn')?.textContent.trim());
console.log('  推荐流', root.querySelector('.xl').children.length, '条');
console.log('  群聊列表', root.querySelector('.gpl').children.length);
// 点开一个联系人
ctl.children[0].click();
console.log('  点开联系人 → .cw 展开:', root.querySelector('.cw').classList.contains('on'));
console.log('  标题:', root.querySelector('.ctitle').textContent);
// 点开一个帖子
root.querySelector('.xl .pill')?.click();
console.log('  点开帖子 → .postd 展开:', root.querySelector('.postd').classList.contains('on'));
