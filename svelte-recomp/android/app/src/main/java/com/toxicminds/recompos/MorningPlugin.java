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
 * The web app's side of the morning briefing. Whenever the app is open it
 * writes the coming mornings' briefings here (see src/lib/nativeAlarms.ts);
 * MorningReceiver posts the right one at the first unlock after the morning
 * time, with the app closed.
 */
@CapacitorPlugin(name = "Morning")
public class MorningPlugin extends Plugin {

    /** { after: minutes from midnight, briefings: [{ date, title, body }] } */
    @PluginMethod
    public void arm(PluginCall call) {
        SharedPreferences.Editor e = prefs().edit().putBoolean("on", true);
        Integer after = call.getInt("after");
        if (after != null) e.putInt("after", Math.max(0, Math.min(after, MorningClock.CUTOFF - 1)));
        JSArray briefings = call.getArray("briefings");
        if (briefings != null) e.putString("briefings", briefings.toString());
        // commit, not apply: check() reads these straight back.
        e.commit();
        MorningReceiver.check(getContext());
        call.resolve(state());
    }

    @PluginMethod
    public void disarm(PluginCall call) {
        prefs().edit().putBoolean("on", false).remove("briefings").commit();
        MorningReceiver.cancel(getContext());
        call.resolve(state());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(state());
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(MorningReceiver.PREFS, Context.MODE_PRIVATE);
    }

    private JSObject state() {
        SharedPreferences p = prefs();
        JSObject o = new JSObject();
        o.put("on", p.getBoolean("on", false));
        o.put("after", p.getInt("after", 6 * 60));
        o.put("shown", p.getString("shown", null));
        o.put("postedAt", p.getLong("postedAt", 0));
        return o;
    }
}
