#!/usr/bin/env node
/* lyric_test.mjs —— 三平台歌词接口 Node 实测脚本（v1.1 歌词需求）
 *
 * 做法同 provider_test.mjs：window 沙箱 + Bridge shim（node fetch 直连，匿名无 cookie），
 * fs 读 providers/*.js + new Function 加载，逐平台「先 search 再 lyric」。
 *
 * 运行：node probe/lyric_test.mjs
 * 输出：每案例×平台 命中/行数/首末时间标签/前两行，失败原因分类；末尾 PASS/FAIL + exit code。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS = path.join(HERE, '..', 'web', 'js', 'providers');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const T = 15000;

/* 每首：显示名 / 搜索关键词 / 艺术家（用于挑最匹配的搜索结果） */
const CASES = [
  { label: '晴天 - 周杰伦', kw: '晴天 周杰伦', name: '晴天', artist: '周杰伦' },
  { label: '小星星 - 汪苏泷', kw: '小星星 汪苏泷', name: '小星星', artist: '汪苏泷' },
  { label: '起风了 - 买辣椒也用券', kw: '起风了 买辣椒也用券', name: '起风了', artist: '买辣椒也用券' }
];

/* ---------------- 1. Bridge shim（node fetch 直连，匿名） ---------------- */
const stats = { proxy: 0, fail: 0, lastErr: '' };
async function proxy(o) {
  stats.proxy++;
  const headers = Object.assign({ 'User-Agent': UA }, o.headers || {});
  if (!headers.Referer) delete headers.Referer;
  try {
    const r = await fetch(o.url, {
      method: o.method || 'GET',
      headers,
      body: typeof o.body === 'string' && o.body ? o.body : undefined,
      redirect: 'follow',
      signal: AbortSignal.timeout(T)
    });
    return { status: r.status, body: await r.text() };
  } catch (e) {
    stats.fail++;
    stats.lastErr = String((e && e.message) || e);
    return { status: 0, error: stats.lastErr };
  }
}
const bridge = {
  version: 'lyric-test-shim',
  proxy,
  proxyJson: async (o) => {
    const r = await proxy(o);
    if (r.status !== 200) throw new Error('上游 HTTP ' + r.status + (r.error ? ' ' + r.error : ''));
    if (!r.body) throw new Error('上游空响应');
    try { return JSON.parse(r.body); } catch (e) { throw new Error('上游非 JSON：' + String(r.body).slice(0, 80)); }
  },
  state: async () => ({
    platforms: { netease: { loggedIn: false }, qq: { loggedIn: false, uin: null }, kugou: { loggedIn: false } },
    version: 'lyric-test-shim'
  }),
  login: async () => ({ ok: false }),
  kvGet: async () => null,
  kvSet: async () => ({ ok: true })
};

/* ---------------- 2. 加载 providers ---------------- */
const win = { Bridge: bridge };
for (const f of ['netease.js', 'qq.js', 'kugou.js', 'index.js']) {
  new Function('window', fs.readFileSync(path.join(PROVIDERS, f), 'utf8'))(win);
}
const P = win.Providers || [];
const pfLabel = { netease: '网易云', qq: 'QQ', kugou: '酷狗' };
const pad = (s, n) => String(s).padEnd(n, ' ');

