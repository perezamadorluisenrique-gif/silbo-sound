package com.silbo.app;

import android.content.Intent;
import android.net.Uri;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/** Serves assets/www as https://appassets.silbo/ (a secure context, so the microphone and workers work offline). */
public class AssetClient extends WebViewClient {
    static final String HOST = "appassets.silbo";
    private final MainActivity activity;

    AssetClient(MainActivity activity) { this.activity = activity; }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
        Uri u = r.getUrl();
        if (!HOST.equals(u.getHost())) return null;
        String path = u.getPath();
        if (path == null || path.equals("/")) path = "/index.html";
        String name = path.substring(1);
        try {
            InputStream in = activity.getAssets().open("www/" + name);
            String ext = MimeTypeMap.getFileExtensionFromUrl(name);
            String mime = "js".equals(ext) ? "text/javascript"
                : "webmanifest".equals(ext) ? "application/manifest+json"
                : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            WebResourceResponse res = new WebResourceResponse(mime == null ? "application/octet-stream" : mime, "utf-8", in);
            Map<String, String> h = new HashMap<>();
            h.put("Access-Control-Allow-Origin", "*");
            res.setResponseHeaders(h);
            return res;
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
        }
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        if (HOST.equals(r.getUrl().getHost())) return false;
        activity.startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl()));
        return true;
    }
}
