/* 歌词：LRC 解析 + 按平台回退抓取 + 当前行定位
 *
 * 用法：
 *   Lyrics.parse(lrcText) -> [{t: 秒, text: '歌词行'}, ...]   // 已按时间排序、按 offset 修正
 *   await Lyrics.fetch(playable) -> {lines:[...], source:'qq', plain:false} | null
 *   Lyrics.indexAt(lines, seconds) -> 当前行下标（-1 表示还没到第一行）
 *   Lyrics.clearCache()
 *
 * 抓取策略：先问「实际用于播放的音源平台」（Player.source），没有再按
 * playable.sources 顺序（QQ > 酷狗 > 网易云）逐个试。
 */
(function () {
  'use strict';

  var cache = {};       // key -> {lines, source} | null（null 表示确认无歌词，避免反复请求）
  var inflight = {};    // key -> Promise

  var TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

  /** LRC 文本 → 行数组。支持一行多个时间标签、[offset:xx]、去掉元信息标签。 */
  function parse(text) {
    if (!text) return [];
    var raw = String(text).replace(/\r\n?/g, '\n');
    var offset = 0;
    var om = raw.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
    if (om) offset = parseInt(om[1], 10) || 0;

    var out = [];
    var lines = raw.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var times = [];
      var m;
      TIME_RE.lastIndex = 0;
      while ((m = TIME_RE.exec(line)) !== null) {
        var min = parseInt(m[1], 10);
        var sec = parseInt(m[2], 10);
        var frac = m[3] || '0';
        // [00:12.34] / [00:12.345] / [00:12:34]
        var ms = frac.length === 1 ? parseInt(frac, 10) * 100
          : frac.length === 2 ? parseInt(frac, 10) * 10
            : parseInt(frac.slice(0, 3), 10);
        times.push(min * 60 + sec + ms / 1000);
      }
      if (!times.length) continue;
      var body = line.replace(TIME_RE, '').replace(/^\s+|\s+$/g, '');
      for (var t = 0; t < times.length; t++) {
        out.push({ t: Math.max(0, times[t] - offset / 1000), text: body });
      }
    }
    out.sort(function (a, b) { return a.t - b.t; });

    // 去掉完全重复（同时间同文本）
    var dedup = [];
    for (var k = 0; k < out.length; k++) {
      var p = dedup[dedup.length - 1];
      if (p && Math.abs(p.t - out[k].t) < 0.02 && p.text === out[k].text) continue;
      dedup.push(out[k]);
    }
    return dedup;
  }

  function indexAt(lines, sec) {
    if (!lines || !lines.length) return -1;
    var lo = 0, hi = lines.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (lines[mid].t <= sec + 0.15) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  function providerOf(id) {
    if (typeof window.providerById === 'function') return window.providerById(id);
    var list = window.Providers || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  async function fetchOne(song) {
    var p = providerOf(song.platform);
    if (!p || typeof p.lyric !== 'function') return null;
    try {
      var r = await p.lyric(song);
      if (!r) return null;
      var text = typeof r === 'string' ? r : (r && r.text);
      var lines = parse(text);
      if (!lines.length) return null;
      return { lines: lines, source: song.platform, plain: false };
    } catch (e) {
      return null;
    }
  }

  var Lyrics = {
    parse: parse,
    indexAt: indexAt,

    /** 已缓存的歌词（不触发请求），用于切歌时立即显示 */
    peek: function (item) {
      if (!item) return null;
      var c = cache[item.key];
      return c === undefined ? undefined : c;
    },

    fetch: function (item) {
      if (!item || !item.key) return Promise.resolve(null);
      var key = item.key;
      if (cache[key] !== undefined) return Promise.resolve(cache[key]);
      if (inflight[key]) return inflight[key];

      var trying = [];
      // 优先当前播放音源，其次按 sources 的既有优先级
      if (window.Player && window.Player.source) trying.push(window.Player.source);
      var sources = item.sources || [];
      for (var i = 0; i < sources.length; i++) {
        var dup = false;
        for (var j = 0; j < trying.length; j++) if (trying[j].platform === sources[i].platform) { dup = true; break; }
        if (!dup) trying.push(sources[i]);
      }
      if (!trying.length && item.primary) trying.push(item.primary);

      var p = (async function () {
        for (var k = 0; k < trying.length; k++) {
          var got = await fetchOne(trying[k]);
          if (got) { cache[key] = got; return got; }
        }
        cache[key] = null;
        return null;
      })();
      inflight[key] = p;
      p.then(function () { delete inflight[key]; }, function () { delete inflight[key]; });
      return p;
    },

    clearCache: function (key) {
      if (key == null) cache = {};
      else delete cache[key];
    }
  };

  window.Lyrics = Lyrics;
})();
