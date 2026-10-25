/* 音匣 MusicBox — UI 层 v2（原生 JS / 无框架 / 无构建）
 * 依赖全局：Providers、Merge、Player、Library、Lyrics、Bridge（均为只读模块）
 * 兼容 Android WebView / WebView2：不使用 ?. ?? structuredClone
 */
(function () {
  'use strict';

  var P_SHORT = { qq: 'QQ', kugou: '酷狗', netease: '网易' };
  var P_FULL = { qq: 'QQ音乐', kugou: '酷狗音乐', netease: '网易云音乐' };
  var ORDER = ['qq', 'kugou', 'netease'];
  var VIEW_ID = { search: 'viewSearch', fav: 'viewFav', playlists: 'viewPlaylists', playlist: 'viewPlaylist', recent: 'viewRecent' };
  var LIST_SCOPE = { list: 'search', favList: 'fav', plSongs: 'pl', recentList: 'recent' };

  var L = window.Library || null;
  var P = window.Player || null;

  /* ---------------- 小工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ico(n) { return '<svg class="ico"><use href="#i-' + n + '"/></svg>'; }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtSec(s) { s = Math.floor(Math.max(0, s || 0)); return Math.floor(s / 60) + ':' + pad2(s % 60); }
  function fmtDur(ms) { return ms > 0 ? fmtSec(ms / 1000) : ''; }
  function fmtBytes(b) {
    if (!b) return '0 KB';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function keyOf(item) { return (item && item.key) || ''; }

  /* 封面：Playable 自带 coverUrl，兜底取 sources 里第一张 */
  function coverUrl(item) {
    if (!item) return '';
    var u = item.coverUrl;
    if (!u) {
      var srcs = item.sources || (item.primary ? [item.primary] : []);
      for (var i = 0; i < srcs.length; i++) {
        if (srcs[i] && srcs[i].coverUrl) { u = srcs[i].coverUrl; break; }
      }
    }
    if (!u) return '';
    u = String(u);
    if (u.slice(0, 2) === '//') u = 'https:' + u;
    return u;
  }

  function covImg(url, kind, cls) {
    return '<img class="' + cls + '" data-cov="' + kind + '" loading="lazy" referrerpolicy="no-referrer" src="' + esc(url) + '" alt="">';
  }

  /* 图片加载失败 → 回退音符占位，绝不留破图 */
  function covFail(img) {
    var kind = img.getAttribute('data-cov');
    var ph;
    if (kind === 'row') {
      ph = document.createElement('span');
      ph.className = 'row-cov ph';
      ph.innerHTML = ico('note-list');
      if (img.parentNode) img.parentNode.replaceChild(ph, img);
    } else if (kind === 'player') {
      if (img.parentNode) img.parentNode.classList.remove('has');
    } else if (kind === 'lycov') {
      img.hidden = true;
    } else {
      ph = document.createElement('span');
      ph.className = 'pc-ph';
      ph.innerHTML = ico('note-list');
      if (img.parentNode) img.parentNode.replaceChild(ph, img);
    }
  }

  function hookImgs(root) {
    root = root || document;
    if (!root.querySelectorAll) return;
    var imgs = root.querySelectorAll('img[data-cov]');
    for (var i = 0; i < imgs.length; i++) {
      (function (img) {
        if (img.getAttribute('data-hooked')) return;
        img.setAttribute('data-hooked', '1');
        img.addEventListener('error', function () { covFail(img); });
      })(imgs[i]);
    }
  }

  var toastEl = null;
  var toastTimer = 0;
  function dismissToast() {
    clearTimeout(toastTimer);
    if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
    toastEl = null;
  }
  /* opt.err: 错误提示 —— 第一段做标题，原因换行，8 秒后消失、点一下也能关 */
  function toast(msg, opt) {
    dismissToast();
    var isErr = !!(opt && opt.err);
    var s = String(msg == null ? '' : msg);
    toastEl = document.createElement('div');
    toastEl.className = 'toast' + (isErr ? ' err' : '');
    if (isErr) {
      var cut = s.indexOf('：');
      var head = cut > 0 ? s.slice(0, cut) : '出错了';
      var body = cut > 0 ? s.slice(cut + 1) : s;
      toastEl.innerHTML = '<b>' + esc(head) + '</b><span>' + esc(body.replace(/ \/ /g, '\n')) + '</span>';
    } else {
      toastEl.textContent = s;
    }
    document.body.appendChild(toastEl);
    toastEl.addEventListener('click', dismissToast);
    toastTimer = setTimeout(dismissToast, isErr ? 8000 : 2300);
  }


  /* ---------------- 演示数据（?demo=1） ---------------- */
  var DEMO_LRC = {
    'demo:qq:d1':
      '[00:00.00]晴天 - 周杰伦\n[00:04.00]作词：周杰伦\n[00:08.00]作曲：周杰伦\n' +
      '[00:12.00]故事的小黄花\n[00:17.00]从出生那年就飘着\n[00:22.00]童年的荡秋千\n' +
      '[00:27.00]随记忆一直晃到现在\n[00:32.00]rui sou sou xi dou xi la\n' +
      '[00:37.00]sou la xi xi xi xi la xi la sou\n[00:42.00]吹着前奏望着天空\n' +
      '[00:47.00]我想起花瓣试着掉落\n[00:52.00]为你翘课的那一天\n[00:57.00]花落的那一天\n' +
      '[01:02.00]教室的那一间\n[01:05.00]我怎么看不见\n[01:09.00]消失的下雨天\n' +
      '[01:13.00]我好想再淋一遍\n[01:17.00]没想到失去的勇气我还留着\n[01:21.00]好想再问一遍\n' +
      '[01:24.00]你会等待还是离开\n[01:28.00]刮风这天我试过握着你手\n' +
      '[01:32.00]但偏偏雨渐渐大到我看你不见\n[01:36.00]还要多久我才能在你身边\n' +
      '[01:40.00]等到放晴的那天也许我会比较好一点\n',
    'demo:kugou:d2':
      '[00:00.00]夜曲 - 周杰伦\n[00:03.00]一群嗜血的蚂蚁 被腐肉所吸引\n' +
      '[00:08.00]我面无表情 看孤独的风景\n[00:13.00]失去你 爱恨开始分明\n' +
      '[00:18.00]失去你 还有什么事好关心\n[00:23.00]当鸽子不再象征和平\n' +
      '[00:27.00]我终于被提醒 广场上喂食的是秃鹰\n[00:33.00]我用漂亮的押韵\n' +
      '[00:37.00]形容被掠夺一空的爱情\n',
    'demo:netease:d3':
      '[00:00.00]稻香 - 周杰伦\n[00:04.00]对这个世界如果你有太多的抱怨\n' +
      '[00:09.00]跌倒了就不敢继续往前走\n[00:14.00]为什么人要这么的脆弱 堕落\n' +
      '[00:19.00]请你打开电视看看\n[00:23.00]多少人为生命在努力勇敢的走下去\n' +
      '[00:29.00]我们是不是该知足\n[00:33.00]珍惜一切 就算没有拥有\n'
  };

  var DEMO_ITEMS = (function () {
    function mk(name, artists, album, durMs, plat, id) {
      var src = { platform: plat, id: id, name: name, artists: artists, album: album, durationMs: durMs, coverUrl: '', vip: false };
      return { key: 'demo:' + plat + ':' + id, name: name, artists: artists, album: album, durationMs: durMs, coverUrl: '', sources: [src], primary: src };
    }
    return [
      mk('晴天', ['周杰伦'], '叶惠美', 269000, 'qq', 'd1'),
      mk('夜曲', ['周杰伦'], '十一月的萧邦', 226000, 'kugou', 'd2'),
      mk('稻香', ['周杰伦'], '魔杰座', 223000, 'netease', 'd3')
    ];
  })();
  var DEMO_LYR = {};
  (function () {
    for (var i = 0; i < DEMO_ITEMS.length; i++) {
      var k = DEMO_ITEMS[i].key;
      DEMO_LYR[k] = (window.Lyrics && DEMO_LRC[k]) ? window.Lyrics.parse(DEMO_LRC[k]) : [];
    }
  })();

  /* ---------------- 状态 ---------------- */
  var st = {
    view: 'search',
    query: '',
    results: [],
    failed: [],
    filter: '',
    loading: false,
    sel: -1,
    demo: false,
    demoItem: null,
    demoQueue: [],
    demoSec: 0,
    demoOn: false,
    plId: null,
    plCache: null,
    addItem: null,
    seeking: false,
    muted: false,
    lyr: { open: false, key: '', lines: null, loading: false, idx: -2, lock: 0, prog: 0 }
  };

  /* ---------------- 当前播放 ---------------- */
  function currentItem() { return st.demo ? st.demoItem : (P && P.item) || null; }
  function currentKey() { var it = currentItem(); return it ? it.key : ''; }
  function currentDur() {
    if (st.demo) return st.demoItem ? st.demoItem.durationMs / 1000 : 0;
    var a = P && P.audio;
    return a && a.duration && isFinite(a.duration) ? a.duration : 0;
  }
  function currentSec() {
    if (st.demo) return st.demoSec;
    return (P && P.audio && P.audio.currentTime) || 0;
  }

  /* ---------------- 渲染：列表行 ---------------- */
  function hasVip(item) {
    if (!item) return false;
    if (item.vip) return true;
    var srcs = item.sources || [];
    for (var i = 0; i < srcs.length; i++) if (srcs[i] && srcs[i].vip) return true;
    return false;
  }

  function tagHtml(item) {
    var srcs = item.sources || (item.primary ? [item.primary] : []);
    var seen = {}, out = '', n = 0;
    for (var i = 0; i < srcs.length && n < 3; i++) {
      var p = srcs[i] && srcs[i].platform;
      if (!p || seen[p]) continue;
      seen[p] = 1;
      n++;
      out += '<span class="tag ' + esc(p) + '">' + esc(P_SHORT[p] || p) + '</span>';
    }
    return out;
  }

  function rowHtml(item, i, scope, acts) {
    var key = keyOf(item);
    var playing = key && key === currentKey();
    var actsHtml = '';
    acts = acts || ['fav'];
    for (var a = 0; a < acts.length; a++) {
      var t = acts[a];
      if (t === 'fav') {
        var on = !!(L && L.isFav(item));
        actsHtml += '<button class="icon-btn' + (on ? ' on' : '') + '" data-act="fav" data-key="' + esc(key) + '" title="收藏" aria-label="收藏">' + ico('heart') + '</button>';
      } else if (t === 'add') {
        actsHtml += '<button class="icon-btn" data-act="add" data-key="' + esc(key) + '" title="加入歌单" aria-label="加入歌单">' + ico('more') + '</button>';
      } else if (t === 'rmpl') {
        actsHtml += '<button class="icon-btn danger" data-act="rmpl" data-key="' + esc(key) + '" title="从歌单移除" aria-label="从歌单移除">' + ico('minus') + '</button>';
      }
    }
    var sub = (item.artists || []).join(' / ');
    if (item.album) sub = sub ? sub + ' · ' + item.album : item.album;
    var cov = coverUrl(item);
    var lead = '<span class="num">' + (i + 1) + '</span><span class="bars"><i></i><i></i><i></i></span>';
    if (cov) lead = covImg(cov, 'row', 'row-cov') + '<span class="bars"><i></i><i></i><i></i></span>';
    return '<div class="row' + (playing ? ' playing' : '') + '" role="listitem" data-i="' + i + '" data-key="' + esc(key) + '" data-scope="' + esc(scope) + '">' +
      '<div class="row-lead' + (cov ? ' cover has' : '') + '">' + lead + '</div>' +
      '<div class="row-main">' +
      '<div class="row-name"><span class="name">' + esc(item.name || '未知歌曲') + '</span>' + (hasVip(item) ? '<span class="vip">VIP</span>' : '') + '</div>' +
      '<div class="row-sub"><span class="sub">' + esc(sub || '未知歌手') + '</span></div>' +
      '</div>' +
      '<div class="row-tags">' + tagHtml(item) + '</div>' +
      '<div class="row-dur">' + fmtDur(item.durationMs) + '</div>' +
      '<div class="row-acts">' + actsHtml + '</div>' +
      '</div>';
  }

  function listHtml(items, scope, acts) {
    var h = '';
    for (var i = 0; i < items.length; i++) h += rowHtml(items[i], i, scope, acts);
    return h;
  }

  function emptyHtml(ic, title, sub, actionHtml) {
    return '<div class="empty">' + ico(ic) + '<b>' + esc(title) + '</b><span>' + esc(sub) + '</span>' + (actionHtml || '') + '</div>';
  }

  function skeleton(n) {
    var h = '';
    for (var i = 0; i < n; i++) {
      h += '<div class="sk-row"><div class="sk sk-cov"></div><div class="sk-main"><div class="sk sk-line"></div><div class="sk sk-line s"></div></div></div>';
    }
    return h;
  }

  function markPlaying() {
    hookImgs(document);
    var key = currentKey();
    var rows = document.querySelectorAll('.row[data-key]');
    for (var i = 0; i < rows.length; i++) {
      var on = !!key && rows[i].getAttribute('data-key') === key;
      if (on) { if (!rows[i].classList.contains('playing')) rows[i].classList.add('playing'); }
      else if (rows[i].classList.contains('playing')) rows[i].classList.remove('playing');
    }
  }

  /* ---------------- 渲染：搜索 ---------------- */
  function platformCounts(items) {
    var c = {};
    for (var i = 0; i < items.length; i++) {
      var srcs = items[i].sources || (items[i].primary ? [items[i].primary] : []);
      var seen = {};
      for (var j = 0; j < srcs.length; j++) {
        var p = srcs[j] && srcs[j].platform;
        if (!p || seen[p]) continue;
        seen[p] = 1;
        c[p] = (c[p] || 0) + 1;
      }
    }
    return c;
  }

  function filtered() {
    if (!st.filter) return st.results;
    var out = [];
    for (var i = 0; i < st.results.length; i++) {
      var srcs = st.results[i].sources || [];
      for (var j = 0; j < srcs.length; j++) {
        if (srcs[j] && srcs[j].platform === st.filter) { out.push(st.results[i]); break; }
      }
    }
    return out;
  }

  function renderSearch() {
    var chips = $('chips');
    var meta = $('searchMeta');
    var list = $('list');
    var demo = st.demo && !st.query;
    if (st.loading) {
      chips.innerHTML = '';
      meta.textContent = '三个平台同时搜索中…';
      list.innerHTML = skeleton(7);
      return;
    }
    if (!st.query && !demo) {
      chips.innerHTML = '';
      meta.textContent = '';
      list.innerHTML = emptyHtml('search', '搜点什么', '歌名或歌手，QQ / 酷狗 / 网易云一起找');
      return;
    }
    var items = filtered();
    var counts = platformCounts(st.results);
    var ch = '<button class="chip' + (st.filter === '' ? ' on' : '') + '" data-p="">全部 ' + st.results.length + '</button>';
    for (var i = 0; i < ORDER.length; i++) {
      var p = ORDER[i];
      if (!counts[p]) continue;
      ch += '<button class="chip' + (st.filter === p ? ' on' : '') + '" data-p="' + p + '">' + (P_SHORT[p] || p) + ' ' + counts[p] + '</button>';
    }
    chips.innerHTML = ch;

    var m = demo ? ('演示数据 · ' + st.results.length + ' 首') : ('“' + st.query + '” · ' + st.results.length + ' 首');
    if (st.failed.length) m += ' · ' + st.failed.join(' / ') + ' 未响应';
    meta.textContent = m;

    if (!items.length) {
      list.innerHTML = emptyHtml('search', '没有找到结果', st.failed.length ? '部分平台未响应，换个关键词再试' : '换个关键词，或者少写几个字', '');
      return;
    }
    list.innerHTML = listHtml(items, 'search', ['fav', 'add']);
    markPlaying();
  }

  /* ---------------- 渲染：收藏 / 最近 ---------------- */
  function renderFav() {
    var items = L ? L.favList() : [];
    $('favMeta').textContent = items.length ? items.length + ' 首' : '';
    $('btnPlayFav').disabled = !items.length;
    $('favList').innerHTML = items.length
      ? listHtml(items, 'fav', ['fav', 'add'])
      : emptyHtml('heart', '还没有收藏', '点歌曲右边的 ♥，喜欢的歌就会出现在这里', '<button class="btn-ghost" data-act="gosearch">' + ico('search') + '去搜索</button>');
    markPlaying();
  }

  function renderRecent() {
    var items = L ? L.recent() : [];
    $('recentMeta').textContent = items.length ? items.length + ' 首' : '';
    $('recentList').innerHTML = items.length
      ? listHtml(items, 'recent', ['fav', 'add'])
      : emptyHtml('clock', '还没有播放记录', '播放过的歌会自动记在这里', '<button class="btn-ghost" data-act="gosearch">' + ico('search') + '去搜索</button>');
    markPlaying();
  }

  /* ---------------- 渲染：歌单 ---------------- */
  function renderPlaylists() {
    var pls = L ? L.playlists() : [];
    $('plMeta').textContent = pls.length ? pls.length + ' 个歌单' : '';
    var h = '';
    for (var i = 0; i < pls.length; i++) {
      var pl = pls[i];
      var songs = pl.songs || [];
      var n = songs.length;
      var cov = n ? coverUrl(songs[0]) : '';
      var cover = cov ? covImg(cov, 'plcover', 'pc-img') : ico('note-list');
      h += '<button class="pl-card" data-pl="' + esc(pl.id) + '" title="' + esc(pl.name) + '">' +
        '<span class="pc-cover">' + cover + '<span class="pc-n">' + n + ' 首</span></span>' +
        '<span class="pc-name">' + esc(pl.name) + '</span>' +
        '<span class="pc-sub">' + n + ' 首</span>' +
        '</button>';
    }
    $('plGrid').innerHTML = h || emptyHtml('note-list', '还没有歌单', '新建一个歌单，把喜欢的歌按心情收进去', '<button class="btn-ghost" data-act="newpl">' + ico('plus') + '新建歌单</button>');
    hookImgs($('plGrid'));
  }

  function renderPlaylistDetail() {
    if (!L || !st.plId) { setView('playlists'); return; }
    var pl = L.getPlaylist(st.plId);
    if (!pl) { st.plId = null; st.plCache = null; setView('playlists'); return; }
    st.plCache = pl;
    var songs = pl.songs || [];
    $('plName').textContent = pl.name;
    $('plMeta2').textContent = songs.length + ' 首';
    var plCov = songs.length ? coverUrl(songs[0]) : '';
    $('plCover').innerHTML = plCov ? covImg(plCov, 'plcover', 'pl-img') : ico('note-list');
    $('plSongs').innerHTML = songs.length
      ? listHtml(songs, 'pl', ['fav', 'rmpl'])
      : emptyHtml('note-list', '歌单还是空的', '在搜索结果里点 ⋯ 就能把歌加进来', '<button class="btn-ghost" data-act="gosearch">' + ico('search') + '去搜索</button>');
    markPlaying();
    hookImgs($('plCover'));
  }

  /* ---------------- 计数 badge ---------------- */
  function setBadge(id, n) {
    var el = $(id);
    if (!el) return;
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = !n;
  }
  function updateCounts() {
    if (!L) return;
    setBadge('cntFav', L.favList().length);
    setBadge('cntPl', L.playlists().length);
  }

  /* ---------------- 播放条 ---------------- */
  function updatePlayerBar() {
    var bar = $('player');
    var it = currentItem();
    if (!it) { bar.hidden = true; return; }
    bar.hidden = false;
    $('pTitle').textContent = it.name || '—';

    var thumb = $('pThumb');
    var cov = coverUrl(it);
    var covEl = $('cover');
    if (cov && covEl) {
      if (covEl.getAttribute('data-src') !== cov) {
        covEl.setAttribute('data-src', cov);
        covEl.src = cov;
      }
      thumb.classList.add('has');
    } else {
      thumb.classList.remove('has');
      if (covEl) { covEl.removeAttribute('src'); covEl.removeAttribute('data-src'); }
    }

    var srcPlatform = '';
    if (st.demo) {
      srcPlatform = (it.sources && it.sources[0] && it.sources[0].platform) || '';
    } else if (P && P.source && P.source.platform) {
      srcPlatform = P.source.platform;
    }
    var sub = (it.artists || []).join(' / ');
    if (srcPlatform) sub = (sub ? sub + ' · ' : '') + (P_FULL[srcPlatform] || srcPlatform);
    else if (!st.demo && P && (P.state === 'resolving' || P.state === 'loading')) sub = (sub ? sub + ' · ' : '') + (P.state === 'resolving' ? '解析音源中…' : '缓冲中…');
    $('pSub').textContent = sub || '—';

    $('btnFav').classList.toggle('on', !!(L && L.isFav(it)));
    var playing = st.demo ? st.demoOn : !!(P && P.state === 'playing');
    $('btnPlay').innerHTML = ico(playing ? 'pause' : 'play');
    $('btnPlay').setAttribute('aria-label', playing ? '暂停' : '播放');

    var dur = currentDur() || (it.durationMs ? it.durationMs / 1000 : 0);
    var cur = Math.min(currentSec(), dur || currentSec());
    $('tDur').textContent = fmtSec(dur);
    if (!st.seeking) {
      $('tCur').textContent = fmtSec(cur);
      $('seek').value = dur ? Math.round(Math.min(1, cur / dur) * 1000) : 0;
    }
  }

  function onTime(cur, dur) {
    if (!st.seeking) {
      var d = dur || currentDur();
      $('tCur').textContent = fmtSec(cur);
      $('tDur').textContent = fmtSec(d);
      $('seek').value = d ? Math.round(Math.min(1, cur / d) * 1000) : 0;
    }
    lyricTick(cur);
  }

  /* ---------------- 视图切换 ---------------- */
  function setView(v) {
    if (!VIEW_ID[v]) v = 'search';
    st.view = v;
    for (var k in VIEW_ID) {
      if (!Object.prototype.hasOwnProperty.call(VIEW_ID, k)) continue;
      var sec = $(VIEW_ID[k]);
      if (sec) sec.classList.toggle('on', k === v);
    }
    var navKey = v === 'playlist' ? 'playlists' : v;
    var navs = document.querySelectorAll('.nav-item');
    for (var i = 0; i < navs.length; i++) {
      var on = navs[i].getAttribute('data-view') === navKey;
      navs[i].classList.toggle('on', on);
    }
    if (v !== 'playlists') { var np = $('newPlRow'); if (np) np.hidden = true; }
    if (v !== 'playlist') { var rr = $('plRenameRow'); if (rr) rr.hidden = true; }
    hideConfirm();
    st.sel = -1;
    renderCurrent();
  }

  function renderCurrent() {
    updateCounts();
    if (st.view === 'search') renderSearch();
    else if (st.view === 'fav') renderFav();
    else if (st.view === 'playlists') renderPlaylists();
    else if (st.view === 'playlist') renderPlaylistDetail();
    else if (st.view === 'recent') renderRecent();
    updatePlayerBar();
  }

  /* ---------------- 列表数据 ---------------- */
  function itemsOf(scope) {
    if (scope === 'search') return filtered();
    if (scope === 'fav') return L ? L.favList() : [];
    if (scope === 'recent') return L ? L.recent() : [];
    if (scope === 'pl') return st.plCache ? (st.plCache.songs || []) : [];
    return [];
  }
  function scopeOfView() {
    if (st.view === 'fav') return 'fav';
    if (st.view === 'recent') return 'recent';
    if (st.view === 'playlist') return 'pl';
    return 'search';
  }
  function scopeOfList(el) { return el && LIST_SCOPE[el.id] ? LIST_SCOPE[el.id] : 'search'; }

  function findItem(key) {
    if (!key) return null;
    var pools = [st.results, L ? L.favList() : [], L ? L.recent() : [], st.plCache ? (st.plCache.songs || []) : [], st.demoQueue];
    for (var i = 0; i < pools.length; i++) {
      var arr = pools[i];
      for (var j = 0; j < arr.length; j++) if (keyOf(arr[j]) === key) return arr[j];
    }
    var it = currentItem();
    return it && it.key === key ? it : null;
  }

  /* ---------------- 播放控制 ---------------- */
  function playAt(scope, i) {
    var items = itemsOf(scope);
    var item = items[i];
    if (!item) return;
    if (st.demo) { demoPlay(item, items); return; }
    if (!P) return;
    P.playPlayable(item, items);
  }

  function togglePlay() {
    if (st.demo) {
      if (!st.demoItem) { if (st.demoQueue.length) demoPlay(st.demoQueue[0], st.demoQueue); return; }
      st.demoOn = !st.demoOn;
      updatePlayerBar();
      return;
    }
    if (!P) return;
    if (!P.item) {
      var items = itemsOf(scopeOfView());
      if (items.length) { P.playPlayable(items[0], items); }
      return;
    }
    P.toggle();
  }

  function nextTrack(dir) {
    if (st.demo) {
      if (!st.demoQueue.length) return;
      var cur = currentKey(), idx = -1;
      for (var i = 0; i < st.demoQueue.length; i++) if (keyOf(st.demoQueue[i]) === cur) { idx = i; break; }
      var n = idx < 0 ? 0 : (idx + dir + st.demoQueue.length) % st.demoQueue.length;
      demoPlay(st.demoQueue[n], st.demoQueue);
      return;
    }
    if (!P) return;
    if (dir > 0) P.next(); else P.prev();
  }

  var demoClock = 0;
  function startDemoClock() {
    if (demoClock) return;
    demoClock = setInterval(function () {
      if (!st.demoItem || !st.demoOn) return;
      st.demoSec += 0.25;
      var dur = currentDur();
      if (dur && st.demoSec >= dur) { nextTrack(1); return; }
      if (!st.seeking) {
        $('tCur').textContent = fmtSec(st.demoSec);
        $('seek').value = dur ? Math.round(st.demoSec / dur * 1000) : 0;
        $('tDur').textContent = fmtSec(dur);
      }
      lyricTick(st.demoSec);
    }, 250);
  }

  function demoPlay(item, queue) {
    st.demoQueue = (queue && queue.length ? queue.slice() : [item]);
    st.demoItem = item;
    st.demoSec = 0;
    st.demoOn = true;
    if (L) L.pushRecent(item);
    markPlaying();
    updatePlayerBar();
    if (st.lyr.open) loadLyrics(false);
    startDemoClock();
  }

  /* ---------------- 收藏 ---------------- */
  function patchFav(key, on) {
    var rows = document.querySelectorAll('.row');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-key') !== key) continue;
      var btn = rows[i].querySelector('[data-act="fav"]');
      if (btn) btn.classList.toggle('on', !!on);
    }
    var cur = currentItem();
    if (cur && cur.key === key) $('btnFav').classList.toggle('on', !!on);
  }

  function toggleFav(item) {
    if (!item || !L) return;
    var on = L.toggleFav(item);
    patchFav(item.key, on);
    toast(on ? '已加入收藏' : '已取消收藏');
    updateCounts();
    if (st.view === 'fav') renderFav();
  }

  /* ---------------- 歌单操作 ---------------- */
  function toggleAdd(plId) {
    if (!L || !st.addItem) return;
    var ids = L.playlistOf(st.addItem) || [];
    if (ids.indexOf(plId) >= 0) {
      L.removeFromPlaylist(plId, st.addItem);
      toast('已从歌单移除');
    } else {
      var ok = L.addToPlaylist(plId, st.addItem);
      toast(ok ? '已加入歌单' : '歌单里已经有这首歌了');
    }
    renderAdd();
    if (st.view === 'playlist' && st.plId === plId) renderPlaylistDetail();
  }

  function openAdd(item) {
    if (!item) return;
    st.addItem = item;
    var sub = (item.artists || []).join(' / ');
    $('addSong').textContent = item.name + (sub ? ' · ' + sub : '');
    $('addNewName').value = '';
    renderAdd();
    openSheet('addSheet');
  }

  function renderAdd() {
    var pls = L ? L.playlists() : [];
    var ids = (L && st.addItem) ? (L.playlistOf(st.addItem) || []) : [];
    var h = '';
    for (var i = 0; i < pls.length; i++) {
      var pl = pls[i];
      var on = ids.indexOf(pl.id) >= 0;
      h += '<button class="add-row' + (on ? ' on' : '') + '" data-pl="' + esc(pl.id) + '">' +
        '<span class="add-ck">' + ico('check') + '</span>' +
        '<span class="add-name">' + esc(pl.name) + '</span>' +
        '<span class="add-cnt">' + (pl.songs || []).length + ' 首</span>' +
        '</button>';
    }
    $('addList').innerHTML = h || '<div class="empty" style="padding:32px 16px">' + ico('note-list') + '<b>还没有歌单</b><span>在下面直接新建一个</span></div>';
  }

  function openPl(id) {
    if (!L) return;
    var pl = L.getPlaylist(id);
    if (!pl) { toast('歌单不存在'); return; }
    st.plId = id;
    st.plCache = pl;
    setView('playlist');
  }

  function showNewPl() {
    var row = $('newPlRow');
    row.hidden = !row.hidden;
    if (!row.hidden) { $('newPlName').value = ''; $('newPlName').focus(); }
  }

  function commitNewPl() {
    if (!L) return;
    var name = ($('newPlName').value || '').trim();
    if (!name) { toast('给歌单起个名字'); return; }
    L.createPlaylist(name);
    $('newPlName').value = '';
    $('newPlRow').hidden = true;
    renderPlaylists();
    toast('已创建歌单「' + name + '」');
  }

  function addNewFromSheet() {
    if (!L || !st.addItem) return;
    var name = ($('addNewName').value || '').trim();
    if (!name) { toast('给歌单起个名字'); return; }
    var pl = L.createPlaylist(name);
    L.addToPlaylist(pl.id, st.addItem);
    $('addNewName').value = '';
    renderAdd();
    closeSheet('addSheet');
    toast('已新建「' + name + '」并加入');
  }

  function startRename() {
    var pl = (L && st.plId) ? L.getPlaylist(st.plId) : null;
    if (!pl) return;
    $('plRenameInput').value = pl.name;
    $('plRenameRow').hidden = false;
    $('plRenameInput').focus();
    if ($('plRenameInput').select) $('plRenameInput').select();
  }

  function commitRename() {
    if (!L || !st.plId) return;
    var v = ($('plRenameInput').value || '').trim();
    if (!v) { toast('名字不能为空'); return; }
    L.renamePlaylist(st.plId, v);
    $('plRenameRow').hidden = true;
    renderPlaylistDetail();
    toast('已重命名');
  }

  function deletePl() {
    if (!L || !st.plId) return;
    var pl = L.getPlaylist(st.plId);
    showConfirm('viewPlaylist', '删除歌单「' + (pl ? pl.name : '') + '」？歌曲本身不会被删除。', '删除', function () {
      L.deletePlaylist(st.plId);
      st.plId = null;
      st.plCache = null;
      setView('playlists');
      toast('歌单已删除');
    });
  }

  function clearRecent() {
    if (!L) return;
    showConfirm('viewRecent', '清空全部最近播放记录？', '清空', function () {
      L.clearRecent();
      renderRecent();
      toast('已清空最近播放');
    });
  }

  /* ---------------- 内联确认条 ---------------- */
  function hideConfirm() {
    var b = $('confirmBar');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  function showConfirm(hostId, msg, okText, onOk) {
    hideConfirm();
    var host = $(hostId);
    if (!host) return;
    var bar = document.createElement('div');
    bar.className = 'confirm';
    bar.id = 'confirmBar';
    bar.innerHTML = '<span class="confirm-msg">' + esc(msg) + '</span>' +
      '<button class="btn-danger" id="confirmOk">' + esc(okText) + '</button>' +
      '<button class="btn-ghost" id="confirmCancel">取消</button>';
    host.insertBefore(bar, host.children[1] || null);
    bar.querySelector('#confirmOk').addEventListener('click', function () {
      hideConfirm();
      onOk();
    });
    bar.querySelector('#confirmCancel').addEventListener('click', hideConfirm);
  }

  /* ---------------- 覆盖层 ---------------- */
  function openSheet(id) {
    var el = $(id);
    if (el) el.hidden = false;
  }
  function closeSheet(id) {
    var el = $(id);
    if (el) el.hidden = true;
    if (id === 'lyricsSheet') st.lyr.open = false;
  }
  function closeTopSheet() {
    var ids = ['addSheet', 'settingsSheet', 'lyricsSheet'];
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (el && !el.hidden) { closeSheet(ids[i]); return true; }
    }
    return false;
  }

  /* ---------------- 歌词 ---------------- */
  function renderLyrics() {
    var body = $('lyricsBody');
    var ly = st.lyr;
    if (ly.loading) {
      body.innerHTML = '<div class="ly-state"><span class="dots"><i></i><i></i><i></i></span>正在加载歌词…</div>';
      return;
    }
    if (!ly.lines || !ly.lines.length) {
      body.innerHTML = '<div class="ly-empty">' + ico('empty') + '<b>暂无歌词</b><span>这首歌三个平台都没给出时间轴歌词</span>' +
        '<button class="btn-ghost" data-act="lyretry">' + ico('search') + '重新获取</button></div>';
      return;
    }
    var h = '';
    for (var i = 0; i < ly.lines.length; i++) {
      var ln = ly.lines[i];
      h += '<div class="ly-line' + (ln.text ? '' : ' blank') + '" data-t="' + ln.t + '" data-li="' + i + '">' + (ln.text ? esc(ln.text) : '&nbsp;') + '</div>';
    }
    body.innerHTML = h;
    ly.idx = -2;
    lyricTick(currentSec());
  }

  function loadLyrics(force) {
    var it = currentItem();
    if (!it) return;
    var ly = st.lyr;
    ly.key = it.key;
    ly.idx = -2;
    ly.lines = null;
    ly.loading = true;

    if (st.demo && DEMO_LYR[it.key]) {
      ly.lines = DEMO_LYR[it.key];
      ly.loading = false;
      renderLyrics();
      lyricTick(st.demoSec);
      return;
    }
    renderLyrics();
    if (!window.Lyrics || typeof window.Lyrics.fetch !== 'function') {
      ly.loading = false;
      ly.lines = null;
      renderLyrics();
      return;
    }
    if (force) window.Lyrics.clearCache(it.key);
    Promise.resolve(window.Lyrics.fetch(it)).then(function (got) {
      if (st.lyr.key !== it.key) return;
      ly.loading = false;
      ly.lines = got && got.lines ? got.lines : null;
      renderLyrics();
      var label = got && got.source ? (P_FULL[got.source] || got.source) : '';
      var sub = (it.artists || []).join(' / ');
      $('lySub').textContent = label ? (sub ? sub + ' · ' + label + ' 歌词' : label + ' 歌词') : sub;
      lyricTick(currentSec());
    }, function () {
      if (st.lyr.key !== it.key) return;
      ly.loading = false;
      ly.lines = null;
      renderLyrics();
    });
  }

  function openLyrics() {
    var it = currentItem();
    if (!it) { toast('先播放一首歌'); return; }
    st.lyr.open = true;
    $('lyTitle').textContent = it.name || '歌词';
    var lyCov = $('lyCover');
    if (lyCov) {
      var lc = coverUrl(it);
      if (lc) { lyCov.src = lc; lyCov.hidden = false; }
      else { lyCov.removeAttribute('src'); lyCov.hidden = true; }
    }
    var sub = (it.artists || []).join(' / ');
    $('lySub').textContent = sub || '';
    openSheet('lyricsSheet');
    var cached = (window.Lyrics && st.demo && DEMO_LYR[it.key]) ? null : (window.Lyrics ? window.Lyrics.peek(it) : null);
    if (st.demo && DEMO_LYR[it.key]) {
      st.lyr.key = it.key;
      st.lyr.lines = DEMO_LYR[it.key];
      st.lyr.loading = false;
      renderLyrics();
      lyricTick(st.demoSec);
      return;
    }
    if (cached && cached.lines) {
      st.lyr.key = it.key;
      st.lyr.lines = cached.lines;
      st.lyr.loading = false;
      renderLyrics();
      lyricTick(currentSec());
      return;
    }
    loadLyrics(false);
  }

  function lyricTick(sec) {
    var ly = st.lyr;
    if (!ly.open || !ly.lines || !ly.lines.length) return;
    if (!window.Lyrics || typeof window.Lyrics.indexAt !== 'function') return;
    var idx = window.Lyrics.indexAt(ly.lines, sec);
    if (idx === ly.idx) return;
    ly.idx = idx;
    var body = $('lyricsBody');
    if (!body) return;
    var prev = body.querySelector('.ly-line.on');
    if (prev) prev.classList.remove('on');
    if (idx < 0) return;
    var cur = body.querySelector('.ly-line[data-li="' + idx + '"]');
    if (!cur) return;
    cur.classList.add('on');
    if (Date.now() > ly.lock) {
      ly.prog = 1;
      try { cur.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { cur.scrollIntoView(); }
      setTimeout(function () { ly.prog = 0; }, 700);
    }
  }

  /* ---------------- 设置 ---------------- */
  function renderSettings() {
    var stats = L ? L.stats() : { fav: 0, playlists: 0, recent: 0, bytes: 0 };
    var provs = window.Providers || [];
    var rows = '';
    var opts = '';
    for (var i = 0; i < provs.length; i++) {
      var p = provs[i];
      var label = p.label || P_FULL[p.id] || p.id;
      rows += '<div class="pf"><div class="pf-name">' + esc(label) +
        '<div class="pf-state" id="pfState-' + esc(p.id) + '">检查中…</div></div>' +
        '<div class="pf-ops">' +
        '<button class="btn-ghost" data-login="' + esc(p.id) + '">登录</button>' +
        '<button class="btn-ghost" data-logout="' + esc(p.id) + '">退出</button>' +
        '</div></div>';
      opts += '<option value="' + esc(p.id) + '">' + esc(label) + '</option>';
    }
    var ver = (window.Bridge && window.Bridge.version) || '—';
    $('settingsBody').innerHTML =
      '<div class="set-block"><div class="set-h">平台账号</div>' + rows +
      '<div class="hint">不登录也能搜索与试听；登录后音源更完整、可播更高音质。</div></div>' +
      '<div class="set-block"><div class="set-h">手动导入 Cookie</div>' +
      '<details class="cookie-import"><summary>展开：粘贴浏览器 Cookie</summary><div class="ci-body">' +
      '<div class="ci-row"><select id="ciPlat">' + opts + '</select>' +
      '<button class="btn-accent" id="ciBtn">导入</button></div>' +
      '<textarea id="ciText" placeholder="把浏览器里对应平台的 Cookie 请求头粘贴到这里"></textarea>' +
      '<div class="hint">仅保存于本机，不会上传。</div></div></details></div>' +
      '<div class="set-block"><div class="set-h">我的数据</div>' +
      '<div class="stat"><span>收藏 <b>' + stats.fav + '</b></span><span>歌单 <b>' + stats.playlists + '</b></span>' +
      '<span>最近 <b>' + stats.recent + '</b></span><span>占用 <b>' + fmtBytes(stats.bytes) + '</b></span></div>' +
      '<button class="btn-ghost" id="settingsClearRecent">' + ico('trash') + '清空最近播放</button></div>' +
      '<div class="set-block"><div class="hint">音匣 MusicBox · UI v2 · Bridge ' + esc(ver) + '</div></div>';
    refreshSettingsState();
  }

  function refreshSettingsState() {
    if (!window.Bridge || typeof window.Bridge.state !== 'function') return;
    Promise.resolve(window.Bridge.state()).then(function (res) {
      var plats = (res && res.platforms) || {};
      var provs = window.Providers || [];
      for (var i = 0; i < provs.length; i++) {
        var id = provs[i].id;
        var el = $('pfState-' + id);
        if (!el) continue;
        var info = plats[id] || null;
        var ok = !!(info && info.loggedIn);
        el.textContent = ok ? '已登录' : '未登录';
        el.className = 'pf-state' + (ok ? ' ok' : '');
      }
    }, function () { /* ignore */ });
  }

  function doLogin(id) {
    if (!window.Bridge || typeof window.Bridge.login !== 'function') return;
    toast('正在打开' + (P_FULL[id] || id) + '登录…');
    Promise.resolve(window.Bridge.login(id)).then(function (r) {
      if (r && r.ok) { toast('登录成功'); refreshSettingsState(); }
      else toast((r && r.error) || '登录失败');
    }, function (e) { toast('登录失败：' + ((e && e.message) || e)); });
  }

  function doLogout(id) {
    if (!window.Bridge || typeof window.Bridge.logout !== 'function') return;
    Promise.resolve(window.Bridge.logout(id)).then(function (r) {
      if (r && r.ok === false) { toast(r.error || '退出失败'); return; }
      toast('已退出' + (P_FULL[id] || id));
      refreshSettingsState();
    }, function (e) { toast('退出失败：' + ((e && e.message) || e)); });
  }

  function importCookie() {
    if (!window.Bridge || typeof window.Bridge.importCookie !== 'function') { toast('当前环境不支持导入'); return; }
    var sel = $('ciPlat');
    var plat = (sel && sel.value) || 'qq';
    var txt = (($('ciText') && $('ciText').value) || '').trim();
    if (!txt) { toast('先粘贴 Cookie'); return; }
    toast('导入中…');
    Promise.resolve(window.Bridge.importCookie(plat, txt)).then(function (r) {
      if (r && r.ok) {
        toast('已导入' + (P_FULL[plat] || plat) + ' Cookie');
        var t = $('ciText');
        if (t) t.value = '';
        refreshSettingsState();
      } else toast((r && r.error) || '导入失败');
    }, function (e) { toast('导入失败：' + ((e && e.message) || e)); });
  }

  /* ---------------- 搜索 ---------------- */
  function renderChipsOnly() { /* 预留 */ }

  function doSearch() {
    var input = $('q');
    var q = (input && input.value ? input.value : '').trim();
    if (!q) { if (input) input.focus(); return; }
    st.query = q;
    st.results = [];
    st.failed = [];
    st.filter = '';
    st.loading = true;
    st.sel = -1;
    setView('search');
    renderSearch();
    var provs = window.Providers || [];
    if (!provs.length) {
      st.loading = false;
      renderSearch();
      toast('没有可用的音乐平台');
      return;
    }
    var jobs = [];
    for (var i = 0; i < provs.length; i++) {
      jobs.push((function (p) {
        return Promise.resolve()
          .then(function () { return p.search(st.query); })
          .then(function (songs) { return { platform: p.id, songs: songs || [] }; })
          .catch(function (err) { return { platform: p.id, songs: [], err: (err && err.message) || String(err), label: p.label || p.id }; });
      })(provs[i]));
    }
    Promise.all(jobs).then(function (out) {
      var groups = [], failed = [];
      for (var j = 0; j < out.length; j++) {
        groups.push({ platform: out[j].platform, songs: out[j].songs });
        if (out[j].err) failed.push(out[j].label || P_SHORT[out[j].platform] || out[j].platform);
      }
      st.results = (window.Merge && window.Merge.mergeResults) ? window.Merge.mergeResults(groups) : [];
      st.failed = failed;
      st.loading = false;
      renderSearch();
      if (!st.results.length) toast(failed.length ? '搜索失败：' + failed.join(' / ') : '没有找到结果');
    });
  }

  /* ---------------- 事件绑定 ---------------- */
  function doAct(el) {
    var act = el.getAttribute('data-act');
    var key = el.getAttribute('data-key') || '';
    var item = key ? findItem(key) : null;
    if (act === 'fav') { if (item) toggleFav(item); }
    else if (act === 'add') { if (item) openAdd(item); }
    else if (act === 'rmpl') {
      if (item && L && st.plId) {
        L.removeFromPlaylist(st.plId, item);
        toast('已从歌单移除');
        renderPlaylistDetail();
      }
    } else if (act === 'lyretry') loadLyrics(true);
    else if (act === 'gosearch') { setView('search'); if ($('q')) $('q').focus(); }
    else if (act === 'newpl') { setView('playlists'); showNewPl(); }
  }

  function onDocClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var closeEl = t.closest('[data-close]');
    if (closeEl) { closeSheet(closeEl.getAttribute('data-close')); return; }

    if (t.classList && t.classList.contains('sheet')) { closeSheet(t.id); return; }

    var actEl = t.closest('[data-act]');
    if (actEl) { doAct(actEl); return; }

    var chipEl = t.closest('.chip[data-p]');
    if (chipEl) {
      st.filter = chipEl.getAttribute('data-p') || '';
      st.sel = -1;
      renderSearch();
      return;
    }

    var plEl = t.closest('[data-pl]');
    if (plEl) {
      var id = plEl.getAttribute('data-pl');
      if (t.closest('#addList')) toggleAdd(id);
      else openPl(id);
      return;
    }

    var navEl = t.closest('.nav-item[data-view]');
    if (navEl) {
      var v = navEl.getAttribute('data-view');
      if (v === 'playlists') { st.plId = null; st.plCache = null; }
      setView(v);
      return;
    }

    var row = t.closest('.row[data-i]');
    if (row) {
      var list = row.closest('.list');
      if (list) playAt(scopeOfList(list), parseInt(row.getAttribute('data-i'), 10) || 0);
    }
  }

  function bindStatic() {
    var q = $('q');
    if (q) {
      q.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); doSearch(); }
      });
    }
    var bs = $('btnSearch');
    if (bs) bs.addEventListener('click', function () { doSearch(); });

    var coverEl = $('cover');
    if (coverEl) coverEl.addEventListener('error', function () { covFail(coverEl); });

    var stg = $('btnSettings');
    if (stg) stg.addEventListener('click', function () { openSheet('settingsSheet'); renderSettings(); });

    var bf = $('btnPlayFav');
    if (bf) bf.addEventListener('click', function () { playAt('fav', 0); });
    var bcr = $('btnClearRecent');
    if (bcr) bcr.addEventListener('click', clearRecent);

    var bnp = $('btnNewPl');
    if (bnp) bnp.addEventListener('click', showNewPl);
    var nok = $('newPlOk');
    if (nok) nok.addEventListener('click', commitNewPl);
    var ncancel = $('newPlCancel');
    if (ncancel) ncancel.addEventListener('click', function () { $('newPlRow').hidden = true; });
    var ninput = $('newPlName');
    if (ninput) ninput.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); commitNewPl(); } });

    var pback = $('plBack');
    if (pback) pback.addEventListener('click', function () { setView('playlists'); });
    var pname = $('plName');
    if (pname) pname.addEventListener('click', startRename);
    var prok = $('plRenameOk');
    if (prok) prok.addEventListener('click', commitRename);
    var prcancel = $('plRenameCancel');
    if (prcancel) prcancel.addEventListener('click', function () { $('plRenameRow').hidden = true; });
    var pinput = $('plRenameInput');
    if (pinput) pinput.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); commitRename(); } });
    var pplay = $('plPlayAll');
    if (pplay) pplay.addEventListener('click', function () { playAt('pl', 0); });
    var pdel = $('plDel');
    if (pdel) pdel.addEventListener('click', deletePl);

    var anb = $('addNewBtn');
    if (anb) anb.addEventListener('click', addNewFromSheet);
    var anin = $('addNewName');
    if (anin) anin.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); addNewFromSheet(); } });

    var sb = $('settingsBody');
    if (sb) {
      sb.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var lg = t.closest('[data-login]');
        if (lg) { doLogin(lg.getAttribute('data-login')); return; }
        var lo = t.closest('[data-logout]');
        if (lo) { doLogout(lo.getAttribute('data-logout')); return; }
        if (t.id === 'ciBtn') { importCookie(); return; }
        if (t.closest('#settingsClearRecent')) { closeSheet('settingsSheet'); setView('recent'); clearRecent(); }
      });
    }

    var bplay = $('btnPlay');
    if (bplay) bplay.addEventListener('click', togglePlay);
    var bnext = $('btnNext');
    if (bnext) bnext.addEventListener('click', function () { nextTrack(1); });
    var bprev = $('btnPrev');
    if (bprev) bprev.addEventListener('click', function () { nextTrack(-1); });
    var bfav = $('btnFav');
    if (bfav) bfav.addEventListener('click', function () {
      var it = currentItem();
      if (it) toggleFav(it);
    });
    var bly = $('btnLyrics');
    if (bly) bly.addEventListener('click', openLyrics);

    var bvol = $('btnVol');
    if (bvol) bvol.addEventListener('click', function () {
      if (!P || !P.audio) return;
      st.muted = !st.muted;
      P.audio.muted = st.muted;
      bvol.title = st.muted ? '取消静音' : '静音';
      bvol.style.opacity = st.muted ? '.5' : '';
    });

    var seek = $('seek');
    if (seek) {
      seek.addEventListener('input', function () {
        st.seeking = true;
        var d = currentDur();
        $('tCur').textContent = fmtSec(d * (this.value / 1000));
      });
      seek.addEventListener('change', function () {
        var r = this.value / 1000;
        st.seeking = false;
        if (st.demo) { st.demoSec = currentDur() * r; onTime(st.demoSec, currentDur()); }
        else if (P) P.seekRatio(r);
      });
    }

    var lyBody = $('lyricsBody');
    if (lyBody) {
      lyBody.addEventListener('click', function (e) {
        var line = e.target.closest ? e.target.closest('.ly-line[data-t]') : null;
        if (!line) return;
        var t = parseFloat(line.getAttribute('data-t')) || 0;
        if (st.demo) { st.demoSec = t; onTime(t, currentDur()); }
        else if (P && P.audio) { try { P.audio.currentTime = t; } catch (err) { /* ignore */ } }
        st.lyr.idx = -2;
        lyricTick(t);
      });
      lyBody.addEventListener('scroll', function () {
        if (!st.lyr.prog) st.lyr.lock = Date.now() + 5000;
      });
    }

    document.addEventListener('click', onDocClick);

    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Escape' || e.keyCode === 27) { closeTopSheet(); return; }
      if (typing) return;
      var scope = scopeOfView();
      var items = itemsOf(scope);
      if (e.key === 'ArrowDown' || e.keyCode === 40) {
        if (!items.length) return;
        e.preventDefault();
        st.sel = Math.min(items.length - 1, st.sel + 1);
        selRow(st.sel);
      } else if (e.key === 'ArrowUp' || e.keyCode === 38) {
        if (!items.length) return;
        e.preventDefault();
        st.sel = Math.max(0, st.sel - 1);
        selRow(st.sel);
      } else if (e.key === 'Enter' || e.keyCode === 13) {
        if (st.sel >= 0 && st.sel < items.length) { e.preventDefault(); playAt(scope, st.sel); }
      } else if (e.key === ' ' || e.keyCode === 32) {
        if (currentItem()) { e.preventDefault(); togglePlay(); }
      }
    });
  }

  function selRow(i) {
    var rows = document.querySelectorAll('.row[data-i]');
    for (var k = 0; k < rows.length; k++) {
      var on = parseInt(rows[k].getAttribute('data-i'), 10) === i;
      rows[k].classList.toggle('sel', on);
      if (on && rows[k].scrollIntoView) {
        try { rows[k].scrollIntoView({ block: 'nearest' }); } catch (e) { rows[k].scrollIntoView(); }
      }
    }
  }

  /* ---------------- 播放器事件 ---------------- */
  function wirePlayer() {
    if (!P || typeof P.on !== 'function') return;
    P.on('item', function () {
      updatePlayerBar();
      markPlaying();
      if (st.lyr.open) {
        var it = currentItem();
        if (it) $('lyTitle').textContent = it.name || '歌词';
        loadLyrics(false);
      }
    });
    P.on('resolving', updatePlayerBar);
    P.on('state', updatePlayerBar);
    P.on('source', function () {
      if (P.item && L) L.pushRecent(P.item);
      updatePlayerBar();
      if (st.lyr.open) loadLyrics(false);
    });
    P.on('time', function (d) { if (d) onTime(d.current || 0, d.duration || 0); });
    P.on('error', function (msg) { toast(String(msg || '播放失败'), { err: true }); updatePlayerBar(); });
  }

  function onLibChange() {
    updateCounts();
    if (st.view === 'fav') renderFav();
    else if (st.view === 'playlists') renderPlaylists();
    else if (st.view === 'playlist') renderPlaylistDetail();
    else if (st.view === 'recent') renderRecent();
    var cur = currentItem();
    if (cur && L) $('btnFav').classList.toggle('on', !!L.isFav(cur));
  }

  /* ---------------- 启动 ---------------- */
  function readParams() {
    var out = {};
    var s = String(location.search || '').replace(/^\?/, '');
    if (!s) return out;
    var parts = s.split('&');
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var kv = parts[i].split('=');
      var k = kv[0];
      try { k = decodeURIComponent(k); } catch (e) { /* ignore */ }
      var v = kv.length > 1 ? kv.slice(1).join('=') : '';
      try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e2) { /* ignore */ }
      out[k] = v;
    }
    return out;
  }

  function boot() {
    bindStatic();
    var params = readParams();
    st.demo = params.demo === '1';
    if (st.demo) st.results = DEMO_ITEMS.slice();

    setView('search');
    if (params.q) {
      $('q').value = params.q;
      doSearch();
    } else {
      renderSearch();
    }
    updatePlayerBar();
    wirePlayer();

    if (L) {
      try { L.on('change', onLibChange); } catch (e) { /* ignore */ }
      Promise.resolve(L.ready).then(function () {
        updateCounts();
        renderCurrent();
      }, function () { updateCounts(); });
    }
    if (st.demo) toast('演示模式：歌曲与歌词都是内置数据');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
