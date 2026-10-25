/* ============================================================
 * tools/build-juus-builtin.mjs —— 生成 resource/juus-card.js（内置的 juus 卡）
 *
 * 为什么有这个（v5.30）
 * ----------------------
 * 以前玩家得先在开场引导里载入自己的 juus 角色卡，引擎才有世界书、立绘、开场。
 * 卡作者 kikukiku 同意奶猫（本项目维护者）自立门户后，juus 的内容改成跟天青一样**随仓库分发**：
 * 打开网页就有，玩家只用导入自己的预设（破限）、想加的话再挂额外世界书。
 *
 * resource/juus-card.js 就是一张完整的 juus 卡（酒馆 V3 格式），引擎照载卡的老路走：
 * 世界书、立绘表（卡里 gal 前端正则里的 EXPRESSION_MAP / SCENE_MAP / DEFAULT_SPRITES）、
 * 手机资源、开场白、正则全都从它读，core/cardres.js 一行不用改。
 *
 * 它已经合进了 resource/juus-patch.js（修订包）的内容，所以卡里带一个标记
 *   data.extensions.gal_builtin.merged_patches = ['juus']
 * core/cardpatch.js 见到这个标记就不再打一遍 —— 否则修订包里旧的「贾维斯」条目
 * 会按名字盖掉世界书里新的，开局会重复一个，飞龙 / 苍龙的原皮会被再对调回去。
 *
 * 用法
 * ----
 *   只换世界书（最常用）：酒馆里「世界书 → 导出」那份 json
 *     node tools/build-juus-builtin.mjs --worldbook 新世界书.json
 *   换底卡（卡里的立绘表 / 开场 / 正则改了）：必须是已经打过修订包的卡
 *     node tools/build-juus-builtin.mjs --card 卡.json [--worldbook 世界书.json]
 *
 * 不给 --card 时以现有的 resource/juus-card.js 为底，只把世界书整本换掉。
 * 世界书按酒馆自己把世界书嵌进卡时的格式转（convertWorldInfoToCharacterBook），
 * 所以和在酒馆里「把这本世界书绑到卡上再导出」得到的是同一份东西。
 * ============================================================ */
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'resource', 'juus-card.js');
const GLOBAL = 'JUUS_CARD';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
}
function die(msg) { console.error(msg); process.exit(1); }

function readJSON(p) {
  let s = fs.readFileSync(p, 'utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return JSON.parse(s);
}

/** 读现有的 resource/juus-card.js（不执行别的，只拿那个全局变量） */
function readBuiltin() {
  if (!fs.existsSync(OUT)) die('还没有 resource/juus-card.js，第一次生成要给 --card');
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(OUT, 'utf8'), ctx, { filename: OUT });
  if (!ctx.window[GLOBAL]) die('resource/juus-card.js 里没有 window.' + GLOBAL);
  return ctx.window[GLOBAL];
}

