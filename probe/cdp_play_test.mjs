// 通过 CDP 驱动无头 Edge 做端到端播放验证：搜索 → 点击第一行 → 看是否真的出声/进度前进
// 用法：node probe/cdp_play_test.mjs "小星星"   前提：Edge 以 --remote-debugging-port=9333 启动，页面已打开
const PORT = process.env.CDP_PORT || 9333;
const kw = process.argv[2] || '小星星';

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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 20000);
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const list = await targets();
const pages = list.filter(t => t.type === 'page');
const page = pages.find(t => /127\.0\.0\.1:8787|app\.local/.test(t.url || '')) || pages[0];
if (!page) { console.error('没有 page target:', JSON.stringify(list)); process.exit(1); }
console.log('连接页面:', page.url);
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
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.text || '') + ' ' + (r.result && r.result.description || ''));
  return r.result && r.result.value;
}

await send(ws, 'Runtime.enable');
await send(ws, 'Page.enable');

// 1) 触发搜索（页面若已带 ?q= 会自动搜，这里再显式搜一次确保最新代码）
console.log('关键词:', kw);
await ev(`(function(){ var q=document.getElementById('q'); q.value=${JSON.stringify(kw)}; document.getElementById('btnSearch').click(); return true; })()`);

// 2) 等结果
let rows = 0;
for (let i = 0; i < 60; i++) {
  await sleep(500);
  rows = await ev(`document.querySelectorAll('#list [data-i]').length`);
  if (rows > 0) break;
}
console.log('结果行数:', rows);
if (!rows) { console.log('FAIL 没有结果'); process.exit(2); }

const first = await ev(`(function(){ var r=document.querySelector('#list [data-i]');
  return { name: r.querySelector('.name') ? r.querySelector('.name').textContent : r.textContent.slice(0,40),
           sub: r.querySelector('.sub') ? r.querySelector('.sub').textContent : '' }; })()`);
console.log('第一行:', JSON.stringify(first));

// 3) 检查合并结果的音源顺序
const order = await ev(`(function(){ var list = document.querySelectorAll('#list [data-i]');
  var out=[]; for (var i=0;i<Math.min(5,list.length);i++){ var b=list[i].querySelectorAll('.tag'); var a=[]; for (var j=0;j<b.length;j++) a.push(b[j].textContent); out.push(a.join('>')); } return out; })()`);
console.log('前 5 行音源顺序:', JSON.stringify(order));

// 用真实鼠标事件点击第 idx 行（比 element.click() 更接近用户，能触发 user gesture）
async function trustedClickRow(idx) {
  const box = await ev(`(function(){ var rows=document.querySelectorAll('#list [data-i]'); var r=rows[${idx}];
    if (!r) return null; r.scrollIntoView({block:'center'});
    var b=r.getBoundingClientRect(); return {x:b.left+b.width/2, y:b.top+b.height/2}; })()`);
  if (!box) return false;
  await sleep(150);
  const x = Math.round(box.x), y = Math.round(box.y);
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  return true;
}

// 4) 逐行尝试播放，直到某行真的出声（验证音源回退链）
const tried = [];
let playing = null;
for (let r = 0; r < 12; r++) {
  const row = await ev(`(function(){ var rows=document.querySelectorAll('#list [data-i]');
    if (!rows[${r}]) return null;
    var t=rows[${r}].querySelector('.name'); var tags=rows[${r}].querySelectorAll('.tag'); var a=[];
    for (var j=0;j<tags.length;j++) a.push(tags[j].textContent);
    return { name: t?t.textContent:'', tags:a }; })()`);
  if (!row) break;
  await trustedClickRow(r);
  let st = null;
  for (let k = 0; k < 30; k++) {
    await sleep(400);
    st = await ev(`(function(){ var p=window.Player; return { state:p.state, src:p.source?p.source.platform:null,
       t:p.audio.currentTime||0, dur:p.audio.duration||0,
       srcHost: p.audio.src? String(p.audio.src).replace(/^https?:\\/\\//,'').split('/')[0] : '' }; })()`);
    if (st && (st.state === 'playing' || st.state === 'error' || st.state === 'paused')) break;
  }
  tried.push({ row: r + 1, name: row.name, tags: row.tags, state: st && st.state, src: st && st.src, host: st && st.srcHost });
  if (st && st.state === 'playing') { playing = st; break; }
}
console.log('逐行尝试:', JSON.stringify(tried, null, 1));

// 5) 再等 3 秒，看进度是否前进（真出声）
await sleep(3000);
const st2 = await ev(`(function(){ var p=window.Player; return { state:p.state, src:p.source?p.source.platform:null,
  t:p.audio.currentTime||0, dur:p.audio.duration||0, paused:p.audio.paused,
  title: p.item?p.item.name:'', host: p.audio.src? String(p.audio.src).replace(/^https?:\\/\\//,'').split('/')[0] : '' }; })()`);
console.log('3 秒后:', JSON.stringify(st2));

const ok = st2 && st2.t > 0.5 && !st2.paused;
console.log(ok ? 'PASS 音频真的在播放（currentTime 前进）' : 'FAIL 音频未推进');
if (st2 && st2.dur) console.log('时长(秒):', st2.dur.toFixed(1));

// 6) 截图（播放器可见）
const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
const fs = await import('node:fs');
fs.writeFileSync('probe/shot_playing.png', Buffer.from(shot.data, 'base64'));
console.log('截图已保存 probe/shot_playing.png');
ws.close();
process.exit(ok ? 0 : 3);
