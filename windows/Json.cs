using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace MusicBox
{
    /// <summary>基于 System.Web.Script.Serialization 的轻量 JSON 辅助。</summary>
    internal static class Json
    {
        private static readonly JavaScriptSerializer Ser = CreateSerializer();

        private static JavaScriptSerializer CreateSerializer()
        {
            JavaScriptSerializer s = new JavaScriptSerializer();
            s.MaxJsonLength = int.MaxValue;
            s.RecursionLimit = 100;
            return s;
        }

        public static Dictionary<string, object> ParseObject(string text)
        {
            if (string.IsNullOrEmpty(text)) return new Dictionary<string, object>();
            try
            {
                Dictionary<string, object> d = Ser.Deserialize<Dictionary<string, object>>(text);
                if (d == null) return new Dictionary<string, object>();
                return d;
            }
            catch (Exception)
            {
                return new Dictionary<string, object>();
            }
        }

        public static string Str(Dictionary<string, object> o, string key)
        {
            if (o == null) return "";
            object v;
            if (!o.TryGetValue(key, out v) || v == null) return "";
            return Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture);
        }

        public static Dictionary<string, string> StrDict(Dictionary<string, object> o, string key)
        {
            Dictionary<string, string> result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (o == null) return result;
            object v;
            if (!o.TryGetValue(key, out v) || v == null) return result;
            Dictionary<string, object> src = v as Dictionary<string, object>;
            if (src == null) return result;
            foreach (KeyValuePair<string, object> kv in src)
            {
                if (kv.Value == null) continue;
                result[kv.Key] = Convert.ToString(kv.Value, System.Globalization.CultureInfo.InvariantCulture);
            }
            return result;
        }

        public static string Serialize(object o)
        {
            return Ser.Serialize(o);
        }
    }
}
