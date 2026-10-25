/* 单测：web/js/core/library.js + web/js/core/lyrics.js
 * 在 node vm 里跑浏览器脚本（不需要浏览器/桥接），用假 Bridge 验证持久化。
 * 运行：node tools/test_library.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' -> ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b }); }

/** 造一个沙箱：window + 假 Bridge（kv 存在内存里，可跨实例复用） */
function makeSandbox(kvStore) {
  const store = kvStore || new Map();
  const win = {
    Bridge: {
      async kvGet(k) { return store.has(k) ? store.get(k) : null; },
      async kvSet(k, v) { store.set(k, String(v)); return { ok: true }; },
      async proxyJson() { throw new Error('not used'); }
    },
    console
  };
  win.window = win;
  const ctx = { window: win, console, setTimeout, clearTimeout, Promise, JSON, Date, Math, String, Number, Array, Object, parseInt, parseFloat, isFinite, RegExp, Error };
  vm.createContext(ctx);
  return { ctx, store };
}

function load(file, ctx) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  vm.runInContext(code, ctx, { filename: file });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function playable(name, artist, sources) {
  return {
    key: name + '|' + artist,
    name, artists: [artist], album: '专辑', durationMs: 200000, coverUrl: 'https://x/y.jpg',
    sources, primary: sources[0]
  };
}
function song(platform, id, name, artist, raw) {
  return { platform, id, name, artists: [artist], album: '专辑', durationMs: 200000, coverUrl: '', vip: false, raw };
}

// ---------------- library ----------------
{
  const { ctx, store } = makeSandbox();
  load('web/js/core/library.js', ctx);
  const L = ctx.window.Library;
  await L.ready;

  ok('初始为空', L.favList().length === 0 && L.playlists().length === 0 && L.recent().length === 0);
  const p = playable('晴天', '周杰伦', [song('qq', '0039MnYb', '晴天', '周杰伦'), song('netease', '186016', '晴天', '周杰伦')]);

  ok('未收藏', L.isFav(p) === false);
  ok('收藏 toggle -> true', L.toggleFav(p) === true);
  ok('已收藏', L.isFav(p) === true);
  eq('收藏 1 条', L.favList().length, 1);
  ok('重复收藏 toggle -> false（取消）', L.toggleFav(p) === false);
  eq('取消后 0 条', L.favList().length, 0);

  L.toggleFav(p);
  // 瘦身：raw 里的大字段必须被丢掉，但酷狗 Privilege 要留
  const kugouSong = song('kugou', 'HASH1', '小星星', '汪苏泷', { Privilege: 8, huge: 'x'.repeat(5000), other: [1, 2, 3] });
  const big = playable('小星星', '汪苏泷', [kugouSong]);
  L.toggleFav(big);
  await sleep(500); // 等 debounce 写 kv
  const saved = JSON.parse(store.get('mb.library.v1'));
  const savedKugou = saved.fav.find((x) => x.sources && x.sources[0] && x.sources[0].platform === 'kugou');
  ok('快照存在', !!savedKugou);
  eq('raw 只保留 Privilege', savedKugou && savedKugou.sources[0].raw, { Privilege: 8 });
  ok('大字段被丢弃', !JSON.stringify(saved).includes('xxxxx'));

  // 歌单
  const pl = L.createPlaylist('  我的测试歌单  ');
  eq('歌单名去空白', pl.name, '我的测试歌单');
  ok('加入歌单', L.addToPlaylist(pl.id, p) === true);
  ok('重复加入返回 false', L.addToPlaylist(pl.id, p) === false);
  eq('playlistOf', L.playlistOf(p), [pl.id]);
  ok('重命名', L.renamePlaylist(pl.id, '改名后') === true);
  eq('重命名生效', L.getPlaylist(pl.id).name, '改名后');
  ok('从歌单移除', L.removeFromPlaylist(pl.id, p.key) === true);
  eq('移除后歌单空', L.getPlaylist(pl.id).songs.length, 0);
  ok('删除歌单', L.deletePlaylist(pl.id) === true);
  eq('删除后 0 个歌单', L.playlists().length, 0);

  // 最近播放：同曲去重且置顶
  L.pushRecent(p);
  L.pushRecent(big);
  L.pushRecent(p);
  const rec = L.recent();
  eq('最近播放去重后 2 条', rec.length, 2);
  eq('最近播放置顶', rec[0].key, p.key);

  // 重新加载持久化（recent 的保存带 1s debounce，先等它 / flush 落盘）
  await sleep(1300);
  L.flush();
  await sleep(50);
  const { ctx: ctx2, store: store2 } = makeSandbox(store);
  load('web/js/core/library.js', ctx2);
  await ctx2.window.Library.ready;
  eq('重载后收藏恢复', ctx2.window.Library.favList().length, 2);
  eq('重载后最近播放恢复', ctx2.window.Library.recent().length, 2);
  ok('重载后 isFav 正确', ctx2.window.Library.isFav(p) === true);

  // 损坏数据不崩
  store2.set('mb.library.v1', '{not json');
  const { ctx: ctx3, store: store3 } = makeSandbox(store2);
  load('web/js/core/library.js', ctx3);
  await ctx3.window.Library.ready;
  eq('损坏 JSON 时降级为空库', ctx3.window.Library.favList().length, 0);

  // stats
  ok('stats 有字段', typeof L.stats().bytes === 'number' && L.stats().fav === 2);
}

