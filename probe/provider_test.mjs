#!/usr/bin/env node
/* provider_test.mjs —— 三平台 provider 的 Node 实测脚本
 *
 * 做法：构造 globalThis 的 window 沙箱 + Bridge shim（node 内置 fetch 直连，带 Referer/UA，
 * 不带任何平台 cookie，等价于「匿名/未登录」状态），再用 fs 读源码 + new Function 加载
 * web/js/providers/{netease,qq,kugou,index}.js，跑真实网络请求。
 *
 * 运行：node probe/provider_test.mjs [关键词1] [关键词2]
 * 输出：每平台搜索数、取地址可播数、HEAD 校验、失败原因分类，末尾 PASS/FAIL。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS = path.join(HERE, '..', 'web', 'js', 'providers');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 15000;
const KW1 = process.argv[2] || '小星星';
const KW2 = process.argv[3] || '周杰伦';

/* ---------------- 1. Bridge shim（node fetch 直连） ---------------- */
const stats = { proxy: 0, fail: 0, platform: {} };

async function proxy(o) {
  stats.proxy++;
  const pf = o.platform || '-';
  stats.platform[pf] = (stats.platform[pf] || 0) + 1;
  if (String(o.url).indexOf('musicu.fcg') >= 0 && o.body) {
    try {
      const u = JSON.parse(o.body).req.param.uin;
      if (stats.firstVkeyUin === undefined) stats.firstVkeyUin = u;
      stats.lastVkeyUin = u;
    } catch (e) { /* ignore */ }
  }
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
    const body = await r.text();
    const hs = {};
    for (const [k, v] of r.headers) hs[k.toLowerCase()] = v;
    return { status: r.status, headers: hs, body };
  } catch (e) {
    stats.fail++;
    return { status: 0, error: String((e && e.message) || e) };
  }
}

const bridge = {
  version: 'test-shim',
  proxy,
  proxyJson: async (o) => {
    const r = await proxy(o);
    if (r.status !== 200) throw new Error('上游 HTTP ' + r.status + (r.error ? ' ' + r.error : ''));
    if (!r.body) throw new Error('上游空响应');
    try { return JSON.parse(r.body); } catch (e) { throw new Error('上游非 JSON：' + String(r.body).slice(0, 100)); }
  },
  /* 未登录状态：无 uin/userId（原生未导入 cookie 时的真实形态） */
  state: async () => ({
    platforms: {
      netease: { loggedIn: false },
      qq: { loggedIn: false, uin: null },
      kugou: { loggedIn: false }
    },
    version: 'test-shim'
  }),
  login: async () => ({ ok: false }),
  kvGet: async () => null,
  kvSet: async () => ({ ok: true })
};

/* ---------------- 2. 加载 provider 源码到沙箱 ---------------- */
function makeProxyJson(px) {
  return async (o) => {
    const r = await px(o);
    if (r.status !== 200) throw new Error('上游 HTTP ' + r.status + (r.error ? ' ' + r.error : ''));
    if (!r.body) throw new Error('上游空响应');
    try { return JSON.parse(r.body); } catch (e) { throw new Error('上游非 JSON：' + String(r.body).slice(0, 100)); }
  };
}

const win = { Bridge: bridge };
function loadInto(target, f) {
  const code = fs.readFileSync(path.join(PROVIDERS, f), 'utf8');
  // new Function 里 window 为形参，provider 仍是纯浏览器代码（不会拿到 node 全局）
  new Function('window', code)(target);
}
function load(f) { loadInto(win, f); }
for (const f of ['netease.js', 'qq.js', 'kugou.js', 'index.js']) load(f);

const P = [win.Provider_qq, win.Provider_kugou, win.Provider_netease];
const pfLabel = { netease: '网易云', qq: 'QQ', kugou: '酷狗' };
const pad = (s, n) => String(s).padEnd(n, ' ');

/* ---------------- 3. md5 自校验（酷狗 key 依赖） ---------------- */
function md5Check() {
  const f = win.Provider_kugou && win.Provider_kugou._md5;
  if (typeof f !== 'function') return { ok: false, why: 'provider 未暴露 _md5' };
  const cases = ['abc', 'kgcloudv2', 'B9B3A55FFB5B95F165839A26120E9FECkgcloudv2', '小星星', 'abc'.repeat(30)];
  let ok = 0;
  for (const c of cases) {
    const want = crypto.createHash('md5').update(c, 'utf8').digest('hex');
    if (f(c) === want) ok++;
    else return { ok: false, why: 'mismatch for ' + JSON.stringify(c.slice(0, 20)) };
  }
  return { ok: ok === cases.length, okCount: ok, total: cases.length };
}

/* ---------------- 4. HEAD 校验 ---------------- */
async function headCheck(u) {
  try {
    const r = await fetch(u, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(T) });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const good = r.status === 200 && ct.startsWith('audio/');
    return { ok: good, info: r.status + ' ' + (ct || 'no-ct') };
  } catch (e) {
    return { ok: false, info: 'HEAD失败 ' + String((e && e.message) || e).slice(0, 60) };
  }
}

