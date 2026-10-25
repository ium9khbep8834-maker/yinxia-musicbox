using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

namespace MusicBox
{
    /// <summary>平台定义：登录页、抓 cookie 的 URL、导入 cookie 时挂的域、uin/userId 的 cookie 名。</summary>
    internal class PlatformDef
    {
        public string Id;
        public string Label;
        public string LoginUrl;
        public string[] CaptureUrls;
        public string ImportDomain;
        public string[] UserIdKeys;
    }

    internal class HttpResult
    {
        public int Status;
        public string Body = "";
        public string Error;
        public Dictionary<string, string> Headers = new Dictionary<string, string>();

        public static HttpResult Fail(string message)
        {
            HttpResult r = new HttpResult();
            r.Status = 0;
            r.Error = message;
            return r;
        }
    }

    /// <summary>一个平台的 cookie 罐 + HttpClient。cookie 值只在原生层流转。</summary>
    internal class PlatformSession
    {
        public PlatformDef Def;
        public CookieContainer Jar;
        public HttpClient Client;
        /// <summary>cookie 名→值（用于 uin/userId 与持久化；绝不写日志）。</summary>
        public Dictionary<string, string> Raw = new Dictionary<string, string>(StringComparer.Ordinal);
        /// <summary>已加入的 Cookie 对象（.NET 4.0 参考程序集没有 CookieContainer.GetAllCookies，自己记账）。</summary>
        public List<Cookie> CookieList = new List<Cookie>();

        public void Track(Cookie c)
        {
            if (c == null || string.IsNullOrEmpty(c.Name)) return;
            for (int i = 0; i < CookieList.Count; i++)
            {
                Cookie x = CookieList[i];
                if (string.Equals(x.Name, c.Name, StringComparison.Ordinal)
                    && string.Equals(x.Domain, c.Domain, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(x.Path, c.Path, StringComparison.Ordinal))
                {
                    CookieList[i] = c;
                    return;
                }
            }
            CookieList.Add(c);
        }

        public PlatformSession(PlatformDef def, CookieContainer jar)
        {
            Def = def;
            Jar = jar;
            Client = Sessions.CreateClient(jar);
        }

        public int CookieCount
        {
            get { return Raw.Count; }
        }

        public string UserIdValue
        {
            get
            {
                if (Def == null || Def.UserIdKeys == null) return null;
                for (int i = 0; i < Def.UserIdKeys.Length; i++)
                {
                    string v;
                    if (Raw.TryGetValue(Def.UserIdKeys[i], out v) && !string.IsNullOrEmpty(v))
                    {
                        string norm = Sessions.NormalizeUid(v);
                        if (norm.Length > 0) return norm;
                    }
                }
                return null;
            }
        }

        public bool AddCookie(Cookie c)
        {
            if (c == null || string.IsNullOrEmpty(c.Name)) return false;
            string value = c.Value == null ? "" : c.Value;
            if (string.IsNullOrEmpty(c.Domain) && Def != null) c.Domain = Def.ImportDomain;
            Raw[c.Name] = value;
            try
            {
                Jar.Add(c);
                Track(c);
            }
            catch (Exception)
            {
                // 个别非法 cookie 直接忽略
            }
            return true;
        }

        public bool AddRawCookie(string name, string value)
        {
            if (string.IsNullOrEmpty(name)) return false;
            Raw[name] = value == null ? "" : value;
            try
            {
                Cookie c = new Cookie(name, value == null ? "" : value);
                c.Domain = Def.ImportDomain;
                c.Path = "/";
                Jar.Add(c);
                Track(c);
            }
            catch (Exception)
            {
            }
            return true;
        }

        public void Reset()
        {
            Jar = new CookieContainer();
            Client = Sessions.CreateClient(Jar);
            Raw.Clear();
            CookieList.Clear();
        }

        public async Task<HttpResult> SendAsync(string url, string method, Dictionary<string, string> headers, string body)
        {
            try
            {
                string m = string.IsNullOrEmpty(method) ? "GET" : method.ToUpperInvariant();
                HttpRequestMessage req = new HttpRequestMessage(new HttpMethod(m), url);
                if (!string.IsNullOrEmpty(body))
                {
                    req.Content = new StringContent(body, Encoding.UTF8);
                }
                bool hasContentType = false;
                if (headers != null)
                {
                    foreach (KeyValuePair<string, string> h in headers)
                    {
                        if (h.Key == null) continue;
                        string lower = h.Key.ToLowerInvariant();
                        if (lower == "cookie" || lower == "host" || lower == "content-length" || lower == "connection" || lower == "transfer-encoding") continue;
                        if (lower == "content-type") hasContentType = true;
                        bool ok = req.Headers.TryAddWithoutValidation(h.Key, h.Value);
                        if (!ok && req.Content != null)
                        {
                            req.Content.Headers.TryAddWithoutValidation(h.Key, h.Value);
                        }
                    }
                }
                if (req.Content != null && !hasContentType)
                {
                    req.Content.Headers.TryAddWithoutValidation("Content-Type", "application/json; charset=utf-8");
                }

                using (HttpResponseMessage resp = await Client.SendAsync(req))
                {
                    HttpResult r = new HttpResult();
                    r.Status = (int)resp.StatusCode;
                    if (resp.Content != null)
                    {
                        byte[] data = await resp.Content.ReadAsByteArrayAsync();
                        r.Body = Encoding.UTF8.GetString(data);
                        if (resp.Content.Headers.ContentType != null)
                        {
                            string ct = resp.Content.Headers.ContentType.ToString();
                            if (!string.IsNullOrEmpty(ct)) r.Headers["content-type"] = ct;
                        }
                    }
                    return r;
                }
            }
            catch (TaskCanceledException)
            {
                return HttpResult.Fail("请求超时或被取消");
            }
            catch (Exception ex)
            {
                return HttpResult.Fail(ex.GetBaseException().Message);
            }
        }
    }

