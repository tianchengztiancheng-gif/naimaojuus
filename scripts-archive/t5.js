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
const E=new w.Engine(); 
console.log('载入卡:', E.loadCard(card), '条（含内置规则）');
const rule=w.Editors.findEntry(E.pool, w.Editors.PHONE_RULE_ID);
console.log('内置规则存在:', !!rule, '| 蓝灯:', rule.constant, '| 启用:', rule.enabled, '|', rule.content.length, '字');
console.log('重复载入不会重复加:', (E.loadCard(card), E.pool.filter(x=>x.uid===w.Editors.PHONE_RULE_ID).length)===1);
// 激活验证
const r=w.Worldbook.activate(E.pool,[{role:'user',content:'早上好'}],{rng:()=>0.01});
console.log('激活时包含手机规则:', r.active.some(x=>x.uid===w.Editors.PHONE_RULE_ID));
// 人设注入
w.Editors.savePersona({name:'天铖',description:'黑发蓝瞳的男性',position:'prompt',depth:4});
E.loadPreset({prompts:[{identifier:'m',content:'x',role:'system'},{identifier:'personaDescription',marker:true},{identifier:'chatHistory',marker:true}],
 prompt_order:[{order:[{identifier:'m',enabled:true},{identifier:'personaDescription',enabled:true},{identifier:'chatHistory',enabled:true}]}]});
const dry=E.dryRun('你好',{persona:w.Editors.loadPersona().description, userName:'天铖'});
console.log('人设进入请求:', JSON.stringify(dry.messages).includes('黑发蓝瞳')?'✔':'✘');
console.log('称呼替换 {{user}}:', dry.report.blocks.map(b=>b.tag).join(','));
process.exit(0);
