global.window=global; global.localStorage={_d:{},getItem:()=>null,setItem(){}};
['resource/juus/expressions.js','resource/juus/scenes.js','resource/juus/phone.js',
 'resource/tianqing/expressions.js','resource/tianqing/scenes.js','resource/aliases.js',
 'core/resolver.js','core/worldbook.js','core/prompt.js','core/script.js','core/phone.js',
 'core/engine.js','core/editors.js'].forEach(f=>require('/home/claude/engine/'+f));
const C=RESOURCE.characters;
const rows=Object.keys(C).map(n=>{
  const o=C[n].outfits, outfits=Object.keys(o);
  let exprs=0, imgs=0, multi=0;
  outfits.forEach(k=>Object.keys(o[k]).forEach(e=>{exprs++; imgs+=o[k][e].length; if(o[k][e].length>1)multi++;}));
  return {n, outfits, nOut:outfits.length, exprs, imgs, multi};
}).sort((a,b)=>b.imgs-a.imgs);
console.log('总角色', rows.length, '| 总立绘', rows.reduce((s,r)=>s+r.imgs,0));
console.log('\n=== 多套服装的角色 ===');
rows.filter(r=>r.nOut>1).forEach(r=>console.log('  '+r.n+'  ['+r.outfits.join(' / ')+']  '+r.exprs+'表情 '+r.imgs+'图'));
console.log('\n=== 按立绘数排名（全部）===');
rows.forEach((r,i)=>{
  if(i%4===0) process.stdout.write('\n  ');
  process.stdout.write((r.n+'('+r.imgs+')').padEnd(20));
});
console.log('\n\n=== 有多图差分的角色（同一表情有多张） ===');
const md=rows.filter(r=>r.multi>0).sort((a,b)=>b.multi-a.multi);
console.log('  共', md.length, '人');
md.forEach((r,i)=>{ if(i%4===0) process.stdout.write('\n  '); process.stdout.write((r.n+'×'+r.multi).padEnd(18)); });
console.log('\n\n=== 只有单图的角色 ===');
const sd=rows.filter(r=>r.multi===0);
console.log('  共', sd.length, '人:', sd.map(r=>r.n).join('、'));
