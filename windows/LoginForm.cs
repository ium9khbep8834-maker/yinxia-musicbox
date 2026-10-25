using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MusicBox
{
    /// <summary>内嵌平台官网登录窗口：登录完成后关闭窗口，由本窗口从 CookieManager 抓取 cookie 交给原生层。</summary>
    internal class LoginForm : Form
    {
        private static CoreWebView2Environment _loginEnv;

        private readonly PlatformDef _def;
        private readonly Form _owner;
        private readonly WebView2 _web;
        private readonly Label _status;
        private readonly TaskCompletionSource<List<Cookie>> _tcs = new TaskCompletionSource<List<Cookie>>();
        private bool _capturing;
        private bool _initialized;

        public LoginForm(PlatformDef def, Form owner)
        {
            _def = def;
            _owner = owner;

            Text = "登录 " + def.Label + "（完成登录后关闭本窗口）";
            Width = 960;
            Height = 740;
            StartPosition = FormStartPosition.CenterParent;
            MinimizeBox = false;
            ShowInTaskbar = true;

            _web = new WebView2();
            _web.Dock = DockStyle.Fill;
            _web.DefaultBackgroundColor = Color.White;

            Panel bar = new Panel();
            bar.Dock = DockStyle.Bottom;
            bar.Height = 46;
            bar.BackColor = Color.FromArgb(245, 245, 247);

            _status = new Label();
            _status.Dock = DockStyle.Fill;
            _status.TextAlign = ContentAlignment.MiddleLeft;
            _status.Padding = new Padding(12, 0, 0, 0);
            _status.Text = "请在上方网页完成登录，然后点击右侧按钮或直接关闭窗口。";

            Button done = new Button();
            done.Text = "我已登录";
            done.Dock = DockStyle.Right;
            done.Width = 120;
            done.Click += delegate { this.Close(); };

            bar.Controls.Add(_status);
            bar.Controls.Add(done);

            Controls.Add(_web);
            Controls.Add(bar);

            Shown += OnShown;
            FormClosing += OnFormClosing;
            FormClosed += OnFormClosed;
        }

        public Task<List<Cookie>> CaptureTask
        {
            get { return _tcs.Task; }
        }

        public async Task<List<Cookie>> ShowAndCaptureAsync()
        {
            if (_owner != null && !_owner.IsDisposed) this.Show(_owner);
            else this.Show();
            return await _tcs.Task;
        }

        private async void OnShown(object sender, EventArgs e)
        {
            try
            {
                Program.Info("打开登录窗口：platform=" + _def.Id + " url=" + _def.LoginUrl);
                // 登录窗口使用独立的 UserDataFolder，避免与主窗口的 WebView2 争用同一 profile
                string dir = Path.Combine(Program.DataDir, "login");
                Directory.CreateDirectory(dir);
                CoreWebView2Environment env = _loginEnv;
                if (env == null)
                {
                    CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions(
                        "--autoplay-policy=no-user-gesture-required --allow-running-insecure-content");
                    env = await CoreWebView2Environment.CreateAsync(null, dir, options);
                    _loginEnv = env;
                }
                await _web.EnsureCoreWebView2Async(env);
                _initialized = true;
                CoreWebView2 core = _web.CoreWebView2;
                core.NewWindowRequested += OnNewWindowRequested;
                core.NavigationCompleted += OnNavigationCompleted;
                core.Navigate(_def.LoginUrl);
            }
            catch (Exception ex)
            {
                Program.Log("登录窗口初始化失败", ex);
                _status.Text = "登录页初始化失败：" + ex.Message;
                _tcs.TrySetResult(new List<Cookie>());
            }
        }

        private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            // 登录页里的弹窗/新窗口都留在同一个 WebView 里，保证 cookie 落在同一 profile
            e.Handled = true;
            try
            {
                if (_web.CoreWebView2 != null) _web.CoreWebView2.Navigate(e.Uri);
            }
            catch (Exception)
            {
            }
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            try
            {
                Program.Info("登录页导航完成 success=" + e.IsSuccess
                    + (e.IsSuccess ? "" : " status=" + e.WebErrorStatus));
            }
            catch (Exception)
            {
            }
        }

        private async void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (_capturing || _tcs.Task.IsCompleted) return;
            e.Cancel = true;
            _capturing = true;
            _status.Text = "正在读取登录状态…";

            List<Cookie> cookies = new List<Cookie>();
            try
            {
                if (_initialized && _web.CoreWebView2 != null)
                {
                    HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
                    for (int i = 0; i < _def.CaptureUrls.Length; i++)
                    {
                        string url = _def.CaptureUrls[i];
                        try
                        {
                            List<CoreWebView2Cookie> list = await _web.CoreWebView2.CookieManager.GetCookiesAsync(url);
                            if (list == null) continue;
                            for (int j = 0; j < list.Count; j++)
                            {
                                CoreWebView2Cookie c = list[j];
                                if (c == null) continue;
                                string key = c.Domain + "|" + c.Path + "|" + c.Name;
                                if (!seen.Add(key)) continue;
                                try
                                {
                                    Cookie nc = c.ToSystemNetCookie();
                                    if (nc != null) cookies.Add(nc);
                                }
                                catch (Exception)
                                {
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            Program.Log("抓取 cookie 失败 " + url, ex);
                        }
                    }
                }
            }
            finally
            {
                Program.Info("登录窗口关闭，抓取 cookie " + cookies.Count + " 条（不含值）");
                _tcs.TrySetResult(cookies);
                this.Close();
            }
        }

        private void OnFormClosed(object sender, FormClosedEventArgs e)
        {
            _tcs.TrySetResult(new List<Cookie>());
        }
    }
}
