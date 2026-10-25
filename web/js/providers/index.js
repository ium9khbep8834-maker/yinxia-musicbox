/* providers 汇总 —— 纯浏览器 JS
 * window.Providers: 按「QQ > 酷狗 > 网易云」优先级排列（DESIGN.md 4 合并规则）
 * window.providerById(id): 取单个 provider；未知 id 返回 null
 * window.providersStatus(): 汇总各平台登录态（UI 设置页用，可选）
 * window.providerLyric(song): 按 song.platform 取歌词 {text,source}|null（v1.1 歌词）
 */
(function () {
  'use strict';
  var list = [window.Provider_qq, window.Provider_kugou, window.Provider_netease];
  var byId = {};

  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (p && p.id) byId[p.id] = p;
  }

  window.Providers = list;

  window.providerById = function (id) {
    return byId[String(id)] || null;
  };

  window.providersStatus = async function () {
    var out = {};
    for (var k = 0; k < list.length; k++) {
      var p = list[k];
      if (!p || !p.id) continue;
      if (typeof p.status !== 'function') { out[p.id] = { loggedIn: false }; continue; }
      try { out[p.id] = await p.status(); }
      catch (e) { out[p.id] = { loggedIn: false, error: String((e && e.message) || e) }; }
    }
    return out;
  };

  /** 按 song.platform 取歌词：{text,source} 或 null，永不抛 */
  window.providerLyric = async function (song) {
    if (!song || !song.platform) return null;
    var p = byId[String(song.platform)];
    if (!p || typeof p.lyric !== 'function') return null;
    try { return await p.lyric(song); }
    catch (e) { return null; }
  };
})();
