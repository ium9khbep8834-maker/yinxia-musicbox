// 用 node 走 devserver 的 /api/proxy，验证「页面 → 代理 → 上游」整条链路（不含浏览器）
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';

const window = { location: { href: BASE }, };
window.window = window;
window.Bridge = {
  proxy: async (o) => {
    const r = await fetch(BASE + '/api/proxy', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: o.platform, url: o.url, method: o.method || 'GET', headers: o.headers || {}, body: o.body || '' }),
    });
    return r.json();
  },
  proxyJson: async (o) => JSON.parse((await window.Bridge.proxy(o)).body),
  state: async () => ({ platforms: {} }),
  kvGet: async () => null, kvSet: async () => ({ ok: true }),
};

for (const f of ['netease.js', 'qq.js', 'kugou.js', 'index.js']) {
  const src = fs.readFileSync(path.join(ROOT, 'web/js/providers', f), 'utf8');
  new Function('window', src)(window);
}
console.log('providers:', (window.Providers || []).map(p => p && p.id).join(','));
for (const p of window.Providers) {
  if (!p) { console.log('skip undefined'); continue; }
  const t0 = Date.now();
  try {
    const songs = await p.search('小星星', 1);
    console.log(p.id, 'search ->', (songs || []).length, 'in', Date.now() - t0, 'ms');
    if (songs && songs[0]) {
      console.log('   sample:', songs[0].name, '-', (songs[0].artists || []).join('/'));
      try {
        const r = await p.resolveUrl(songs[0]);
        console.log('   url:', r && r.url ? r.url.slice(0, 90) : ('null (' + (r && r.reason) + ')'));
      } catch (e) { console.log('   resolve ERR', e && e.message); }
    }
  } catch (e) {
    console.log(p.id, 'search ERR', e && e.message);
  }
}
