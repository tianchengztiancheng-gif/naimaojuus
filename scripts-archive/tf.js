const { JSDOM } = require('jsdom');
const fs=require('fs'), p='/home/claude/engine/';
const dom=new JSDOM(fs.readFileSync(p+'index.html','utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
const w=dom.window,d=w.document;
w.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),0);
w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
w.alert=()=>{}; w.confirm=()=>true; w.prompt=()=>null;
let n=0;
w.fetch=async()=>{ n++; return {ok:true,json:async()=>({choices:[{message:{content:
  '<Gal>\n第'+n+'轮第一句。|柴郡|微笑|\n第'+n+'轮第二句。|柴郡|高兴|\n</Gal>'}}]})}; };
['resource/tianqing/expressions.js','resource/tianqing/scenes.js','resource/juus/expressions.js',
 'resource/juus/scenes.js','resource/juus/phone.js','resource/aliases.js','core/resolver.js',
 'core/worldbook.js','core/prompt.js','core/script.js','core/phone.js','core/engine.js',
 'core/api.js','core/storage.js','core/editors.js','app/app.js'].forEach(f=>w.eval(fs.readFileSync(p+f,'utf8')));
w.GalAPI.saveConfig({protocol:'openai',baseUrl:'http://x/v1',apiKey:'k',model:'m',stream:false});
const E=w.__gal.eng;
E.loadCard(JSON.parse(fs.readFileSync('/home/claude/card.json','utf8')));
E.loadPreset({prompts:[{identifier:'m',content:'x',role:'system'},{identifier:'chatHistory',marker:true}],
  prompt_order:[{order:[{identifier:'m',enabled:true},{identifier:'chatHistory',enabled:true}]}]});
d.getElementById('toolbar').hidden=false; d.getElementById('dialogue').hidden=false;
d.getElementById('inputbar').hidden=false;
const send=()=>{ d.getElementById('usertext').value='推进'; d.getElementById('send').click(); };
console.log('=== 连续三轮 ===');
send();
setTimeout(()=>{
  console.log('  第1轮后: 日志', E.log.length, '句 | 进度', d.getElementById('progress').textContent,
              '| 文字', JSON.stringify(d.getElementById('text').textContent));
  send();
  setTimeout(()=>{
    console.log('  第2轮后: 日志', E.log.length, '句 | 进度', d.getElementById('progress').textContent,
                '| 文字', JSON.stringify(d.getElementById('text').textContent));
    send();
    setTimeout(()=>{
      console.log('  第3轮后: 日志', E.log.length, '句 | 进度', d.getElementById('progress').textContent,
                  '| 文字', JSON.stringify(d.getElementById('text').textContent));
      console.log('  API 调用次数:', n, '(应为 3)');
      console.log('  send 按钮可用:', !d.getElementById('send').disabled?'✔':'✘ 卡住');
      console.log('  转圈已停:', d.getElementById('spinner').hidden?'✔':'✘');
      process.exit(0);
    },1200);
  },1200);
},1200);