    /// <summary>三平台会话管理 + cookie 持久化。</summary>
    internal class Sessions
    {
        public static readonly string DataDir = Program.DataDir;

        private static PlatformDef[] _defs;

        public static PlatformDef[] Defs
        {
            get
            {
                if (_defs == null) _defs = BuildDefs();
                return _defs;
            }
        }

        public static string[] PlatformIds
        {
            get
            {
                PlatformDef[] defs = Defs;
                string[] ids = new string[defs.Length];
                for (int i = 0; i < defs.Length; i++) ids[i] = defs[i].Id;
                return ids;
            }
        }

        private static PlatformDef[] BuildDefs()
        {
            PlatformDef netease = new PlatformDef();
            netease.Id = "netease";
            netease.Label = "网易云音乐";
            netease.LoginUrl = "https://music.163.com/";
            netease.CaptureUrls = new string[] { "https://music.163.com/", "https://music.163.com/api/", "https://www.163.com/", "https://163.com/" };
            netease.ImportDomain = ".163.com";
            netease.UserIdKeys = new string[] { "userId", "userid", "user_id", "uid", "MUSIC_U_USER_ID" };

            PlatformDef qq = new PlatformDef();
            qq.Id = "qq";
            qq.Label = "QQ音乐";
            qq.LoginUrl = "https://y.qq.com/";
            qq.CaptureUrls = new string[] { "https://y.qq.com/", "https://u.y.qq.com/", "https://c.y.qq.com/", "https://music.qq.com/", "https://qq.com/", "https://i.y.qq.com/" };
            qq.ImportDomain = ".qq.com";
            qq.UserIdKeys = new string[] { "uin", "p_uin", "wxuin", "qqmusic_uin", "luin" };

            PlatformDef kugou = new PlatformDef();
            kugou.Id = "kugou";
            kugou.Label = "酷狗音乐";
            kugou.LoginUrl = "https://www.kugou.com/";
            kugou.CaptureUrls = new string[] { "https://www.kugou.com/", "https://songsearch.kugou.com/", "https://m3ws.kugou.com/", "https://trackercdn.kugou.com/", "https://kugou.com/", "https://login-user.kugou.com/" };
            kugou.ImportDomain = ".kugou.com";
            kugou.UserIdKeys = new string[] { "userid", "user_id", "uid", "kugouid" };

            return new PlatformDef[] { netease, qq, kugou };
        }

        public static bool IsKnown(string platform)
        {
            return Def(platform) != null;
        }

