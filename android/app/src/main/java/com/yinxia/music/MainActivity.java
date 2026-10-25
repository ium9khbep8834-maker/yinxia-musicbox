package com.yinxia.music;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * 主界面：一个 WebView 装载 https://app.local/index.html。
 * 该虚拟域名的所有请求由 {@link BridgeServer} 接管（静态资源 → assets/web，/api/* → 原生桥接）。
 */
public class MainActivity extends Activity {

    private static final String TAG = "MusicBox";
    static final String PAGE_URL = "https://app.local/index.html";
    private static final int REQ_LOGIN = 1001;

    /** 登录回调：rawCookie 为 "k=v; k2=v2"；error 非 null 表示失败/取消。 */
    interface LoginCallback {
        void onLoginResult(String rawCookie, String error);
    }

    private WebView webView;
    private BridgeServer bridge;
    private LoginCallback pendingLogin;
    private boolean selftestRan = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge = new BridgeServer(this);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF101014);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= 21) {
            // 音频/封面多为 http 明文，虚拟域名是 https，必须放行混合内容
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setLoadsImagesAutomatically(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setDefaultTextEncodingName("utf-8");
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= 21) cm.setAcceptThirdPartyCookies(webView, true);
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return bridge.handleRequest(request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) return false;
                Uri u = request.getUrl();
                String host = u.getHost();
                if (host != null && host.equalsIgnoreCase("app.local")) return false;
                // 站外链接交给系统处理（登录在 LoginActivity 内完成）
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Throwable ignored) {
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.i(TAG, "page finished: " + url);
                maybeSelfTest();
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                Log.w(TAG, "page error " + errorCode + " " + description + " " + failingUrl);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                // 页面 console 统一进 logcat，selftest 结果 tag=MusicBoxTest
                String msg = cm.message() == null ? "" : cm.message();
                Log.i("MusicBoxTest", msg + " @" + cm.lineNumber());
                return true;
            }
        });

        webView.loadUrl(PAGE_URL);
    }

    /** 由 BridgeServer 在主线程调用：打开登录页，返回后回调。 */
    void startLogin(String platform, LoginCallback cb) {
        if (pendingLogin != null) {
            LoginCallback old = pendingLogin;
            pendingLogin = null;
            old.onLoginResult(null, "superseded");
        }
        pendingLogin = cb;
        Intent i = new Intent(this, LoginActivity.class);
        i.putExtra(LoginActivity.EXTRA_PLATFORM, platform);
        try {
            startActivityForResult(i, REQ_LOGIN);
        } catch (Throwable t) {
            pendingLogin = null;
            cb.onLoginResult(null, "cannot start login: " + t.getClass().getSimpleName());
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_LOGIN) return;
        LoginCallback cb = pendingLogin;
        pendingLogin = null;
        if (cb == null) return;
        if (resultCode != RESULT_OK || data == null) {
            cb.onLoginResult(null, "cancelled");
            return;
        }
        String platform = data.getStringExtra("platform");
        String cookie = data.getStringExtra("cookie");
        Log.i(TAG, "login activity returned for platform=" + platform
                + " cookieEntries=" + countEntries(cookie)); // 只记条数，绝不记值
        cb.onLoginResult(cookie, null);
    }

    private static int countEntries(String cookie) {
        if (cookie == null || cookie.trim().isEmpty()) return 0;
        int n = 0;
        for (String part : cookie.split(";")) {
            if (part.indexOf('=') > 0) n++;
        }
        return n;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        LoginCallback cb = pendingLogin;
        pendingLogin = null;
        if (cb != null) cb.onLoginResult(null, "activity destroyed");
        if (webView != null) {
            try {
                webView.stopLoading();
            } catch (Throwable ignored) {
            }
        }
        super.onDestroy();
    }

    // ------------------------------------------------------------------ selftest

    private void maybeSelfTest() {
        if (selftestRan) return;
        if (!getIntent().getBooleanExtra("selftest", false)) return;
        selftestRan = true;
        String js = "(function(){var out=function(m){console.log('SELFTEST '+m)};"
                + "window.Bridge.state().then(function(st){out('state='+JSON.stringify(st));"
                + "return Bridge.kvSet('selftest_ts',''+Date.now());})"
                + ".then(function(){return Bridge.kvGet('selftest_ts');})"
                + ".then(function(v){out('kv='+((v==null)?'NULL':String(v).length));"
                + "return Bridge.proxy({platform:'netease',url:'https://music.163.com/api/cloudsearch/pc?s=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=1&limit=1&offset=0',method:'GET',headers:{'Referer':'https://music.163.com/'}});})"
                + ".then(function(r){out('proxy_status='+r.status+' body_len='+((r.body||'').length));"
                + "try{var j=JSON.parse(r.body||'{}');out('search_count='+((j.result&&j.result.songs&&j.result.songs.length)||0));}catch(e){out('parse_error');}})"
                + ".catch(function(e){out('ERROR '+e);});})();";
        webView.evaluateJavascript(js, null);
    }
}
