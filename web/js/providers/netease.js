/* 网易云音乐 provider —— 纯浏览器 JS（无 require / 无 import / 无三方库）
 * 端点与字段见 DESIGN.md 第 1 节；请求一律经 window.Bridge.proxyJson（原生注入 cookie）。
 * 契约：window.Provider_netease = {id,label,search(),resolveUrl(),lyric(),status()}
 */
(function () {
  'use strict';
  var P = 'netease';
  var REFERER = 'https://music.163.com/';
  var TIMEOUT = 15000;
  var API_SEARCH = 'https://music.163.com/api/cloudsearch/pc';
  var API_URL = 'https://music.163.com/api/song/enhance/player/url';
  var API_LYRIC = 'https://music.163.com/api/song/lyric';

  function str(v) { return v == null ? '' : String(v); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function trim(s) { return str(s).replace(/^\s+|\s+$/g, ''); }
  /** https 升级：页面在 https://app.local，http 音频/封面会被 Chromium 当 mixed content 拦掉 */
  function sec(u) { u = str(u); return /^http:\/\//i.test(u) ? 'https://' + u.slice(7) : u; }

  /** 给 Bridge 调用套 15s 超时（bridge 自身没有 abort） */
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
  function brName(br) {
    br = num(br);
    if (br >= 999000) return 'flac';
    if (br >= 320000) return '320k';
    return '128k';
  }

  function toSong(s) {
    if (!s || s.id == null) return null;
    var ar = s.ar || s.artists || [];
    var artists = [], i;
    for (i = 0; i < ar.length; i++) {
      var n = trim(ar[i] && ar[i].name);
      if (n) artists.push(n);
    }
    var al = s.al || s.album || {};
    var fee = num(s.fee);
    var name = trim(s.name);
    if (!name) return null;
    return {
      platform: P,
      id: String(s.id),
      name: name,
      artists: artists,
      album: trim(al.name),
      durationMs: num(s.dt) || num(s.duration),
      coverUrl: sec(al.picUrl || al.picUrl_str || ''),
      vip: fee === 1 || fee === 4,
      raw: s
    };
  }

  async function search(keyword, page) {
    try {
      if (!keyword) return [];
      page = Math.max(1, parseInt(page, 10) || 1);
      var url = API_SEARCH + '?s=' + encodeURIComponent(keyword) +
        '&type=1&limit=30&offset=' + ((page - 1) * 30);
      var j = await bj({ platform: P, url: url, method: 'GET', headers: { Referer: REFERER } });
      var list = (j && j.result && j.result.songs) || [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var song = toSong(list[i]);
        if (song) out.push(song);
      }
      return out;
    } catch (e) { return []; }
  }

  function failReason(song, d) {
    var raw = song.raw || {};
    var fee = num(raw.fee);
    var pl = num(raw.privilege && raw.privilege.pl);
    if (fee === 1 || fee === 4) return 'VIP/付费曲目（需会员或登录）';
    if (pl === 0) return '无版权/需登录';
    if (d && num(d.code) === -110) return '接口返回 -110（需登录或版权限制）';
    var st = raw.privilege && raw.privilege.st;
    if (st != null && num(st) < 0) return '版权限制（st<0）';
    return '需登录或版权限制';
  }
  function needLogin(song) {
    var raw = song.raw || {};
    var fee = num(raw.fee);
    var pl = num(raw.privilege && raw.privilege.pl);
    return fee === 1 || fee === 4 || pl === 0;
  }

  async function resolveUrl(song) {
    try {
      if (!song || song.id == null) return null;
      var j = await bj({
        platform: P,
        url: API_URL + '?ids=' + encodeURIComponent('[' + String(song.id) + ']') + '&br=128000',
        method: 'GET',
        headers: { Referer: REFERER }
      });
      var d = (j && j.data && j.data[0]) || null;
      if (d && d.url) {
        return { url: sec(d.url), quality: brName(d.br), requiresLogin: false };
      }
      return {
        url: null,
        quality: '',
        requiresLogin: needLogin(song),
        reason: failReason(song, d)
      };
    } catch (e) {
      return { url: null, quality: '', requiresLogin: false, reason: '请求失败：' + ((e && e.message) || e) };
    }
  }

  /** 至少一行 [mm:ss(.xx)] 才算带时间轴的歌词 */
  function normLrc(text) {
    text = str(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(text)) return '';
    return text.replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  }

  async function lyric(song) {
    try {
      if (!song || song.id == null) return null;
      var j = await bj({
        platform: P,
        url: API_LYRIC + '?id=' + encodeURIComponent(String(song.id)) + '&lv=-1&kv=-1&tv=-1',
        method: 'GET',
        headers: { Referer: REFERER }
      });
      var text = normLrc(j && j.lrc && j.lrc.lyric);
      return text ? { text: text, source: P } : null;
    } catch (e) { return null; }
  }

  async function status() {
    try {
      if (!window.Bridge || typeof window.Bridge.state !== 'function') return { loggedIn: false };
      var s = await timeout(window.Bridge.state(), TIMEOUT);
      var me = (s && s.platforms && s.platforms.netease) || {};
      return { loggedIn: !!me.loggedIn, userId: me.userId || null };
    } catch (e) { return { loggedIn: false }; }
  }

  window.Provider_netease = {
    id: P,
    label: '网易云音乐',
    search: search,
    resolveUrl: resolveUrl,
    lyric: lyric,
    status: status
  };
})();
