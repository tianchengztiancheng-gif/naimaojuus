/* 自定义立绘（core/customsprites.js）+ 动态评论存进 phoneSent（v5.27） */
import fs from 'fs'; import vm from 'vm';
import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = (...a) => path.join(ROOT, ...a);

const kv = {};
const sb = { console, setTimeout, clearTimeout, Date, Math, JSON, Promise };
sb.window = sb;
sb.localStorage = { getItem: () => null, setItem: () => {} };
sb.GalStore = { get: async k => kv[k] && JSON.parse(kv[k]), set: async (k, v) => { kv[k] = JSON.stringify(v); return true; } };
const card = () => ({ characters: { 甲: { default_outfit: '常服', outfits: { 常服: { 微笑: ['card-smile'], 平静: ['card-calm'] } } } },
  defaults: { 甲: ['card-def'], 乙: ['yi-def'] }, scenes: {} });
sb.RESOURCE = card();
vm.createContext(sb);
for (const f of ['resolver', 'script', 'phone', 'customsprites'])
  vm.runInContext(fs.readFileSync(P('core', f + '.js'), 'utf8'), sb);
const { CustomSprites: C, Resolver } = sb;

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n      → ' + x : '')));
const J = x => JSON.stringify(x);
const R = () => sb.RESOURCE;

console.log('\n[1] 加 / 合进素材表');
{
  let threw = '';
  try { C.add('', '常服', '微笑', 'https://x/a.png'); } catch (e) { threw = e.message; }
  ok('没填角色名：报错', /角色名/.test(threw));
  threw = '';
  try { C.add('丙', '', '', 'javascript:alert(1)'); } catch (e) { threw = e.message; }
  ok('不是图片地址：报错', /http/.test(threw));
  const r = C.add('丙|<x>', '', '', 'https://x/b.png');
  ok('名字里的竖线尖括号去掉；服装默认常服、表情默认平静', r.name === '丙x' && r.outfit === '常服' && r.expr === '平静', J(r));
  C.add('丙x', '常服', '平静', 'https://x/b.png');
  ok('同一张不重复加', C.count() === 1);
  C.add('甲', '常服', '微笑', 'data:image/webp;base64,AAA');
  C.add('甲', '泳装', '害羞', 'https://x/swim.png');
  C.add('乙', '常服', '生气', 'https://x/yi-angry.png');
  C.apply();
  ok('新角色：建起来，默认服装是加的那套', R().characters['丙x'] && R().characters['丙x'].default_outfit === '常服' &&
     R().characters['丙x'].outfits['常服']['平静'][0] === 'https://x/b.png');
  ok('卡里有的同一格：换成玩家的图', J(R().characters['甲'].outfits['常服']['微笑']) === J(['data:image/webp;base64,AAA']));
  ok('卡里有的其它表情不动', R().characters['甲'].outfits['常服']['平静'][0] === 'card-calm');
  ok('卡里有的角色加新服装', R().characters['甲'].outfits['泳装']['害羞'][0] === 'https://x/swim.png');
  ok('只有默认立绘的角色：补上表情差分', R().characters['乙'] && R().characters['乙'].outfits['常服']['生气'][0] === 'https://x/yi-angry.png');
  const s = Resolver.sprite('乙', '生气', {});
  ok('立绘查找：加的表情用得上', s && s.url === 'https://x/yi-angry.png', J(s));
  const s2 = Resolver.sprite('乙', '开心', {});
  ok('立绘查找：没加的表情退回卡里的默认立绘', s2 && s2.url === 'yi-def', J(s2));
  ok('isNew：卡里本来没有的才算', C.isNew('丙x') && C.isNew('乙') && !C.isNew('甲'));
  ok('重复 apply 不叠加', (C.apply(), J(R().characters['甲'].outfits['常服']['微笑'])) === J(['data:image/webp;base64,AAA']));
}

console.log('\n[2] 删除后还原卡里的');
{
  C.remove('甲', '常服', '微笑', 0); C.apply();
  ok('删掉覆盖的那张：卡里原来的回来了', J(R().characters['甲'].outfits['常服']['微笑']) === J(['card-smile']));
  C.remove('甲'); C.apply();
  ok('删掉整个角色的自定义：加的服装没了，卡里的还在', !R().characters['甲'].outfits['泳装'] && R().characters['甲'].outfits['常服']['平静'][0] === 'card-calm');
  C.remove('乙'); C.apply();
  ok('只有默认立绘的角色：删光后回到只有默认立绘', !R().characters['乙'] && R().defaults['乙'][0] === 'yi-def');
  ok('剩下的', J(C.names()) === J(['丙x']));
}

