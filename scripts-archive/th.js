const fs=require('fs');
global.window=global; global.localStorage={_d:{},getItem:()=>null,setItem(){}};
['resource/juus/expressions.js','resource/juus/scenes.js','resource/juus/phone.js','resource/aliases.js',
 'core/resolver.js','core/worldbook.js','core/prompt.js','core/script.js','core/phone.js','core/engine.js']
 .forEach(f=>require('/home/claude/engine/'+f));
const card=JSON.parse(fs.readFileSync('/home/claude/card.json','utf8'));
const E=new Engine(); E.loadCard(card);
E.seedVarsFromOpening(card.data.alternate_greetings[4]);
E.log=[{turn:0,who:'柴郡',text:'指挥官早呀，今天也要加油哦。',narration:false},
       {turn:0,who:'旁白',text:'她把报告放在桌角。',narration:true}];
const ctx=E.quietContext('柴郡 报告呢',{who:'柴郡'});
console.log('=== quietContext ===');
console.log('  剧情:', JSON.stringify(ctx.scene));
console.log('  设定长度:', ctx.lore.length, '字');
console.log('  设定开头:', JSON.stringify(ctx.lore.slice(0,90)));
const pr=Phone.buildSmsPrompt('柴郡',[],E.vars.人物['柴郡'],'报告呢',ctx);
console.log('\n=== 私聊提示词自检 ===');
[['好感度',/好感度约 \d+/],['服装',/现在穿着/],['她的设定',/\[她的设定\]/],
 ['现在的剧情',/\[现在的剧情\]/],['地点',/地点：/],['最近发生的',/最近发生的/],
 ['表情包名单',/【表情包只能从这份名单里原样照抄】/]].forEach(([n,re])=>
  console.log('  '+n+':', re.test(pr)?'✔':'✘'));
console.log('  提示词总长:', pr.length, '字');
console.log('\n=== 表情名匹配收紧 ===');
['躺','完全瞎编的名字','啊','听我上课','xyzabc'].forEach(n=>
  console.log('  '+n.padEnd(12), Phone.stickerOf(n)?('→ '+Phone.stickerOf(n).slice(-10)):'→ null（正确拒绝）'));
