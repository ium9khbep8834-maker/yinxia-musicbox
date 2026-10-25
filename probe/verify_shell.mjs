// 真壳/真浏览器端到端验收：冷启动 → 搜索 → 播放 → 歌词 → 收藏 → 歌单 → 刷新后持久化
// 用法：CDP_PORT=9334 node probe/verify_shell.mjs [关键词]
// 前提：目标以 --remote-debugging-port=9334 启动（Windows 壳：
//       WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9334）
const PORT = process.env.CDP_PORT || 9334;
const OUT = process.env.SHOT_PREFIX || 'probe/win';
const kw = process.argv[2] || '晴天';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra === undefined ? null : extra });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''));
}

async function targets() {
  const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
  return r.json();
}
function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => res(ws);
    ws.onerror = (e) => rej(new Error('ws error ' + (e && e.message)));
  });
}
let msgId = 0;
const pending = new Map();
function send(ws, method, params) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params: params || {} }));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 30000);
  });
}

const list = await targets();
const pages = list.filter((t) => t.type === 'page');
const page = pages.find((t) => /app\.local|127\.0\.0\.1:8787/.test(t.url || '')) || pages[0];
if (!page) { console.error('没有 page target:', JSON.stringify(list)); process.exit(2); }
console.log('页面:', page.url, '| port', PORT);

const ws = await connect(page.webSocketDebuggerUrl);
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result);
  }
};
async function ev(expr) {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.text || '') + ' ' + ((r.result && r.result.description) || ''));
  return r.result && r.result.value;
}
async function shot(name) {
  const r = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync(OUT + '_' + name + '.png', Buffer.from(r.data, 'base64'));
  console.log('  截图 -> ' + OUT + '_' + name + '.png');
}
async function realClick(x, y) {
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function clickSelector(sel, dx) {
  const box = await ev(`(function(){var el=document.querySelector(${JSON.stringify(sel)}); if(!el) return null; var r=el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};})()`);
  if (!box) throw new Error('找不到元素 ' + sel);
  await realClick(box.x + (dx == null ? box.w / 2 : dx), box.y + box.h / 2);
}
async function waitFor(expr, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(expr)) return true;
    await sleep(300);
  }
  console.log('  等待超时: ' + label);
  return false;
}

await send(ws, 'Runtime.enable');
await send(ws, 'Page.enable');

// ---------- 1. 冷启动 ----------
const cold = await ev(`(function(){
  var ids=['player','lyricsSheet','settingsSheet','addSheet','newPlRow','plRenameRow'];
  var vis=0; for(var i=0;i<ids.length;i++){var el=document.getElementById(ids[i]); if(el && !el.hidden) vis++;}
  return {visible:vis, playerHidden: document.getElementById('player').hidden,
          hasBridge: !!(window.Bridge&&window.Bridge.state), hasLib: !!window.Library, hasLy: !!window.Lyrics,
          rows: document.querySelectorAll('#list [data-i]').length};
})()`);
check('冷启动无面板展开', cold.visible === 0, cold);
check('播放条初始隐藏', cold.playerHidden === true);
check('Library/Lyrics/Bridge 已加载', cold.hasLib && cold.hasLy && cold.hasBridge);

// ---------- 2. 搜索 ----------
await ev(`(function(){var q=document.getElementById('q'); q.value=${JSON.stringify(kw)}; return true;})()`);
await clickSelector('#btnSearch');
const got = await waitFor(`document.querySelectorAll('#list [data-i]').length>0`, 25000, '搜索结果');
const rows = await ev(`document.querySelectorAll('#list [data-i]').length`);
check('搜索出结果', got && rows > 0, { rows });
await shot('search');

const first = await ev(`(function(){var r=document.querySelector('#list [data-i="0"]'); if(!r) return null;
  var tags=r.querySelectorAll('.tag'); var a=[]; for(var i=0;i<tags.length;i++) a.push(tags[i].textContent.trim());
  return {name:r.querySelector('.name').textContent.trim(), sub:r.querySelector('.sub').textContent.trim(),
          tags:a, cover:!!(r.querySelector('.row-lead img')), h:r.getBoundingClientRect().height};})()`);
check('首行结构完整（name/sub/tag）', first && first.name && first.sub && first.tags.length > 0, first);
check('音源标签顺序 QQ 在前', first && first.tags[0] === 'QQ', first && first.tags);

// ---------- 3. 点行播放（行 0 可能是 VIP 拿不到音源，逐行试到真播出来） ----------
let play = null;
let playedIdx = -1;
for (let i = 0; i < 6; i++) {
  const rowBox = await ev(`(function(){var r=document.querySelector('#list [data-i="${i}"]'); if(!r) return null; var b=r.getBoundingClientRect(); return {x:b.x+140,y:b.y+b.height/2};})()`);
  if (!rowBox) continue;
  await realClick(rowBox.x, rowBox.y);
  await sleep(4000);
  play = await ev(`(function(){var a=window.Player&&window.Player.audio; return a?{state:window.Player.state, t:a.currentTime||0, dur:a.duration||0, src:(window.Player.source&&window.Player.source.platform)||'', title:document.getElementById('pTitle').textContent}:null;})()`);
  if (play && play.state === 'playing' && play.t > 0) { playedIdx = i; break; }
}
check('某一行真实播放成功', playedIdx >= 0, { playedIdx, play });
if (playedIdx >= 0) check('播放进度在前进', play.t > 0, { t: play.t, dur: play.dur, src: play.src });
await shot('playing');

