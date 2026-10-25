# 音匣 MusicBox — 设计文档（Lead 维护，任何人改动需在群里说明）

三平台（网易云 / QQ音乐 / 酷狗）聚合音乐播放器，Android + Windows 双端。
**UI 简单、体积小、不花哨**；同名同作者优先 QQ/酷狗音源。

---

## 1. 实测结论（2026-10-25 探针，脚本在 `probe/`）

| 能力 | 网易云 | QQ音乐 | 酷狗 |
|---|---|---|---|
| 搜索（匿名） | ✅ `GET https://music.163.com/api/cloudsearch/pc?s=&type=1&limit=&offset=` | ✅ `GET https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=30&w=&format=json` | ✅ `GET https://songsearch.kugou.com/song_search_v2?keyword=&page=1&pagesize=30&platform=WebFilter&tag=em&filter=2&iscorrection=1&privilege_filter=0` |
| 播放地址（匿名） | ✅ 免费曲（`fee==0 && privilege.pl>0`）走 `GET https://music.163.com/api/song/enhance/player/url?ids=[id]&br=128000`，返回 CDN mp3，**HEAD 200 audio/mpeg，不需要 Referer** | ❌ 匿名 `musicu.fcg GetVkey` 的 `purl` 恒为空（sip 也为空）→ **必须登录 cookie** | ⚠️ 仅 `Privilege==8` 的曲目能取到；`Privilege==10`（付费/VIP）匿名失败 |

酷狗取地址两条链路（都试，取到即用）：
1. `https://trackercdn.kugou.com/i/v2/?key=<md5(FileHash+'kgcloudv2')>&hash=<FileHash>&br=hq&appid=1005&pid=2&cmd=25&behavior=play` → `url[]`
2. `https://m3ws.kugou.com/api/v1/song/get_song_info?cmd=playInfo&hash=<FileHash>` → `url`

QQ 登录后取地址：`POST https://u.y.qq.com/cgi-bin/musicu.fcg`
body: `{"req":{"module":"music.vkey.GetVkey","method":"UrlGetVkey","param":{"guid":"<10位随机>","songmid":["<mid>"],"songtype":[0],"uin":"<uin>","loginflag":1,"platform":"20"}},"comm":{"uin":"<uin>","format":"json","ct":24,"cv":0}}`
→ `req.data.midurlinfo[0].purl` 非空时拼 `req.data.sip[0] + purl`。

**注意字段：** 酷狗 `SongName` 含 `<em>` 高亮标签，必须 strip；QQ 老搜索接口无 `pay/fee` 字段。

## 2. 目录结构

```
D:/ds工作区/musicapp/
  DESIGN.md              本节文档
  web/                   共享前端（两端共用，唯一 UI 来源）
    index.html
    css/app.css
    js/bridge.js         桥接协议客户端（只此一处）
    js/http.js           统一 HTTP（走 bridge）
    js/providers/        netease.js qq.js kugou.js index.js
    js/core/             merge.js（去重+优先）player.js（回退链）store.js
    js/ui/app.js         界面
  android/               Android 壳（Kotlin，不用 Compose）
  windows/               Windows 壳（C# 5 + WinForms + WebView2）
  vendor/wv2/            已解包的 WebView2 SDK（勿提交改动）
  probe/                 实测探针脚本（保留）
  tools/                 构建脚本
  dist/                  产物：dist/android/*.apk、dist/windows/
```

## 3. 桥接协议（两端必须逐字一致）

**页面地址：`https://app.local/index.html`**（两端都把 web/ 目录映射到该虚拟域名，页面同源，避免 CORS）。

### 3.1 静态资源
- 请求 `https://app.local/<path>` → 从 `web/` 目录（Windows）或 `assets/web/`（Android）读取返回。
- MIME 至少要覆盖：html/css/js/json/svg/png/woff2。

### 3.2 HTTP 代理
```
POST https://app.local/api/proxy
Content-Type: application/json
{
  "platform": "netease|qq|kugou",   // 决定带上哪个平台的 cookie 罐，可省略
  "url": "https://...",              // 目标地址（http/https）
  "method": "GET|POST",
  "headers": {"Referer":"...", "User-Agent":"..."},
  "body": "原始字符串"                // 可选
}
→ 200 application/json
{ "status": 200, "headers": {"content-type":"..."}, "body": "原始响应字符串" }
失败： { "status": 0, "error": "原因" }
```
- 响应 body 一律按 UTF-8 文本返回（音乐接口都是文本/JSON）。
- 平台 Cookie 由原生侧注入，JS **不接触 cookie 值**。

### 3.3 登录（内嵌登录页抓 cookie）
```
POST https://app.local/api/login   {"platform":"netease|qq|kugou"}
→ {"ok":true,"cookieCount":3,"platform":"netease"}
```
原生侧：打开一个内嵌 WebView 到该平台官网登录页，用户登录/关闭后从 CookieManager 抓取该域 cookie 并合并进原生 cookie 罐。

