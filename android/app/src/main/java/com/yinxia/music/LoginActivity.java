package com.yinxia.music;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 平台登录页：内嵌第二个 WebView，用户自行登录，点「完成」/返回后
 * 用 CookieManager.getCookie 抓取 cookie 串回传 MainActivity。
 * cookie 值只放进 Intent extras / 内存，不打印。
 */
public class LoginActivity extends Activity {

    private static final String TAG = "MusicBoxLogin";
    static final String EXTRA_PLATFORM = "platform";

    private String platform = "";
    private WebView webView;
    private boolean collected = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        platform = getIntent().getStringExtra(EXTRA_PLATFORM);
        if (platform == null) platform = "";
        platform = platform.trim().toLowerCase(Locale.ROOT);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFFFFFFFF);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(12), dp(6), dp(8), dp(6));
        bar.setBackgroundColor(0xFFF3F3F5);
        TextView title = new TextView(this);
        title.setText("登录 " + labelOf(platform));
        title.setTextSize(16);
        title.setTextColor(0xFF222222);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button done = new Button(this);
        done.setText("完成");
        done.setAllCaps(false);
        done.setOnClickListener(v -> finishAndCollect());
        bar.addView(done);
        root.addView(bar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        webView = new WebView(this);
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        if (Build.VERSION.SDK_INT >= 21) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        s.setAllowFileAccess(false);
        s.setDefaultTextEncodingName("utf-8");
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= 21) cm.setAcceptThirdPartyCookies(webView, true);
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);

        // 登录流程整段留在内嵌 WebView（不跳外部浏览器），所有导航都放行
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        webView.loadUrl(loginUrl(platform));
    }

    @Override
    public void onBackPressed() {
        finishAndCollect();
    }

    private void finishAndCollect() {
        if (collected) return;
        collected = true;
        String cookie = collectCookies();
        try {
            CookieManager.getInstance().flush();
        } catch (Throwable ignored) {
        }
        Log.i(TAG, "collect cookies for " + platform + ": entries=" + countEntries(cookie)); // 只记条数
        Intent data = new Intent();
        data.putExtra("platform", platform);
        data.putExtra("cookie", cookie);
        setResult(RESULT_OK, data);
        finish();
    }

    /** 汇总各相关域 cookie，按名字去重（后取到的覆盖先取到的）。 */
    private String collectCookies() {
        LinkedHashMap<String, String> merged = new LinkedHashMap<>();
        CookieManager cm = CookieManager.getInstance();
        for (String url : BridgeServer.cookieUrlsFor(platform)) {
            String raw;
            try {
                raw = cm.getCookie(url);
            } catch (Throwable t) {
                raw = null;
            }
            if (raw == null || raw.trim().isEmpty()) continue;
            for (String part : raw.split(";")) {
                String p = part.trim();
                if (p.isEmpty()) continue;
                int eq = p.indexOf('=');
                if (eq <= 0) continue;
                merged.put(p.substring(0, eq).trim(), p.substring(eq + 1).trim());
            }
        }
        if (merged.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : merged.entrySet()) {
            if (sb.length() > 0) sb.append("; ");
            sb.append(e.getKey()).append('=').append(e.getValue());
        }
        return sb.toString();
    }

    private static int countEntries(String cookie) {
        if (cookie == null || cookie.trim().isEmpty()) return 0;
        int n = 0;
        for (String part : cookie.split(";")) {
            if (part.indexOf('=') > 0) n++;
        }
        return n;
    }

    private static String loginUrl(String platform) {
        if ("netease".equals(platform)) return "https://music.163.com/";
        if ("qq".equals(platform)) return "https://y.qq.com/";
        if ("kugou".equals(platform)) return "https://www.kugou.com/";
        return "about:blank";
    }

    private static String labelOf(String platform) {
        if ("netease".equals(platform)) return "网易云音乐";
        if ("qq".equals(platform)) return "QQ 音乐";
        if ("kugou".equals(platform)) return "酷狗音乐";
        return platform;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            try {
                webView.stopLoading();
                webView.setWebChromeClient(null);
                webView.destroy();
            } catch (Throwable ignored) {
            }
            webView = null;
        }
        super.onDestroy();
    }
}