        public static PlatformDef Def(string platform)
        {
            if (string.IsNullOrEmpty(platform)) return null;
            PlatformDef[] defs = Defs;
            for (int i = 0; i < defs.Length; i++)
            {
                if (string.Equals(defs[i].Id, platform, StringComparison.OrdinalIgnoreCase)) return defs[i];
            }
            return null;
        }

        public static HttpClient CreateClient(CookieContainer jar)
        {
            HttpClientHandler handler = new HttpClientHandler();
            handler.CookieContainer = jar;
            handler.UseCookies = true;
            handler.AllowAutoRedirect = true;
            handler.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            HttpClient client = new HttpClient(handler);
            client.Timeout = TimeSpan.FromSeconds(35);
            client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
            return client;
        }

        /// <summary>QQ uin 去掉前导 o；非纯数字返回空串。</summary>
        public static string NormalizeUid(string v)
        {
            if (string.IsNullOrEmpty(v)) return "";
            string s = v.Trim();
            if (s.Length > 1 && (s[0] == 'o' || s[0] == 'O') && char.IsDigit(s[1])) s = s.Substring(1);
            if (s.Length == 0) return "";
            for (int i = 0; i < s.Length; i++)
            {
                if (!char.IsDigit(s[i])) return "";
            }
            return s;
        }

        private readonly Dictionary<string, PlatformSession> _map = new Dictionary<string, PlatformSession>(StringComparer.OrdinalIgnoreCase);
        private readonly string _cookiePath;

        public Sessions()
        {
            try { Directory.CreateDirectory(DataDir); }
            catch (Exception) { }
            _cookiePath = Path.Combine(DataDir, "cookies.json");
            PlatformDef[] defs = Defs;
            for (int i = 0; i < defs.Length; i++)
            {
                _map[defs[i].Id] = new PlatformSession(defs[i], new CookieContainer());
            }
            // 无平台（platform 省略）时使用的空罐
            _map[""] = new PlatformSession(null, new CookieContainer());
            Load();
        }

        public PlatformSession Get(string platform)
        {
            if (!string.IsNullOrEmpty(platform))
            {
                PlatformSession s;
                if (_map.TryGetValue(platform, out s)) return s;
            }
            return _map[""];
        }

        public int ImportCookies(string platform, List<Cookie> cookies)
        {
            PlatformSession s = Get(platform);
            if (s == null || s.Def == null || cookies == null) return 0;
            int n = 0;
            for (int i = 0; i < cookies.Count; i++)
            {
                if (s.AddCookie(cookies[i])) n++;
            }
            Save();
            return n;
        }

        public int ImportCookieString(string platform, string rawCookie)
        {
            PlatformSession s = Get(platform);
            if (s == null || s.Def == null || string.IsNullOrEmpty(rawCookie)) return 0;
            int n = 0;
            string[] parts = rawCookie.Split(';');
            for (int i = 0; i < parts.Length; i++)
            {
                string part = parts[i].Trim();
                if (part.Length == 0) continue;
                int eq = part.IndexOf('=');
                if (eq <= 0) continue;
                string name = part.Substring(0, eq).Trim();
                string value = part.Substring(eq + 1).Trim();
                if (name.Length == 0) continue;
                string lower = name.ToLowerInvariant();
                if (lower == "path" || lower == "domain" || lower == "expires" || lower == "max-age"
                    || lower == "secure" || lower == "httponly" || lower == "samesite") continue;
                if (value.Length >= 2 && value[0] == '"' && value[value.Length - 1] == '"')
                {
                    value = value.Substring(1, value.Length - 2);
                }
                if (s.AddRawCookie(name, value)) n++;
            }
            if (n > 0) Save();
            return n;
        }

        public void Logout(string platform)
        {
            PlatformSession s = Get(platform);
            if (s == null || s.Def == null) return;
            s.Reset();
            Save();
        }

