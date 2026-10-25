using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MusicBox
{
    internal class MainForm : Form
    {
        private readonly WebView2 _web;
        private readonly Label _banner;
        private CoreWebView2Environment _env;
        private Bridge _bridge;
        private string _webDir;
        private bool _navOk;

        public MainForm()
        {
            Text = "音匣 MusicBox";
            Width = 1180;
            Height = 820;
            MinimumSize = new Size(900, 620);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(22, 22, 26);
            try
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch (Exception)
            {
            }

            _banner = new Label();
            _banner.Dock = DockStyle.Top;
            _banner.Height = 0;
            _banner.Visible = false;
            _banner.BackColor = Color.FromArgb(160, 40, 40);
            _banner.ForeColor = Color.White;
            _banner.TextAlign = ContentAlignment.MiddleLeft;
            _banner.Padding = new Padding(12, 0, 0, 0);

            _web = new WebView2();
            _web.Dock = DockStyle.Fill;
            _web.DefaultBackgroundColor = Color.FromArgb(22, 22, 26);

            Controls.Add(_web);
            Controls.Add(_banner);

            Shown += OnShown;
            Resize += delegate
            {
                if (WindowState == FormWindowState.Minimized) return;
            };
        }

        private async void OnShown(object sender, EventArgs e)
        {
            await InitAsync();
        }

        private async Task InitAsync()
        {
            try
            {
                _webDir = LocateWebDir();
                Program.Info("web 目录：" + (_webDir == null ? "(未找到)" : _webDir));
                if (_webDir == null)
                {
                    ShowBanner("找不到 web 目录，无法加载界面。请确认 exe 同级有 web\\index.html。");
                    return;
                }

                // 主窗口使用独立 profile（与登录窗口分开，避免争用）
                string profile = Path.Combine(Program.DataDir, "web");
                try { Directory.CreateDirectory(profile); }
                catch (Exception) { }
                // 允许无用户手势自动播放（解决 play() 被自动播放策略拦截：自动下一首 / 连播依赖它）
                // 同时放行 https 页面里加载的 http 音频直链（混合内容），避免部分曲源被拦
                CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions(
                    "--autoplay-policy=no-user-gesture-required --allow-running-insecure-content");
                _env = await CoreWebView2Environment.CreateAsync(null, profile, options);
                await _web.EnsureCoreWebView2Async(_env);
                CoreWebView2 core = _web.CoreWebView2;
                if (core == null)
                {
                    ShowBanner("WebView2 初始化失败：CoreWebView2 为空。");
                    return;
                }

                core.Settings.AreDevToolsEnabled = true;
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.AreHostObjectsAllowed = false;

                core.NewWindowRequested += OnNewWindowRequested;
                core.NavigationCompleted += OnNavigationCompleted;
                core.ProcessFailed += OnProcessFailed;
                core.DocumentTitleChanged += delegate
                {
                    try
                    {
                        string t = core.DocumentTitle;
                        if (string.IsNullOrEmpty(t)) return;
                        // 页面标题本身就是「音匣 MusicBox」时不再追加，避免重复
                        Text = t.IndexOf("MusicBox", StringComparison.OrdinalIgnoreCase) >= 0
                            ? t : t + " — 音匣 MusicBox";
                    }
                    catch (Exception) { }
                };

                // 仓库 web 目录 -> https://app.local/（由 Bridge 自己服务静态文件；
                // 不用 SetVirtualHostNameToFolderMapping，因为映射主机不触发 WebResourceRequested）
                _bridge = new Bridge(core, _env, this, _webDir);
                _bridge.Init();

                Program.Info("导航到 https://app.local/index.html");
                core.Navigate("https://app.local/index.html");
            }
            catch (Exception ex)
            {
                Program.Log("主窗口初始化失败", ex);
                ShowBanner("WebView2 初始化失败：" + ex.Message + "（详见 error.log）");
            }
        }

        private void ShowBanner(string text)
        {
            _banner.Height = 44;
            _banner.Visible = true;
            _banner.Text = text;
            _banner.BringToFront();
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            try
            {
                Program.Info("导航完成 success=" + e.IsSuccess
                    + (e.IsSuccess ? "" : " status=" + e.WebErrorStatus));
                if (!e.IsSuccess)
                {
                    ShowBanner("页面加载失败：" + e.WebErrorStatus + "（" + (e.HttpStatusCode > 0 ? "HTTP " + e.HttpStatusCode : "网络/映射错误") + "）");
                    return;
                }
                _navOk = true;
                if (!string.IsNullOrEmpty(Program.SelfTestDir))
                {
                    string dir = Program.SelfTestDir;
                    Task t = SelfTest.RunAsync(_web.CoreWebView2, dir);
                    t.ContinueWith(delegate
                    {
                        Program.Info("自检完成，退出。");
                        try { this.BeginInvoke((Action)delegate { this.Close(); }); }
                        catch (Exception) { }
                    });
                }
            }
            catch (Exception ex)
            {
                Program.Log("NavigationCompleted 处理异常", ex);
            }
        }

        private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            // 页面内的外链交给系统浏览器
            e.Handled = true;
            try
            {
                Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                Program.Log("打开外链失败", ex);
            }
        }

        private void OnProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs e)
        {
            Program.Info("WebView2 进程失败 kind=" + e.ProcessFailedKind);
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
            {
                ShowBanner("WebView2 浏览器进程已退出，请重启应用。");
            }
        }

        public bool NavigationOk
        {
            get { return _navOk; }
        }

        /// <summary>定位 web 目录：优先 exe 同级 web\，其次向上找源码树里的 musicapp\web\。</summary>
        private static string LocateWebDir()
        {
            string exeDir = Program.ExeDir;
            string direct = Path.Combine(exeDir, "web");
            if (File.Exists(Path.Combine(direct, "index.html"))) return direct;

            DirectoryInfo di = new DirectoryInfo(exeDir);
            for (int i = 0; i < 6 && di != null; i++)
            {
                string candidate = Path.Combine(di.FullName, "web");
                if (File.Exists(Path.Combine(candidate, "index.html"))) return candidate;
                string nested = Path.Combine(di.FullName, "musicapp", "web");
                if (File.Exists(Path.Combine(nested, "index.html"))) return nested;
                di = di.Parent;
            }

            string fixedPath = "D:\\ds工作区\\musicapp\\web";
            if (File.Exists(Path.Combine(fixedPath, "index.html"))) return fixedPath;
            return null;
        }
    }
}
