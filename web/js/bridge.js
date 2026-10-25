/* 桥接协议客户端 —— 两端共用，协议见 DESIGN.md 第 3 节 */
(function () {
  'use strict';
  // 壳里页面跑在虚拟域名 https://app.local 上，原生层拦截该域名的 /api/*；
  // 在浏览器里直接调试（devserver）时退回同源相对路径，行为一致。
  var VIRTUAL = (typeof location !== 'undefined' && location.hostname === 'app.local')
    ? 'https://app.local' : '';

  function enc(s) { return encodeURIComponent(s); }

  async function postJson(path, payload) {
    var r = await fetch(VIRTUAL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      cache: 'no-store'
    });
    var txt = await r.text();
    if (!r.ok) throw new Error('bridge ' + path + ' -> HTTP ' + r.status + ' ' + txt.slice(0, 120));
    try { return JSON.parse(txt); }
    catch (e) { throw new Error('bridge ' + path + ' bad json: ' + txt.slice(0, 120)); }
  }

  var Bridge = {
    version: '1.0.0',

    /** 原始代理：{platform,url,method,headers,body} -> {status,headers,body} */
    proxy: async function (o) {
      var r = await postJson('/api/proxy', {
        platform: o.platform || '',
        url: o.url,
        method: o.method || 'GET',
        headers: o.headers || {},
        body: typeof o.body === 'string' ? o.body : (o.body == null ? '' : JSON.stringify(o.body))
      });
      if (!r || typeof r.status !== 'number') throw new Error('proxy 响应异常');
      return r;
    },

    /** 代理并解析 JSON（仅 200 且 body 可解析时返回） */
    proxyJson: async function (o) {
      var r = await Bridge.proxy(o);
      if (r.status !== 200) throw new Error('上游 HTTP ' + r.status + (r.error ? (' ' + r.error) : ''));
      if (!r.body) throw new Error('上游空响应');
      try { return JSON.parse(r.body); }
      catch (e) { throw new Error('上游非 JSON：' + String(r.body).slice(0, 100)); }
    },

    login: function (platform) { return postJson('/api/login', { platform: platform }); },
    logout: function (platform) { return postJson('/api/logout', { platform: platform }); },
    state: function () { return postJson('/api/state', {}); },
    /** 手动导入 cookie 串（QQ 兜底通道） */
    importCookie: function (platform, cookie) { return postJson('/api/cookie', { platform: platform, cookie: cookie }); },

    kvGet: async function (key) {
      var r = await fetch(VIRTUAL + '/api/kv?key=' + enc(key), { cache: 'no-store' });
      if (!r.ok) return null;
      try { var j = await r.json(); return j && j.value != null ? j.value : null; } catch (e) { return null; }
    },
    kvSet: function (key, value) { return postJson('/api/kv', { key: key, value: String(value) }); }
  };

  window.Bridge = Bridge;
})();