// ---------------- lyrics ----------------
{
  const { ctx } = makeSandbox();
  // 假 providers：netease 没歌词，qq 有；验证回退顺序与缓存
  let calls = [];
  const lrcQq = '[ti:测试]\n[offset:0]\n[00:01.00]第一句\n[00:03.50]第二句\n[00:06.25][00:09.00]重复句\n[00:12.30]\n';
  ctx.window.Providers = [
    { id: 'qq', async lyric(s) { calls.push('qq'); return { text: lrcQq, source: 'qq' }; } },
    { id: 'kugou', async lyric() { calls.push('kugou'); return null; } },
    { id: 'netease', async lyric() { calls.push('netease'); return null; } }
  ];
  ctx.window.providerById = (id) => ctx.window.Providers.find((p) => p.id === id) || null;
  load('web/js/core/lyrics.js', ctx);
  const Ly = ctx.window.Lyrics;

  const lines = Ly.parse(lrcQq);
  eq('解析行数（含重复时间标签）', lines.length, 5);
  eq('首行时间', lines[0].t, 1);
  eq('首行文本', lines[0].text, '第一句');
  eq('重复句两个时间点', lines.map((l) => l.t).slice(2, 4), [6.25, 9]);
  eq('空文本行保留', lines[4].text, '');

  eq('indexAt 之前返回 -1', Ly.indexAt(lines, 0.2), -1);
  eq('indexAt 1.0 -> 0', Ly.indexAt(lines, 1.0), 0);
  eq('indexAt 3.6 -> 1', Ly.indexAt(lines, 3.6), 1);
  eq('indexAt 100 -> 末行', Ly.indexAt(lines, 100), lines.length - 1);
  eq('空数组 indexAt', Ly.indexAt([], 5), -1);

  // offset 修正：+1000ms 表示歌词提前 1s
  const off = Ly.parse('[offset:1000]\n[00:05.00]x\n');
  eq('offset 修正', off[0].t, 4);

  // 各种时间格式
  const fmt = Ly.parse('[00:01.5]a\n[00:02.25]b\n[00:03.125]c\n[1:04]d\n');
  eq('时间格式 [mm:ss.s]', fmt[0].t, 1.5);
  eq('时间格式 [mm:ss.xx]', fmt[1].t, 2.25);
  eq('时间格式 [mm:ss.xxx]', fmt[2].t, 3.125);
  eq('时间格式 [m:ss]', fmt[3].t, 64);

  const item = playable('测试', '歌手', [song('netease', '1', '测试', '歌手'), song('qq', '2', '测试', '歌手')]);
  ctx.window.Player = { source: null };
  const got = await Ly.fetch(item);
  ok('fetch 取到歌词', got && got.lines.length === 5);
  eq('fetch 来源平台', got && got.source, 'qq');
  eq('回退顺序 netease -> qq', calls.slice(0, 2), ['netease', 'qq']);
  const again = await Ly.fetch(item);
  ok('缓存命中（不再请求）', again === got && calls.length === 2);
  ok('peek 返回缓存', Ly.peek(item) === got);

  const none = playable('无歌词', 'x', [song('netease', '9', '无歌词', 'x')]);
  calls = [];
  const r2 = await Ly.fetch(none);
  eq('全平台无歌词 -> null', r2, null);
  ok('确认无歌词也缓存', Ly.peek(none) === null);

  // provider 抛异常不崩
  ctx.window.Providers.push({ id: 'boom', async lyric() { throw new Error('boom'); } });
  const item2 = playable('异常', 'x', [song('boom', '1', '异常', 'x'), song('qq', '2', '异常', 'x')]);
  calls = [];
  const r3 = await Ly.fetch(item2);
  ok('provider 抛错仍回退成功', r3 && r3.source === 'qq');

  // fetch 并发去重
  const item3 = playable('并发', 'x', [song('qq', '3', '并发', 'x')]);
  calls = [];
  const [a, b] = await Promise.all([Ly.fetch(item3), Ly.fetch(item3)]);
  ok('并发请求共享 inflight', a === b && calls.length === 1);
}

console.log('\n' + (fail === 0 ? `ALL PASS (${pass})` : `FAILED ${fail} / ${pass + fail}`));
process.exit(fail === 0 ? 0 : 1);
