package com.yinxia.music;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.GZIPInputStream;

/**
 * 桥接服务：把虚拟域名 https://app.local/ 全部接管。
 *
 * - 非 /api/ 路径：从 assets/web/ 读静态资源（构建时由 Gradle 从仓库 web/ 复制）。
 * - /api/：原生实现，见 DESIGN.md 第 3 节。
 *
 * 关键实现说明：WebView 的 shouldInterceptRequest 拿不到 POST 请求体，
 * 因此页面侧注入了一小段 shim（assets/bridge_shim.js），把 POST /api/* 的
 * 请求体 base64 后放进请求头 X-Bridge-Body；原生侧从请求头取回。
 * 静态资源与 GET 请求完全走 shouldInterceptRequest，页面同源，无 CORS。
 */
public final class BridgeServer {

    private static final String TAG = "MusicBoxBridge";
    private static final String VIRTUAL_HOST = "app.local";
    private static final String DEFAULT_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    private static final String PREFS_KV = "mb_kv";
    private static final String KV_PREFIX = "k:";

    /** HttpURLConnection 不允许/不应透传的请求头（cookie 单独处理）。 */
    private static final Set<String> BLOCKED_REQUEST_HEADERS = new HashSet<>();

    static {
        String[] blocked = {
                "connection", "content-length", "host", "expect", "upgrade",
                "transfer-encoding", "te", "trailer", "keep-alive",
                "proxy-authorization", "proxy-authenticate", "cookie2",
                "accept-encoding", "user-agent"
        };
        // user-agent 不禁止（下面单独按平台默认值处理），先移除
        for (String b : blocked) {
            if (!"user-agent".equals(b)) BLOCKED_REQUEST_HEADERS.add(b);
        }
    }

    private final Context ctx;
    private final CookieJar jar;
    private final SharedPreferences kvPrefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final MainActivity activity;
    private final String versionName;
    private String shimJs;

    BridgeServer(MainActivity activity) {
        this.activity = activity;
        this.ctx = activity.getApplicationContext();
        this.jar = new CookieJar(ctx);
        this.kvPrefs = ctx.getSharedPreferences(PREFS_KV, Context.MODE_PRIVATE);
        String v = "1.0.0";
        try {
            v = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException ignored) {
        }
        this.versionName = v;
    }

    // ------------------------------------------------------------ request entry

    /** 由 WebViewClient.shouldInterceptRequest 调用；非 app.local 返回 null 放行。 */
    public WebResourceResponse handleRequest(WebResourceRequest request) {
        try {
            if (request == null || request.getUrl() == null) return null;
            Uri uri = request.getUrl();
            String host = uri.getHost();
            if (host == null || !VIRTUAL_HOST.equalsIgnoreCase(host)) return null;
            String path = uri.getPath();
            if (path == null || path.isEmpty()) path = "/";
            if (path.startsWith("/api/")) return handleApi(request, uri, path);
            return serveStatic(path);
        } catch (Throwable t) {
            // 只记录异常类型，不带请求细节（避免 cookie 等敏感信息进日志）
            Log.w(TAG, "intercept failed: " + t.getClass().getSimpleName());
            return jsonResponse(errorObject("intercept failed"), 500);
        }
    }

    // -------------------------------------------------------------- static assets

