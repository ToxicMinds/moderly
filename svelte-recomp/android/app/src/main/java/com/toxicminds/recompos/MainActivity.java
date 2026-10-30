package com.toxicminds.recompos;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the custom in-app APK updater before the bridge boots, so the
        // web layer can call ApkInstaller.installFromUrl(...) over the bridge.
        // Only the sideloaded APK updates itself; Google Play updates the Play build.
        if (!"play".equals(BuildConfig.FLAVOR)) registerPlugin(ApkInstallerPlugin.class);
        // The morning briefing and the evening hold (MomentsPlugin → MomentReceiver).
        registerPlugin(MomentsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