### 3.4 状态与存储
```
POST https://app.local/api/state   {}
→ {"platforms":{
     "netease":{"loggedIn":true,"userId":"<可选>"},
     "qq":{"loggedIn":true,"uin":"<可选，QQ号>"},
     "kugou":{"loggedIn":false}
   },"version":"1.0.0"}
GET  https://app.local/api/kv?key=xxx        → {"value":"..."}
POST https://app.local/api/kv  {"key":"x","value":"y"} → {"ok":true}
```
- `uin` / `userId` 是接口必需参数（QQ 的 GetVkey 要 uin），**不是密钥**，可以返回给 JS；其它 cookie 值绝不出原生层。
- 从 cookie 里能解析出 uin 就填，解析不出就省略。

### 3.5 手动导入 Cookie（登录失败时的兜底，QQ 尤其需要）
```
POST https://app.local/api/cookie  {"platform":"qq","cookie":"k1=v1; k2=v2"} → {"ok":true,"cookieCount":2}
```
原生侧把该串解析成键值对合并进平台 cookie 罐（覆盖同名键）。UI 在设置页提供折叠的输入框，
提示用户从浏览器（已登录状态）复制 cookie。**cookie 字符串不要写日志、不要回显。**


## 4. 前端约定

- 纯原生 JS（无框架、无构建步骤），Chromium 内核直出。总体积目标 < 300KB。
- `bridge.js` 暴露：
  ```js
  const resp = await Bridge.proxy({platform, url, method, headers, body}); // → {status, body}，body 为字符串
  const j = await Bridge.proxyJson({...});                                // status!=200 抛错
  await Bridge.login(platform); await Bridge.state(); await Bridge.kvGet(k); await Bridge.kvSet(k,v);
  ```
- `providers/<x>.js` 统一导出：
  ```js
  window.Provider_qq = {
    id: 'qq', label: 'QQ音乐',
    async search(keyword, page=1) -> Song[],       // 失败返回 []，不抛
    async resolveUrl(song) -> {url, quality?}|null,
  }
  ```
  Song 统一结构：
  ```js
  { platform:'qq', id:'<songmid>', name, artists:[..], album, durationMs, coverUrl, vip:bool, raw:{} }
  ```
- 合并规则（`core/merge.js`）：key = normalize(name) + '|' + normalize(artists.join('/'))；
  normalize = 全角转半角、小写、去首尾空格、压缩空白、去 `(feat. ...)` 之外不做激进剪裁。
  同一 key 的多个平台条目合成一条 `Playable`，`sources` 按 **QQ > 酷狗 > 网易云** 排序（用户要求）。
  播放时按 sources 顺序逐个 `resolveUrl`，取到即可播；全失败则提示「无可用音源」。
- 播放器：`<audio>` 直连 CDN 地址（已验证无 Referer 要求）。

## 5. 环境与构建

- Node v24.20.0；JDK17 `D:/小说项目/tools/jdk17`；Gradle 8.7 `D:/小说项目/tools/gradle-8.7`；
  Android SDK `D:/小说项目/android-sdk`（platforms android-34、build-tools 34.0.0）；
  `GRADLE_USER_HOME=D:/小说项目/gradle-home`（已缓存 AGP 8.5.2 / Kotlin 2.0.21，**构建请加 `--offline`**）。
- Windows 无 .NET SDK/无 MSVC：用系统自带 `C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe`（C# 5，`async/await` 可用，**不可用字符串插值、?.、nameof**）+ `vendor/wv2/`（WebView2 SDK，`lib/net462` 两个 dll + `runtimes/win-x64/native/WebView2Loader.dll`）。
- 网络很慢的域名：`codeload.github.com`、`cdn.jsdelivr.net`、`raw.githubusercontent.com`（会超时）。
  `api.nuget.org`、`api.github.com`、音乐接口都很快。

## 6. 验收

1. Android：`gradlew assembleDebug` 成功，APK 落在 `dist/android/`，可安装启动，能搜到三平台歌并播放。
2. Windows：`tools/build_win.bat` 成功，`dist/windows/MusicBox.exe` 启动显示界面，能搜能播。
3. 断网/接口失败时 UI 不白屏，给出可读错误。

## 7. 已知限制（不得隐瞒，要写进 UI 设置页）

- QQ 音乐匿名 100% 不可播，**必须导入/登录 cookie**；VIP 曲目即使登录也可能无版权。
- 酷狗 `Privilege=10` 曲目匿名不可播。
- 网易云 VIP 曲目匿名不可播。

## 8. 实现偏差与实测记录（截至交付）

