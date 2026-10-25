using System;
using System.IO;
using System.Text;
using System.Windows.Forms;

namespace MusicBox
{
    internal static class Program
    {
        /// <summary>自检输出目录；非空时启动后自动跑桥接自检并截图（仅调试用）。</summary>
        public static string SelfTestDir = null;

        private static readonly object LogLock = new object();
        private static string _exeDir;

        public static string ExeDir
        {
            get
            {
                if (_exeDir == null) _exeDir = AppDomain.CurrentDomain.BaseDirectory;
                return _exeDir;
            }
        }

        [STAThread]
        public static void Main(string[] args)
        {
            if (args != null)
            {
                for (int i = 0; i < args.Length; i++)
                {
                    string a = args[i];
                    if (a == "--selftest" && i + 1 < args.Length) SelfTestDir = args[i + 1];
                    else if (a.StartsWith("--selftest=", StringComparison.Ordinal)) SelfTestDir = a.Substring("--selftest=".Length);
                    else if (a == "--version") { Console.WriteLine("MusicBox 1.0.0"); return; }
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            Application.ThreadException += delegate(object sender, System.Threading.ThreadExceptionEventArgs e)
            {
                Log("ThreadException", e.Exception);
            };
            AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e)
            {
                Log("UnhandledException", e.ExceptionObject as Exception);
            };

            try
            {
                NativeMethods.SetProcessDPIAware();
            }
            catch (Exception)
            {
            }

            Info("==== MusicBox 启动，exe=" + Application.ExecutablePath + " ====");
            try
            {
                Application.Run(new MainForm());
            }
            catch (Exception ex)
            {
                Log("Fatal", ex);
                try
                {
                    MessageBox.Show("启动失败：" + ex.Message + "\r\n\r\n详细信息见：" + LogFilePath(),
                        "音匣 MusicBox", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                catch (Exception)
                {
                }
            }
            Info("==== MusicBox 退出 ====");
        }

        public static string DataDir
        {
            get
            {
                string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MusicBox");
                try { Directory.CreateDirectory(dir); }
                catch (Exception) { }
                return dir;
            }
        }

        public static string LogFilePath()
        {
            return Path.Combine(DataDir, "app.log");
        }

        public static void Info(string message)
        {
            Write(message);
        }

        public static void Log(string tag, Exception ex)
        {
            string text = "[" + tag + "] ";
            if (ex == null)
            {
                text = text + "(null)";
            }
            else
            {
                text = text + ex.GetType().Name + ": " + ex.Message + "\r\n" + ex.StackTrace;
                Exception inner = ex.InnerException;
                int depth = 0;
                while (inner != null && depth < 4)
                {
                    text = text + "\r\n  --> " + inner.GetType().Name + ": " + inner.Message;
                    inner = inner.InnerException;
                    depth++;
                }
            }
            Write(text);
        }

        private static void Write(string message)
        {
            string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + message + "\r\n";
            lock (LogLock)
            {
                // 1) %LOCALAPPDATA%\MusicBox\app.log
                try
                {
                    File.AppendAllText(Path.Combine(DataDir, "app.log"), line, new UTF8Encoding(false));
                }
                catch (Exception) { }
                // 2) exe 同目录 error.log（便于绿色版排查）
                try
                {
                    File.AppendAllText(Path.Combine(ExeDir, "error.log"), line, new UTF8Encoding(false));
                }
                catch (Exception) { }
            }
        }
    }

    internal static class NativeMethods
    {
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();
    }
}