/* ---------------- 5. 搜索 ---------------- */
async function searchAll(kw) {
  const out = {};
  for (const p of P) {
    const t0 = Date.now();
    let list = [];
    try { list = await p.search(kw, 1); } catch (e) { list = []; }
    out[p.id] = { list, ms: Date.now() - t0 };
  }
  return out;
}

/* ---------------- 6. 取地址 ---------------- */
function reasonBucket(r) {
  if (!r) return 'null';
  if (r.url) return 'OK';
  const s = String(r.reason || '无原因');
  if (/VIP|付费/.test(s)) return 'VIP/付费';
  if (/未登录|需登录|登录/.test(s)) return '需登录';
  if (/无版权/.test(s)) return '无版权';
  if (/无可用音源/.test(s)) return '无可用音源';
  if (/请求失败/.test(s)) return '请求失败';
  return s.slice(0, 16);
}

async function resolveGroup(songs, n) {
  const cand = songs.slice(0, n);
  const res = [];
  for (const s of cand) {
    let r = null;
    try { r = await P.find((p) => p.id === s.platform).resolveUrl(s); } catch (e) { r = { url: null, reason: '抛错:' + e.message }; }
    let head = null;
    if (r && r.url) head = await headCheck(r.url);
    res.push({ song: s, r, head });
  }
  const got = res.filter((x) => x.r && x.r.url);
  const headOk = got.filter((x) => x.head && x.head.ok);
  const reasons = {};
  for (const x of res) {
    if (x.r && x.r.url) continue;
    const b = reasonBucket(x.r);
    reasons[b] = (reasons[b] || 0) + 1;
  }
  return { cand: cand.length, got: got.length, headOk: headOk.length, reasons, res };
}

/* ---------------- 7. 主流程 ---------------- */
const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };

