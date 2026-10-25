/* 多平台结果合并：同名同作者去重，音源优先级 QQ > 酷狗 > 网易云（见 DESIGN.md 4） */
(function () {
  'use strict';

  // 平台优先级：数字越小越优先（用户要求同名同作者优先 QQ/酷狗）
  var PRIORITY = { qq: 0, kugou: 1, netease: 2 };

  var FULLWIDTH_OFFSET = 0xFEE0;

  /** 全角转半角 + 小写 + 去标点空白，用于比较 */
  function normalize(s) {
    if (!s) return '';
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xFF01 && c <= 0xFF5E) c -= FULLWIDTH_OFFSET;      // ！-～ → !-～
      else if (c === 0x3000) c = 0x20;                             // 全角空格
      out += String.fromCharCode(c);
    }
    out = out.toLowerCase();
    // 去掉空白、常见连接符和标点，保留中英文数字与括号内容
    out = out.replace(/[\s\u00b7·・\-_—–~/\\|,，.。:：;；!！?？'"“”'‘’]/g, '');
    return out;
  }

  function artistTokens(song) {
    var arr = (song && song.artists) || [];
    var toks = [];
    for (var i = 0; i < arr.length; i++) {
      var parts = String(arr[i] || '').split(/[\/&,，、;；]+/);
      for (var j = 0; j < parts.length; j++) {
        var t = normalize(parts[j]);
        if (t && toks.indexOf(t) < 0) toks.push(t);
      }
    }
    return toks;
  }

  function sharesArtist(a, b) {
    if (!a.length || !b.length) return true; // 双方都没写作者时视为同名可合并，交给 UI 标注
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) >= 0) return true;
    return false;
  }

  function pickCover(sources) {
    for (var i = 0; i < sources.length; i++) {
      if (sources[i].coverUrl) return sources[i].coverUrl;
    }
    return '';
  }

  function toPlayable(nameNorm, bucketItems) {
    var sources = bucketItems.map(function (x) { return x.song; });
    sources.sort(function (a, b) {
      var pa = PRIORITY[a.platform] == null ? 9 : PRIORITY[a.platform];
      var pb = PRIORITY[b.platform] == null ? 9 : PRIORITY[b.platform];
      return pa - pb;
    });
    var primary = sources[0];
    var allArtists = [];
    for (var i = 0; i < sources.length; i++) {
      var a = sources[i].artists || [];
      for (var j = 0; j < a.length; j++) if (allArtists.indexOf(a[j]) < 0) allArtists.push(a[j]);
    }
    return {
      key: nameNorm + '|' + artistTokens(primary).join(','),
      name: primary.name,
      artists: allArtists.length ? allArtists : (primary.artists || []),
      album: primary.album || '',
      durationMs: primary.durationMs || 0,
      coverUrl: pickCover(sources),
      sources: sources,
      primary: primary
    };
  }

  /**
   * groups: [{platform:'qq', songs:[Song...]}, ...]
   * 返回 Playable[]，保持首次出现的顺序，同 key 合并。
   */
  function mergeResults(groups) {
    var out = [];
    var byName = {};   // nameNorm -> [bucket]
    var seen = {};     // 平台+id 去重

    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g];
      var songs = (grp && grp.songs) || [];
      for (var i = 0; i < songs.length; i++) {
        var song = songs[i];
        if (!song || !song.name) continue;
        var uniq = song.platform + ':' + song.id;
        if (seen[uniq]) continue;
        seen[uniq] = 1;

        var nameNorm = normalize(song.name);
        var tokens = artistTokens(song);
        var bucketList = byName[nameNorm] || (byName[nameNorm] = []);
        var target = null;
        for (var b = 0; b < bucketList.length; b++) {
          if (sharesArtist(tokens, bucketList[b].tokens)) { target = bucketList[b]; break; }
        }
        if (target) {
          // 同一平台在同一首歌里只保留一条（平台内可能返回多个版本/重复 id）
          var dup = false;
          for (var q = 0; q < target.items.length; q++) {
            if (target.items[q].song.platform === song.platform) { dup = true; break; }
          }
          if (dup) continue;
          target.items.push({ song: song, tokens: tokens });
          for (var t = 0; t < tokens.length; t++) if (target.tokens.indexOf(tokens[t]) < 0) target.tokens.push(tokens[t]);
        } else {
          target = { nameNorm: nameNorm, tokens: tokens.slice(), items: [{ song: song, tokens: tokens }] };
          bucketList.push(target);
          out.push(target);
        }
      }
    }

    return out.map(function (t) { return toPlayable(t.nameNorm, t.items); });
  }

  window.Merge = {
    normalize: normalize,
    artistTokens: artistTokens,
    mergeResults: mergeResults,
    priority: PRIORITY
  };
})();