以下与最初设计不同，属于**实现时发现必须这样**，后来的维护者不要再改回去：

1. **Windows 端不能用 `SetVirtualHostNameToFolderMapping` 提供页面**。
   实测：映射后的主机不会触发 `WebResourceRequested`，于是 `https://app.local/api/*` 全被文件夹
   映射吞掉、页面里 fetch 全部 "Failed to fetch"。改为**用 `WebResourceRequested` 自己服务
   `https://app.local/*`**（内置 MIME 表 + 路径穿越校验 + 404），对外 URL 形态不变。
2. **`Bridge` 的虚拟域名要按页面 host 判断**（`web/js/bridge.js`）：host 是 `app.local` 时用
   `https://app.local`，否则用同源相对路径。这样同一份前端既能跑在壳里，也能在
   `node tools/devserver.mjs` 的浏览器里调试。
3. **`merge.js` 同一平台在同一首歌里只保留一条**。网易云/酷狗同一次搜索会返回同一首歌的多个
   id，不额外去重会出现「QQ 酷狗 网易 网易」这种重复徽章。
4. **Windows 壳必须加浏览器参数 `--autoplay-policy=no-user-gesture-required`**
   （`CoreWebView2EnvironmentOptions` 的 additionalBrowserArguments）。否则 `audio.play()`
   在 resolveUrl 成功后仍被自动播放策略拦下（实测：duration 已加载 140s，currentTime 一直是 0），
   自动下一首也播不了。建议同串再加 `--allow-running-insecure-content`（音频直链是 http 明文）。
5. **音频直链是 http 明文**，页面在 https 下：安卓必须 `setMixedContentMode(MIXED_CONTENT_ALWAYS_ALLOW)`
   + `setMediaPlaybackRequiresUserGesture(false)`。
6. 实测可播性（2026-10-25，匿名）：网易云免费曲 5/5 可播；酷狗免费曲（Privilege=8）5/5 可播；
   QQ 匿名榜单前 5 只有个别免费曲可播（time-window vkey 波动），其余必须登录。
7. 端到端已验证：Windows exe 内通过 CDP 真实点击行 → `audio.currentTime` 前进（115.9s 曲目）、
   页面在 WebView2 中渲染正常；浏览器里同样验证通过。

## 9. v1.1 增补（2026-10-25 晚：用户要求「歌单/收藏/基础功能 + UI 重做 + 歌词」）

### 9.1 新增两个前端核心模块（`web/js/core/`）

| 文件 | 职责 | 持久化 |
|---|---|---|
| `library.js` | 收藏 / 自建歌单 / 最近播放 | 单个 kv 键 `mb.library.v1`，JSON `{fav:[],playlists:[],recent:[]}` |
| `lyrics.js` | LRC 解析、按音源优先级回退抓歌词、当前行定位 | 内存缓存（按 `playable.key`） |

- **必须存「瘦身快照」**：`Playable` 里的 `song.raw` 是平台原始返回，单首可达数 KB；
  直接 `JSON.stringify` 存档会把 Android SharedPreferences / kv.json 撑爆。`library.js`
  的 `slim()/slimPlayable()` 只保留播放与歌词必需字段（酷狗 `hash`、`raw.Privilege`）。
- 容量上限：收藏 500、最近播放 200、单歌单 800 首。
- 写入 debounce（收藏/歌单 0–350ms，最近播放 1s），并在 `pagehide`/`beforeunload`/
  `visibilitychange(hidden)` 时 `flush()` 立即落盘。
- 存储键只有一个 → 桥接协议**无需新增端点**，`/api/kv` 原样够用。

`Library` 关键 API：`ready`（Promise）、`isFav/toggleFav/removeFav/favList`、
`playlists/getPlaylist/createPlaylist/renamePlaylist/deletePlaylist/addToPlaylist/
removeFromPlaylist/playlistOf`、`recent/pushRecent/clearRecent`、`stats`、`on('change')`。

`Lyrics` 关键 API：`parse(text)`、`fetch(playable)`、`indexAt(lines, sec)`、`peek(playable)`、`clearCache(key)`。

### 9.2 provider 新增歌词接口

- 三个 provider 都新增 `async lyric(song) -> {text, source} | null`，失败一律返回 `null` 不抛。
  返回的 `text` 是**带时间轴的原生 LRC**（行首保留 `[mm:ss.xx]` / `[mm:ss.SSS]`）。
- `index.js` 新增便捷入口 `window.providerLyric(song)`（内部按 provider 分发，永不抛）。
- 匿名实测（2026-10-25）：QQ / 酷狗 / 网易云 **3/3 平台匿名可取到带时间轴歌词**（晴天、小星星、起风了三首全部命中）。
  - 网易云：`api/song/lyric?id=&lv=-1&kv=-1&tv=-1` → `lrc.lyric`
  - QQ：`fcg_query_lyric_new.fcg?songmid=&format=json&nobase64=1&g_tk=5381`（Referer y.qq.com；明文优先，base64 回退）
  - 酷狗两步：`krcs.kugou.com/search`（**hash + duration 必传**）→ `lyrics.kugou.com/download`（base64 LRC）
