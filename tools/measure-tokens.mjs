import fs from 'fs'; import vm from 'vm';
const sb={TextDecoder,TextEncoder,console}; sb.window=sb; sb.globalThis=sb; sb.self=sb;
vm.createContext(sb);
for (const f of ['cl100k_base','o200k_base'])
  vm.runInContext(fs.readFileSync('core/vendor/gpt-tokenizer-'+f+'.js','utf8'), sb);
const cl = sb.GPTTokenizer_cl100k_base, oo = sb.GPTTokenizer_o200k_base;
function rough(s){const cjk=(s.match(/[一-龥぀-ヿ]/g)||[]).length;return Math.round(cjk+(s.length-cjk)/4);}
const samples = [
 ['纯中文（无标点）','指挥官今天也要好好工作不可以偷懒哦我会一直看着你的哦真的'],
 ['带标点对白','「指挥官，早呀。」她抬起头，眯着眼笑了笑。'],
 ['剧本行','她抬起头。|柴郡|微笑|'],
 ['世界书人设','柴郡，皇家阵营驱逐舰，性格活泼、爱撒娇，自称「猫猫」，说话常带「喵」字尾音。与贝尔法斯特关系亲密，常在港区厨房偷吃点心。战斗时以高速机动和近距离火力压制见长，对指挥官抱有强烈依赖感，会用玩笑掩饰真实情绪。厌恶被当作小孩子对待，但被夸奖时会得意地摇尾巴。口头禅：「喵哈～」「这种事情交给本喵就好啦！」'],
 ['JSON变量','{"好感度":78,"当前地点":"港区食堂","时间":"清晨","在场":["柴郡"]}'],
 ['英文prompt','1girl, cheshire (azur lane), cat ears, smile, kitchen, morning light, masterpiece, best quality, very aesthetic, absurdres'],
];
let tr=0,tc=0,to=0; const rows=[];
for (const [name,s] of samples){
  const r=rough(s), c=cl.encode(s).length, o=oo.encode(s).length;
  tr+=r;tc+=c;to+=o;
  rows.push([name, s.length, r, c, Math.round((r/c-1)*100)+'%', o, Math.round((r/o-1)*100)+'%']);
}
const w=[14,5,5,8,7,7,7];
console.log(['样本','字符','粗估','cl100k','误差','o200k','误差'].map((h,i)=>h.padEnd(w[i])).join(''));
for(const r of rows) console.log(r.map((x,i)=>String(x).padEnd(w[i])).join(''));
console.log('合计: 粗估 '+tr+' | cl100k '+tc+' 误差 '+(Math.round((tr/tc-1)*1000)/10)+'% | o200k '+to+' 误差 '+(Math.round((tr/to-1)*1000)/10)+'%');
