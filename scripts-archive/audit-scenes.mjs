import fs from 'fs'; import vm from 'vm';
const sb = { console }; sb.window = sb; sb.localStorage = { getItem:()=>null, setItem:()=>{} };
vm.createContext(sb);
for (const f of ['resource/tianqing/scenes.js','resource/juus/scenes.js','resource/aliases.js','core/resolver.js'])
  vm.runInContext(fs.readFileSync('../'+f,'utf8'), sb);
const keys = Object.keys(sb.RESOURCE.scenes);
console.log('场景总数:', keys.length, '| 预置别名:', Object.keys(sb.SCENE_ALIASES||{}).length);

/* 模型在碧蓝航线同人里最可能自由发明的地名 */
const probes = `餐厅 食堂 饭堂 厨房 后厨 宿舍 房间 卧室 我的房间 她的房间 客厅 起居室
走廊 楼道 大厅 门口 玄关 阳台 天台 屋顶 庭院 院子 花园 后院
办公室 指挥室 作战室 会议室 资料室 档案室 训练场 演习场 靶场 工厂 车间 仓库
教室 学校 学院 校园 操场 图书馆 自习室 社团活动室 保健室 医务室 医院 病房
浴室 澡堂 温泉 泡汤 更衣室 洗手间
港口 码头 海边 沙滩 海滩 海岸 甲板 舰桥 船上 海上
商店街 商业街 街道 市集 集市 广场 公园 咖啡厅 咖啡馆 甜品店 酒吧 居酒屋
神社 寺庙 教堂 祭典 庙会 烟花大会 夏日祭
电影院 游乐园 游乐场 水族馆 商场 购物中心 车站 列车 电车 公交车 车里
雪地 雪山 森林 山顶 河边 湖边 桥上 马路 公路 天文馆 演唱会 舞台 后台
新年 圣诞 万圣节 情人节 泳池 游泳池 赛车场 赌场 酒店 旅馆 民宿`
  .split(/\s+/).filter(Boolean);

const rows = probes.map(loc => { const r = sb.Resolver.scene(loc, '白日'); return { loc, via: r?r.via:'null', hit: r?r.loc:'-' }; });
const byVia = {}; rows.forEach(r => (byVia[r.via] = (byVia[r.via]||0)+1));
console.log('\n=== 分布 ===');
Object.entries(byVia).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k.padEnd(14)} ${v}  (${(v/rows.length*100).toFixed(0)}%)`));

console.log('\n=== 哈希兜底（完全乱给，最该修）===');
rows.filter(r=>r.via==='hash').forEach(r => console.log(`  ${r.loc.padEnd(8)} → ${r.hit}`));
console.log('\n=== 相似度兜底（多半也不对）===');
rows.filter(r=>r.via==='similar').forEach(r => console.log(`  ${r.loc.padEnd(8)} → ${r.hit}`));
console.log('\n=== 包含匹配（看着像对，实际常挑到偏门的）===');
rows.filter(r=>r.via==='fuzzy').forEach(r => console.log(`  ${r.loc.padEnd(8)} → ${r.hit}`));
