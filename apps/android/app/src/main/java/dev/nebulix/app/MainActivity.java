package dev.nebulix.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Nebulix for Android: a hardened, game-friendly window onto Nebulix.
 * Security: HTTPS only, only Nebulix's own addresses load inside the app (everything else opens in your normal browser),
 * no JavaScript bridge into Android, no file access, Safe Browsing on. Camera and microphone are asked only when a
 * Nebulix page needs them (voice rooms, video calls).
 * Games: hardware acceleration, full screen with the system bars hidden, gamepad support, media without extra taps.
 * If the main address does not answer, the app tries the mirror addresses of the same server.
 */
public class MainActivity extends Activity {
    private static final List<String> ADDRESSES = Arrays.asList(
            "https://nebulix.fly.dev", "https://nebulix-play.fly.dev", "https://nebulix-zone.fly.dev", "https://nebulix-hq.fly.dev");
    private static final int REQ_FILE = 41, REQ_MEDIA = 42;
    private WebView web;
    private FrameLayout fullscreen;
    private View customView;
    private int addressIndex = 0;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;
    private WebChromeClient chrome;

    static boolean isNebulixHost(String host) {
        if (host == null) return false;
        host = host.toLowerCase();
        return host.equals("nebulix.fly.dev") || (host.startsWith("nebulix-") && host.endsWith(".fly.dev"));
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED, WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
        fullscreen = new FrameLayout(this);
        fullscreen.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        fullscreen.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(fullscreen);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " NebulixApp/1.0");
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true); // the Nebulix browser and games domains run in frames
        web.setBackgroundColor(Color.BLACK);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("https".equals(u.getScheme()) && isNebulixHost(u.getHost())) return false;
                // anything else (other websites, mail, store links) opens outside the app
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame() && addressIndex < ADDRESSES.size() - 1) { addressIndex++; view.loadUrl(ADDRESSES.get(addressIndex)); }
            }
        });
        chrome = new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (!isNebulixHost(request.getOrigin().getHost())) { request.deny(); return; }
                List<String> need = new ArrayList<>();
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) need.add(Manifest.permission.CAMERA);
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) need.add(Manifest.permission.RECORD_AUDIO);
                }
                boolean granted = true;
                for (String p : need) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) granted = false;
                if (granted) request.grant(request.getResources());
                else { pendingPermission = request; requestPermissions(need.toArray(new String[0]), REQ_MEDIA); }
            }
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try { startActivityForResult(params.createIntent(), REQ_FILE); } catch (Exception e) { fileCallback = null; return false; }
                return true;
            }
            // HTML5 full screen (videos, games, emulators)
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                customView = view; fullscreen.addView(view, new FrameLayout.LayoutParams(-1, -1)); web.setVisibility(View.GONE); immersive(true);
            }
            @Override
            public void onHideCustomView() {
                if (customView != null) fullscreen.removeView(customView); customView = null; web.setVisibility(View.VISIBLE); immersive(false);
            }
        };
        web.setWebChromeClient(chrome);
        if (state != null) web.restoreState(state); else web.loadUrl(ADDRESSES.get(0));
    }

    @SuppressWarnings("deprecation")
    private void immersive(boolean on) {
        getWindow().getDecorView().setSystemUiVisibility(on
                ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                : View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        if (req == REQ_FILE && fileCallback != null) { fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data)); fileCallback = null; return; }
        super.onActivityResult(req, result, data);
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        if (req == REQ_MEDIA && pendingPermission != null) {
            boolean ok = results.length > 0; for (int r : results) if (r != PackageManager.PERMISSION_GRANTED) ok = false;
            if (ok) pendingPermission.grant(pendingPermission.getResources()); else pendingPermission.deny();
            pendingPermission = null;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (customView != null) { chrome.onHideCustomView(); return; }
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}
