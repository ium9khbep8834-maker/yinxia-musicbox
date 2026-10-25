/* QQ音乐 provider —— 纯浏览器 JS（无 require / 无 import / 无三方库）
 * 搜索：c.y.qq.com client_search_cp（匿名可用）
 * 取地址：u.y.qq.com musicu.fcg GetVkey；匿名 purl 恒为空，需原生 cookie 罐里的 uin。
 * 契约：window.Provider_qq = {id,label,search(),resolveUrl(),status()}
 */
(function () {
  'use strict';
  var P = 'qq';
  var REFERER = 'https://y.qq.com/';
  var TIMEOUT = 15000;
  var API_SEARCH = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
  var API_VKEY = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
  var API_LYRIC = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';
  var CDN_FALLBACK = 'https://dl.stream.qqmusic.qq.com/';

  function str(v) { return v == null ? '' : String(v); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function trim(s) { return str(s).replace(/^\s+|\s+$/g, ''); }
  function sec(u) { u = str(u); return /^http:\/\//i.test(u) ? 'https://' + u.slice(7) : u; }
  function decodeEntities(s) {
    return str(s)
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  }
  function timeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function bj(o) {
    if (!window.Bridge || typeof window.Bridge.proxyJson !== 'function') {
      return Promise.reject(new Error('Bridge 不可用'));
    }
    return timeout(window.Bridge.proxyJson(o), TIMEOUT);
  }

  function coverOf(mid) {
    mid = trim(mid);
    return mid ? 'https://y.gtimg.cn/music/photo_new/T002R300x300M000' + mid + '.jpg' : '';
  }

  function toSong(s) {
    if (!s || !s.songmid) return null;
    var singers = s.singer || [];
    var artists = [], i;
    for (i = 0; i < singers.length; i++) {
      var n = trim(singers[i] && singers[i].name);
      if (n) artists.push(n);
    }
    var name = trim(decodeEntities(s.songname || s.songorig));
    if (!name) return null;
    var interval = num(s.interval);
    /* 老搜索接口字段：payplay/payalbum/paydownload（不是 pay_play） */
    var pay = s.pay || {};
    return {
      platform: P,
      id: String(s.songmid),
      name: name,
      artists: artists,
      album: trim(decodeEntities(s.albumname)),
      durationMs: interval > 0 ? interval * 1000 : 0,
      coverUrl: coverOf(s.albummid),
      vip: !!(pay.payplay === 1 || pay.payalbum === 1 || pay.paydownload === 1),
      raw: s
    };
  }

  async function search(keyword, page) {
    try {
      if (!keyword) return [];
      page = Math.max(1, parseInt(page, 10) || 1);
      var url = API_SEARCH + '?p=' + page + '&n=30&w=' + encodeURIComponent(keyword) + '&format=json';
      var j = await bj({ platform: P, url: url, method: 'GET', headers: { Referer: REFERER } });
      var list = (j && j.data && j.data.song && j.data.song.list) || [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var song = toSong(list[i]);
        if (song) out.push(song);
      }
      return out;
    } catch (e) { return []; }
  }

  /* 登录态缓存：Bridge.state() 由 index.js/UI 也会调，这里 30s 内不重复问原生 */
  var stateCache = null, stateAt = 0;
  async function getState(force) {
    var now = Date.now();
    if (!force && stateCache && (now - stateAt) < 30000) return stateCache;
    try {
      if (!window.Bridge || typeof window.Bridge.state !== 'function') return null;
      var s = await timeout(window.Bridge.state(), TIMEOUT);
      stateCache = s || null;
      stateAt = now;
      return stateCache;
    } catch (e) { return null; }
  }

  function b64utf8(b64) {
    var bin = '';
    b64 = str(b64).replace(/\s+/g, '');
    if (!b64) return '';
    try { bin = atob(b64); } catch (e) { return ''; }
    try {
      if (typeof TextDecoder === 'function') {
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xFF;
        return new TextDecoder('utf-8').decode(bytes);
      }
    } catch (e2) { /* 落到下面 */ }
    var enc = '';
    for (var j = 0; j < bin.length; j++) enc += '%' + ('0' + bin.charCodeAt(j).toString(16)).slice(-2);
    try { return decodeURIComponent(enc); } catch (e3) { return bin; }
  }
  /** 至少一行 [mm:ss(.xx)] 才算带时间轴的歌词 */
  function normLrc(text) {
    text = str(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(text)) return '';
    return text.replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  }

  async function lyric(song) {
    try {
      if (!song || !song.id) return null;
      var j = await bj({
        platform: P,
        url: API_LYRIC + '?songmid=' + encodeURIComponent(String(song.id)) +
          '&format=json&nobase64=1&g_tk=5381',
        method: 'GET',
        headers: { Referer: REFERER }
      });
      if (!j || (j.retcode != null && num(j.retcode) !== 0)) return null;
      var raw = str(j.lyric);
      if (!raw) return null;
      /* nobase64=1 时是明文；若接口忽略该参数则回退 base64（base64 串里不会出现 '[' ） */
      var text = raw.indexOf('[') >= 0 ? raw : b64utf8(raw);
      text = normLrc(text);
      return text ? { text: text, source: P } : null;
    } catch (e) { return null; }
  }

  async function status() {
    var s = await getState(true);
    var q = (s && s.platforms && s.platforms.qq) || {};
    var uin = trim(q.uin || q.userId);
    return { loggedIn: !!q.loggedIn, uin: uin || null };
  }

  function randomGuid() {
    var s = '';
    for (var i = 0; i < 10; i++) s += Math.floor(Math.random() * 10);
    return s;
  }

  function qualityOf(purl) {
    purl = str(purl).toLowerCase();
    if (/\.flac(\?|$)/.test(purl)) return 'flac';
    if (/\.m4a(\?|$)/.test(purl) || /m4a/.test(purl)) return 'm4a';
    if (/\.mp3(\?|$)/.test(purl)) return '320k';
    return 'standard';
  }

  async function resolveUrl(song) {
    try {
      if (!song || !song.id) return null;
      var mid = String(song.id);
      var st = await getState(false);
      var q = (st && st.platforms && st.platforms.qq) || {};
      var uin = trim(q.uin || q.userId) || '0';
      var loggedIn = !!q.loggedIn;
      var body = JSON.stringify({
        req: {
          module: 'music.vkey.GetVkey',
          method: 'UrlGetVkey',
          param: {
            guid: randomGuid(),
            songmid: [mid],
            songtype: [0],
            uin: uin,
            loginflag: 1,
            platform: '20'
          }
        },
        comm: { uin: uin, format: 'json', ct: 24, cv: 0 }
      });
      var j = await bj({
        platform: P,
        url: API_VKEY,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Referer: REFERER },
        body: body
      });
      var data = (j && j.req && j.req.data) || {};
      var info = (data.midurlinfo && data.midurlinfo[0]) || {};
      var purl = trim(info.purl);
      if (!purl) {
        var why = loggedIn ? 'VIP/无版权或取地址失败' : 'QQ未登录（需导入 Cookie）';
        if (info.errtype) why += ' errtype=' + info.errtype;
        return { url: null, quality: '', requiresLogin: !loggedIn, reason: why };
      }
      var sip = '';
      if (data.sip && data.sip.length && data.sip[0]) sip = sec(data.sip[0]);
      if (!sip) sip = CDN_FALLBACK;
      if (!/\/$/.test(sip)) sip += '/';
      var full = /^https?:\/\//i.test(purl) ? sec(purl) : sip + purl.replace(/^\//, '');
      return { url: full, quality: qualityOf(purl), requiresLogin: false };
    } catch (e) {
      return { url: null, quality: '', requiresLogin: false, reason: '请求失败：' + ((e && e.message) || e) };
    }
  }

  window.Provider_qq = {
    id: P,
    label: 'QQ音乐',
    search: search,
    resolveUrl: resolveUrl,
    lyric: lyric,
    status: status
  };
})();
