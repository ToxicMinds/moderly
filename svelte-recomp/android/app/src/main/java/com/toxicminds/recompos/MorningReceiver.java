package com.toxicminds.recompos;

import android.Manifest;
import android.app.AlarmManager;
import android.app.KeyguardManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;

/**
 * Posts the morning briefing the first time the phone is unlocked after the
 * morning time (MorningClock decides when). The briefing itself is written by
 * the web app whenever it's open and handed over through MorningPlugin, so
 * nothing here computes anything about the user's day.
 *
 * Every look is booked on a non-waking alarm (RTC, never RTC_WAKEUP): it costs
 * nothing while the phone sleeps, and Android delivers a held one the moment
 * the screen turns on — which is exactly the moment this is waiting for.
 */
public class MorningReceiver extends BroadcastReceiver {
    static final String PREFS = "recompos.morning";
    static final String ACTION_CHECK = "com.toxicminds.recompos.MORNING_CHECK";
    static final String CHANNEL_ID = "recompos-morning";
    static final int NOTIFICATION_ID = 7001;

    @Override
    public void onReceive(Context context, Intent intent) {
        // Our own alarm, a reboot (alarms don't survive one) or an app update.
        check(context);
    }

    /** Decide, act, and book the next look. */
    static void check(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!p.getBoolean("on", false)) {
            cancel(ctx);
            return;
        }
        int after = p.getInt("after", 6 * 60);
        LocalDateTime now = LocalDateTime.now();
        LocalDate today = now.toLocalDate();
        JSONObject briefing = briefingFor(p.getString("briefings", "[]"), today.toString());
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        KeyguardManager km = (KeyguardManager) ctx.getSystemService(Context.KEYGUARD_SERVICE);

        int action = MorningClock.decide(today.toString(), now.getHour() * 60 + now.getMinute(), after,
            p.getString("shown", ""), briefing != null,
            pm != null && pm.isInteractive(), km != null && km.isKeyguardLocked());

        long nowMs = System.currentTimeMillis();
        switch (action) {
            case MorningClock.POST:
                post(ctx, briefing);
                p.edit().putString("shown", today.toString()).putLong("postedAt", nowMs).apply();
                schedule(ctx, at(today.plusDays(1), after));
                break;
            case MorningClock.WAIT:
                schedule(ctx, at(today, after));
                break;
            case MorningClock.SOON:
                schedule(ctx, nowMs + 5_000);
                break;
            case MorningClock.LATER:
                // Held while the screen is off; the minute only matters if the
                // screen comes on and off again within it.
                schedule(ctx, nowMs + 60_000);
                break;
            default:
                schedule(ctx, at(today.plusDays(1), after));
        }
    }

    static void cancel(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(pending(ctx));
    }

    private static JSONObject briefingFor(String json, String date) {
        try {
            JSONArray all = new JSONArray(json);
            for (int i = 0; i < all.length(); i++) {
                JSONObject b = all.getJSONObject(i);
                if (date.equals(b.optString("date"))) return b;
            }
        } catch (Exception ignored) {
            // A briefing that can't be read is no briefing.
        }
        return null;
    }

    private static long at(LocalDate day, int minutes) {
        return day.atTime(minutes / 60, minutes % 60).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }

    private static PendingIntent pending(Context ctx) {
        Intent i = new Intent(ctx, MorningReceiver.class).setAction(ACTION_CHECK);
        return PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static void schedule(Context ctx, long atMs) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        // Exact, so a held look isn't batched behind someone else's alarm and
        // still due when the screen comes on. USE_EXACT_ALARM (manifest) grants
        // it on 13+; on 12 it's the user's call, and inexact still works.
        if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) {
            am.setExact(AlarmManager.RTC, atMs, pending(ctx));
        } else {
            am.set(AlarmManager.RTC, atMs, pending(ctx));
        }
    }

    private static void post(Context ctx, JSONObject b) {
        if (Build.VERSION.SDK_INT >= 33
            && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        // Pops up (it's the moment the phone is in hand) but makes no sound:
        // a quiet house at six doesn't need one. The watch buzzes on its own.
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Morning briefing", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Weather and the day's plan, the first time you unlock the phone in the morning");
        ch.setSound(null, null);
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);

        String title = b.optString("title", "Good morning");
        String body = b.optString("body", "");
        int nl = body.indexOf('\n');
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        NotificationCompat.Builder n = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_morning)
            .setContentTitle(title)
            .setContentText(nl > 0 ? body.substring(0, nl) : body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true);
        if (open != null) {
            n.setContentIntent(PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        }
        try {
            NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, n.build());
        } catch (SecurityException ignored) {
            // Notifications switched off since the check above.
        }
    }
}
