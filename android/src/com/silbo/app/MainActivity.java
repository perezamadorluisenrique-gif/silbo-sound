package com.silbo.app;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/** Offline shell: serves the bundled PWA (assets/www) from https://appassets.silbo/ so the page is a secure context. */
public class MainActivity extends Activity {
    private static final String HOME = "https://" + AssetClient.HOST + "/index.html";
    private static final int REQ_MIC = 1, REQ_FILE = 2;

    private WebView web;
    private PermissionRequest pendingMic;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Color.parseColor("#0b5f59"));
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.addJavascriptInterface(new Saver(this), "SilboAndroid");
        web.setWebViewClient(new AssetClient(this));
        web.setWebChromeClient(new MicClient(this));
        // Blob downloads (received files) have no URL the OS can fetch: read them in the page and hand the bytes over.
        web.setDownloadListener((url, ua, cd, mime, len) -> {
            String name = android.webkit.URLUtil.guessFileName(url, cd, mime);
            if (url.startsWith("blob:")) {
                web.evaluateJavascript("(async()=>{const r=await fetch('" + url + "');const buf=new Uint8Array(await r.arrayBuffer());let s='';" +
                    "for(let i=0;i<buf.length;i+=8192)s+=String.fromCharCode.apply(null,buf.subarray(i,i+8192));" +
                    "SilboAndroid.save(" + org.json.JSONObject.quote(name) + "," + org.json.JSONObject.quote(mime == null ? "application/octet-stream" : mime) + ",btoa(s));})()", null);
            }
        });
        web.loadUrl(HOME);
    }

    void askMic(PermissionRequest req) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            req.grant(req.getResources());
        } else {
            pendingMic = req;
            requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, REQ_MIC);
        }
    }

    boolean pickFile(ValueCallback<Uri[]> cb, WebChromeClient.FileChooserParams p) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = cb;
        try {
            startActivityForResult(p.createIntent(), REQ_FILE);
            return true;
        } catch (Exception e) {
            fileCallback = null;
            return false;
        }
    }

    private void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
    }

    void saveDownload(String name, String mime, String b64) {
        try {
            byte[] data = Base64.decode(b64, Base64.DEFAULT);
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            OutputStream out = getContentResolver().openOutputStream(uri);
            out.write(data);
            out.close();
            toast("Guardado en Descargas: " + name);
        } catch (Exception e) {
            toast("No se pudo guardar: " + e.getMessage());
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == REQ_MIC && pendingMic != null) {
            if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) pendingMic.grant(pendingMic.getResources());
            else pendingMic.deny();
            pendingMic = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
