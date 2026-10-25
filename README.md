# 音匣 MusicBox

一个把 **网易云音乐 / QQ音乐 / 酷狗音乐** 三个平台的搜索与播放整合到一起的轻量播放器。
同一首歌（同名同作者）只显示一条，音源按 **QQ音乐 > 酷狗 > 网易云** 的优先级自动选择可播放的那一个。

- **Windows 端**：单个 `MusicBox.exe` + WebView2，绿色免安装，整目录约 1 MB。
- **安卓端**：单个 APK，约 85 KB（不含系统 WebView）。
- UI 克制：左侧导航 + 搜索框 + 列表 + 播放条；深色主题，无广告无推荐无登录墙。

功能：三平台聚合搜索 / 同名同作者合并去重 / 音源自动降级 / 时间轴歌词 / **收藏** /
**自建歌单** / **最近播放** / 平台筛选 / 登录（内嵌窗口或手动导入 Cookie）。

## 快速开始

### Windows

```
双击 dist/windows/MusicBox.exe
```

依赖系统自带的 **WebView2 Runtime**（Win10/11 通常已预装；没有的话装一次
[Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) 即可）。
整个 `dist/windows/` 目录可以随便拷到别处运行（exe + web/ + 3 个 WebView2 文件）。

### 安卓

```
adb install dist/android/yinxia-1.0.0-debug.apk
```

`minSdk 24`（Android 7.0+）/ `targetSdk 34`。安装后直接打开，无需其它依赖（用系统 WebView）。

## 使用说明

1. 输入歌名或歌手，回车/点搜索：三个平台同时搜，结果合并成一列。
2. 每行右侧的彩色小标签表示这首歌在哪些平台有：`QQ` / `酷狗` / `网易`。
3. **点一行即播放**（播放顺序就是标签从左到右的优先级，前一个平台拿不到地址就自动换下一个）。
4. 播放条：上一首 / 播放暂停 / 下一首，进度条可拖动，播完自动下一首；右侧「词」打开歌词。
5. 左侧导航：搜索 / 收藏 / 歌单 / 最近播放。列表行右侧 ♥ 收藏、⋯ 加入歌单。
6. 顶部 chips 可以只看某个平台的结果（带各平台命中数）。
7. 右上角 ⚙ 打开设置：各平台登录状态、登录、退出、手动导入 Cookie、我的数据占用。

歌词：按当前音源平台优先取（QQ / 酷狗 / 网易云都实现了），带 `[mm:ss]` 时间轴，
随播放高亮；手动滚动后 5 秒内不抢滚动。拿不到歌词时显示「暂无歌词」并可重试。

收藏 / 歌单 / 最近播放保存在本机桥接 KV 里（Windows：`%LOCALAPPDATA%\MusicBox\kv.json`；
安卓：应用私有 SharedPreferences），不上传、不联网。

### 关于登录（重要）

| 平台 | 不登录能听什么 | 登录后 |
|---|---|---|
| 网易云 | 免费曲目（约 128k） | VIP 曲目按账号权限 |
| 酷狗 | 免费曲目（Privilege = 8） | VIP 曲目按账号权限 |
| QQ音乐 | **基本听不了**（匿名 GetVkey 返回空 purl） | 可听免费曲目与账号有权限的曲目 |

也就是说：**想正常用，至少登录 QQ音乐**。点设置里的「登录」会弹出一个独立浏览器窗口，
在其中正常登录，关掉窗口后 cookie 自动收下（登录窗口与主窗口的浏览器数据是隔离的）。

如果内嵌窗口登录不成功（有些平台会检测 WebView），可以用兜底方案：
在电脑浏览器里登录该平台 → F12 → Network → 任意请求 → 复制 Request Headers 里的整串 `Cookie`
→ 设置页最下面「登录不上？手动导入 Cookie」粘贴进去。

