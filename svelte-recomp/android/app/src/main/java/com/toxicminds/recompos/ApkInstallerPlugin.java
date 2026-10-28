package com.toxicminds.recompos;

import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app APK updater. Downloads a new build and hands it to Android's package
 * installer for a one-tap, in-place update — so a native update never means
 * opening a browser or a file manager.
 *
 * The whole thing only works because every APK is signed with one stable key
 * (see app/build.gradle); otherwise Android rejects the install as a signature
 * mismatch. The download lands in the app's cache dir, which is exposed through
 * the FileProvider already declared in the manifest (res/xml/file_paths.xml),
 * and the install prompt is launched with a temporary read grant on that URI.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    @PluginMethod
    public void installFromUrl(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("No download url provided");
            return;
        }

        // Network + disk off the main thread; resolve/reject when it's done.
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    File apk = new File(getContext().getCacheDir(), "update.apk");
                    if (apk.exists() && !apk.delete()) {
                        // A stale file we can't remove would install an old build.
                        call.reject("Could not clear the previous update file");
                        return;
                    }

                    conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(30000);
                    conn.setReadTimeout(60000);
                    conn.connect();

                    int code = conn.getResponseCode();
                    if (code < 200 || code >= 300) {
                        call.reject("Download failed (HTTP " + code + ")");
                        return;
                    }

                    InputStream in = conn.getInputStream();
                    OutputStream out = new FileOutputStream(apk);
                    try {
                        byte[] buffer = new byte[8192];
                        int read;
                        while ((read = in.read(buffer)) != -1) {
                            out.write(buffer, 0, read);
                        }
                        out.flush();
                    } finally {
                        try { in.close(); } catch (Exception ignored) {}
                        try { out.close(); } catch (Exception ignored) {}
                    }

                    if (apk.length() == 0) {
                        call.reject("Downloaded update was empty");
                        return;
                    }

                    Uri uri = FileProvider.getUriForFile(
                        getContext(),
                        getContext().getPackageName() + ".fileprovider",
                        apk
                    );

                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    intent.setDataAndType(uri, "application/vnd.android.package-archive");
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(intent);

                    call.resolve();
                } catch (Exception e) {
                    call.reject(e.getMessage() != null ? e.getMessage() : "Update failed");
                } finally {
                    if (conn != null) {
                        try { conn.disconnect(); } catch (Exception ignored) {}
                    }
                }
            }
        }).start();
    }
}