    private WebResourceResponse serveStatic(String path) {
        String p = path;
        if (p.isEmpty() || "/".equals(p)) p = "/index.html";
        if (p.indexOf("..") >= 0) return notFound();
        String assetPath = "web" + p;
        byte[] data;
        InputStream in = null;
        try {
            in = ctx.getAssets().open(assetPath, AssetManager.ACCESS_STREAMING);
            data = readAll(in);
        } catch (IOException e) {
            return notFound();
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (IOException ignored) {
                }
            }
        }
        String mime = mimeFor(p);
        if ("/index.html".equals(p)) {
            // 注入桥接 shim：必须在页面任何脚本之前执行
            String html = new String(data, StandardCharsets.UTF_8);
            String inject = "<script>" + shimSource() + "</script>";
            int idx = html.indexOf("<head>");
            if (idx >= 0) {
                html = html.substring(0, idx + 6) + inject + html.substring(idx + 6);
            } else {
                html = inject + html;
            }
            data = html.getBytes(StandardCharsets.UTF_8);
        }
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Access-Control-Allow-Origin", "*");
        WebResourceResponse resp = new WebResourceResponse(
                mime, isTextMime(mime) ? "utf-8" : null, new ByteArrayInputStream(data));
        resp.setResponseHeaders(headers);
        return resp;
    }

    private String shimSource() {
        if (shimJs != null) return shimJs;
        InputStream in = null;
        try {
            in = ctx.getAssets().open("bridge_shim.js");
            shimJs = new String(readAll(in), StandardCharsets.UTF_8);
        } catch (IOException e) {
            Log.w(TAG, "bridge shim missing from assets: " + e.getClass().getSimpleName());
            shimJs = "";
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (IOException ignored) {
                }
            }
        }
        return shimJs;
    }

    private static String mimeFor(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        int dot = p.lastIndexOf('.');
        String ext = dot >= 0 ? p.substring(dot + 1) : "";
        switch (ext) {
            case "html":
            case "htm":
                return "text/html";
            case "css":
                return "text/css";
            case "js":
            case "mjs":
                return "text/javascript";
            case "json":
            case "map":
                return "application/json";
            case "svg":
                return "image/svg+xml";
            case "png":
                return "image/png";
            case "jpg":
            case "jpeg":
                return "image/jpeg";
            case "gif":
                return "image/gif";
            case "webp":
                return "image/webp";
            case "ico":
                return "image/x-icon";
            case "woff":
                return "font/woff";
            case "woff2":
                return "font/woff2";
            case "ttf":
                return "font/ttf";
            case "otf":
                return "font/otf";
            case "mp3":
                return "audio/mpeg";
            case "m4a":
                return "audio/mp4";
            case "wav":
                return "audio/wav";
            case "ogg":
                return "audio/ogg";
            case "txt":
                return "text/plain";
            case "webmanifest":
                return "application/manifest+json";
            case "wasm":
                return "application/wasm";
            default:
                return "application/octet-stream";
        }
    }

    private static boolean isTextMime(String mime) {
        return mime.startsWith("text/") || "application/json".equals(mime) || "application/manifest+json".equals(mime);
    }

    // ------------------------------------------------------------------ api router

    private WebResourceResponse handleApi(WebResourceRequest request, Uri uri, String path) {
        String method = request.getMethod();
        if (method == null) method = "GET";
        method = method.toUpperCase(Locale.ROOT);
        JSONObject body = readJsonBody(request);
        switch (path) {
            case "/api/kv":
                return "GET".equals(method) ? kvGet(uri) : kvSet(body);
            case "/api/state":
                return state();
            case "/api/logout":
                return logout(body);
            case "/api/cookie":
                return importCookie(body);
            case "/api/proxy":
                return proxyAsync(body);
            case "/api/login":
                return loginAsync(body);
            default:
                return jsonResponse(errorObject("unknown api: " + path), 404);
        }
    }

    /**
     * POST 请求体从请求头 X-Bridge-Body 取（base64，页面 shim 写入）。
     * 缺失/非法时返回空 JSON 对象，由各端点自行判定。
     */
    private JSONObject readJsonBody(WebResourceRequest request) {
        try {
            Map<String, String> headers = request.getRequestHeaders();
            String b64 = null;
            if (headers != null) {
                for (Map.Entry<String, String> e : headers.entrySet()) {
                    if (e.getKey() != null && "x-bridge-body".equals(e.getKey().toLowerCase(Locale.ROOT))) {
                        b64 = e.getValue();
                        break;
                    }
                }
            }
            if (b64 == null || b64.isEmpty()) return new JSONObject();
            byte[] raw = Base64.decode(b64, Base64.DEFAULT);
            String text = new String(raw, StandardCharsets.UTF_8).trim();
            if (text.isEmpty()) return new JSONObject();
            return new JSONObject(text);
        } catch (Throwable t) {
            Log.w(TAG, "bad bridge body: " + t.getClass().getSimpleName());
            return new JSONObject();
        }
    }

    // ------------------------------------------------------------------- /api/kv

    private WebResourceResponse kvGet(Uri uri) {
        JSONObject o = new JSONObject();
        try {
            String key = uri.getQueryParameter("key");
            String value = key == null ? null : kvPrefs.getString(KV_PREFIX + key, null);
            if (value == null) o.put("value", JSONObject.NULL);
            else o.put("value", value);
        } catch (JSONException ignored) {
        }
        return jsonResponse(o, 200);
    }

    private WebResourceResponse kvSet(JSONObject body) {
        JSONObject o = new JSONObject();
        try {
            String key = body.optString("key", "");
            if (key.isEmpty()) {
                o.put("ok", false);
            } else {
                String value = body.isNull("value") ? "" : body.optString("value", "");
                kvPrefs.edit().putString(KV_PREFIX + key, value).apply();
                o.put("ok", true);
            }
        } catch (JSONException ignored) {
        }
        return jsonResponse(o, 200);
    }

    // ---------------------------------------------------------------- /api/state

    private WebResourceResponse state() {
        JSONObject out = new JSONObject();
        try {
            JSONObject platforms = new JSONObject();
            platforms.put("netease", platformState("netease"));
            platforms.put("qq", platformState("qq"));
            platforms.put("kugou", platformState("kugou"));
            out.put("platforms", platforms);
            out.put("version", versionName);
        } catch (JSONException e) {
            return jsonResponse(errorObject("state failed"), 500);
        }
        return jsonResponse(out, 200);
    }

    private JSONObject platformState(String platform) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("loggedIn", jar.hasAuth(platform));
        if ("qq".equals(platform)) {
            String uin = jar.qqUin();
            if (!uin.isEmpty()) o.put("uin", uin);   // 接口必需参数，非密钥
        } else if ("netease".equals(platform)) {
            String uid = jar.neteaseUserId();
            if (!uid.isEmpty()) o.put("userId", uid); // 接口必需参数，非密钥
        }
        return o;
    }

    // --------------------------------------------------------------- /api/logout

    private WebResourceResponse logout(JSONObject body) {
        String platform = normalizePlatform(body.optString("platform", ""));
        jar.clear(platform);
        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
            o.put("platform", platform);
        } catch (JSONException ignored) {
        }
        return jsonResponse(o, 200);
    }

    // --------------------------------------------------------------- /api/cookie

    private WebResourceResponse importCookie(JSONObject body) {
        String platform = normalizePlatform(body.optString("platform", ""));
        String cookie = body.optString("cookie", "");
        int count = jar.merge(platform, cookie);
        JSONObject o = new JSONObject();
        try {
            o.put("ok", count > 0);
            o.put("cookieCount", count);
            o.put("platform", platform);
        } catch (JSONException ignored) {
        }
        return jsonResponse(o, 200);
    }

    // ---------------------------------------------------------------- /api/proxy

    private WebResourceResponse proxyAsync(final JSONObject req) {
        final PipedInputStream in;
        final PipedOutputStream out;
        try {
            in = new PipedInputStream(64 * 1024);
            out = new PipedOutputStream(in);
        } catch (IOException e) {
            return jsonResponse(errorObject("pipe failed"), 500);
        }
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                String json;
                try {
                    json = proxyOnce(req).toString();
                } catch (Throwable e) {
                    json = errorObject(shortError(e)).toString();
                }
                writeAndClose(out, json);
            }
        }, "mb-proxy");
        t.setDaemon(true);
        t.start();
        return jsonStream(in);
    }

    private JSONObject proxyOnce(JSONObject req) {
        String platform = normalizePlatform(req.optString("platform", ""));
        String urlStr = req.optString("url", "");
        if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) {
            return errorObject("invalid url");
        }
        String method = req.optString("method", "GET").trim().toUpperCase(Locale.ROOT);
        if (method.isEmpty()) method = "GET";
        JSONObject headers = req.optJSONObject("headers");
        String body = req.isNull("body") ? "" : req.optString("body", "");
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(25000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Accept-Encoding", "identity");
            conn.setRequestProperty("User-Agent", DEFAULT_UA);
            String jsCookie = "";
            if (headers != null) {
                Iterator<String> it = headers.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    if (k == null) continue;
                    String v = headers.optString(k, "");
                    if (v == null) continue;
                    String lk = k.toLowerCase(Locale.ROOT);
                    if ("cookie".equals(lk)) {
                        // 仅在原生罐为空时兜底放行（保持「JS 不接触 cookie」不泄露原生值）
                        jsCookie = v;
                        continue;
                    }
                    if (BLOCKED_REQUEST_HEADERS.contains(lk)) continue;
                    try {
                        conn.setRequestProperty(k, v);
                    } catch (Throwable ignored) {
                    }
                }
            }
            String jarCookie = jar.header(platform);
            String cookie = !jarCookie.isEmpty() ? jarCookie : jsCookie;
            if (!cookie.isEmpty()) {
                try {
                    conn.setRequestProperty("Cookie", cookie);
                } catch (Throwable ignored) {
                }
            }
            boolean hasBody = !"GET".equals(method) && !"HEAD".equals(method);
            if (hasBody) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                conn.setDoOutput(true);
                try {
                    conn.setFixedLengthStreamingMode(bytes.length);
                } catch (Throwable ignored) {
                }
                OutputStream os = conn.getOutputStream();
                os.write(bytes);
                os.flush();
                os.close();
            } else {
                conn.setDoOutput(false);
            }
            int code = conn.getResponseCode();
            JSONObject out = new JSONObject();
            out.put("status", code);
            JSONObject hs = new JSONObject();
            Map<String, List<String>> headerFields = conn.getHeaderFields();
            if (headerFields != null) {
                for (Map.Entry<String, List<String>> e : headerFields.entrySet()) {
                    String name = e.getKey();
                    if (name == null) continue;
                    List<String> values = e.getValue();
                    if (values == null || values.isEmpty()) continue;
                    hs.put(name.toLowerCase(Locale.ROOT), values.get(0));
                    if (!platform.isEmpty() && "set-cookie".equalsIgnoreCase(name)) {
                        for (String sc : values) jar.mergeSetCookie(platform, sc);
                    }
                }
            }
            out.put("headers", hs);
            InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            byte[] raw = is == null ? new byte[0] : readAllQuiet(is);
            String enc = conn.getContentEncoding();
            if (enc != null && enc.toLowerCase(Locale.ROOT).contains("gzip")) {
                try {
                    raw = readAll(new GZIPInputStream(new ByteArrayInputStream(raw)));
                } catch (IOException ignored) {
                }
            }
            out.put("body", new String(raw, StandardCharsets.UTF_8));
            return out;
        } catch (Throwable t) {
            return errorObject(shortError(t));
        } finally {
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Throwable ignored) {
                }
            }
        }
    }

    // ---------------------------------------------------------------- /api/login

    private WebResourceResponse loginAsync(final JSONObject req) {
        final String platform = normalizePlatform(req.optString("platform", ""));
        final PipedInputStream in;
        final PipedOutputStream out;
        try {
            in = new PipedInputStream(16 * 1024);
            out = new PipedOutputStream(in);
        } catch (IOException e) {
            return jsonResponse(errorObject("pipe failed"), 500);
        }
        final boolean known = "netease".equals(platform) || "qq".equals(platform) || "kugou".equals(platform);
        main.post(new Runnable() {
            @Override
            public void run() {
                if (!known) {
                    writeAndClose(out, loginResult(platform, 0, false, "unknown platform"));
                    return;
                }
                if (activity == null) {
                    writeAndClose(out, loginResult(platform, 0, false, "activity gone"));
                    return;
                }
                activity.startLogin(platform, new MainActivity.LoginCallback() {
                    @Override
                    public void onLoginResult(String rawCookie, String error) {
                        int count = 0;
                        boolean ok = false;
                        if (error == null) {
                            count = jar.merge(platform, rawCookie);
                            ok = jar.hasAuth(platform) || count > 0;
                        }
                        writeAndClose(out, loginResult(platform, count, ok, error));
                    }
                });
            }
        });
        return jsonStream(in);
    }

    private String loginResult(String platform, int count, boolean ok, String error) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", ok);
            o.put("cookieCount", count);
            o.put("platform", platform);
            if (error != null) o.put("error", error);
            return o.toString();
        } catch (JSONException e) {
            return "{\"ok\":false,\"error\":\"json\"}";
        }
    }

    // -------------------------------------------------------------- login cookies

    /** 登录页关闭后抓取 cookie 的候选 URL（覆盖各平台相关域）。 */
    static String[] cookieUrlsFor(String platform) {
        if ("netease".equals(platform)) {
            return new String[]{
                    "https://music.163.com/",
                    "https://music.163.com/api/",
                    "https://music.163.com/m/",
                    "https://reg.163.com/",
                    "https://www.163.com/",
                    "https://163.com/"
            };
        }
        if ("qq".equals(platform)) {
            return new String[]{
                    "https://y.qq.com/",
                    "https://u.y.qq.com/",
                    "https://c.y.qq.com/",
                    "https://i.y.qq.com/",
                    "https://music.qq.com/",
                    "https://ptlogin2.qq.com/",
                    "https://ssl.ptlogin2.qq.com/",
                    "https://graph.qq.com/",
                    "https://qq.com/"
            };
        }
        if ("kugou".equals(platform)) {
            return new String[]{
                    "https://www.kugou.com/",
                    "https://passport.kugou.com/",
                    "https://songsearch.kugou.com/",
                    "https://m3ws.kugou.com/",
                    "https://kugou.com/"
            };
        }
        return new String[0];
    }

    // ------------------------------------------------------------------- utils

    private static String normalizePlatform(String p) {
        if (p == null) return "";
        String v = p.trim().toLowerCase(Locale.ROOT);
        if ("netease".equals(v) || "qq".equals(v) || "kugou".equals(v)) return v;
        return v;
    }

    private WebResourceResponse jsonResponse(JSONObject o, int status) {
        byte[] bytes = o.toString().getBytes(StandardCharsets.UTF_8);
        WebResourceResponse r = new WebResourceResponse("application/json", "utf-8", new ByteArrayInputStream(bytes));
        if (status != 200) {
            r.setStatusCodeAndReasonPhrase(status, status == 404 ? "Not Found" : "Error");
        }
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        h.put("Access-Control-Allow-Origin", "*");
        r.setResponseHeaders(h);
        return r;
    }

    private WebResourceResponse jsonStream(PipedInputStream in) {
        WebResourceResponse r = new WebResourceResponse("application/json", "utf-8", in);
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        r.setResponseHeaders(h);
        return r;
    }

    private WebResourceResponse notFound() {
        WebResourceResponse r = new WebResourceResponse(
                "text/plain", "utf-8", new ByteArrayInputStream("not found".getBytes(StandardCharsets.UTF_8)));
        r.setStatusCodeAndReasonPhrase(404, "Not Found");
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        r.setResponseHeaders(h);
        return r;
    }

    private static JSONObject errorObject(String reason) {
        JSONObject o = new JSONObject();
        try {
            o.put("status", 0);
            o.put("error", reason == null ? "error" : reason);
        } catch (JSONException ignored) {
        }
        return o;
    }

    private static String shortError(Throwable t) {
        String msg;
        try {
            msg = t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage());
        } catch (Throwable ignored) {
            msg = t.getClass().getSimpleName();
        }
        if (msg.length() > 300) msg = msg.substring(0, 300);
        return msg;
    }

    private static byte[] readAllQuiet(InputStream is) {
        try {
            return readAll(is);
        } catch (IOException e) {
            return new byte[0];
        } finally {
            try {
                is.close();
            } catch (IOException ignored) {
            }
        }
    }

    private static byte[] readAll(InputStream is) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream(8192);
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) {
            bos.write(buf, 0, n);
        }
        return bos.toByteArray();
    }

    private static void writeAndClose(PipedOutputStream out, String json) {
        try {
            out.write(json.getBytes(StandardCharsets.UTF_8));
            out.flush();
        } catch (IOException ignored) {
        } finally {
            try {
                out.close();
            } catch (IOException ignored) {
            }
        }
    }
}
