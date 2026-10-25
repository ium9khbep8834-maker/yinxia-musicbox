/* 音乐库：收藏 / 自建歌单 / 最近播放（持久化走 /api/kv，见 DESIGN.md 桥接协议）
 *
 * 用法：
 *   await Library.ready;                        // 首次加载完成
 *   Library.toggleFav(playable) -> bool          // 返回是否已收藏
 *   Library.isFav(playable) -> bool
 *   Library.favList() -> Playable[]
 *   Library.createPlaylist(name) -> {id,name,songs:[]}
 *   Library.addToPlaylist(id, playable) -> bool  // 已存在返回 false
 *   Library.removeFromPlaylist(id, key)
 *   Library.playlistOf(playableOrKey) -> string[] // 该歌曲所在的歌单 id 列表
 *   Library.deletePlaylist(id)
 *   Library.renamePlaylist(id, name)
 *   Library.pushRecent(playable)
 *   Library.on('change', fn)                     // 任何写操作后触发
 *
 * 存储：单个 kv 键 mb.library.v1，形如 {fav:[],playlists:[],recent:[]}。
 * 注意：保存的是「瘦身快照」——去掉 Song.raw 里的大字段，只留播放/歌词必需的
 * （酷狗的 raw.Privilege、hash），否则几千首歌会把 SharedPreferences 撑爆。
 */
