/*
 * 原生 WebView 桥接注入脚本（由 BridgeServer 在 index.html 的 <head> 里内联注入）。
 *
 * 为什么需要它：Android WebView 的 shouldInterceptRequest 只能看到 URL 和请求头，
 * 拿不到 POST 请求体。这里把 POST /api/* 的 JSON body 转成 base64，放进自定义
 * 请求头 X-Bridge-Body，原生侧读请求头还原。完全在原生侧注入，不改动仓库里的页面源码。
 */
(function () {
  'use strict';
  if (window.__mbBridgeShimInstalled) return;
  window.__mbBridgeShimInstalled = true;

  var API_PREFIX = 'https://app.local/api/';

  function isApi(url) {
    return typeof url === 'string' && url.indexOf(API_PREFIX) === 0;
  }

  function base64Utf8(text) {
    var s = String(text == null ? '' : text);
    try {
      var bytes = new TextEncoder().encode(s);
      var bin = '';
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    } catch (e) {
      try {
        return btoa(unescape(encodeURIComponent(s)));
      } catch (e2) {
        return '';
      }
    }
  }

  function withBodyHeader(url, method, init) {
    if (!isApi(url)) return init;
    var m = String(method || 'GET').toUpperCase();
    if (m === 'GET' || m === 'HEAD') return init;
    var body = init && init.body != null ? init.body : '';
    if (typeof body !== 'string') body = String(body);
    var next = {};
    if (init) {
      for (var k in init) {
        if (Object.prototype.hasOwnProperty.call(init, k)) next[k] = init[k];
      }
    }
    var headers;
    try {
      headers = new Headers((init && init.headers) || {});
      headers.set('X-Bridge-Body', base64Utf8(body));
    } catch (e) {
      headers = (init && init.headers) || {};
      if (headers && typeof headers === 'object' && !(headers instanceof Array)) {
        headers['X-Bridge-Body'] = base64Utf8(body);
      }
    }
    next.headers = headers;
    return next;
  }

  // ---- fetch 包装（web/js/bridge.js 走这条路径）
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url);
        var method = (init && init.method) || (input && input.method) || 'GET';
        var next = withBodyHeader(url, method, init);
        if (next !== init) return origFetch.call(this, input, next);
      } catch (e) {
        // 落到原始 fetch
      }
      return origFetch.apply(this, arguments);
    };
  }

  // ---- XHR 兜底（当前页面不用，防止后续 provider 改动后失效）
  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    var origOpen = XHR.prototype.open;
    var origSend = XHR.prototype.send;
    if (typeof origOpen === 'function' && typeof origSend === 'function') {
      XHR.prototype.open = function (method, url) {
        try {
          this.__mbMethod = method;
          this.__mbUrl = url;
        } catch (e) {
        }
        return origOpen.apply(this, arguments);
      };
      XHR.prototype.send = function (body) {
        try {
          if (isApi(String(this.__mbUrl)) && String(this.__mbMethod || 'GET').toUpperCase() !== 'GET') {
            this.setRequestHeader('X-Bridge-Body', base64Utf8(body == null ? '' : body));
          }
        } catch (e) {
        }
        return origSend.apply(this, arguments);
      };
    }
  }
})();