/** 酒馆 convertWorldInfoToCharacterBook 的同款转换（世界书导出格式 → 卡内 character_book） */
function toCardBook(wi, name) {
  const src = wi.entries || wi;
  const list = Array.isArray(src) ? src : Object.keys(src).map(k => src[k]);
  if (!list.length) die('世界书里一条条目都没有');
  if (list[0].keys && !list[0].key) die('这像是卡里的 character_book，不是酒馆导出的世界书（要 key / uid 那种格式）');
  const entries = list.map(e => ({
    id: e.uid,
    keys: e.key || [],
    secondary_keys: e.keysecondary || [],
    comment: e.comment || '',
    content: e.content || '',
    constant: !!e.constant,
    selective: e.selective !== false,
    insertion_order: e.order,
    enabled: !e.disable,
    position: e.position == 0 ? 'before_char' : 'after_char',
    use_regex: true,
    extensions: {
      ...(e.extensions || {}),
      position: e.position,
      exclude_recursion: e.excludeRecursion ?? false,
      display_index: e.displayIndex,
      probability: e.probability ?? null,
      useProbability: e.useProbability ?? false,
      depth: e.depth ?? 4,
      selectiveLogic: e.selectiveLogic ?? 0,
      outlet_name: e.outletName ?? '',
      group: e.group ?? '',
      group_override: e.groupOverride ?? false,
      group_weight: e.groupWeight ?? null,
      prevent_recursion: e.preventRecursion ?? false,
      delay_until_recursion: e.delayUntilRecursion ?? false,
      scan_depth: e.scanDepth ?? null,
      match_whole_words: e.matchWholeWords ?? null,
      use_group_scoring: e.useGroupScoring ?? false,
      case_sensitive: e.caseSensitive ?? null,
      automation_id: e.automationId ?? '',
      role: e.role ?? 0,
      vectorized: e.vectorized ?? false,
      sticky: e.sticky ?? null,
      cooldown: e.cooldown ?? null,
      delay: e.delay ?? null,
      match_persona_description: e.matchPersonaDescription ?? false,
      match_character_description: e.matchCharacterDescription ?? false,
      match_character_personality: e.matchCharacterPersonality ?? false,
      match_character_depth_prompt: e.matchCharacterDepthPrompt ?? false,
      match_scenario: e.matchScenario ?? false,
      match_creator_notes: e.matchCreatorNotes ?? false,
      triggers: e.triggers ?? [],
      ignore_budget: e.ignoreBudget ?? false
    }
  }));
  const ids = new Set();
  entries.forEach(e => {
    if (e.id == null) die('有条目没有 uid：' + e.comment);
    if (ids.has(e.id)) die('uid 重复：' + e.id + '（' + e.comment + '）');
    ids.add(e.id);
  });
  return { name, entries };
}

const cardPath = arg('--card');
const wbPath = arg('--worldbook');
if (!cardPath && !wbPath) die('用法：node tools/build-juus-builtin.mjs [--card 卡.json] [--worldbook 世界书.json]');

let card = cardPath ? readJSON(cardPath) : readBuiltin();
const d0 = card.data || card;
if (!/juus|奶猫崛起/i.test(String(d0.name || ''))) die('这不是 juus 卡（名字是「' + d0.name + '」）');
const book0 = (d0.character_book && d0.character_book.entries) || [];
if (cardPath && !book0.some(e => e.comment === '贾维斯差分')) {
  die('这张卡还没打修订包（没有「贾维斯差分」条目）。先用酒馆版的 apply-juus-patch.py 打一遍再来。');
}

/* 只留 data（V3）：顶层那份 V1 字段是重复的，引擎只认 data */
const data = JSON.parse(JSON.stringify(d0));
if (wbPath) data.character_book = toCardBook(readJSON(wbPath), (data.character_book && data.character_book.name) || data.name);
data.extensions = data.extensions || {};
const prev = data.extensions.gal_builtin || {};
data.extensions.gal_builtin = {
  merged_patches: Array.from(new Set([].concat(prev.merged_patches || [], ['juus']))),
  worldbook_from: wbPath ? path.basename(wbPath) : (prev.worldbook_from || null),
  card_from: cardPath ? path.basename(cardPath) : (prev.card_from || null),
  built: new Date().toISOString().slice(0, 10)
};
const out = { spec: 'chara_card_v3', spec_version: '3.0', data };

const head = `/* ============================================================
 * resource/juus-card.js —— 内置的 juus 卡（「juus 之奶猫崛起 · 奶猫版本」）
 *
 * ⚠ 自动生成，别手改。改世界书：酒馆里导出世界书，然后
 *     node tools/build-juus-builtin.mjs --worldbook 新世界书.json
 *   说明见 tools/build-juus-builtin.mjs 文件头。
 *
 * 作者 kikukiku 与奶猫，经 kikukiku 同意随本仓库分发（见 NOTICE）。
 * 这份内容不适用本仓库的 MIT 许可证。
 *
 * 世界书 ${data.character_book.entries.length} 条 · 开场白 ${(data.alternate_greetings || []).length} 个 · 生成于 ${data.extensions.gal_builtin.built}
 * ============================================================ */
`;
fs.writeFileSync(OUT, head + 'window.' + GLOBAL + ' = ' + JSON.stringify(out, null, 1) + ';\n');
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log('写好了 resource/juus-card.js（' + kb + ' KB）：世界书 ' + data.character_book.entries.length +
  ' 条，开场白 ' + (data.alternate_greetings || []).length + ' 个');
