using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace MusicBox
{
    /// <summary>调试自检：用 CDP 在页面里跑 bridge 调用，并截图，结果写 selftest.json。</summary>
    internal static class SelfTest
    {
        public static async Task RunAsync(CoreWebView2 core, string outDir)
        {
            List<Dictionary<string, object>> items = new List<Dictionary<string, object>>();
            try
            {
                Directory.CreateDirectory(outDir);
                Add(items, await EvalAsync(core, "document.title"));
                Add(items, await EvalAsync(core, "document.body ? document.body.innerText.replace(/\\s+/g,' ').slice(0,300) : 'NO_BODY'"));
                Add(items, await EvalAsync(core, "document.querySelectorAll('*').length + ' nodes'"));
                Add(items, await EvalAsync(core, "location.href"));

                // 1) /api/state
                Add(items, await EvalAsync(core,
                    "(async()=>{try{const r=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});"
                    + "return r.status+' '+await r.text();}catch(e){return 'ERR '+e;}})()"));

                // 2) kv 往返
                Add(items, await EvalAsync(core,
                    "(async()=>{try{"
                    + "await fetch('/api/kv',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'selftest',value:'42'})});"
                    + "const r=await fetch('/api/kv?key=selftest');return r.status+' '+await r.text();"
                    + "}catch(e){return 'ERR '+e;}})()"));

                // 3) proxy 真实转发（网易云搜索，超时 15s）
                Add(items, await EvalAsync(core,
                    "(async()=>{const c=new AbortController();const t=setTimeout(()=>c.abort(),15000);try{"
                    + "const r=await fetch('/api/proxy',{method:'POST',headers:{'Content-Type':'application/json'},"
                    + "body:JSON.stringify({platform:'netease',url:'https://music.163.com/api/search/get/web?s=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=1&offset=0&limit=3',method:'GET'}),signal:c.signal});"
                    + "const txt=await r.text();return r.status+' '+txt.slice(0,300);"
                    + "}catch(e){return 'ERR '+e;}finally{clearTimeout(t);}})()"));

                // 4) /api/cookie 手动导入 + /api/state 的 userId 映射（假 cookie，测完立即登出）
                Add(items, await EvalAsync(core,
                    "(async()=>{try{const r=await fetch('/api/cookie',{method:'POST',headers:{'Content-Type':'application/json'},"
                    + "body:JSON.stringify({platform:'netease',cookie:'MUSIC_U=selftest_dummy; userId=12345678'})});"
                    + "return r.status+' '+await r.text();}catch(e){return 'ERR '+e;}})()"));
                Add(items, await EvalAsync(core,
                    "(async()=>{try{const r=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});"
                    + "return r.status+' '+await r.text();}catch(e){return 'ERR '+e;}})()"));
                Add(items, await EvalAsync(core,
                    "(async()=>{try{const r=await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},"
                    + "body:JSON.stringify({platform:'netease'})});return r.status+' '+await r.text();}catch(e){return 'ERR '+e;}})()"));
                Add(items, await EvalAsync(core,
                    "(async()=>{try{const r=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});"
                    + "return r.status+' '+await r.text();}catch(e){return 'ERR '+e;}})()"));

                // 5) 页面可见性
                Add(items, await EvalAsync(core, "document.visibilityState + ' w=' + innerWidth + ' h=' + innerHeight"));

                // 截图（WebView2 内容）
                try
                {
                    string png = Path.Combine(outDir, "webview.png");
                    using (FileStream fs = new FileStream(png, FileMode.Create, FileAccess.Write))
                    {
                        await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);
                    }
                    Dictionary<string, object> shot = new Dictionary<string, object>();
                    shot["name"] = "webview_capture";
                    shot["ok"] = File.Exists(png);
                    shot["value"] = png;
                    items.Add(shot);
                }
                catch (Exception ex)
                {
                    Program.Log("CapturePreview 失败", ex);
                }

                string json = Json.Serialize(items);
                File.WriteAllText(Path.Combine(outDir, "selftest.json"), json, new UTF8Encoding(false));
                Program.Info("自检结果已写入 " + Path.Combine(outDir, "selftest.json"));
            }
            catch (Exception ex)
            {
                Program.Log("自检异常", ex);
            }
        }

        private static void Add(List<Dictionary<string, object>> items, string value)
        {
            Dictionary<string, object> item = new Dictionary<string, object>();
            item["value"] = value;
            items.Add(item);
        }

        private static async Task<string> EvalAsync(CoreWebView2 core, string expression)
        {
            Dictionary<string, object> p = new Dictionary<string, object>();
            p["expression"] = expression;
            p["awaitPromise"] = true;
            p["returnByValue"] = true;
            p["userGesture"] = true;
            try
            {
                string res = await core.CallDevToolsProtocolMethodAsync("Runtime.evaluate", Json.Serialize(p));
                Dictionary<string, object> outer = Json.ParseObject(res);
                Dictionary<string, object> result = GetDict(outer, "result");
                if (result == null) return "NO_RESULT " + Truncate(res);
                Dictionary<string, object> exc = GetDict(result, "exceptionDetails");
                if (exc != null)
                {
                    return "JS_EXCEPTION " + Json.Str(exc, "text");
                }
                object v;
                if (!result.TryGetValue("value", out v) || v == null) return "(undefined)";
                return Truncate(Convert.ToString(v));
            }
            catch (Exception ex)
            {
                Program.Log("Runtime.evaluate 失败", ex);
                return "EVAL_ERROR " + ex.Message;
            }
        }

        private static Dictionary<string, object> GetDict(Dictionary<string, object> d, string key)
        {
            if (d == null) return null;
            object o;
            if (!d.TryGetValue(key, out o)) return null;
            return o as Dictionary<string, object>;
        }

        private static string Truncate(string s)
        {
            if (s == null) return "";
            if (s.Length <= 600) return s;
            return s.Substring(0, 600) + "…";
        }
    }
}
