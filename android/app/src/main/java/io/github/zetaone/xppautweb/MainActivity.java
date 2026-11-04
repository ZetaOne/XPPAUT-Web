package io.github.zetaone.xppautweb;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * XPPAUT-Web as an Android app: the website (bundled in assets/www) in a
 * WebView, plus what a browser cannot do well on a phone: opening .ode files
 * from other apps, saving to Downloads, Back = Esc, keeping the screen on.
 * The page side of this is src/android.ts.
 */
public class MainActivity extends Activity {
    /** the bundled site is served from this https origin (needed for WebAssembly) */
    static final String HOST = "appassets.androidplatform.net";
    static final String HOME = "https://" + HOST + "/index.html";
    static final int PICK_FILES = 1;

    private WebView web;
    private ValueCallback<Uri[]> pickCallback;
    private final List<String[]> pendingFiles = new ArrayList<>(); // {name, base64}
    private boolean pageReady = false;
    private long lastBack = 0;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0)
            WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setTextZoom(100); // XPP's windows are pixel-exact; the page has its own zoom
        s.setSupportMultipleWindows(true); // help opens in a dialog (see onCreateWindow)
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Bridge(), "XppAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        setContentView(web);
        if (state != null) web.restoreState(state);
        else web.loadUrl(HOME);
        handleIntent(getIntent());
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    // ---- Back = Esc for XPP; Back twice quickly leaves the app
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        long now = System.currentTimeMillis();
        if (now - lastBack < 800) {
            finish();
            return;
        }
        lastBack = now;
        web.evaluateJavascript("window.xppAppBack ? xppAppBack() : 'exit'", r -> {
            if (r != null && r.contains("exit")) {
                Toast.makeText(this, "Press Back again to close XPPAUT", Toast.LENGTH_SHORT).show();
            }
        });
    }

    // ---- serving the bundled website
    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            return asset(u.getPath());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (HOST.equals(u.getHost())) return false;
            // links to other sites open in the browser
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (ActivityNotFoundException e) { /* nothing to open it with */ }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            pageReady = false;
        }
    }

    private static final Map<String, String> TYPES = new HashMap<>();
    static {
        TYPES.put("html", "text/html");
        TYPES.put("js", "text/javascript");
        TYPES.put("mjs", "text/javascript");
        TYPES.put("css", "text/css");
        TYPES.put("json", "application/json");
        TYPES.put("wasm", "application/wasm");
        TYPES.put("png", "image/png");
        TYPES.put("gif", "image/gif");
        TYPES.put("jpg", "image/jpeg");
        TYPES.put("svg", "image/svg+xml");
        TYPES.put("ico", "image/x-icon");
    }

    private WebResourceResponse asset(String path) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        String file = "www" + Uri.decode(path);
        String ext = file.substring(file.lastIndexOf('.') + 1).toLowerCase();
        String type = TYPES.containsKey(ext) ? TYPES.get(ext) : "text/plain";
        try {
            InputStream in = getAssets().open(file);
            WebResourceResponse r = new WebResourceResponse(type, type.startsWith("text") || type.endsWith("json") ? "utf-8" : null, in);
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-cache");
            r.setResponseHeaders(h);
            return r;
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
        }
    }

    // ---- file picker (Open .ode file…, Add files…) and XPP's help window
    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (pickCallback != null) pickCallback.onReceiveValue(null);
            pickCallback = cb;
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            try {
                startActivityForResult(i, PICK_FILES);
            } catch (ActivityNotFoundException e) {
                pickCallback = null;
                return false;
            }
            return true;
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message msg) {
            // window.open (XPP's help): show it in a full-screen dialog
            Dialog d = new Dialog(MainActivity.this, android.R.style.Theme_DeviceDefault_NoActionBar);
            LinearLayout box = new LinearLayout(MainActivity.this);
            box.setOrientation(LinearLayout.VERTICAL);
            Button close = new Button(MainActivity.this);
            close.setText("Close help");
            close.setGravity(Gravity.CENTER);
            WebView w = new WebView(MainActivity.this);
            w.getSettings().setJavaScriptEnabled(true);
            w.setWebViewClient(new Client());
            box.addView(close, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            box.addView(w, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
            d.setContentView(box);
            close.setOnClickListener(v -> d.dismiss());
            d.setOnDismissListener(x -> w.destroy());
            d.show();
            ((WebView.WebViewTransport) msg.obj).setWebView(w);
            msg.sendToTarget();
            return true;
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_FILES || pickCallback == null) return;
        Uri[] uris = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                uris = new Uri[data.getClipData().getItemCount()];
                for (int i = 0; i < uris.length; i++) uris[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                uris = new Uri[] { data.getData() };
            }
        }
        pickCallback.onReceiveValue(uris);
        pickCallback = null;
    }

    // ---- "Open with XPPAUT" / "Share to XPPAUT" from other apps
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        if (uris.isEmpty()) return;
        List<String[]> files = new ArrayList<>();
        for (Uri u : uris) {
            try {
                files.add(new String[] { displayName(u), Base64.encodeToString(read(u), Base64.NO_WRAP) });
            } catch (IOException | SecurityException e) {
                android.util.Log.w("XPPAUT", "cannot read " + u, e);
                Toast.makeText(this, "Cannot read " + u.getLastPathSegment(), Toast.LENGTH_LONG).show();
            }
        }
        if (files.isEmpty()) return;
        intent.setAction(null); // handled
        openFiles(files);
    }

    /** start XPP with these files; asks first if a session is running */
    private void openFiles(List<String[]> files) {
        if (!pageReady) {
            pendingFiles.clear();
            pendingFiles.addAll(files);
            return;
        }
        web.evaluateJavascript("window.xppAppRunning && xppAppRunning()", running -> {
            if (!"true".equals(running)) {
                pendingFiles.clear();
                pendingFiles.addAll(files);
                deliverPending();
                return;
            }
            new AlertDialog.Builder(this)
                .setTitle("Open " + files.get(0)[0] + "?")
                .setMessage("XPP is running. Opening this file restarts XPP; unsaved work in the current session is lost (use Save session first to keep it).")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Open", (d, w) -> {
                    pendingFiles.clear();
                    pendingFiles.addAll(files);
                    pageReady = false;
                    web.loadUrl(HOME); // fresh start; files go in when it is ready
                })
                .show();
        });
    }

    private void deliverPending() {
        if (pendingFiles.isEmpty()) return;
        StringBuilder js = new StringBuilder("xppAppOpen([");
        for (String[] f : pendingFiles) {
            js.append("{name:").append(jsString(f[0])).append(",b64:'").append(f[1]).append("'},");
        }
        js.append("])");
        pendingFiles.clear();
        web.evaluateJavascript(js.toString(), null);
    }

    private String displayName(Uri u) {
        try (Cursor c = getContentResolver().query(u, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception e) { /* fall through */ }
        String last = u.getLastPathSegment();
        return last != null ? last.substring(last.lastIndexOf('/') + 1) : "model.ode";
    }

    private byte[] read(Uri u) throws IOException {
        try (InputStream in = getContentResolver().openInputStream(u)) {
            if (in == null) throw new IOException("no data");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private static String jsString(String s) {
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ") + "'";
    }

    // ---- called from the page (src/android.ts)
    private class Bridge {
        @JavascriptInterface
        public void ready() {
            ui.post(() -> {
                pageReady = true;
                deliverPending();
            });
        }

        @JavascriptInterface
        public void setKeepScreenOn(boolean on) {
            ui.post(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        /** save in Downloads/XPPAUT; session .zip files also offer Share */
        @JavascriptInterface
        public void saveFile(String name, String mime, String base64) {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, name);
            v.put(MediaStore.Downloads.MIME_TYPE, mime);
            v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/XPPAUT");
            Uri uri = null;
            try {
                uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IOException("cannot create the file");
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new IOException("cannot write the file");
                    out.write(data);
                }
            } catch (IOException e) {
                ui.post(() -> Toast.makeText(MainActivity.this, "Could not save " + name + ": " + e.getMessage(), Toast.LENGTH_LONG).show());
                return;
            }
            final Uri saved = uri;
            ui.post(() -> {
                if (name.toLowerCase().endsWith(".zip")) {
                    new AlertDialog.Builder(MainActivity.this)
                        .setTitle("Session saved")
                        .setMessage(name + "\nis in Downloads/XPPAUT.")
                        .setPositiveButton("OK", null)
                        .setNeutralButton("Share", (d, w) -> share(saved, mime, name))
                        .show();
                } else {
                    Toast.makeText(MainActivity.this, "Saved to Downloads/XPPAUT: " + name, Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    private void share(Uri uri, String mime, String name) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(mime);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.putExtra(Intent.EXTRA_TITLE, name);
        // lets the share sheet read the file's name for its preview
        send.setClipData(android.content.ClipData.newUri(getContentResolver(), name, uri));
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(send, "Share"));
    }
}