- 酷狗 `Song` 新增 `hash` 字段（= FileHash）；`library.js` 的快照会保留它，否则重载后酷狗歌词抓不到。

### 9.3 UI v2 规格

见 `UI_SPEC.md`（4 视图 + 歌词/设置/加入歌单 3 个覆盖层 + 响应式 + DOM 契约）。
DOM 契约（`#q`、`#list [data-i]`、`.name/.sub/.tag`、`#btnPlay`、`#tCur/#tDur`、`#seek`）
是 `probe/cdp_play_test.mjs` 的驱动接口，改 UI 时必须保留。

### 9.4 测试

- `node tools/test_merge.mjs` —— 合并/优先级 9 项
- `node tools/test_library.mjs` —— 收藏/歌单/最近/持久化/歌词解析与回退 51 项
- `node probe/provider_test.mjs`、`node probe/lyric_test.mjs`、`node probe/web_proxy_test.mjs`
- Windows 端到端：`probe/cdp_play_test.mjs`（CDP 驱动真实 exe）

## 10. v1.1 交付状态与端到端验证（2026-10-25 傍晚）

### 10.1 本轮改动

| 模块 | 文件 | 说明 |
|---|---|---|
| 数据层 | `web/js/core/library.js`（8.9KB） | 收藏 / 自建歌单 / 最近播放，单 kv 键 `mb.library.v1`，debounce + `flush()` + `pagehide` 兜底 |
| 数据层 | `web/js/core/lyrics.js`（4.9KB） | LRC 解析（多标签、`[offset:]`、毫秒精度）、按音源顺序回退、inflight 去重、null 缓存 |
| 接口层 | `web/js/providers/*.js` | 每平台新增 `lyric(song)`：QQ `fcg_query_lyric_new.fcg`、酷狗 `krcs`+歌词下载、网易云 `/api/song/lyric` |
| 界面层 | `web/index.html` / `css/app.css` / `js/ui/app.js` | 4 视图 + 3 覆盖层重做，封面渲染、遮罩毛玻璃、双行错误 toast、移动端底部 tab |

最终体积：`index.html` 11923B + `app.css` 25708B + `app.js` 50921B = **88552B**（前端总量），
APK 84952B，Windows exe 62976B（含图标）。

### 10.2 Windows 壳端到端（真实 exe + CDP，`probe/verify_shell.mjs`）

```
CDP_PORT=9334 node probe/verify_shell.mjs 小星星   → RESULT: PASS (18)
```

覆盖：冷启动无面板展开（`visible:0`、播放条 hidden）→ 搜索 67 行 → 首行 `name/sub/tags`
结构（`tags:["QQ"]`）→ **真实鼠标点行播放成功**（`state=playing`、`t=1.08s`、
`dur=115.89s`、`src=qq`）→ 歌词面板 19 行带时间轴 → ♥ 收藏 → 新建歌单并加入 →
歌单详情 → **`Page.reload` 后收藏/歌单/最近播放全部仍在（真 KV 持久化）** → 设置面板。
截图：`probe/win_{search,playing,lyrics,playlist,settings}.png`。

（同一脚本在 `晴天` 关键词下 16/17——行 0–5 全是 VIP 曲目、匿名拿不到地址，
唯一失败项「最近播放」因没有真实播放而跳过；这属于账号限制，不是代码缺陷。）

### 10.3 Android 端

APK 已用新前端重建：`dist/android/yinxia-1.0.0-debug.apk` 84952B，
sha256 `7d8ff682e3f96ea213012cbb123b3a2af919f0b0767c65b5a4f0b97bee3f2d5a`，
`unzip -l` 确认 `assets/web/js/core/{library,lyrics}.js` 与 12 个 web 资源全在包内。
桥接端点 `BridgeServer.java:246-260` 覆盖 `/api/kv`（GET/POST）、`/api/state`、
`/api/logout`、`/api/cookie`、`/api/proxy`、`/api/login`。

**运行时仍未验证**：本机无可用模拟器（x86_64 镜像需硬件加速，AEHD 未安装、WHPX 需管理员）
且无真机。诚实标注为「编译 + 静态内容 + 代码路径已验证，运行时未验证」。

### 10.4 未做 / 待决定

- 安卓真机/模拟器联调（需要用户提供设备或允许安装虚拟化驱动）。
- 下载、后台播放服务、加载更多、跨设备同步。
- 二进制产物（exe/apk/png）未提交到 GitHub（本机无 git 凭据，MCP 只能推文本）。
