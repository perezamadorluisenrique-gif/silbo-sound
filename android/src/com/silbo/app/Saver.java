package com.silbo.app;

import android.webkit.JavascriptInterface;

/** Bridge the page calls (as SilboAndroid.save) to store a received file in Downloads. */
public class Saver {
    private final MainActivity activity;

    Saver(MainActivity activity) { this.activity = activity; }

    @JavascriptInterface
    public void save(String name, String mime, String b64) { activity.saveDownload(name, mime, b64); }
}
