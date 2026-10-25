# UI v2 规格（web-ui 任务书）

> 读者：负责重做 `web/index.html`、`web/css/app.css`、`web/js/ui/app.js` 的实现者。
> 目标：把当前「能跑但简陋」的界面升级成「小而美」的成品音乐播放器，并接上
> 收藏 / 自建歌单 / 最近播放 / 歌词 四项新功能。
> 权威架构文档：`musicapp/DESIGN.md`（桥接协议、provider 契约）。

## 0. 用户原话（必须满足）

- m00429：「最起码要加入歌单功能和收藏等音乐软件的基础功能吧 而且你这ui写的有点太简陋了」
- m00430：「而且歌词也看不了」

## 1. 审美基调

- 深色、克制、留白多。**不要**花哨动画、不要彩色大色块、不要 emoji 当图标（用内联 SVG）。
- 参考质感：Spotify / Apple Music 的深色版，但更轻。字号层级清楚，圆角统一，行高舒服。
- 所有图标用内联 `<svg>`（stroke 1.7，currentColor），不用图标字体、不引外部资源（离线可用）。
- 单文件体积意识：CSS 目标 < 18KB，app.js 目标 < 30KB，总计前端 < 90KB（现在约 55KB）。

## 2. 布局

断点：`@media (max-width: 760px)` 为移动端。

**桌面（>760px）**

```
┌──────────────────────────────────────────────────────────────┐
│ [♪ 音匣]   [🔍 搜索歌曲 / 歌手............]        [⚙]        │  56px
├────────────┬─────────────────────────────────────────────────┤
│ 搜索        │  (搜索视图) 平台 chips: 全部 QQ 酷狗 网易        │
│ 收藏        │  结果列表                                       │
│ 歌单        │                                                 │
│ 最近播放    │                                                 │
│ 200px      │                                                 │
├────────────┴─────────────────────────────────────────────────┤
│ [封面] 歌名 歌手 · QQ    ♥ 词   ⏮ ▶ ⏭   0:03 ──●── 1:55  🔊 │  72px
└──────────────────────────────────────────────────────────────┘
```

**移动（≤760px）**

- 顶栏只留：品牌小标 + 搜索框（继续用）；设置齿轮缩小。
- 左侧导航变成**底部 tab bar**（4 项：搜索/收藏/歌单/最近），高 56px，safe-area 内边距。
- 播放条是**迷你条**，浮在 tab bar 上方，高 60px：封面 40 + 歌名/歌手 + ▶ + ♥ + 词。
- 歌词、设置、加入歌单都是**全屏/底部抽屉**（`position:fixed; inset:0` 或 `bottom:0; border-radius:16px 16px 0 0`）。

## 3. 视图（4 个 + 3 个覆盖层）

### 3.1 搜索视图（默认）
- 平台 chips 单选（全部/QQ/酷狗/网易），保留「全部」时显示合并结果。
- 列表行（桌面 64px 高，移动 60px）：
  - 左：序号（灰、等宽数字，播放中的行换成 3 根跳动的柱子，用 CSS animation）；或封面 40px 圆角 8（有 coverUrl 时显示封面，加载失败回退到音符占位）。
  - 中：`歌名`（15px，500）+ 可选 `VIP` 小徽章（10px，金色描边）；第二行 `歌手 · 专辑`（12.5px，次要色，超出省略）。
  - 右：平台徽章（`.tag`：`QQ`/`酷狗`/`网易`，按 sources 顺序显示**全部**平台，最多 3 个，色描边不同——QQ 绿、酷狗蓝、网易红，低饱和）；时长（12px 次要色）；`♥` 收藏按钮；`⋯` 更多按钮。桌面默认只显示时长，hover 时淡入 ♥/⋯（触摸端常显）。
  - 当前播放行整行高亮（`background: rgba(91,140,255,.08)` + 左侧 2px 强调条）。
- 搜索中显示骨架屏（3~5 行灰色脉冲块），不要只显示「搜索中…」。
- 空态：居中 SVG + 文案「输入歌名开始，三个平台一次搜完」。
- 无结果：「没找到「xxx」，换个关键词试试」。
- 键盘：桌面 ↑↓ 移动选中、Enter 播放（可选加分项，不强制）。

### 3.2 收藏视图
- 标题「我的收藏」+ 右侧「播放全部」。
- 列表行同上（无序号，有封面），右侧多「移出收藏」。
- 空态：「还没有收藏的歌曲 / 点歌名右侧的 ♥ 收进来」。

