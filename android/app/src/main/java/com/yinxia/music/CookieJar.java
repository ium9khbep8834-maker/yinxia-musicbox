package com.yinxia.music;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 平台 cookie 罐。
 *
 * 安全约束（AGENTS.md / DESIGN.md 3.3）：原始 cookie 值只存在于本类内存与
 * SharedPreferences 中，绝不写日志、不回显、不进入异常信息。
 */
final class CookieJar {

    private static final String PREFS = "mb_cookie_jar";
    private static final String KEY_PREFIX = "jar_";

    /** 判定「已登录」的 cookie 名（小写比较；键存在即视为登录过）。 */
    private static final String[] AUTH_NETEASE = {"music_u"};
    private static final String[] AUTH_QQ = {"qm_keyst", "qqmusic_key", "uin", "p_uin", "wxuin"};
    private static final String[] AUTH_KUGOU = {"kugoo", "kugou_token"};

    /** 手动导入时可能出现的 cookie 属性名，跳过。 */
    private static final String[] ATTRIBUTE_NAMES = {
        "path", "domain", "expires", "max-age", "secure", "httponly", "samesite", "priority", "version", "comment"
    };

    private final SharedPreferences sp;
    private final Map<String, LinkedHashMap<String, String>> cache = new LinkedHashMap<>();

    CookieJar(Context ctx) {
        this.sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private LinkedHashMap<String, String> load(String platform) {
        String p = platform == null ? "" : platform;
        LinkedHashMap<String, String> m = cache.get(p);
        if (m != null) return m;
        m = new LinkedHashMap<>();
        String raw = sp.getString(KEY_PREFIX + p, "");
        if (raw != null && !raw.isEmpty()) {
            try {
                JSONObject o = new JSONObject(raw);
                java.util.Iterator<String> it = o.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    String v = o.optString(k, "");
                    if (k != null && !k.isEmpty()) m.put(k, v);
                }
            } catch (JSONException ignored) {
                // 存量数据坏了就当空罐，绝不打印内容
            }
        }
        cache.put(p, m);
        return m;
    }

    private void save(String platform) {
        String p = platform == null ? "" : platform;
        LinkedHashMap<String, String> m = cache.get(p);
        JSONObject o = new JSONObject();
        if (m != null) {
            for (Map.Entry<String, String> e : m.entrySet()) {
                try {
                    o.put(e.getKey(), e.getValue());
                } catch (JSONException ignored) {
                }
            }
        }
        sp.edit().putString(KEY_PREFIX + p, o.toString()).apply();
    }

    /** 合并 "k1=v1; k2=v2" 串，覆盖同名键；返回本次写入的键数量。 */
    synchronized int merge(String platform, String rawCookie) {
        if (rawCookie == null) return 0;
        String trimmed = rawCookie.trim();
        if (trimmed.isEmpty()) return 0;
        LinkedHashMap<String, String> m = load(platform);
        int n = 0;
        for (String part : trimmed.split(";")) {
            String p = part.trim();
            if (p.isEmpty()) continue;
            int eq = p.indexOf('=');
            if (eq <= 0) continue;
            String name = p.substring(0, eq).trim();
            String value = p.substring(eq + 1).trim();
            if (name.isEmpty()) continue;
            if (isAttributeName(name)) continue;
            m.put(unquote(name), unquote(value));
            n++;
        }
        if (n > 0) save(platform);
        return n;
    }

    /** 处理上游 Set-Cookie（只取 name=value 段，属性丢弃）。 */
    synchronized void mergeSetCookie(String platform, String setCookie) {
        if (setCookie == null) return;
        int semi = setCookie.indexOf(';');
        String pair = semi >= 0 ? setCookie.substring(0, semi) : setCookie;
        merge(platform, pair);
    }

    /** 生成注入用的 Cookie 请求头；空罐返回 ""。 */
    synchronized String header(String platform) {
        LinkedHashMap<String, String> m = load(platform);
        if (m.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : m.entrySet()) {
            if (sb.length() > 0) sb.append("; ");
            sb.append(e.getKey()).append('=').append(e.getValue());
        }
        return sb.toString();
    }

    synchronized int count(String platform) {
        return load(platform).size();
    }

    synchronized void clear(String platform) {
        load(platform).clear();
        save(platform);
    }

    synchronized boolean hasAuth(String platform) {
        LinkedHashMap<String, String> m = load(platform);
        if (m.isEmpty()) return false;
        for (String name : authNames(platform)) {
            for (String k : m.keySet()) {
                if (k.equalsIgnoreCase(name)) return true;
            }
        }
        return false;
    }

    /** QQ 号（DESIGN.md 3.4：接口必需参数，可以返回给 JS）。解析不出返回 ""。 */
    synchronized String qqUin() {
        LinkedHashMap<String, String> m = load("qq");
        String[] names = {"uin", "p_uin", "qqmusic_uin", "wxuin"};
        for (String name : names) {
            String digits = digitsOf(valueIgnoreCase(m, name));
            if (!digits.isEmpty()) return digits;
        }
        return "";
    }

    /** 网易云 userId（DESIGN.md 3.4）。解析不出返回 ""。 */
    synchronized String neteaseUserId() {
        LinkedHashMap<String, String> m = load("netease");
        String[] names = {"userid", "user_id", "uid"};
        for (String name : names) {
            String digits = digitsOf(valueIgnoreCase(m, name));
            if (!digits.isEmpty()) return digits;
        }
        return "";
    }

    // ---------------------------------------------------------------- helpers

    private static boolean isAttributeName(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        for (String a : ATTRIBUTE_NAMES) {
            if (a.equals(lower)) return true;
        }
        return false;
    }

    private static String unquote(String s) {
        if (s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"")) {
            return s.substring(1, s.length() - 1);
        }
        return s;
    }

    private static String valueIgnoreCase(LinkedHashMap<String, String> m, String name) {
        for (Map.Entry<String, String> e : m.entrySet()) {
            if (e.getKey().equalsIgnoreCase(name)) return e.getValue();
        }
        return null;
    }

    /** "o0123456789" / "\"123\"" / "123" → "123456789"；非纯数字返回 ""。 */
    private static String digitsOf(String value) {
        if (value == null) return "";
        String v = unquote(value.trim());
        if (v.isEmpty()) return "";
        if (v.startsWith("o") || v.startsWith("O")) v = v.substring(1);
        int i = 0;
        while (i < v.length() - 1 && v.charAt(i) == '0') i++;
        v = v.substring(i);
        if (v.length() < 4 || v.length() > 12) return "";
        for (int k = 0; k < v.length(); k++) {
            if (!Character.isDigit(v.charAt(k))) return "";
        }
        return v;
    }

    private static String[] authNames(String platform) {
        if ("netease".equals(platform)) return AUTH_NETEASE;
        if ("qq".equals(platform)) return AUTH_QQ;
        if ("kugou".equals(platform)) return AUTH_KUGOU;
        return new String[0];
    }
}