/* ---------------- 3. 匹配与校验工具 ---------------- */
function norm(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[\s\-_·、,，.。!！?？'"“”‘’()（）\[\]【】]/g, '');
}
function baseName(n) {
  return String(n == null ? '' : n).replace(/[（(\[【].*?[）)\]】]/g, '');
}
/** 在搜索结果里挑与目标歌名+歌手最匹配的一条 */
function pickSong(list, c) {
  let best = null, bestScore = 0;
  const wantName = norm(baseName(c.name));
  for (const s of list) {
    const nm = norm(baseName(s.name));
    let score = 0;
    if (nm === wantName) score += 3;
    else if (nm.indexOf(wantName) >= 0 || wantName.indexOf(nm) >= 0) score += 2;
    const artists = norm((s.artists || []).join('/'));
    if (artists.indexOf(norm(c.artist)) >= 0) score += 2;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore > 0 ? best : (list[0] || null);
}
const TS_RE = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
function lrcInfo(text) {
  const times = [];
  let m;
  TS_RE.lastIndex = 0;
  while ((m = TS_RE.exec(text))) {
    const frac = m[3] ? Number('0.' + m[3]) : 0;
    times.push(Number(m[1]) * 60 + Number(m[2]) + frac);
  }
  const lines = text.split('\n').filter((l) => /^\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(l.trim()));
  return {
    n: lines.length,
    times,
    first: lines[0] || '',
    last: lines[lines.length - 1] || '',
    firstT: times.length ? times[0] : null,
    lastT: times.length ? times[times.length - 1] : null
  };
}
function fmtT(sec) {
  if (sec == null || !isFinite(sec)) return '-';
  const m = Math.floor(sec / 60);
  const s = (sec - m * 60).toFixed(2);
  return m + ':' + (Number(s) < 10 ? '0' + s : s);
}

/* ---------------- 4. 主流程 ---------------- */
const out = [];
const say = (s) => { out.push(s); };

/* 4.0 基本契约 */
const contractOk = P.length === 3 && P.every((p) => typeof p.lyric === 'function' && typeof p.search === 'function');
say('== 环境 ==');
say('  provider: ' + P.map((p) => p.id).join(',') + ' | 全部暴露 lyric(): ' + (contractOk ? 'OK' : 'FAIL'));

const perPlatform = {};   /* id -> {hits, lines, firstCase} */
for (const p of P) perPlatform[p.id] = { hits: 0, lines: 0 };

let totalCasesOk = 0;
for (const c of CASES) {
  say('');
  say('== 案例：' + c.label + ' ==');
  for (const p of P) {
    const label = pad(pfLabel[p.id] || p.id, 6);
    let list = [];
    try { list = await p.search(c.kw, 1); } catch (e) { list = []; }
    const song = pickSong(list, c);
    if (!song) { say('  ' + label + '未搜到（0 条）'); continue; }
    let res = null;
    try { res = await p.lyric(song); } catch (e) { res = null; }
    if (!res || !res.text) {
      say('  ' + label + 'null（' + song.name.slice(0, 22) + ' 无歌词/接口空）');
      continue;
    }
    const info = lrcInfo(res.text);
    const ok = info.n >= 3 && info.firstT != null && info.lastT != null && info.lastT > info.firstT;
    if (ok) { perPlatform[p.id].hits++; perPlatform[p.id].lines += info.n; }
    say('  ' + label + (ok ? 'OK  ' : 'BAD ') + song.name.slice(0, 18).slice(0, 18) +
      ' | ' + pad(info.n + ' 行', 7) + '| 首 ' + fmtT(info.firstT) + ' 末 ' + fmtT(info.lastT) +
      ' | ' + (res.source === p.id ? 'source=' + res.source : 'source!=' + res.source));
    const lines = info.first ? [info.first, (info.last !== info.first ? info.last : '')].filter(Boolean) : [];
    for (const l of lines) say('        ' + l.trim().slice(0, 60));
    if (ok) totalCasesOk++;
  }
}

/* 4.1 防御性：坏输入不抛 */
let defendOk = true;
for (const p of P) {
  for (const bad of [null, {}, { platform: p.id, id: 'zzzz-not-exist-404' }, { platform: p.id, id: '', hash: '' }]) {
    try {
      const r = await p.lyric(bad);
      if (r !== null && r !== undefined && !(r && typeof r.text === 'string')) defendOk = false;
    } catch (e) { defendOk = false; }
  }
}

/* 4.2 酷狗搜索结果保留 hash（歌词要用） */
const kgList = await win.Provider_kugou.search('晴天', 1);
const kgHashOk = kgList.length > 0 && !!kgList[0].hash && kgList[0].hash === kgList[0].id;

/* 4.3 index.js providerLyric 便捷入口 */
let helperOk = false;
for (const c of CASES) {
  const song = pickSong(await win.Provider_qq.search(c.kw, 1), c);
  if (song) {
    const r = await win.providerLyric(song);
    if (r && typeof r.text === 'string') { helperOk = true; break; }
  }
}

/* ---------------- 5. 汇总 ---------------- */
say('');
say('== 汇总（匿名无登录态） ==');
let okPlatforms = 0;
for (const p of P) {
  const s = perPlatform[p.id];
  if (s.hits > 0) okPlatforms++;
  say('  ' + pad(pfLabel[p.id], 6) + '命中 ' + s.hits + '/' + CASES.length + ' 首 | ' +
    (s.hits ? ('平均 ' + Math.round(s.lines / s.hits) + ' 行/首') : '无带时间轴歌词'));
}
say('  命中平台数 ' + okPlatforms + '/3（验收要求 ≥2） | 代理请求 ' + stats.proxy + ' 次（失败 ' + stats.fail + '）' +
  (stats.lastErr ? ' | 最后错误：' + stats.lastErr : ''));

const checks = [
  ['三 provider 均暴露 lyric()', contractOk],
  ['≥2 个平台匿名拿到带时间轴的歌词', okPlatforms >= 2],
  ['至少 2 首案例命中歌词', totalCasesOk >= 2],
  ['坏输入/不存在 id 返回 null 不抛', defendOk],
  ['酷狗 search 结果保留 hash 字段', kgHashOk],
  ['index.js providerLyric 可用', helperOk]
];
say('');
say('== 结论 ==');
let pass = true;
for (const [name, ok] of checks) {
  if (!ok) pass = false;
  say('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name);
}
say('');
say(pass ? 'RESULT: PASS' : 'RESULT: FAIL');
console.log(out.join('\n'));
if (!pass) process.exitCode = 1;