console.log('\n[3] 换卡（素材表整块重写）之后');
{
  C.add('甲', '常服', '微笑', 'https://x/mine.png');
  C.apply();
  sb.RESOURCE.characters = card().characters;      // 模拟 CardRes.apply 覆盖
  C.forget(); C.apply();
  ok('forget + apply：重新合上', R().characters['甲'].outfits['常服']['微笑'][0] === 'https://x/mine.png' && R().characters['丙x']);
  C.remove('甲'); C.apply();
  ok('之后再删：还原的是新卡里的', R().characters['甲'].outfits['常服']['微笑'][0] === 'card-smile');
  /* 真的载卡是 Object.assign 合并：卡里没有的角色（玩家新加的、预置素材包里的）对象不会被换掉 */
  C.add('丁', '常服', '平静', 'https://x/d.png');
  sb.RESOURCE.characters['戊'] = { default_outfit: '常服', outfits: { 常服: { 微笑: ['pack-smile'] } } };
  C.add('戊', '常服', '微笑', 'https://x/e.png');
  C.apply();
  Object.assign(sb.RESOURCE.characters, card().characters);   // 再载一次卡
  C.forget(); C.apply();
  ok('载卡后：新加的角色、预置素材包角色上的改动都还在', R().characters['丁'].outfits['常服']['平静'][0] === 'https://x/d.png' &&
     R().characters['戊'].outfits['常服']['微笑'][0] === 'https://x/e.png');
  C.remove('丁'); C.remove('戊'); C.apply();
  ok('再删：新角色真没了，预置素材包的原图回来了（不会留下鬼影）', !R().characters['丁'] && R().characters['戊'].outfits['常服']['微笑'][0] === 'pack-smile',
     J([R().characters['丁'], R().characters['戊']]));
}

console.log('\n[4] 提示词说明 / 存取 / 导入导出');
{
  C.add('丙x', '常服', '微笑', 'https://x/c2.png');
  C.add('丙x', '睡衣', '困倦', 'https://x/c3.png');
  C.apply();
  const n = C.note();
  ok('提示词里列出角色、服装和表情', /<自定义立绘>/.test(n) && /丙x（常服：平静\/微笑；睡衣：困倦）/.test(n), n);
  await C.save();
  const saved = JSON.parse(kv.custom_sprites);
  ok('存进 GalStore', saved.chars['丙x']['睡衣']['困倦'][0] === 'https://x/c3.png');
  C.data = { chars: {} }; C.apply();
  ok('清空后 note 为空', C.note() === '' && !R().characters['丙x']);
  await C.load(); C.apply();
  ok('读回来', C.count() === 3 && R().characters['丙x'].outfits['睡衣']);
  const ex = C.exportJSON();
  C.data = { chars: {} };
  const got = C.importJSON(JSON.parse(JSON.stringify(ex)));
  ok('导出再导入：一张不少', got === 3 && C.count() === 3);
  ok('再导入一次不重复', C.importJSON(ex) === 0 && C.count() === 3);
  ok('导入时过滤掉不是图片的地址', C.importJSON({ chars: { 坏: { 常服: { 平静: ['javascript:x', 'file:///etc/passwd'] } } } }) === 0 && !C.names().includes('坏'));
}

console.log('\n[5] 动态评论存在 phoneSent，按帖子 id 挂回去');
{
  const hist = [{ role: 'assistant', content: '[小红书|甲|今天的晚饭|好吃|10|2|1]\n[评论|乙|看起来不错]' }];
  const d0 = sb.Phone.scan(hist, [], {});
  const id = d0.posts.find(p => p.title === '今天的晚饭').id;
  const sent = [{ kind: 'cmt', post: id, who: '指挥官', text: '我也想吃', mine: true },
                { kind: 'cmt', post: id, who: '甲', text: '下次带你', mine: false },
                { kind: 'cmt', post: 'p-不存在', who: 'x', text: 'y' }];
  const d = sb.Phone.scan(hist, sent, {});
  const p = d.posts.find(x => x.id === id);
  ok('剧情里的评论 + 存下来的评论都在，顺序对', J(p.cmts.map(c => c.text)) === J(['看起来不错', '我也想吃', '下次带你']), J(p.cmts));
  ok('自己的评论标成 mine', p.cmts[1].mine === true && !p.cmts[2].mine);
  ok('评论数跟着加', p.comments === '4', p.comments);
  ok('评论记录不会混进私聊', !Object.keys(d.chats).length);
  const again = sb.Phone.scan(hist, sent, {});
  ok('每次扫描都一样（不会越挂越多）', again.posts.find(x => x.id === id).cmts.length === 3);
}

console.log('\n' + (fail ? '✗' : '✓') + ' ' + pass + ' 过 / ' + fail + ' 挂');
process.exit(fail ? 1 : 0);
