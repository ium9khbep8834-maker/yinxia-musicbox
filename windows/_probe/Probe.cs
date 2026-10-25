using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Probe
{
    public class ProbeForm : Form
    {
        private WebView2 _wv;
        private CoreWebView2Environment _env;
        private HttpClient _http;
        private CookieContainer _jar;
        private Dictionary<string, object> _dict;

        public ProbeForm()
        {
            _wv = new WebView2();
            _wv.Dock = DockStyle.Fill;
            Controls.Add(_wv);
            _jar = new CookieContainer();
            HttpClientHandler h = new HttpClientHandler();
            h.CookieContainer = _jar;
            h.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            _http = new HttpClient(h);
            _http.Timeout = TimeSpan.FromSeconds(30);
            _dict = new Dictionary<string, object>();
        }

        protected override async void OnShown(EventArgs e)
        {
            base.OnShown(e);
            try
            {
                _env = await CoreWebView2Environment.CreateAsync(null, null, null);
                await _wv.EnsureCoreWebView2Async(_env);
                _wv.CoreWebView2.AddWebResourceRequestedFilter("https://app.local/api/*", CoreWebView2WebResourceContext.All);
                _wv.CoreWebView2.WebResourceRequested += this.OnWrr;
                _wv.CoreWebView2.SetVirtualHostNameToFolderMapping("app.local", System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "web"), CoreWebView2HostResourceAccessKind.DenyCors);
                _wv.CoreWebView2.Navigate("https://app.local/index.html");
                JavaScriptSerializer ser = new JavaScriptSerializer();
                string s = ser.Serialize(new Dictionary<string, object> { { "ok", true }, { "n", 3 } });
                Dictionary<string, object> d = ser.Deserialize<Dictionary<string, object>>("{\"a\":1,\"b\":\"x\"}");
                Console.WriteLine(s + " " + (d != null));
            }
            catch (Exception ex)
            {
                Console.WriteLine("ERR " + ex.Message);
            }
        }

        private async void OnWrr(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            CoreWebView2Deferral def = e.GetDeferral();
            try
            {
                string body = "";
                if (e.Request.Content != null)
                {
                    using (System.IO.StreamReader sr = new System.IO.StreamReader(e.Request.Content))
                    {
                        body = await sr.ReadToEndAsync();
                    }
                }
                byte[] bytes = System.Text.Encoding.UTF8.GetBytes("{\"ok\":true}");
                e.Response = _env.CreateWebResourceResponse(new System.IO.MemoryStream(bytes), 200, "OK", "Content-Type: application/json; charset=utf-8");
            }
            finally
            {
                def.Complete();
            }
        }
    }

    public static class Program
    {
        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ProbeForm());
        }
    }
}
