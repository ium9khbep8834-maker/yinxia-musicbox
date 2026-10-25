using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace MusicBox
{
    /// <summary>DESIGN.md 第 3 节桥接协议的原生实现（https://app.local/api/*）。</summary>
    internal class Bridge
    {
        private const string Origin = "https://app.local";

        private readonly CoreWebView2 _core;
        private readonly CoreWebView2Environment _env;
        private readonly Form _owner;
        private readonly Sessions _sessions;
        private readonly KvStore _kv;
        private readonly string _webDir;
        private bool _loginOpen;

        public Bridge(CoreWebView2 core, CoreWebView2Environment env, Form owner, string webDir)
        {
            _core = core;
            _env = env;
            _owner = owner;
            _webDir = webDir;
            _sessions = new Sessions();
            _kv = new KvStore();
        }

        public void Init()
        {
            // 注意：不能用 SetVirtualHostNameToFolderMapping —— 映射后的主机不会触发
            // WebResourceRequested，/api/* 就会被文件夹映射吞掉。这里统一自己提供静态文件。
            _core.AddWebResourceRequestedFilter(Origin + "/*", CoreWebView2WebResourceContext.All);
            _core.WebResourceRequested += OnWebResourceRequested;
            Program.Info("桥接已注册 " + Origin + "/*（静态文件 + /api/*）");
        }

        private async void OnWebResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            string uri = e.Request != null ? e.Request.Uri : null;
            if (uri == null || !uri.StartsWith(Origin + "/", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(uri, Origin, StringComparison.OrdinalIgnoreCase)) return;

            string path = "";
            string query = "";
            try
            {
                SplitUrl(uri, out path, out query);
            }
            catch (Exception)
            {
                return;
            }

            bool isApi = path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase)
                || string.Equals(path, "/api", StringComparison.OrdinalIgnoreCase);

            CoreWebView2Deferral deferral = e.GetDeferral();
            try
            {
                if (!isApi)
                {
                    e.Response = ServeFile(path);
                    return;
                }

                Program.Info("bridge <- " + e.Request.Method + " " + uri);
                string body = await ReadBodyAsync(e.Request);
                string json;
                if (path == "/api/proxy") json = await HandleProxyAsync(body);
                else if (path == "/api/login") json = await HandleLoginAsync(body);
                else if (path == "/api/logout") json = HandleLogout(body);
                else if (path == "/api/state") json = HandleState();
                else if (path == "/api/kv") json = string.Equals(e.Request.Method, "GET", StringComparison.OrdinalIgnoreCase)
                        ? HandleKvGet(query) : HandleKvSet(body);
                else if (path == "/api/cookie") json = HandleCookieImport(body);
                else json = "{\"status\":0,\"error\":" + Json.Serialize("未知接口 " + path) + "}";
                e.Response = CreateJsonResponse(200, json);
            }
            catch (Exception ex)
            {
                Program.Log("桥接处理异常 path=" + path, ex);
                try
                {
                    e.Response = CreateJsonResponse(200, "{\"status\":0,\"error\":" + Json.Serialize("桥接内部错误: " + ex.Message) + "}");
                }
                catch (Exception)
                {
                }
            }
            finally
            {
                deferral.Complete();
            }
        }

        private CoreWebView2WebResourceResponse CreateJsonResponse(int status, string json)
        {
            byte[] bytes = new UTF8Encoding(false).GetBytes(json);
            string headers = "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + bytes.Length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Access-Control-Allow-Origin: " + Origin + "\r\n";
            return _env.CreateWebResourceResponse(new MemoryStream(bytes), status, "OK", headers);
        }

        // ---------------- 静态文件：https://app.local/* -> web 目录 ----------------

        private static readonly Dictionary<string, string> Mimes = BuildMimes();

        private static Dictionary<string, string> BuildMimes()
        {
            Dictionary<string, string> m = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            m[".html"] = "text/html; charset=utf-8";
            m[".htm"] = "text/html; charset=utf-8";
            m[".js"] = "text/javascript; charset=utf-8";
            m[".mjs"] = "text/javascript; charset=utf-8";
            m[".css"] = "text/css; charset=utf-8";
            m[".json"] = "application/json; charset=utf-8";
            m[".map"] = "application/json; charset=utf-8";
            m[".txt"] = "text/plain; charset=utf-8";
            m[".svg"] = "image/svg+xml";
            m[".png"] = "image/png";
            m[".jpg"] = "image/jpeg";
            m[".jpeg"] = "image/jpeg";
            m[".gif"] = "image/gif";
            m[".webp"] = "image/webp";
            m[".ico"] = "image/x-icon";
            m[".woff"] = "font/woff";
            m[".woff2"] = "font/woff2";
            m[".ttf"] = "font/ttf";
            m[".mp3"] = "audio/mpeg";
            m[".ogg"] = "audio/ogg";
            m[".m4a"] = "audio/mp4";
            m[".wasm"] = "application/wasm";
            return m;
        }

        private CoreWebView2WebResourceResponse ServeFile(string path)
        {
            try
            {
                string rel = path == null ? "" : path;
                while (rel.StartsWith("/", StringComparison.Ordinal)) rel = rel.Substring(1);
                if (rel.Length == 0) rel = "index.html";
                rel = Uri.UnescapeDataString(rel).Replace('\\', '/');
                if (rel.IndexOf("..", StringComparison.Ordinal) >= 0) return NotFound();
                if (rel.EndsWith("/", StringComparison.Ordinal)) rel = rel + "index.html";

                string root = Path.GetFullPath(_webDir);
                string full = Path.GetFullPath(Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar)));
                string rootWithSep = root.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal)
                    ? root : root + Path.DirectorySeparatorChar;
                if (!full.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase)) return NotFound();
                if (!File.Exists(full)) return NotFound();

                byte[] bytes = File.ReadAllBytes(full);
                string mime;
                if (!Mimes.TryGetValue(Path.GetExtension(full), out mime)) mime = "application/octet-stream";
                string headers = "Content-Type: " + mime + "\r\n"
                    + "Content-Length: " + bytes.Length + "\r\n"
                    + "Cache-Control: no-cache\r\n";
                return _env.CreateWebResourceResponse(new MemoryStream(bytes), 200, "OK", headers);
            }
            catch (Exception ex)
            {
                Program.Log("静态文件服务失败 path=" + path, ex);
                return NotFound();
            }
        }

        private CoreWebView2WebResourceResponse NotFound()
        {
            byte[] bytes = Encoding.UTF8.GetBytes("404 Not Found");
            return _env.CreateWebResourceResponse(new MemoryStream(bytes), 404, "Not Found",
                "Content-Type: text/plain; charset=utf-8\r\nContent-Length: " + bytes.Length + "\r\n");
        }

        private static async Task<string> ReadBodyAsync(CoreWebView2WebResourceRequest request)        {
            if (request == null || request.Content == null) return "";
            try
            {
                using (StreamReader reader = new StreamReader(request.Content, Encoding.UTF8))
                {
                    return await reader.ReadToEndAsync();
                }
            }
            catch (Exception)
            {
                return "";
            }
        }

        private static void SplitUrl(string uri, out string path, out string query)
        {
            path = uri.Substring(Origin.Length);
            query = "";
            int q = path.IndexOf('?');
            if (q >= 0)
            {
                query = path.Substring(q + 1);
                path = path.Substring(0, q);
            }
            int h = path.IndexOf('#');
            if (h >= 0) path = path.Substring(0, h);
            path = path.TrimEnd('/');
        }

        private static string QueryValue(string query, string key)
        {
            if (string.IsNullOrEmpty(query)) return null;
            string[] parts = query.Split('&');
            for (int i = 0; i < parts.Length; i++)
            {
                string part = parts[i];
                if (part.Length == 0) continue;
                int eq = part.IndexOf('=');
                string name = eq < 0 ? part : part.Substring(0, eq);
                if (!string.Equals(name, key, StringComparison.OrdinalIgnoreCase)) continue;
                string value = eq < 0 ? "" : part.Substring(eq + 1);
                try { return Uri.UnescapeDataString(value.Replace("+", " ")); }
                catch (Exception) { return value; }
            }
            return null;
        }

        // ---------------- /api/proxy ----------------

        private async Task<string> HandleProxyAsync(string body)
        {
            Dictionary<string, object> o = Json.ParseObject(body);
            string url = Json.Str(o, "url");
            if (url.Length == 0) return ProxyError("缺少 url");
            string platform = Json.Str(o, "platform");
            string method = Json.Str(o, "method");
            string payload = Json.Str(o, "body");
            Dictionary<string, string> headers = Json.StrDict(o, "headers");

            PlatformSession session = _sessions.Get(platform);
            HttpResult r = await session.SendAsync(url, method, headers, payload);

            Dictionary<string, object> d = new Dictionary<string, object>();
            d["status"] = r.Status;
            if (r.Status == 0)
            {
                d["error"] = string.IsNullOrEmpty(r.Error) ? "请求失败" : r.Error;
            }
            else
            {
                d["headers"] = r.Headers;
                d["body"] = r.Body == null ? "" : r.Body;
            }
            return Json.Serialize(d);
        }

        private static string ProxyError(string message)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["status"] = 0;
            d["error"] = message;
            return Json.Serialize(d);
        }

        // ---------------- /api/login ----------------

        private async Task<string> HandleLoginAsync(string body)
        {
            Dictionary<string, object> o = Json.ParseObject(body);
            string platform = Json.Str(o, "platform");
            PlatformDef def = Sessions.Def(platform);
            if (def == null)
            {
                Dictionary<string, object> bad = new Dictionary<string, object>();
                bad["ok"] = false;
                bad["error"] = "未知平台：" + platform;
                return Json.Serialize(bad);
            }
            if (_loginOpen)
            {
                Dictionary<string, object> busy = new Dictionary<string, object>();
                busy["ok"] = false;
                busy["error"] = "登录窗口已打开";
                return Json.Serialize(busy);
            }

            _loginOpen = true;
            try
            {
                LoginForm form = new LoginForm(def, _owner);
                List<Cookie> cookies = await form.ShowAndCaptureAsync();
                int count = _sessions.ImportCookies(platform, cookies);
                Dictionary<string, object> d = new Dictionary<string, object>();
                d["ok"] = true;
                d["cookieCount"] = count;
                d["platform"] = def.Id;
                Program.Info("登录流程结束 platform=" + def.Id + " cookieCount=" + count);
                return Json.Serialize(d);
            }
            finally
            {
                _loginOpen = false;
            }
        }

        // ---------------- /api/logout ----------------

        private string HandleLogout(string body)
        {
            Dictionary<string, object> o = Json.ParseObject(body);
            string platform = Json.Str(o, "platform");
            PlatformDef def = Sessions.Def(platform);
            if (def == null) return "{\"ok\":false,\"error\":\"未知平台\"}";
            _sessions.Logout(def.Id);
            Program.Info("已退出平台 " + def.Id);
            return "{\"ok\":true}";
        }

        // ---------------- /api/state ----------------

        private string HandleState()
        {
            Dictionary<string, object> platforms = new Dictionary<string, object>();
            string[] ids = Sessions.PlatformIds;
            for (int i = 0; i < ids.Length; i++)
            {
                PlatformSession s = _sessions.Get(ids[i]);
                Dictionary<string, object> info = new Dictionary<string, object>();
                info["loggedIn"] = s.CookieCount > 0;
                string uid = s.UserIdValue;
                if (!string.IsNullOrEmpty(uid))
                {
                    if (string.Equals(ids[i], "netease", StringComparison.OrdinalIgnoreCase)) info["userId"] = uid;
                    else if (string.Equals(ids[i], "qq", StringComparison.OrdinalIgnoreCase)) info["uin"] = uid;
                }
                platforms[ids[i]] = info;
            }
            Dictionary<string, object> root = new Dictionary<string, object>();
            root["platforms"] = platforms;
            root["version"] = "1.0.0";
            return Json.Serialize(root);
        }

        // ---------------- /api/kv ----------------

        private string HandleKvGet(string query)
        {
            string key = QueryValue(query, "key");
            string value = key == null ? null : _kv.Get(key);
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["value"] = value;
            return Json.Serialize(d);
        }

        private string HandleKvSet(string body)
        {
            Dictionary<string, object> o = Json.ParseObject(body);
            string key = Json.Str(o, "key");
            if (key.Length == 0) return "{\"ok\":false,\"error\":\"缺少 key\"}";
            string value = Json.Str(o, "value");
            _kv.Set(key, value);
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["ok"] = true;
            return Json.Serialize(d);
        }

        // ---------------- /api/cookie（手动导入，兜底） ----------------

        private string HandleCookieImport(string body)
        {
            Dictionary<string, object> o = Json.ParseObject(body);
            string platform = Json.Str(o, "platform");
            string raw = Json.Str(o, "cookie");
            PlatformDef def = Sessions.Def(platform);
            if (def == null) return "{\"ok\":false,\"error\":\"未知平台\"}";
            int count = _sessions.ImportCookieString(def.Id, raw);
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["ok"] = true;
            d["cookieCount"] = count;
            Program.Info("导入 cookie platform=" + def.Id + " count=" + count + "（不记录内容）");
            return Json.Serialize(d);
        }
    }
}
