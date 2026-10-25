// 本地开发服务器：把 web/ 跑在浏览器里，用 node fetch 实现 /api/proxy，
// 便于在没有壳的情况下验证前端逻辑（壳里由原生拦截实现同样协议）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'web');
const PORT = Number(process.env.PORT || 8787);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname === '/api/proxy' && req.method === 'POST') {
      const p = JSON.parse(await readBody(req) || '{}');
      const headers = Object.assign({ 'User-Agent': UA }, p.headers || {});
      try {
        const r = await fetch(p.url, {
          method: p.method || 'GET',
          headers,
          body: p.body ? p.body : undefined,
          redirect: 'follow',
          signal: AbortSignal.timeout(20000),
        });
        const body = await r.text();
        const outHeaders = {};
        r.headers.forEach((v, k) => { outHeaders[k] = v; });
        return json(res, 200, { status: r.status, headers: outHeaders, body });
      } catch (e) {
        return json(res, 200, { status: 0, error: String(e.message || e) });
      }
    }
    if (u.pathname === '/api/state') {
      return json(res, 200, { platforms: { netease: { loggedIn: false }, qq: { loggedIn: false }, kugou: { loggedIn: false } }, version: 'dev' });
    }
    if (u.pathname === '/api/login' || u.pathname === '/api/logout') {
      return json(res, 200, { ok: false, error: 'dev server 不支持登录' });
    }
    if (u.pathname === '/api/kv') {
      if (req.method === 'GET') return json(res, 200, { value: null });
      await readBody(req);
      return json(res, 200, { ok: true });
    }
    // 静态文件
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.join(ROOT, rel.replace(/\.\./g, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': buf.length });
      res.end(buf);
    });
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('devserver http://127.0.0.1:' + PORT + '/  (root=' + ROOT + ')');
});
