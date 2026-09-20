const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
function build(strip) {
  let html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const dom = new JSDOM(html, { runScripts:'outside-only', pretendToBeVisual:true, url:'http://localhost/' });
  const w = dom.window, d = w.document;
  w.requestAnimationFrame = cb => setTimeout(()=>cb(Date.now()),0);
  w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){} });
  w.fetch = () => Promise.reject(new Error('no net'));
  w.alert=()=>{}; w.confirm=()=>true; w.prompt=()=>null;
  // 内联所有样式表
  const css = ['app/style.css','app/phone-inner.css','resource/juus/phone.css','app/phone.css','app/editor-theme.css']
    .map(f=>fs.readFileSync(path.join(ROOT,f),'utf8')).join('\n');
  const st = d.createElement('style');
  st.textContent = strip ? css.replace(/#jup-root \*\{[^}]*\}/g,'') : css;
  d.head.appendChild(st);
  const FILES = ['test/fixtures/resource.js','resource/aliases.js','core/cardres.js','core/tokens.js','core/vector.js',
    'core/imagegen.js','core/snapshot.js','core/gallery.js','core/cg.js','core/resolver.js','core/worldbook.js',
    'core/prompt.js','core/script.js','core/phone.js','core/engine.js','core/api.js','core/storage.js',
    'core/editors.js','app/app.js'];
  for (const f of FILES) w.eval(fs.readFileSync(path.join(ROOT,f),'utf8'));
  d.getElementById('btn-phone').click();      // 打开手机 → buildPhone
  return { w, d };
}
const a = build(false), b = build(true);
const sel = '#jup-root *';
const ea = [...a.d.querySelectorAll(sel)], eb = [...b.d.querySelectorAll(sel)];
console.log('元素数', ea.length, eb.length);
const diff = {};
for (let i=0;i<Math.min(ea.length,eb.length);i++){
  const ca = a.w.getComputedStyle(ea[i]), cb = b.w.getComputedStyle(eb[i]);
  ['paddingLeft','paddingTop','marginLeft','marginTop','marginBottom'].forEach(p=>{
    if (ca[p]!==cb[p]) {
      const k = (ea[i].tagName.toLowerCase()) + '.' + (ea[i].className||'').toString().split(' ').filter(Boolean).slice(0,2).join('.') + ' ' + p;
      if(!diff[k]) diff[k] = ca[p] + ' → 应为 ' + cb[p];
    }
  });
}
const keys = Object.keys(diff);
console.log('被 #jup-root * 压掉的 padding/margin 种类数 =', keys.length);
keys.slice(0,40).forEach(k=>console.log('  ', k, ':', diff[k]));
