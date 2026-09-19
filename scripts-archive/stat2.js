global.window=global; global.localStorage={_d:{},getItem:()=>null,setItem(){}};
['resource/juus/expressions.js','resource/juus/scenes.js','resource/juus/phone.js',
 'resource/tianqing/expressions.js','resource/tianqing/scenes.js','resource/aliases.js',
 'core/resolver.js','core/worldbook.js','core/prompt.js','core/script.js','core/phone.js',
 'core/engine.js','core/editors.js'].forEach(f=>require('/home/claude/engine/'+f));
const fs=require('fs');
const card=JSON.parse(fs.readFileSync('/home/claude/card.json','utf8'));
const E=new Engine(); E.loadCard(card);
const st=Editors.bookStats(E.pool);
console.log('世界书:', JSON.stringify(st));
console.log('场景:', Object.keys(RESOURCE.scenes).length, '地点 /',
  Object.values(RESOURCE.scenes).reduce((s,o)=>s+Object.keys(o).length,0), '张图');
console.log('手机资源: 头像', Object.keys(PHONE_RES.avatars).length,
  '表情包', Object.keys(PHONE_RES.stickers).length,
  '群组', Object.keys(PHONE_RES.groupMeta||{}).length,
  '种子帖', PHONE_RES.basePosts.length, '种子热点', PHONE_RES.baseTrends.length);
console.log('预置地名别名:', Object.keys(SCENE_ALIASES).length);
console.log('开场白:', (card.data.alternate_greetings||[]).length);
console.log('内置世界书条目:', [Editors.PHONE_RULE_ID, Editors.STAGE_RULE_ID]
  .filter(id=>Editors.findEntry(E.pool,id)).length);
let n=0; const w=(d)=>{fs.readdirSync(d,{withFileTypes:true}).forEach(e=>{
  if(e.isDirectory()) w(d+'/'+e.name); else n++;});};
w('/home/claude/engine');
console.log('工程文件数:', n);
const lines=(f)=>fs.readFileSync('/home/claude/engine/'+f,'utf8').split('\n').length;
['core/engine.js','core/worldbook.js','core/prompt.js','core/script.js','core/phone.js',
 'core/resolver.js','core/api.js','core/editors.js','core/storage.js','app/app.js']
 .forEach(f=>console.log('  '+f.padEnd(22), lines(f), '行'));
