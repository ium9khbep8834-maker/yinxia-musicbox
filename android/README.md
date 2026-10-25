# 音匣 Android 壳（android/）

纯 Java（无 Compose、无 androidx）的 WebView 容器，实现 `DESIGN.md` 第 3 节桥接协议。
页面地址固定为 `https://app.local/index.html`，由 `shouldInterceptRequest` 提供：
同源，因此页面里的 `fetch('/api/...')` 不需要 CORS。

## 构建

```bash
bash tools/build_android.sh          # 增量构建 + 复制 APK 到 dist/android/
bash tools/build_android.sh --clean  # 先 clean
```

产物：`dist/android/yinxia-1.0.0-debug.apk`

脚本固定使用本机已缓存工具链，全程 `--offline`：

| 项 | 路径 |
|---|---|
| JDK | `D:/小说项目/tools/jdk17` |
| Android SDK | `D:/小说项目/android-sdk` |
| Gradle | `D:/小说项目/tools/gradle-8.7/bin/gradle` |
| GRADLE_USER_HOME | `D:/小说项目/gradle-home` |

仓库在 `D:/ds工作区`（中文路径），脚本会自动 `subst` 映射盘符并把 SDK 也映射后写入
`local.properties`，退出时清理映射（AGP 拒绝非 ASCII 工程路径，`android.overridePathCheck=true` 配合）。

前端不是第二份源：`app/build.gradle` 的 `copyWebAssets` 在构建时把 `../web/` 复制进
`build/generated/webAssets/web`，再作为 assets 打包。

## 桥接端点（全部 JSON；POST body 为 JSON）

| 端点 | 入参 | 出参 |
|---|---|---|
| `POST /api/proxy` | `{platform,url,method,headers,body}` | `{status,headers,body}`；失败 `{status:0,error}` |
| `POST /api/login` | `{platform}` | `{ok,cookieCount,platform}`，失败 `{ok:false,error}` |
| `POST /api/logout` | `{platform}` | `{ok}` |
| `GET /api/state` | — | `{platforms:{netease:{loggedIn[,userId]},qq:{loggedIn[,uin]},kugou:{loggedIn}},version}` |
| `GET /api/kv?key=x` | query | `{value}` |
| `POST /api/kv` | `{key,value}` | `{ok}` |
| `POST /api/cookie` | `{platform,cookie}` | `{ok,cookieCount}`（手动导入兜底） |

实现要点：

- WebView 的 `shouldInterceptRequest` 拿不到 POST body，所以 `assets/bridge_shim.js` 被注入
  `index.html` 的 `<head>`，包装 `fetch`/`XHR`，对 `https://app.local/api/*` 的非 GET 请求把
  body base64 后放进请求头 `X-Bridge-Body`，原生侧解码。
- `/api/proxy` 用 `HttpURLConnection` 在 daemon 线程执行，结果经 `PipedInputStream` 流式回给
  WebView，不阻塞拦截线程；平台 cookie 由原生注入（JS 不接触 cookie 值），
  响应 `Set-Cookie` 合并回平台罐；`Accept-Encoding: identity`，若仍返回 gzip 则手动解压。
- `/api/login` 在主线程弹 `LoginActivity`（内嵌第二个 WebView 到平台登录页），用户点「完成」后
  用 `CookieManager.getCookie` 按候选域抓取并合并进 `CookieJar`；日志只记条数，不打印 cookie。
- `GET /api/state` 的 `loggedIn` 依据鉴权类 cookie 名（netease `MUSIC_U`；qq `qm_keyst`/
  `qqmusic_key`/`uin`/`p_uin`/`wxuin`；kugou `KuGoo`/`kugou_token`），不是罐非空——匿名会话
  也会写 cookie，罐非空不能说明已登录。

## 配置

- `applicationId com.yinxia.music`，应用名「音匣」，minSdk 24 / target & compile 34，versionName 1.0.0。
- WebView：JS、DOM storage、`mediaPlaybackRequiresUserGesture(false)`、
  `MIXED_CONTENT_ALWAYS_ALLOW`（音频常为 http 明文）、`allowFileAccess(false)`。
- 自检入口：`adb shell am start -n com.yinxia.music/.MainActivity --ez selftest true`，
  页面加载后在 console 打 state/kv/proxy 结果，`adb logcat -s MusicBoxTest` 可看。
