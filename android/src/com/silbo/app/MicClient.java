package com.silbo.app;

import android.net.Uri;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

/** Microphone permission and the file picker for the page. */
public class MicClient extends WebChromeClient {
    private final MainActivity activity;

    MicClient(MainActivity activity) { this.activity = activity; }

    @Override
    public void onPermissionRequest(PermissionRequest req) { activity.runOnUiThread(() -> activity.askMic(req)); }

    @Override
    public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) { return activity.pickFile(cb, p); }
}