### 3.3 歌单视图
- 顶部「新建歌单」按钮 → 内联输入行（不要 `prompt()`）。
- 卡片网格（桌面 4 列、移动 2 列）：封面（取第一首歌封面，无则渐变占位）+ 名称 + 「N 首」。点卡片进入歌单详情。
- 详情：返回按钮 + 大封面 + 名称（可点击重命名）+ 首数 + 「播放全部」+「删除歌单」（二次确认用内联确认条，不用 `confirm()`）。
- 详情歌曲列表：行右侧「从歌单移除」。
- 空歌单文案：「歌单还是空的，去搜索页用 ⋯ 加歌」。

### 3.4 最近播放
- 「清空」按钮（内联二次确认）。
- 上限 200 首，按最近播放倒序。

### 3.5 覆盖层 A：歌词（`#lyricsSheet`）
- 全高（桌面中间 62% 宽、圆角 16；移动全屏）。
- 头部：歌名 + 歌手 + 关闭按钮。
- 主体：滚动容器，行 26px 唱歌词（无歌词行显示原样），当前行 20px→ 高亮强调色 + 加粗 + 轻微放大；`scrollIntoView({block:'center', behavior:'smooth'})` 但**用户手动滚动后 5 秒内不自动滚**。
- 点某行 → `Player.audio.currentTime = line.t`。
- 无歌词：「暂无歌词 / 这首歌三个平台都没给出时间轴歌词」+ 重试按钮。
- 打开时若尚未抓取，显示「歌词加载中…」+ 3 个点的动画。

### 3.6 覆盖层 B：设置（`#settingsSheet`）
保留现有功能：三平台登录状态 + 登录/退出 + 手动导入 Cookie + 版本号 + 库统计（`Library.stats()`）+ 清空最近播放。样式重做，不要变功能。

### 3.7 覆盖层 C：加入歌单（`#addSheet`）
- 头部显示目标歌曲名。
- 勾选列表：每个歌单一行，已在其中显示勾。
- 底部「新建歌单并加入」内联输入。
- 支持同时加入多个歌单（勾选即生效，关闭即完成）。

## 4. DOM 契约（测试脚本依赖，**不要改名**）

`probe/cdp_play_test.mjs` 会按这些选择器驱动 UI：

| 选择器 | 含义 |
|---|---|
| `#q` | 搜索输入框（`input[type=search]`） |
| `#btnSearch` | 搜索按钮 |
| `#list` | 结果列表容器 |
| `#list [data-i="<n>"]` | 第 n 行（0 起），必须是可点击行元素 |
| 行内 `.name` | 歌名文本节点 |
| 行内 `.sub` | 「歌手 · 专辑」文本 |
| 行内 `.tag` | 平台徽章，文本必须是 `QQ`/`酷狗`/`网易` |
| `#btnPlay` | 播放/暂停按钮 |
| `#tCur` / `#tDur` | 当前/总时长文本 |
| `#seek` | 进度条（`input[type=range]`） |

新增元素建议统一用 `data-el`（如 `[data-el="nav-search"]`）以便自测。

## 5. 数据 API（已存在，直接用；不要重写这些文件）

```js
// 搜索：三平台并发，失败平台忽略
var groups = await Promise.all(window.Providers.map(function (p) {
  return p.search(q).then(function (r) { return { platform: p.id, songs: r || [] }; },
                          function () { return { platform: p.id, songs: [] }; });
}));
var items = window.mergeResults(groups);       // Playable[]，sources 已按 QQ>酷狗>网易 排好

// 播放
window.Player.playPlayable(item, queue);       // queue = 当前可见列表
window.Player.on('time'|'state'|'item'|'source'|'error'|'resolving', fn)
window.Player.toggle(); window.Player.next(); window.Player.prev();
window.Player.audio; window.Player.state; window.Player.item; window.Player.source;

// 收藏 / 歌单 / 最近（这是我写的新模块，用前先 await Library.ready）
window.Library.isFav(item); window.Library.toggleFav(item) -> bool;
window.Library.favList(); window.Library.on('change', renderAll);
window.Library.createPlaylist(name); window.Library.addToPlaylist(id,item);
window.Library.removeFromPlaylist(id,key); window.Library.deletePlaylist(id);
window.Library.renamePlaylist(id,name); window.Library.playlistOf(item) -> id[];
window.Library.recent(); window.Library.pushRecent(item); window.Library.clearRecent();
window.Library.stats();

// 歌词（我写的新模块）
await window.Lyrics.fetch(item);   // -> {lines:[{t,text}], source} | null
window.Lyrics.indexAt(lines, sec) -> 当前行下标
window.Lyrics.peek(item) -> undefined(未查过) | null(无歌词) | {lines,...}

// 桥接（不要直接 fetch /api，统一走 Bridge）
window.Bridge.proxyJson({platform,url,method,headers,body})
window.Bridge.login(platform); window.Bridge.logout(platform);
window.Bridge.state(); window.Bridge.kvGet(k); window.Bridge.kvSet(k,v);
window.Bridge.importCookie(platform, cookie)
```