> Cookie 只存在本机（Windows：`%LOCALAPPDATA%\MusicBox\`；安卓：应用私有 SharedPreferences），
> 不会上传、不会打日志。退出登录即清除。

## 技术架构

两个端共用同一套前端，原生层只做「HTTP 代理 + Cookie 保管 + KV + 登录窗口」：

```
┌──────────────────────────────────────────────────┐
│  web/  共享前端（原生 JS，无框架，~89 KB）        │
│  index.html  css/app.css                         │
│  js/bridge.js        ← 桥接协议客户端             │
│  js/providers/*.js   ← 三平台接口（搜索/取地址/歌词）│
│  js/core/merge.js    ← 同名同作者合并 + 优先级排序 │
│  js/core/player.js   ← 播放器 / 降级链 / 队列      │
│  js/core/library.js  ← 收藏 / 歌单 / 最近播放      │
│  js/core/lyrics.js   ← LRC 解析 / 拉取 / 定位      │
│  js/ui/app.js        ← 视图与交互                 │
└───────────────┬──────────────────────────────────┘
                │  页面跑在虚拟域名 https://app.local，
                │  所有 /api/* 由原生层拦截实现
    ┌───────────┴────────────┐
    │                        │
┌───▼─────────────┐   ┌──────▼──────────────┐
│ Windows 原生    │   │ Android 原生         │
│ WinForms +      │   │ WebView +           │
│ WebView2        │   │ shouldInterceptReq. │
│ csc(.NET 4.8)   │   │ Java                │
└─────────────────┘   └─────────────────────┘
```

- **接口签名/加密为什么在 JS 里**：三平台的搜索/取地址/歌词接口签名（酷狗需要 md5 计算 key、
  QQ 需要 cookie+uin、网易云需要特定请求头）全部用纯 JS 实现，两端复用同一份代码，
  原生层不需要跟着平台改版重编译。
- **跨域问题**：页面是 `https://app.local`，音频 CDN 是别的域名，`fetch` 会跨域；
  所以所有网络请求都走 `POST /api/proxy` 交给原生层发（顺带带上该平台的 cookie）。
- **登录抓 cookie**：原生层另开一个 WebView 加载平台登录页，关窗时用浏览器的
  CookieManager 收集 cookie 存进平台罐，之后代理请求自动带上。
- **音源优先级**：`merge.js` 里 `PRIORITY = { qq: 0, kugou: 1, netease: 2 }`，
  合并时按此排序；`player.js` 依次尝试，失败自动降级到下一个平台。
- **桥接端点**：`/api/proxy`、`/api/login`、`/api/logout`、`/api/state`、`/api/kv`、`/api/cookie`。
  协议细节见 `DESIGN.md` 第 3 节。

## 目录

```
musicapp/
├── web/                  共享前端（直接可以放进浏览器跑，见下）
├── windows/              Windows 壳源码（C# 5，csc 编译）
├── android/              安卓壳源码（Java，AGP 8.5.2 / compileSdk 34）
├── tools/
│   ├── build_win.bat       一键构建 Windows（编译 + 拷 web + 拷 WebView2 文件）
│   ├── build_android.sh    一键构建 APK（--offline，需本机 gradle 缓存）
│   ├── devserver.mjs       浏览器里直接调试前端（同源 /api/proxy 实现）
│   ├── test_merge.mjs      合并/优先级单元测试
│   └── test_library.mjs    收藏/歌单/最近播放 + LRC 解析单元测试
├── probe/                逆向与接口探测脚本、端到端验证脚本、截图
├── docs/                 截图
├── dist/                 构建产物（windows/、android/）
├── DESIGN.md             桥接协议与实现细节（改动前先看这个）
└── UI_SPEC.md            视图 / 覆盖层 / DOM 契约 / 设计变量
```

## 自己构建

### Windows

```
cd musicapp\tools
build_win.bat
```

只需要系统自带的 `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`
（.NET Framework 4.x 自带，C# 5 语法），以及 `vendor/wv2/` 里的 WebView2 NuGet 解包文件。
产物：`dist/windows/MusicBox.exe`。

> 在 git bash 里调用要写成 `cmd //c build_win.bat`，否则 MSYS 会改写路径导致脚本没执行。

### 安卓

```
bash tools/build_android.sh
```

脚本自带 JDK17 / ANDROID_HOME / GRADLE_USER_HOME（可用环境变量覆盖）、把 `web/` 拷进
`assets/web/`、中文路径时自动 `subst` 映射盘符。产物：`dist/android/yinxia-1.0.0-debug.apk`。

### 前端（不装壳，直接在浏览器里调）

```
node tools/devserver.mjs          # http://127.0.0.1:8787
```

页面会自动退回同源相对路径（不用 app.local 拦截），`?q=关键词` 可以直接带搜索参数，
`?demo=1` 用假数据看列表/歌词样式。

## 验证脚本

```
node tools/test_merge.mjs                  # 合并/优先级 9 项断言
node tools/test_library.mjs                # 收藏/歌单/最近播放/LRC 51 项断言
node probe/provider_test.mjs               # 三平台搜索 + 取地址 + HEAD 校验
node probe/cdp_play_test.mjs 小星星         # 真浏览器/真壳里点行播放，看 currentTime 是否前进
CDP_PORT=9334 node probe/verify_shell.mjs 小星星
                                           # 真壳全流程：冷启动→搜索→播放→歌词→收藏
                                           # →歌单→刷新后 KV 持久化→设置（18 项）
```

远程调试端口：Edge 用 `--remote-debugging-port=9333`；Windows 壳设环境变量
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9334` 再启动 exe。

## 截图

本地文件（GitHub 仓库只放源码，二进制截图未提交）：

| 文件 | 内容 |
|---|---|
| `docs/desktop.png` | Windows 壳搜索结果 |
| `docs/playing.png` | Windows 壳播放中（封面 + 高亮行） |
| `docs/lyrics.png` | 歌词面板（时间轴高亮） |
| `docs/playlist.png` | 歌单详情 |
| `docs/mobile.png` | 安卓竖屏布局（420 宽） |

## 已知限制

- **QQ音乐匿名不可播**，必须登录（平台策略，不是 bug）。
- VIP / 付费 / 独家版权曲目即使登录也可能拿不到地址，此时会提示具体原因
  （如「QQ未登录」「VIP/付费曲目（Privilege=10）」）。
- 只加载每平台第一页（30 条）结果，没有「加载更多」。
- **安卓端未做运行时验证**：本机没有可用的模拟器/真机（x86_64 镜像需硬件加速，
  AEHD 未安装、WHPX 需管理员权限）。只验证了编译、APK 内容与桥接端点代码。
- 没有下载、没有后台播放服务（安卓切后台可能被系统暂停）。
- 直链有时效（QQ 的 vkey、酷狗的 tracker key），播放器缓存 25 分钟后自动重新解析。
- 平台接口随时可能变，接口层集中在 `web/js/providers/`，改一处两端同时生效。
