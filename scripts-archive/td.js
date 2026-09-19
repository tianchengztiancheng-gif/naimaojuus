const { JSDOM } = require('jsdom');
const fs=require('fs'), p='/home/claude/engine/';
const dom=new JSDOM(fs.readFileSync(p+'index.html','utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
const w=dom.window,d=w.document;
w.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),0);
w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
w.alert=()=>{}; w.confirm=()=>true; w.prompt=()=>null;
// 假 API：私聊返回 <sms>/<stk>，群聊返回 [群聊|…]
let calls=[];
w.fetch=async(url,opt)=>{
  const body=JSON.parse(opt.body);
  const prompt=body.messages.map(m=>m.content).join('\n');
  calls.push(prompt);
  let out;
  if(/群聊生成/.test(prompt)) out='[群聊|公共频道|Z23|文字|收到！]\n[群聊|公共频道|Z52|文字|+1]';
  else if(/动态评论区/.test(prompt)) out='[评论|Z23|谢谢指挥官！]\n[评论|独角兽|我也觉得]';
  else out='<sms>指挥官好呀</sms><stk>躺</stk>';
  return {ok:true, json:async()=>({choices:[{message:{content:out}}]})};
};
['resource/tianqing/expressions.js','resource/tianqing/scenes.js','resource/juus/expressions.js',
 'resource/juus/scenes.js','resource/juus/phone.js','resource/aliases.js','core/resolver.js',
 'core/worldbook.js','core/prompt.js','core/script.js','core/phone.js','core/engine.js',
 'core/api.js','core/storage.js','core/editors.js','app/app.js'].forEach(f=>w.eval(fs.readFileSync(p+f,'utf8')));
w.GalAPI.saveConfig({protocol:'openai',baseUrl:'http://x/v1',apiKey:'k',model:'m',stream:false});
const E=w.__gal.eng;
E.loadCard(JSON.parse(fs.readFileSync('/home/claude/card.json','utf8')));
E.seedVarsFromOpening(JSON.parse(fs.readFileSync('/home/claude/card.json','utf8')).data.alternate_greetings[4]);
E.history=[{role:'assistant',content:'开场白正文'}];
E.log=[{turn:0,who:'柴郡',text:'早',narration:false,stage:[],sprites:[]}];
d.getElementById('toolbar').hidden=false;
d.getElementById('btn-phone').click();
const R=d.getElementById('jup-root'), q=s=>R.querySelector(s), qa=s=>[...R.querySelectorAll(s)];
q('.ph-app[data-app="juus"]').click();
const before={hist:E.history.length, log:E.log.length};
qa('.ctl .ct').find(e=>e.dataset.c==='柴郡').click();
q('.cin').value='在干嘛';
q('.snd').click();
setTimeout(()=>{
  console.log('=== 私聊：独立生成 ===');
  console.log('  请求类型:', /手机短信回复/.test(calls[0]||'')?'✔ 独立任务短信':'✘');
  console.log('  主线历史:', before.hist,'→',E.history.length, '(应不变)');
  console.log('  剧情日志:', before.log,'→',E.log.length, '(应不变)');
  console.log('  收到消息:', E.phoneSent.map(x=>x.who+':'+(x.type==='sticker'?'[表情]':x.v)).join(' | '));
  console.log('\n=== 主线能看到手机记录 ===');
  const inj=E.renderPhoneLog();
  console.log(' ', inj.replace(/\n/g,' ').slice(0,110));
  console.log('\n=== 群聊 ===');
  qa('.ph-seg [data-sub]')[1].click();
  qa('.gpl .ct').find(e=>e.dataset.g==='公共频道').click();
  q('.cin').value='集合';
  q('.snd').click();
  setTimeout(()=>{
    console.log('  请求类型:', /群聊生成/.test(calls[1]||'')?'✔ 独立任务群聊':'✘');
    const phoneOnly=E.history.filter(m=>m.phoneOnly).length;
    console.log('  写入 phoneOnly 记录:', phoneOnly, '条');
    const dry=E.dryRun('测试');
    console.log('  主线组装时跳过 phoneOnly:', JSON.stringify(dry.messages).includes('[群聊|')?'✘ 混进去了':'✔ 已跳过');
    console.log('  但 <手机记录> 有注入:', JSON.stringify(dry.messages).includes('手机记录')?'✔':'✘');
    process.exit(0);
  },150);
},150);
