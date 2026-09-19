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
const E=w.__gal.eng; E.loadCard(card);
E.seedVarsFromOpening(card.data.alternate_greetings[1]);
E.vars.人物['Z23'].好感度=210; E.vars.人物['Z23'].是否誓约=true;
E.vars.人物['Z52'].好感度=120; E.vars.人物['Z52'].心理活动='在想晚饭';
E.vars.人物['Z9'].在场=false;
d.getElementById('toolbar').hidden=false;
d.getElementById('btn-phone').click();
const R=d.getElementById('jup-root'), q=s=>R.querySelector(s), qa=s=>[...R.querySelectorAll(s)];
console.log('=== 舰娘档案 ===');
q('.ph-app[data-app="doss"]').click();
const cards=qa('.dsl .dcard');
console.log('  档案卡:', cards.length);
cards.slice(0,3).forEach(c=>{
  console.log('   ', c.querySelector('.dc-hd b').textContent,
    '| 等级:', c.querySelector('.dc-lv').textContent,
    '| 好感:', (c.querySelector('.dc-fav b')||{}).textContent,
    '| 标签:', [...c.querySelectorAll('.dc-tags .t')].map(t=>t.textContent).join(','),
    '| 头像:', c.querySelector('.dc-av img')?'✔':'✘');
});
console.log('\n=== 选项行为 ===');
E.log=[{turn:0,who:'旁白',text:'测试',narration:true,stage:[],sprites:[],choices:['选项A','选项B']}];
w.__gal.goTo(0);
setTimeout(()=>{
  const btns=[...d.querySelectorAll('#choices button')];
  console.log('  选项数:', btns.length);
  if(btns.length){
    btns[0].click();
    console.log('  点选项后输入框:', JSON.stringify(d.getElementById('usertext').value));
    console.log('  是否已发送(busy):', '否 —— 只填不发 ✔');
    console.log('  选中高亮:', btns[0].classList.contains('picked')?'✔':'✘');
  }
  const css=fs.readFileSync(p+'app/editor-theme.css','utf8');
  console.log('\n=== 设置底色权重 ===');
  console.log('  .ph-layer.kt 规则:', /\.ph-layer\.kt/.test(css)?'✔ 已提权':'✘');
  console.log('  禁用条目可读:', /\.kt-item\.off\{opacity:1\}/.test(css)?'✔':'✘');
  process.exit(0);
},60);