        public void Save()
        {
            try
            {
                Dictionary<string, object> root = new Dictionary<string, object>();
                Dictionary<string, object> platforms = new Dictionary<string, object>();
                PlatformDef[] defs = Defs;
                for (int i = 0; i < defs.Length; i++)
                {
                    PlatformSession s;
                    if (!_map.TryGetValue(defs[i].Id, out s)) continue;
                    List<object> items = new List<object>();
                    foreach (Cookie c in s.CookieList)
                    {
                        if (c == null || string.IsNullOrEmpty(c.Name)) continue;
                        Dictionary<string, object> item = new Dictionary<string, object>();
                        item["name"] = c.Name;
                        item["value"] = c.Value == null ? "" : c.Value;
                        item["domain"] = c.Domain == null ? "" : c.Domain;
                        item["path"] = c.Path == null ? "/" : c.Path;
                        item["secure"] = c.Secure;
                        item["httpOnly"] = c.HttpOnly;
                        item["expires"] = c.Expires == DateTime.MinValue ? 0L : ToUnix(c.Expires);
                        items.Add(item);
                    }
                    platforms[defs[i].Id] = items;
                }
                root["platforms"] = platforms;
                string json = Json.Serialize(root);
                string tmp = _cookiePath + ".tmp";
                File.WriteAllText(tmp, json, new UTF8Encoding(false));
                if (File.Exists(_cookiePath)) File.Delete(_cookiePath);
                File.Move(tmp, _cookiePath);
                Program.Info("cookie 已保存（各平台数量：" + CountsText() + "）");
            }
            catch (Exception ex)
            {
                Program.Log("cookie 保存失败", ex);
            }
        }

        private string CountsText()
        {
            StringBuilder sb = new StringBuilder();
            PlatformDef[] defs = Defs;
            for (int i = 0; i < defs.Length; i++)
            {
                PlatformSession s;
                if (!_map.TryGetValue(defs[i].Id, out s)) continue;
                if (sb.Length > 0) sb.Append(", ");
                sb.Append(defs[i].Id).Append("=").Append(s.Raw.Count);
            }
            return sb.ToString();
        }

        private static long ToUnix(DateTime dt)
        {
            DateTime epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            DateTime utc = dt.Kind == DateTimeKind.Utc ? dt : dt.ToUniversalTime();
            return (long)(utc - epoch).TotalSeconds;
        }

        private static DateTime FromUnix(long seconds)
        {
            DateTime epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            return epoch.AddSeconds(seconds).ToLocalTime();
        }

        private void Load()
        {
            try
            {
                if (!File.Exists(_cookiePath)) return;
                string text = File.ReadAllText(_cookiePath, Encoding.UTF8);
                Dictionary<string, object> root = Json.ParseObject(text);
                object platformsObj;
                if (!root.TryGetValue("platforms", out platformsObj)) return;
                Dictionary<string, object> platforms = platformsObj as Dictionary<string, object>;
                if (platforms == null) return;
                int restored = 0;
                foreach (KeyValuePair<string, object> kv in platforms)
                {
                    PlatformSession s;
                    if (!_map.TryGetValue(kv.Key, out s) || s.Def == null) continue;
                    object[] items = kv.Value as object[];
                    if (items == null) continue;
                    for (int i = 0; i < items.Length; i++)
                    {
                        Dictionary<string, object> item = items[i] as Dictionary<string, object>;
                        if (item == null) continue;
                        string name = Json.Str(item, "name");
                        string value = Json.Str(item, "value");
                        string domain = Json.Str(item, "domain");
                        string path = Json.Str(item, "path");
                        if (name.Length == 0) continue;
                        if (path.Length == 0) path = "/";
                        Cookie c = new Cookie(name, value);
                        c.Domain = domain.Length == 0 ? s.Def.ImportDomain : domain;
                        c.Path = path;
                        try { c.Secure = Convert.ToBoolean(item["secure"]); } catch (Exception) { }
                        try { c.HttpOnly = Convert.ToBoolean(item["httpOnly"]); } catch (Exception) { }
                        long exp = 0;
                        try { exp = Convert.ToInt64(item["expires"]); } catch (Exception) { }
                        if (exp > 0) c.Expires = FromUnix(exp);
                        try
                        {
                            s.Jar.Add(c);
                            s.Track(c);
                            s.Raw[name] = value;
                            restored++;
                        }
                        catch (Exception)
                        {
                        }
                    }
                }
                Program.Info("cookie 已恢复，共 " + restored + " 条（" + CountsText() + "）");
            }
            catch (Exception ex)
            {
                Program.Log("cookie 恢复失败", ex);
            }
        }
    }
}