(async () => {
  say('== 环境 ==');
  const m = md5Check();
  say('  node ' + process.version + ' | provider 加载: ' + P.filter(Boolean).map((p) => p.id).join(',') +
    ' | index.js: Providers=' + (win.Providers || []).length + ' providerById=\'' + (typeof win.providerById) + '\'');
  say('  md5(纯JS) vs node:crypto: ' + (m.ok ? 'OK ' + m.okCount + '/' + m.total + ' (含中文/长串)' : 'FAIL ' + m.why));
  if (!m.ok) process.exitCode = 1;

  say('');
  say('== 搜索（匿名，无平台 cookie） ==');
  const s1 = await searchAll(KW1);
  const s2 = await searchAll(KW2);
  const searchOk = {};
  for (const p of P) {
    const a = s1[p.id] || { list: [], ms: 0 };
    const b = s2[p.id] || { list: [], ms: 0 };
    searchOk[p.id] = a.list.length;
    const sample = a.list.slice(0, 3).map((x) => x.name + ' - ' + (x.artists.join('/') || '?')).join(' | ');
    say('  ' + pad(pfLabel[p.id], 6) + ' 「' + KW1 + '」' + pad(a.list.length + '条', 6) + '「' + KW2 + '」' + pad(b.list.length + '条', 6) +
      '  ' + a.ms + '/' + b.ms + 'ms');
    say('         样例: ' + (sample.length > 110 ? sample.slice(0, 110) + '…' : sample));
  }

  /* 取地址：每平台「前5条」+「前5条非VIP」（曲库前排常被 VIP 占满，需单列） */
  say('');
  say('== 取地址 + HEAD（关键词「' + KW1 + '」） ==');
  say('  ' + pad('平台', 6) + pad('前5可播', 10) + pad('HEAD ok', 9) + pad('非VIP前5可播', 14) + pad('HEAD ok', 9) + '失败原因');
  const resolveStat = {};
  for (const p of P) {
    const all = (s1[p.id] || {}).list || [];
    const free = all.filter((x) => !x.vip);
    const g1 = await resolveGroup(all, 5);
    const g2 = await resolveGroup(free, 5);
    resolveStat[p.id] = { g1, g2 };
    const rs = Object.assign({}, g1.reasons);
    for (const k of Object.keys(g2.reasons)) rs[k] = (rs[k] || 0) + g2.reasons[k];
    const reasonStr = Object.keys(rs).length ? Object.keys(rs).map((k) => k + '×' + rs[k]).join(' ') : '-';
    say('  ' + pad(pfLabel[p.id], 6) + pad(g1.got + '/' + g1.cand, 10) + pad(g1.headOk + '/' + g1.cand, 9) +
      pad(g2.got + '/' + g2.cand, 14) + pad(g2.headOk + '/' + g2.cand, 9) + reasonStr);
  }

  /* 样例：每个平台一条成功 URL（截断） */
  say('');
  say('== 可播样例（截断） ==');
  let playableTotal = 0;
  for (const p of P) {
    const st = resolveStat[p.id];
    const hit = (st.g1.res.concat(st.g2.res)).find((x) => x.r && x.r.url);
    if (hit) {
      playableTotal++;
      say('  ' + pad(pfLabel[p.id], 6) + (hit.r.quality || '?') + ' ' + String(hit.r.url).slice(0, 72) +
        ' | ' + (hit.head ? hit.head.info : 'no-head'));
    } else {
      const f = (st.g1.res.concat(st.g2.res))[0];
      say('  ' + pad(pfLabel[p.id], 6) + '无可播 → ' + (f && f.r ? (f.r.reason || 'url 为空') : '无结果'));
    }
  }

  /* 周杰伦：只看首3条失败原因（验证 VIP/未登录分类） */
  say('');
  say('== 取地址分类（关键词「' + KW2 + '」，每平台首3条） ==');
  for (const p of P) {
    const all = (s2[p.id] || {}).list || [];
    const g = await resolveGroup(all, 3);
    const reasons = Object.keys(g.reasons).map((k) => k + '×' + g.reasons[k]).join(' ') || '-';
    say('  ' + pad(pfLabel[p.id], 6) + g.got + '/' + g.cand + ' 可播 | ' + reasons);
  }

  /* QQ 登录态分支：用假 uin 只验证「uin 进请求体 + 分支不再报未登录」，
   * 真实可播仍取决于原生 cookie 罐，不代表权限。 */
  say('');
  say('== QQ 登录态分支（假 uin=10001，仅验证请求构造与分支，不代表真实权限） ==');
  let qqLoginOk = false, qqLoginDesc = '未执行';
  try {
    const seen = { uin: null, purl: false };
    const b2 = Object.assign({}, bridge);
    b2.state = async () => ({ platforms: { qq: { loggedIn: true, uin: '10001' }, netease: { loggedIn: false }, kugou: { loggedIn: false } } });
    b2.proxy = async (o) => {
      if (String(o.url).indexOf('musicu.fcg') >= 0 && o.body) {
        try { seen.uin = JSON.parse(o.body).req.param.uin; } catch (e) { /* ignore */ }
      }
      return proxy(o);
    };
    b2.proxyJson = makeProxyJson(b2.proxy);
    const win2 = { Bridge: b2 };
    loadInto(win2, 'qq.js');
    const list = await win2.Provider_qq.search(KW1, 1);
    const r = await win2.Provider_qq.resolveUrl(list[0]);
    const branchOk = !!r && (!!r.url || (r.requiresLogin === false && /VIP|版权/.test(String(r.reason || ''))));
    qqLoginOk = seen.uin === '10001' && branchOk;
    qqLoginDesc = '请求体 uin=' + seen.uin + ' | ' + (r && r.url ? 'purl 非空→可播' : ('purl 空→' + (r && r.reason)));
    say('  ' + (qqLoginOk ? 'PASS' : 'FAIL') + '  ' + qqLoginDesc);
  } catch (e) {
    say('  FAIL  ' + String((e && e.message) || e));
  }

  /* ---------------- 8. 结论 ---------------- */
  say('');
  say('== 结论 ==');
  const qqResolve = resolveStat.qq.g1.res[0];
  const qqAnonMarked = !!qqResolve && !!qqResolve.r && qqResolve.r.url === null &&
    qqResolve.r.requiresLogin === true && /未登录|登录/.test(String(qqResolve.r.reason || ''));
  const checks = [
    ['QQ 搜索有结果', searchOk.qq > 0],
    ['QQ 匿名不可播原因标注为需登录', qqAnonMarked],
    ['QQ 匿名 GetVkey uin=0（未硬编码假账号）', String(stats.firstVkeyUin) === '0'],
    ['QQ 登录态 uin 进入请求体、分支正确', qqLoginOk],
    ['网易云 ≥1 首可播', resolveStat.netease.g1.got + resolveStat.netease.g2.got > 0],
    ['网易云 ≥1 首 HEAD 200 audio/*', resolveStat.netease.g1.headOk + resolveStat.netease.g2.headOk > 0],
    ['酷狗 ≥1 首可播', resolveStat.kugou.g1.got + resolveStat.kugou.g2.got > 0],
    ['酷狗 ≥1 首 HEAD 200 audio/*', resolveStat.kugou.g1.headOk + resolveStat.kugou.g2.headOk > 0],
    ['md5 纯 JS 实现正确', m.ok],
    ['index.js 暴露 Providers/providerById', (win.Providers || []).length === 3 && typeof win.providerById === 'function']
  ];
  let pass = true;
  for (const [name, ok] of checks) {
    if (!ok) pass = false;
    say('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name);
  }
  say('  代理请求 ' + stats.proxy + ' 次（失败 ' + stats.fail + '）| 按平台 ' +
    Object.keys(stats.platform).map((k) => k + '=' + stats.platform[k]).join(' ') + ' | 可播平台数 ' + playableTotal + '/3');
  say('');
  say(pass ? 'RESULT: PASS' : 'RESULT: FAIL');
  if (!pass) process.exitCode = 1;
})().catch((e) => {
  console.error('脚本异常：', e && e.stack || e);
  process.exitCode = 1;
});
