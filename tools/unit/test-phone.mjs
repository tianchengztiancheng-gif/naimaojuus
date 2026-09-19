/* phone.js 单测：重点是「舰娘之间的对话不该进指挥官的私聊」 */
import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);

const sb = { console };
sb.window = sb;
sb.RESOURCE = { characters: {}, defaults: {}, scenes: {} };
['Z52','Z9','Z47','Z46','Z23','柴郡','长门','贝尔法斯特','谢菲尔德'].forEach(n => { sb.RESOURCE.defaults[n] = ['u']; });
sb.PHONE_RES = { avatars: {}, stickers: {}, defaultAvatars: ['d'], groupMeta: { '公共频道': {} } };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(P('core','phone.js'), 'utf8'), sb);
const Phone = sb.Phone;

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));
const turn = txt => [{ role: 'assistant', content: txt }];

console.log('\n[1] peerDirected —— 认出「这条其实是说给别的舰娘听的」');
ok('开头喊别人的名字 → 认出来',
   Phone.peerDirected('Z52', 'Z9！！！你看到了吗后面那个！', '指挥官') === 'Z9');
ok('省略号也算呼格',
   Phone.peerDirected('Z9', 'Z52……你现在不是应该在做第七题吗……', '指挥官') === 'Z52');
ok('第三人称提指挥官 → 认出来',
   !!Phone.peerDirected('Z52', 'Z47坐在指挥官大腿上了！！！', '指挥官'));
ok('正常发给指挥官的不误伤（呼格是指挥官本人）',
   Phone.peerDirected('柴郡', '指挥官，早呀，今天也要加油哦。', '指挥官') === null);
ok('有第二人称就不算第三人称提及',
   Phone.peerDirected('柴郡', '指挥官你今天有空吗？', '指挥官') === null);
ok('喊自己的名字不算（模型偶尔自称）',
   Phone.peerDirected('柴郡', '柴郡，来啦！', '指挥官') === null);
ok('不认识的名字不算（别把普通开头词当人名）',
   Phone.peerDirected('柴郡', '那个，我想问一下……', '指挥官') === null);
ok('普通一句话不动', Phone.peerDirected('柴郡', '今天天气真好呀。', '指挥官') === null);
ok('自定义称呼也认', Phone.peerDirected('柴郡', '提督，早。', '提督') === null);

console.log('\n[2] scan —— 你截图里那一幕，原样跑一遍');
const real = turn([
  '[短信|Z52|文字|Z9！！！你看到了吗后面那个！Z47坐在指挥官大腿上了！！！]',
  '[短信|Z52|文字|不公平吧？！ 凭什么啊？！ 就因为她手机被没收了？！]',
  '[短信|Z52|文字|别转移话题！]',
  '[短信|Z9|文字|……看到了。]',
  '[短信|Z9|文字|Z52……你现在不是应该在做第七题吗……]'
].join('\n'));
const d = Phone.scan(real, [], { userName: '指挥官' });
ok('Z52 的私聊里干净了（不再有对 Z9 说的话）', !d.chats['Z52'], JSON.stringify(Object.keys(d.chats)));
ok('Z9 的私聊里也干净了', !d.chats['Z9']);
ok('全都进了「舰娘闲聊」群', (d.groups['舰娘闲聊'] || []).length === 5,
   String((d.groups['舰娘闲聊'] || []).length));
ok('「别转移话题！」这种没线索的也跟着走了（同一段对话不能拆散）',
   (d.groups['舰娘闲聊'] || []).some(x => x.v === '别转移话题！'));
ok('「……看到了。」也跟着走了（它在呼格那条前面，靠整组判断才抓得到）',
   (d.groups['舰娘闲聊'] || []).some(x => x.v === '……看到了。'));
ok('群里发言人保留原样', (d.groups['舰娘闲聊'] || []).filter(x => x.who === 'Z52').length === 3);
ok('标了 rerouted，调试面板能看出是被改投的',
   (d.groups['舰娘闲聊'] || []).every(x => x.rerouted));

console.log('\n[3] 真·私信不受影响');
const dm = Phone.scan(turn([
  '[短信|柴郡|文字|指挥官，早呀～今天也要加油哦。]',
  '[短信|柴郡|文字|中午一起吃饭好不好？]'
].join('\n')), [], { userName: '指挥官' });
ok('留在柴郡的私聊里', (dm.chats['柴郡'] || []).length === 2, JSON.stringify(Object.keys(dm.chats)));
ok('没有凭空多出群聊', !dm.groups['舰娘闲聊']);

console.log('\n[4] 混在一起时各走各的');
const mix = Phone.scan(turn([
  '[短信|柴郡|文字|指挥官，你在忙吗？]',
  '[短信|Z52|文字|Z9！快看这个！]'
].join('\n')), [], { userName: '指挥官' });
ok('柴郡的私信留下', (mix.chats['柴郡'] || []).length === 1);
ok('Z52 的改投群聊', (mix.groups['舰娘闲聊'] || []).length === 1);
ok('Z52 没在私聊里留残影', !mix.chats['Z52']);

console.log('\n[5] 模型自己写对了群聊时照旧');
const grp = Phone.scan(turn([
  '[群聊|驱逐舰小队|Z52|文字|今晚吃什么？]',
  '[群聊|驱逐舰小队|Z9|文字|随便。]'
].join('\n')), [], { userName: '指挥官' });
ok('原样进它自己的群', (grp.groups['驱逐舰小队'] || []).length === 2);
ok('不会被塞进舰娘闲聊', !grp.groups['舰娘闲聊']);

console.log('\n[6] 去重与跨轮');
const two = Phone.scan([
  { role: 'assistant', content: '[短信|Z52|文字|Z9！快看！]' },
  { role: 'assistant', content: '[短信|Z52|文字|Z9！快看！]' },
  { role: 'assistant', content: '[短信|柴郡|文字|指挥官，晚安。]' }
], [], { userName: '指挥官' });
ok('重复的那条只算一次', (two.groups['舰娘闲聊'] || []).length === 1,
   String((two.groups['舰娘闲聊'] || []).length));
ok('后一轮的正常私信不受前一轮影响', (two.chats['柴郡'] || []).length === 1);


console.log('\n[7] 通讯录剔除名单');
sb.RESOURCE.defaults['阿尔贝托']=['u']; sb.RESOURCE.defaults['天青']=['u'];
sb.RESOURCE.defaults['布里·META']=['u']; sb.RESOURCE.defaults['布里']=['u'];
sb.RESOURCE.defaults['新月JP']=['u']; sb.RESOURCE.defaults['新月']=['u'];
sb.RESOURCE.defaults['小加贺']=['u']; sb.RESOURCE.defaults['加贺']=['u'];
sb.RESOURCE.defaults['泛用型布里']=['u']; sb.RESOURCE.defaults['奥斯塔']=['u'];
sb.RESOURCE.defaults['乌戈里诺·']=['u'];
const R = Phone.roster();
Phone.ROSTER_EXCLUDE.forEach(n => ok('剔掉 ' + n, R.indexOf(n) < 0));
ok('同前缀的没被误伤', ['布里','新月','加贺'].every(n => R.indexOf(n) >= 0),
   JSON.stringify(['布里','新月','加贺'].filter(n => R.indexOf(n) < 0)));
ok('excluded() 精确匹配，不做前缀匹配',
   Phone.excluded('布里·META') && !Phone.excluded('布里'));
ok('两头空格也认', Phone.excluded('  天青  '));

console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂\n');
process.exit(fail ? 1 : 0);
