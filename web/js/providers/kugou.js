/* 酷狗音乐 provider —— 纯浏览器 JS（无 require / 无 import / 无三方库）
 * 搜索：songsearch.kugou.com song_search_v2（SongName 含 <em> 必须 strip）
 * 取地址：trackercdn.i/v2（key = md5(FileHash+'kgcloudv2')，浏览器无 md5 → 本文件内置纯 JS md5）
 *         失败再试 m3ws get_song_info?cmd=playInfo
 * 契约：window.Provider_kugou = {id,label,search(),resolveUrl(),status()}
 */
(function () {
  'use strict';
  var P = 'kugou';
  var REFERER = 'https://www.kugou.com/';
  var TIMEOUT = 15000;
  var API_SEARCH = 'https://songsearch.kugou.com/song_search_v2';
  var API_CDN = 'https://trackercdn.kugou.com/i/v2/';
  var API_M3WS = 'https://m3ws.kugou.com/api/v1/song/get_song_info';
  var API_LYRIC_SEARCH = 'https://krcs.kugou.com/search';
  var API_LYRIC_DL = 'https://lyrics.kugou.com/download';

  function str(v) { return v == null ? '' : String(v); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function trim(s) { return str(s).replace(/^\s+|\s+$/g, ''); }
  function sec(u) { u = str(u); return /^http:\/\//i.test(u) ? 'https://' + u.slice(7) : u; }
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

  /* ---------------- 纯 JS MD5（UTF-8，输出小写 hex） ---------------- */
  var MD5 = (function () {
    var S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
             5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
             4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
             6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    var T = (function () {
      var t = [], i;
      for (i = 0; i < 64; i++) t[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
      return t;
    })();

    function utf8(s) {
      var out = [], i, c;
      s = str(s);
      for (i = 0; i < s.length; i++) {
        c = s.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0xD800 || c >= 0xE000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else {
          i++;
          c = 0x10000 + (((c & 0x3FF) << 10) | (s.charCodeAt(i) & 0x3FF));
          out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        }
      }
      return out;
    }
    function word(b, i) { return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24); }
    function hexLE(x) {
      var s = '', i, b;
      for (i = 0; i < 4; i++) {
        b = (x >>> (i * 8)) & 0xFF;
        s += (b < 16 ? '0' : '') + b.toString(16);
      }
      return s;
    }

    return function (input) {
      var bytes = utf8(input), i, g, F, tmp;
      var bitLen = bytes.length * 8;
      bytes.push(0x80);
      while (bytes.length % 64 !== 56) bytes.push(0);
      var hi = Math.floor(bitLen / 4294967296), lo = bitLen >>> 0;
      bytes.push(lo & 0xFF, (lo >>> 8) & 0xFF, (lo >>> 16) & 0xFF, (lo >>> 24) & 0xFF);
      bytes.push(hi & 0xFF, (hi >>> 8) & 0xFF, (hi >>> 16) & 0xFF, (hi >>> 24) & 0xFF);

      var a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
      var M = new Array(16);
      for (var off = 0; off < bytes.length; off += 64) {
        for (i = 0; i < 16; i++) M[i] = word(bytes, off + i * 4);
        var A = a0, B = b0, C = c0, D = d0;
        for (i = 0; i < 64; i++) {
          if (i < 16) { F = (B & C) | (~B & D); g = i; }
          else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
          else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
          else { F = C ^ (B | ~D); g = (7 * i) & 15; }
          tmp = (A + F + T[i] + M[g]) | 0;
          A = D; D = C; C = B;
          B = (B + ((tmp << S[i]) | (tmp >>> (32 - S[i])))) | 0;
        }
        a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
      }
      return hexLE(a0) + hexLE(b0) + hexLE(c0) + hexLE(d0);
    };
  })();

  /* ---------------- 字段处理 ---------------- */
  function stripTags(s) {
    return str(s)
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  }
  function coverOf(img) {
    img = str(img).replace(/\{size\}/gi, '400');
    return sec(img);
  }
  function toSong(s) {
    if (!s || !s.FileHash) return null;
    var name = trim(stripTags(s.SongName || s.FileName));
    if (!name) return null;
    var artists = [];
    if (s.Singers && s.Singers.length != null && typeof s.Singers !== 'string') {
      /* v2 接口 Singers 是对象数组 [{name,id}] */
      for (var j = 0; j < s.Singers.length; j++) {
        var sn = trim(stripTags(s.Singers[j] && s.Singers[j].name));
        if (sn) artists.push(sn);
      }
    } else {
      var singers = trim(stripTags(s.Singers || s.SingerName || ''));
      var parts = singers ? singers.split(/[、/&,;]/) : [];
      for (var k = 0; k < parts.length; k++) {
        var n = trim(parts[k]);
        if (n) artists.push(n);
      }
    }
    var priv = num(s.Privilege);
    return {
      platform: P,
      id: String(s.FileHash),
      hash: String(s.FileHash),   /* 歌词 krcs 接口需要 */
      name: name,
      artists: artists,
      album: trim(stripTags(s.AlbumName || '')),
      durationMs: num(s.Duration) * 1000,
      coverUrl: coverOf(s.Image),
      vip: priv === 10,
      raw: s
    };
  }

  async function search(keyword, page) {
    try {
      if (!keyword) return [];
      page = Math.max(1, parseInt(page, 10) || 1);
      var url = API_SEARCH + '?keyword=' + encodeURIComponent(keyword) + '&page=' + page +
        '&pagesize=30&platform=WebFilter&tag=em&filter=2&iscorrection=1&privilege_filter=0';
      var j = await bj({ platform: P, url: url, method: 'GET', headers: { Referer: REFERER } });
      var list = (j && j.data && j.data.lists) || [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var song = toSong(list[i]);
        if (song) out.push(song);
      }
      return out;
    } catch (e) { return []; }
  }

  /* 链路1：trackercdn（需要 key） */
  async function viaCdn(hash) {
    try {
      var key = MD5(hash + 'kgcloudv2');
      var url = API_CDN + '?key=' + key + '&hash=' + encodeURIComponent(hash) +
        '&br=hq&appid=1005&pid=2&cmd=25&behavior=play';
      var j = await bj({ platform: P, url: url, method: 'GET', headers: { Referer: REFERER } });
      var u = (j && j.url && j.url[0]) || (j && j.backup_url && j.backup_url[0]) || '';
      return sec(u);
    } catch (e) { return ''; }
  }
  /* 链路2：m3ws playInfo */
  async function viaM3ws(hash) {
    try {
      var url = API_M3WS + '?cmd=playInfo&hash=' + encodeURIComponent(hash);
      var j = await bj({ platform: P, url: url, method: 'GET', headers: { Referer: 'https://m.kugou.com/' } });
      var u = (j && j.url) || (j && j.backup_url && j.backup_url[0]) || '';
      return sec(u);
    } catch (e) { return ''; }
  }

  function qualityOf(u) {
    u = str(u).toLowerCase();
    if (/\.flac/.test(u)) return 'flac';
    if (/\.mp3/.test(u)) return 'hq';
    return 'standard';
  }

  async function resolveUrl(song) {
    try {
      if (!song || !song.id) return null;
      var hash = String(song.id);
      var url = await viaCdn(hash);
      var via = 'trackercdn';
      if (!url) { url = await viaM3ws(hash); via = 'm3ws'; }
      if (url) return { url: url, quality: qualityOf(url), requiresLogin: false, via: via };
      var priv = num((song.raw || {}).Privilege);
      var vip = priv === 10;
      return {
        url: null,
        quality: '',
        requiresLogin: vip,
        reason: vip ? 'VIP/付费曲目（Privilege=10）' : '无可用音源（两条链路均空）'
      };
    } catch (e) {
      return { url: null, quality: '', requiresLogin: false, reason: '请求失败：' + ((e && e.message) || e) };
    }
  }

  /* ---------------- 歌词（两步：krcs 搜索 → lyrics 下载 base64 LRC） ---------------- */
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
  /** candidates 里挑时长最接近的一条（duration 单位毫秒） */
  function pickCandidate(j, song) {
    var list = (j && j.candidates) || [];
    var best = null, bestDiff = Infinity;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || c.id == null || !c.accesskey) continue;
      var diff = num(c.duration) > 0 ? Math.abs(num(c.duration) - num(song.durationMs)) : Infinity;
      if (diff < bestDiff) { bestDiff = diff; best = c; }
    }
    if (!best) {
      for (var k = 0; k < list.length; k++) {
        if (list[k] && list[k].id != null && list[k].accesskey) return list[k];
      }
    }
    return best;
  }

  async function lyric(song) {
    try {
      if (!song) return null;
      var hash = trim(song.hash || song.id);
      if (!hash) return null;
      var durS = Math.round(num(song.durationMs) / 1000) || num((song.raw || {}).Duration);
      var name = trim(song.name || (song.raw || {}).SongName);
      var sj = await bj({
        platform: P,
        url: API_LYRIC_SEARCH + '?ver=1&man=yes&client=mobi' +
          '&keyword=' + encodeURIComponent(name) + '&duration=' + encodeURIComponent(String(durS)) +
          '&hash=' + encodeURIComponent(hash),
        method: 'GET',
        headers: { Referer: REFERER }
      });
      var c = pickCandidate(sj, song);
      if (!c) return null;
      var dj = await bj({
        platform: P,
        url: API_LYRIC_DL + '?ver=1&client=pc&id=' + encodeURIComponent(String(c.id)) +
          '&accesskey=' + encodeURIComponent(str(c.accesskey)) + '&fmt=lrc&charset=utf8',
        method: 'GET',
        headers: { Referer: REFERER }
      });
      if (!dj || (dj.status != null && num(dj.status) !== 200) || !dj.content) return null;
      var text = normLrc(b64utf8(dj.content));
      return text ? { text: text, source: P } : null;
    } catch (e) { return null; }
  }

  async function status() {
    try {
      if (!window.Bridge || typeof window.Bridge.state !== 'function') return { loggedIn: false };
      var s = await timeout(window.Bridge.state(), TIMEOUT);
      var me = (s && s.platforms && s.platforms.kugou) || {};
      return { loggedIn: !!me.loggedIn, userId: me.userId || null };
    } catch (e) { return { loggedIn: false }; }
  }

  /* 暴露 md5 便于 probe 校验（不影响契约） */
  window.Provider_kugou = {
    id: P,
    label: '酷狗音乐',
    search: search,
    resolveUrl: resolveUrl,
    lyric: lyric,
    status: status,
    _md5: MD5
  };
})();