(function () {
  'use strict';

  var KV_KEY = 'mb.library.v1';
  var CAPS = { fav: 500, recent: 200, playlistSongs: 800 };

  var data = { fav: [], playlists: [], recent: [] };
  var listeners = [];
  var saveTimer = null;
  var loading = null;

  function nowId() {
    return 'pl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function keyOf(item) {
    if (!item) return '';
    if (typeof item === 'string') return item;
    return item.key || ((item.platform || '') + ':' + (item.id == null ? '' : item.id));
  }

  /** Song/Playable → 可持久化的瘦身快照 */
  function slim(s) {
    if (!s) return null;
    var o = {
      platform: s.platform,
      id: s.id == null ? '' : String(s.id),
      name: s.name || '',
      artists: (s.artists || []).slice(0, 8),
      album: s.album || '',
      durationMs: s.durationMs || 0,
      coverUrl: s.coverUrl || '',
      vip: !!s.vip
    };
    if (s.hash) o.hash = String(s.hash);
    // 酷狗 resolveUrl 需要 raw.Privilege 判断音源是否可取
    if (s.raw && s.raw.Privilege != null) o.raw = { Privilege: s.raw.Privilege };
    return o;
  }

  function slimPlayable(item) {
    if (!item) return null;
    var sources = (item.sources || []).map(slim);
    var out = {
      key: keyOf(item),
      name: item.name || (sources[0] && sources[0].name) || '',
      artists: (item.artists || []).slice(0, 8),
      album: item.album || '',
      durationMs: item.durationMs || 0,
      coverUrl: item.coverUrl || '',
      sources: sources
    };
    if (item.primary) out.primary = slim(item.primary);
    return out;
  }

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](data); } catch (e) { console.warn('[library] listener error', e); }
    }
  }

  function save(delay) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var payload = JSON.stringify(data);
      if (!window.Bridge || typeof window.Bridge.kvSet !== 'function') return;
      Promise.resolve(window.Bridge.kvSet(KV_KEY, payload)).catch(function (e) {
        console.warn('[library] 保存失败', e);
      });
    }, delay == null ? 350 : delay);
  }

  /** 立即落盘（页面隐藏/关闭前调用，避免 debounce 窗口内的改动丢失） */
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!window.Bridge || typeof window.Bridge.kvSet !== 'function') return;
    try {
      Promise.resolve(window.Bridge.kvSet(KV_KEY, JSON.stringify(data))).catch(function () {});
    } catch (e) { /* ignore */ }
  }

  function trimTo(arr, cap) {
    if (arr.length > cap) arr.length = cap;
    return arr;
  }

  function findPlaylist(id) {
    for (var i = 0; i < data.playlists.length; i++) {
      if (data.playlists[i].id === id) return data.playlists[i];
    }
    return null;
  }

  function uniqueByKey(arr, item) {
    var k = keyOf(item);
    for (var i = 0; i < arr.length; i++) if (keyOf(arr[i]) === k) return i;
    return -1;
  }

  var Library = {
    ready: null,
    isFav: function (item) {
      var k = keyOf(item);
      if (!k) return false;
      for (var i = 0; i < data.fav.length; i++) if (keyOf(data.fav[i]) === k) return true;
      return false;
    },
    favList: function () { return data.fav.slice(); },
    toggleFav: function (item) {
      var snap = slimPlayable(item);
      if (!snap || !snap.key) return false;
      var idx = uniqueByKey(data.fav, snap);
      var added;
      if (idx >= 0) { data.fav.splice(idx, 1); added = false; }
      else { data.fav.unshift(snap); trimTo(data.fav, CAPS.fav); added = true; }
      save();
      emit();
      return added;
    },
    removeFav: function (key) {
      var idx = uniqueByKey(data.fav, key);
      if (idx < 0) return false;
      data.fav.splice(idx, 1);
      save();
      emit();
      return true;
    },

    playlists: function () { return data.playlists.slice(); },
    getPlaylist: findPlaylist,
    createPlaylist: function (name) {
      name = String(name || '').replace(/^\s+|\s+$/g, '').slice(0, 40) || '新建歌单';
      var pl = { id: nowId(), name: name, createdAt: Date.now(), songs: [] };
      data.playlists.push(pl);
      save(0);
      emit();
      return pl;
    },
    renamePlaylist: function (id, name) {
      var pl = findPlaylist(id);
      if (!pl) return false;
      name = String(name || '').replace(/^\s+|\s+$/g, '').slice(0, 40);
      if (!name) return false;
      pl.name = name;
      save(0);
      emit();
      return true;
    },
    deletePlaylist: function (id) {
      for (var i = 0; i < data.playlists.length; i++) {
        if (data.playlists[i].id === id) {
          data.playlists.splice(i, 1);
          save(0);
          emit();
          return true;
        }
      }
      return false;
    },
    addToPlaylist: function (id, item) {
      var pl = findPlaylist(id);
      var snap = slimPlayable(item);
      if (!pl || !snap || !snap.key) return false;
      if (uniqueByKey(pl.songs, snap) >= 0) return false;
      pl.songs.push(snap);
      trimTo(pl.songs, CAPS.playlistSongs);
      save(0);
      emit();
      return true;
    },
    removeFromPlaylist: function (id, itemOrKey) {
      var pl = findPlaylist(id);
      if (!pl) return false;
      var idx = uniqueByKey(pl.songs, itemOrKey);
      if (idx < 0) return false;
      pl.songs.splice(idx, 1);
      save(0);
      emit();
      return true;
    },
    playlistOf: function (itemOrKey) {
      var out = [];
      for (var i = 0; i < data.playlists.length; i++) {
        if (uniqueByKey(data.playlists[i].songs, itemOrKey) >= 0) out.push(data.playlists[i].id);
      }
      return out;
    },

    recent: function () { return data.recent.slice(); },
    pushRecent: function (item) {
      var snap = slimPlayable(item);
      if (!snap || !snap.key) return;
      var idx = uniqueByKey(data.recent, snap);
      if (idx >= 0) data.recent.splice(idx, 1);
      data.recent.unshift(snap);
      trimTo(data.recent, CAPS.recent);
      save(1000);
      emit();
    },
    clearRecent: function () {
      data.recent = [];
      save(0);
      emit();
    },

    on: function (ev, fn) {
      if (ev === 'change' && typeof fn === 'function') listeners.push(fn);
      return Library;
    },

    /** 统计信息（设置页显示用） */
    stats: function () {
      return {
        fav: data.fav.length,
        playlists: data.playlists.length,
        recent: data.recent.length,
        bytes: JSON.stringify(data).length
      };
    }
  };

  Library.ready = new Promise(function (resolve) {
    var done = false;
    function finish() { if (!done) { done = true; resolve(Library); } }
    if (!window.Bridge || typeof window.Bridge.kvGet !== 'function') { finish(); return; }
    Promise.resolve(window.Bridge.kvGet(KV_KEY)).then(function (v) {
      if (v && typeof v === 'string') {
        var parsed = JSON.parse(v);
        if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.fav)) data.fav = parsed.fav;
          if (Array.isArray(parsed.playlists)) data.playlists = parsed.playlists;
          if (Array.isArray(parsed.recent)) data.recent = parsed.recent;
        }
      }
    }).catch(function (e) {
      console.warn('[library] 读取失败，使用空库', e);
    }).then(finish);
    setTimeout(finish, 4000); // kv 卡住也不能阻塞界面
  });

  window.Library = Library;
  Library.flush = flush;

  // 页面隐藏/关闭时立即落盘
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flush();
      });
    }
  }
})();
