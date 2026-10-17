package com.toxicminds.recompos;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The web app's side of the morning briefing and the evening hold. Whenever
 * the app is open it writes the coming moments here (src/lib/nativeAlarms.ts);
 * MomentReceiver posts each at the first unlock inside its window, with the
 * app closed.
 */
@CapacitorPlugin(name = "Moments")
public class MomentsPlugin extends Plugin {

    /** { moments: [{ date, key, after, until, title, body }] }, minutes from midnight. */
    @PluginMethod
    public void arm(PluginCall call) {
        JSArray moments = call.getArray("moments");
        if (moments == null) {
            call.reject("No moments");
            return;
        }
        // commit, not apply: check() reads these straight back.
        prefs().edit().putBoolean("on", true).putString("moments", moments.toString()).commit();
        MomentReceiver.check(getContext());
        call.resolve(state());
    }

    @PluginMethod
    public void disarm(PluginCall call) {
        prefs().edit().putBoolean("on", false).remove("moments").commit();
        MomentReceiver.cancel(getContext());
        call.resolve(state());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(state());
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(MomentReceiver.PREFS, Context.MODE_PRIVATE);
    }

    private JSObject state() {
        SharedPreferences p = prefs();
        JSObject o = new JSObject();
        o.put("on", p.getBoolean("on", false));
        for (String key : new String[] { "morning", "evening" }) {
            JSObject k = new JSObject();
            k.put("shown", p.getString("shown:" + key, null));
            k.put("postedAt", p.getLong("postedAt:" + key, 0));
            o.put(key, k);
        }
        return o;
    }
}