- Playable 结构：`{key,name,artists[],album,durationMs,coverUrl,sources[Song],primary}`。
- 页面启动顺序：`await Library.ready` 后再渲染库相关视图；搜索不依赖它。
- 播放一首歌后要 `Library.pushRecent(item)`（只在真正开始播放时记一次，用 `Player.on('source')` 或 `state==='playing'` 去重）。

## 6. 设计变量（写进 `:root`，全站只用这些）

```css
--bg:#0b0d12; --bg-elev:#12151d; --panel:#161a24; --panel-2:#1d2230;
--line:rgba(255,255,255,.07); --line-strong:rgba(255,255,255,.14);
--text:#e8eaf0; --text-2:#98a0b3; --text-3:#6b7385;
--accent:#5b8cff; --accent-soft:rgba(91,140,255,.14);
--qq:#3ac06a; --kugou:#4a9dff; --netease:#ff5c6c;
--radius:12px; --radius-lg:16px;
--shadow:0 8px 28px rgba(0,0,0,.45);
--ease:cubic-bezier(.2,.7,.3,1);
```
字体：`-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif`；
时长/序号用 `font-variant-numeric: tabular-nums`。
过渡统一 140–200ms；不要超过 250ms。

## 7. 文件所有权

| 文件 | 归属 |
|---|---|
| `web/index.html`、`web/css/app.css`、`web/js/ui/app.js` | **你**（本次重写） |
| `web/js/core/library.js`、`web/js/core/lyrics.js` | Lead（已写好，**只读**；有缺口告诉我，不要改） |
| `web/js/core/player.js`、`web/js/core/merge.js` | Lead（只读；确实需要微调先发消息） |
| `web/js/bridge.js` | Lead（只读） |
| `web/js/providers/*` | 另一个人（只读；provider.lyric 正在加） |

硬性约束：
- 原生 JS，无框架、无构建、无 CDN、无外部字体。
- 目标环境：Android WebView（Chrome 内核）+ WebView2。**不要用可选链 `?.`、`??`、`structuredClone`**；`async/await` 可以用。
- 脚本用 `<script src>` 按顺序加载，新增 `js/core/library.js`、`js/core/lyrics.js` 必须在 `app.js` **之前**、在 `merge.js`/`player.js` **之后**。
- 页面 URL 固定 `https://app.local/index.html`（壳内）；浏览器里用 devserver。**不要写死任何 http 域名**。
- 保留现有彩蛋：`?demo=1` 走内置假数据（3 首，含合并结果），`?q=xxx` 自动搜索（截图/自测用）。若 demo 假数据与 merge 结构不兼容，就改成直接构造 Playable 数组。

## 8. 自测流程（你必须自己跑完再汇报）

```bash
cd D:/ds工作区/musicapp
node tools/devserver.mjs          # 8787，后台；没有就自己起，注意别占端口
# 截图（Edge headless）
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu \
  --hide-scrollbars --window-size=1200,860 --virtual-time-budget=25000 \
  --screenshot=D:/ds工作区/musicapp/probe/ui_home.png "http://127.0.0.1:8787/"
# 真实搜索 + 播放 + 歌词：用真实数据页
... --virtual-time-budget=30000 --screenshot=... "http://127.0.0.1:8787/?q=%E6%99%B4%E5%A4%A9"
# 移动端
... --window-size=420,860 --screenshot=probe/ui_mobile.png "http://127.0.0.1:8787/?q=..."
```
- 用 `read_image` 自查截图：**必须**无重叠、无溢出、无「设置/歌词面板默认显示」这类 hidden 失效问题。
- 检查控制台：`node tools/devserver.mjs` 日志里不应有重复请求风暴；页面 `console` 通过 CDP 或 `?debug=1` 自检。
- 收藏/歌单/歌词这些依赖 kv 与 provider 的，浏览器里 devserver 有 kv 桩（进程内），可以真跑：先在搜索页点 ♥ → 切到收藏视图看到它；新建歌单 → ⋯ 加歌 → 详情可见；点「词」→ 有歌词（网易云多数歌能出）。

## 9. 交付要求

1. 三个文件重写完成，`node -e` 语法检查通过。
2. 至少 4 张自测截图落盘到 `probe/`：`ui_home.png`、`ui_search.png`、`ui_mobile.png`、`ui_lyrics.png`（歌词面板打开状态，可用 CDP 或 demo 数据）。
3. 一份简短汇报 send_message 给 lead：改了什么、截图路径、已知问题、体积（`wc -c`）。
4. 时间预算 90 分钟。中途若有阻塞（比如 provider.lyric 还没好）**先做 UI 骨架 + 空歌词态**，不要等。
