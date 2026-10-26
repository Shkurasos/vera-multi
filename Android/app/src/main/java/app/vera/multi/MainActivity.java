package app.vera.multi;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayList;
import java.util.List;

/**
 * VERA Multi для Android: WebView-обёртка над веб-клиентом.
 *
 * Офлайн работает так же, как в браузере и в десктопе: сервис-воркер клиента
 * кэширует оболочку приложения и медиа, IndexedDB хранит последние 10 сообщений
 * каждого чата, музыку и аватары, localStorage — тему и настройки. Данные WebView
 * лежат в приватной папке приложения и переживают перезапуск.
 * Если клиента ещё нет в кэше и сети нет — показываем локальную страницу «нет сети».
 */
public class MainActivity extends Activity {
    private static final int REQ_FILE = 1001;
    private static final int REQ_PERMS = 1002;
    private static final String OFFLINE_PAGE = "file:///android_asset/offline.html";

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;
    /** Server address: written into the APK by the site at download time, otherwise from the build. */
    private static String serverUrl = BuildConfig.SERVER_URL;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        serverUrl = ServerStamp.resolve(this);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0F0F17"));
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);           // localStorage: тема, настройки
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);            // file:///android_asset остаётся доступен
        s.setAllowContentAccess(true);          // выбор файлов из галереи
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // Без сети — берём из HTTP-кэша даже устаревшее (поверх кэша SW).
        s.setCacheMode(isOnline() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new VeraClient());
        webView.setWebChromeClient(new VeraChrome());

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(startUrl(getIntent()));
        }
    }

    /** Стартовый адрес: сервер или ссылка привязки vera://link?token=... */
    private String startUrl(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && "vera".equals(data.getScheme()) && data.getHost() != null) {
            Uri.Builder b = Uri.parse(serverUrl).buildUpon()
                    .path("/" + data.getHost() + (data.getPath() != null ? data.getPath() : ""));
            if (data.getEncodedQuery() != null) b.encodedQuery(data.getEncodedQuery());
            return b.build().toString();
        }
        return serverUrl;
    }

    private boolean isOnline() {
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        if (cm == null) return true;
        NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private static boolean isServerUrl(Uri uri) {
        Uri server = Uri.parse(serverUrl);
        return uri != null && server.getHost() != null && server.getHost().equalsIgnoreCase(uri.getHost());
    }

    private void showOffline() {
        webView.loadUrl(OFFLINE_PAGE + "?server=" + Uri.encode(serverUrl));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent.getData() != null) webView.loadUrl(startUrl(intent));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
    private class VeraClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isServerUrl(uri) || "file".equals(uri.getScheme())) return false;
            // Внешние ссылки — в браузер/приложение системы.
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException ignored) { /* нечем открыть */ }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && isServerUrl(request.getUrl())) showOffline();
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            // Render отдаёт 502/503, пока сервис просыпается или упал.
            if (request.isForMainFrame() && isServerUrl(request.getUrl()) && response.getStatusCode() >= 500) showOffline();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            view.getSettings().setCacheMode(isOnline() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        }
    }

    private class VeraChrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                startActivityForResult(params.createIntent(), REQ_FILE);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            // Доступ к камере/микрофону даём только нашему серверу.
            if (!isServerUrl(request.getOrigin())) { request.deny(); return; }
            List<String> missing = new ArrayList<>();
            for (String r : request.getResources()) {
                String p = PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) ? Manifest.permission.RECORD_AUDIO
                        : PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) ? Manifest.permission.CAMERA : null;
                if (p != null && checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
            }
            if (missing.isEmpty()) { request.grant(request.getResources()); return; }
            if (pendingPermission != null) pendingPermission.deny();
            pendingPermission = request;
            requestPermissions(missing.toArray(new String[0]), REQ_PERMS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQ_PERMS || pendingPermission == null) return;
        boolean all = results.length > 0;
        for (int r : results) all &= r == PackageManager.PERMISSION_GRANTED;
        if (all) pendingPermission.grant(pendingPermission.getResources());
        else pendingPermission.deny();
        pendingPermission = null;
    }

    @SuppressWarnings("deprecation")
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) return;
        fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
        fileCallback = null;
    }
}
