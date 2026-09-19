const { JSDOM } = require('jsdom');
const fs=require('fs'), p='/home/claude/engine/';
const dom=new JSDOM(fs.readFileSync(p+'index.html','utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
const w=dom.window,d=w.document;
w.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),0);
w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
w.alert=()=>{}; w.confirm=()=>true; w.prompt=()=>null;
let reply='<sms>行行行，今晚之前给你</sms><stk>躺</stk><sms>别催了</sms><stk>不存在的表情名</stk>';
w.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:reply}}]})});
['resource/tianqing/expressions.js','resource/tianqing/scenes.js','resource/juus/expressions.js',
 'resource/juus/scenes.js','resource/juus/phone.js','resource/aliases.js','core/resolver.js',
 'core/worldbook.js','core/prompt.js','core/script.js','core/phone.js','core/engine.js',
 'core/api.js','core/storage.js','core/editors.js','app/app.js'].forEach(f=>w.eval(fs.readFileSync(p+f,'utf8')));
console.log('=== parseSmsReply ===');
w.Phone.parseSmsReply(reply).forEach(x=>console.log('  ',x.type, JSON.stringify(String(x.v).slice(0,60))));
w.GalAPI.saveConfig({protocol:'openai',baseUrl:'http://x/v1',apiKey:'k',model:'m',stream:false});
const E=w.__gal.eng;
E.loadCard(JSON.parse(fs.readFileSync('/home/claude/card.json','utf8')));
E.seedVarsFromOpening(JSON.parse(fs.readFileSync('/home/claude/card.json','utf8')).data.alternate_greetings[4]);
d.getElementById('toolbar').hidden=false;
d.getElementById('btn-phone').click();
const R=d.getElementById('jup-root'), q=s=>R.querySelector(s), qa=s=>[...R.querySelectorAll(s)];
q('.ph-app[data-app="juus"]').click();
qa('.ctl .ct').find(e=>e.dataset.c==='柴郡').click();
q('.cin').value='报告呢'; q('.snd').click();
setTimeout(()=>{
  console.log('\n=== 会话 DOM ===');
  qa('.ms .m').forEach(m=>{
    const stk=m.querySelector('.bb.stk img');
    const bb=m.querySelector('.bb:not(.stk)');
    console.log('  ', stk? ('[表情] src='+stk.getAttribute('src')) : ('[文字] '+JSON.stringify(bb?bb.textContent:'(空)')));
  });
  console.log('\n=== 提示词里有什么 ===');
  const pr=w.Phone.buildSmsPrompt('柴郡', [], (E.vars.人物||{})['柴郡'], '在吗');
  console.log('  含好感度:', /好感度/.test(pr)?'✔':'✘');
  console.log('  含人设/世界书:', /性格|人设|设定/.test(pr)?'✔':'✘ 没有');
  console.log('  含当前剧情:', /地点|剧情|刚刚/.test(pr)?'✔':'✘ 没有');
  console.log('  表情包名单条数:', (w.Phone.stickerNames().split('、')||[]).length, '/ 共', Object.keys(w.PHONE_RES.stickers).length);
  process.exit(0);
},400);