// ---------- 4. 歌词 ----------
let ly = null;
if (play && play.state !== 'idle') {
  await clickSelector('#btnLyrics');
  await waitFor(`!document.getElementById('lyricsSheet').hidden`, 6000, '歌词面板打开');
  await sleep(3500);
  ly = await ev(`(function(){var b=document.getElementById('lyricsBody'); if(!b) return null;
    return {open:!document.getElementById('lyricsSheet').hidden, lines:b.querySelectorAll('[data-t]').length,
            highlighted:b.querySelectorAll('.cur,.on,.hl-line,.cur-line').length,
            head:(document.getElementById('lySub')||{}).textContent||''};})()`);
  check('歌词面板打开', ly && ly.open, ly);
  check('歌词有带时间轴的行', ly && ly.lines > 5, ly && { lines: ly.lines, head: ly.head });
  await shot('lyrics');
  await ev(`(function(){var el=document.querySelector('#lyricsSheet [data-close]'); if(el) el.click(); return true;})()`);
  await sleep(400);
}

// ---------- 5. 收藏 ----------
const favBefore = await ev(`window.Library.favList().length`);
await ev(`(function(){var b=document.querySelector('#list [data-i="0"] [data-act="fav"]'); if(b) b.click(); return !!b;})()`);
await sleep(900);
const favAfter = await ev(`window.Library.favList().length`);
check('点 ♥ 收藏成功', favAfter === favBefore + 1, { before: favBefore, after: favAfter });
const favView = await ev(`(function(){document.querySelector('[data-view="fav"]').click(); return true;})()`);
await sleep(600);
const favRows = await ev(`document.querySelectorAll('#favList [data-i]').length`);
check('收藏视图显示已收藏歌曲', favRows >= 1, { favRows });

// ---------- 6. 歌单 ----------
await ev(`(function(){document.querySelector('[data-view="playlists"]').click(); return true;})()`);
await sleep(400);
await clickSelector('#btnNewPl');
await sleep(300);
await ev(`(function(){var i=document.getElementById('newPlName'); i.value='验收歌单'; return true;})()`);
await clickSelector('#newPlOk');
await sleep(700);
await ev(`(function(){document.querySelector('[data-view="search"]').click(); return true;})()`);
await sleep(500);
await ev(`(function(){var b=document.querySelector('#list [data-i="0"] [data-act="add"]'); if(b) b.click(); return !!b;})()`);
await sleep(700);
const addSheet = await ev(`(function(){var s=document.getElementById('addSheet'); var first=s&&s.querySelector('[data-pl]');
  if(!first) return {open:false};
  first.click(); return {open:!s.hidden, pls:s.querySelectorAll('[data-pl]').length, checked:first.getAttribute('aria-checked')||''};})()`);
await sleep(600);
await ev(`(function(){var el=document.querySelector('#addSheet [data-close]'); if(el) el.click(); return true;})()`);
await sleep(300);
const plState = await ev(`(function(){var pls=window.Library.playlists(); return {n:pls.length, songs:pls[0]?pls[0].songs.length:0, name:pls[0]?pls[0].name:''};})()`);
check('加入歌单成功', plState.songs >= 1, plState);

// 打开歌单详情截图
await ev(`(function(){document.querySelector('[data-view="playlists"]').click(); return true;})()`);
await sleep(500);
const card = await ev(`(function(){var c=document.querySelector('#plGrid [data-pl]'); if(!c) return null; var b=c.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2};})()`);
if (card) { await realClick(card.x, card.y); await sleep(700); }
const detail = await ev(`(function(){return {open:document.getElementById('viewPlaylist').classList.contains('on'),
  name:(document.getElementById('plName')||{}).textContent, rows:document.querySelectorAll('#plSongs [data-i]').length};})()`);
check('歌单详情可打开', detail && detail.open && detail.rows >= 1, detail);
await shot('playlist');

// ---------- 7. 刷新后持久化（真 kv） ----------
await send(ws, 'Page.reload', { ignoreCache: false });
await sleep(5000);
await send(ws, 'Runtime.enable');
const persisted = await ev(`(async function(){ if(!window.Library) return null; await window.Library.ready;
  return {fav:window.Library.favList().length, pls:window.Library.playlists().length,
          plSongs:window.Library.playlists()[0]?window.Library.playlists()[0].songs.length:0,
          recent:window.Library.recent().length}; })()`);
check('刷新后收藏仍在（真 kv 持久化）', persisted && persisted.fav >= 1, persisted);
check('刷新后歌单仍在', persisted && persisted.pls >= 1 && persisted.plSongs >= 1, persisted);
if (playedIdx >= 0) check('最近播放在刷新后保留', persisted && persisted.recent >= 1, persisted);
else console.log('SKIP 最近播放（本轮没有真实播放成功的曲目）');

// ---------- 8. 设置面板 ----------
await clickSelector('#btnSettings');
await sleep(800);
const set = await ev(`(function(){var s=document.getElementById('settingsSheet'); return {open:!s.hidden, text:(document.getElementById('settingsBody')||{}).textContent.slice(0,80)};})()`);
check('设置面板可打开', set && set.open, set);
await shot('settings');

const bad = results.filter((r) => !r.ok);
console.log('\n' + (bad.length ? 'RESULT: FAIL (' + bad.length + '/' + results.length + ')' : 'RESULT: PASS (' + results.length + ')'));
if (bad.length) console.log('失败项: ' + bad.map((b) => b.name).join(' | '));
ws.close();
process.exit(bad.length ? 1 : 0);
