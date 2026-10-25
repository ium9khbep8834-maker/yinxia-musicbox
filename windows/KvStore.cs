using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace MusicBox
{
    /// <summary>键值存储：%LOCALAPPDATA%\MusicBox\kv.json</summary>
    internal class KvStore
    {
        private readonly string _path;
        private readonly Dictionary<string, string> _map = new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly object _lock = new object();

        public KvStore()
        {
            _path = Path.Combine(Program.DataDir, "kv.json");
            Load();
        }

        public string Get(string key)
        {
            if (key == null) return null;
            lock (_lock)
            {
                string v;
                if (_map.TryGetValue(key, out v)) return v;
                return null;
            }
        }

        public void Set(string key, string value)
        {
            if (key == null) return;
            lock (_lock)
            {
                _map[key] = value == null ? "" : value;
                Save();
            }
        }

        private void Load()
        {
            try
            {
                if (!File.Exists(_path)) return;
                string text = File.ReadAllText(_path, Encoding.UTF8);
                Dictionary<string, object> root = Json.ParseObject(text);
                foreach (KeyValuePair<string, object> kv in root)
                {
                    if (kv.Key == null) continue;
                    _map[kv.Key] = kv.Value == null ? "" : Convert.ToString(kv.Value, System.Globalization.CultureInfo.InvariantCulture);
                }
                Program.Info("kv 已加载，共 " + _map.Count + " 项");
            }
            catch (Exception ex)
            {
                Program.Log("kv 加载失败", ex);
            }
        }

        private void Save()
        {
            try
            {
                string json = Json.Serialize(_map);
                string tmp = _path + ".tmp";
                File.WriteAllText(tmp, json, new UTF8Encoding(false));
                if (File.Exists(_path)) File.Delete(_path);
                File.Move(tmp, _path);
            }
            catch (Exception ex)
            {
                Program.Log("kv 保存失败", ex);
            }
        }
    }
}
