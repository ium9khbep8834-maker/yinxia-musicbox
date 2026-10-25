/* 播放器：音源回退链（QQ > 酷狗 > 网易云 依次尝试）+ 队列管理 */
(function () {
  'use strict';

  var URL_TTL = 25 * 60 * 1000;     // 解析出的直链缓存 25 分钟（CDN 直链有时效）
  var urlCache = {};                // key -> {url, source, at}

  function cacheGet(key) {
    var c = urlCache[key];
    if (!c) return null;
    if (Date.now() - c.at > URL_TTL) { delete urlCache[key]; return null; }
    return c;
  }
  function cacheSet(key, val) { urlCache[key] = { url: val.url, source: val.source, at: Date.now() }; }

  function providerOf(id) {
    var list = window.Providers || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function Player() {
    var self = this;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.queue = [];
    this.index = -1;
    this.item = null;      // 当前 Playable
    this.source = null;    // 当前实际使用的 Song
    this.state = 'idle';   // idle|resolving|loading|playing|paused|error
    this.listeners = {};
    this._seq = 0;

    this.audio.addEventListener('playing', function () { self._setState('playing'); });
    this.audio.addEventListener('pause', function () { if (self.state !== 'idle' && self.state !== 'resolving') self._setState('paused'); });
    this.audio.addEventListener('ended', function () { self.next(true); });
    this.audio.addEventListener('timeupdate', function () {
      self._emit('time', { current: self.audio.currentTime || 0, duration: self.audio.duration || 0 });
    });
    this.audio.addEventListener('loadedmetadata', function () {
      self._emit('time', { current: 0, duration: self.audio.duration || 0 });
    });
    this.audio.addEventListener('error', function () {
      // 直链失效：丢弃缓存并尝试下一个音源
      if (self.item && self.source) delete urlCache[self.item.key];
      self._emit('error', '音频加载失败，尝试其它音源');
      self._fallbackRetry();
    });
  }

  Player.prototype.on = function (ev, fn) {
    (this.listeners[ev] || (this.listeners[ev] = [])).push(fn);
    return this;
  };
  Player.prototype._emit = function (ev, data) {
    var l = this.listeners[ev] || [];
    for (var i = 0; i < l.length; i++) { try { l[i](data); } catch (e) { console.warn(e); } }
  };
  Player.prototype._setState = function (s) {
    if (this.state === s) return;
    this.state = s;
    this._emit('state', s);
  };

  /** 按优先级尝试每个平台的音源，返回 {url, source} 或 null */
  Player.prototype._resolve = async function (item, skipPlatforms) {
    var sources = item.sources || [];
    var reasons = [];
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      if (skipPlatforms && skipPlatforms.indexOf(s.platform) >= 0) continue;
      var p = providerOf(s.platform);
      if (!p) { reasons.push(s.platform + ':无 provider'); continue; }
      try {
        var r = await p.resolveUrl(s);
        if (r && r.url) return { url: r.url, source: s, reason: null };
        reasons.push(s.platform + ':' + ((r && r.reason) || '无音源'));
      } catch (e) {
        reasons.push(s.platform + ':' + (e && e.message ? e.message : '请求失败'));
      }
    }
    return { url: null, source: null, reason: reasons.join(' / ') };
  };

  Player.prototype.playPlayable = async function (item, queue) {
    if (queue && queue.length) this.queue = queue.slice();
    if (item) {
      var idx = -1;
      for (var i = 0; i < this.queue.length; i++) if (this.queue[i].key === item.key) { idx = i; break; }
      if (idx < 0) { this.queue.push(item); idx = this.queue.length - 1; }
      this.index = idx;
    }
    if (this.index < 0 || !this.queue[this.index]) return;
    this.item = this.queue[this.index];
    this._emit('item', this.item);
    this._setState('resolving');
    this._emit('resolving', this.item);

    var seq = ++this._seq;
    var cached = cacheGet(this.item.key);
    var got = cached
      ? { url: cached.url, source: cached.source, reason: null }
      : await this._resolve(this.item, null);
    if (seq !== this._seq) return; // 已被后续操作取代

    if (!got.url) {
      this.source = null;
      this._setState('error');
      this._emit('error', '没有可用音源：' + (got.reason || '未知'));
      return;
    }
    cacheSet(this.item.key, got);
    this.source = got.source;
    this._emit('source', got.source);
    this.audio.src = got.url;
    this._setState('loading');
    try {
      await this.audio.play();
    } catch (e) {
      // play() 被拒绝（自动播放策略）或加载失败
      this._setState('paused');
      this._emit('error', '无法播放：' + (e && e.message ? e.message : e));
    }
  };

  Player.prototype._fallbackRetry = function () {
    var self = this;
    if (!this.item) return;
    var skip = this.source ? [this.source.platform] : [];
    this._setState('resolving');
    this._resolve(this.item, skip).then(function (got) {
      if (!got.url) { self._setState('error'); self._emit('error', '所有音源均不可用'); return; }
      cacheSet(self.item.key, got);
      self.source = got.source;
      self._emit('source', got.source);
      self.audio.src = got.url;
      self.audio.play().catch(function () { self._setState('paused'); });
    });
  };

  Player.prototype.next = function (auto) {
    if (!this.queue.length) return;
    this.index = (this.index + 1) % this.queue.length;
    this.playPlayable(null, null);
  };
  Player.prototype.prev = function () {
    if (!this.queue.length) return;
    this.index = (this.index - 1 + this.queue.length) % this.queue.length;
    this.playPlayable(null, null);
  };
  Player.prototype.toggle = function () {
    if (!this.item) return;
    if (this.audio.paused) { this.audio.play().catch(function () {}); }
    else this.audio.pause();
  };
  Player.prototype.seekRatio = function (r) {
    var d = this.audio.duration;
    if (d && isFinite(d)) this.audio.currentTime = Math.max(0, Math.min(1, r)) * d;
  };

  window.Player = new Player();
})();
