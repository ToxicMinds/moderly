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
import java.util.ArrayList;
import java.util.List;

/**
 * Posts the morning briefing and the evening hold, each the first time the
 * phone is unlocked inside its window (MomentClock decides when). The text is
 * written by the web app whenever it's open and handed over through
 * MomentsPlugin; nothing here computes anything about the user's day.
 *
 * Every look is booked on a non-waking alarm (RTC, never RTC_WAKEUP): it costs
 * nothing while the phone sleeps, and Android delivers a held one the moment
 * the screen turns on, which is exactly the moment this is waiting for.
 */
public class MomentReceiver extends BroadcastReceiver {
    static final String PREFS = "recompos.moments";
    static final String ACTION_CHECK = "com.toxicminds.recompos.MOMENT_CHECK";

    @Override
    public void onReceive(Context context, Intent intent) {
        // Our own alarm, a reboot (alarms don't survive one) or an app update.
        check(context);
    }

    /** Decide, act, and book the next look. */
    static void check(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        carryOverBuild6(ctx, p);
        if (!p.getBoolean("on", false)) {
            cancel(ctx);
            return;
        }
        LocalDateTime now = LocalDateTime.now();
        String today = now.toLocalDate().toString();
        int nowMin = now.getHour() * 60 + now.getMinute();
        List<MomentClock.Moment> moments = read(p);
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        KeyguardManager km = (KeyguardManager) ctx.getSystemService(Context.KEYGUARD_SERVICE);
        boolean interactive = pm != null && pm.isInteractive();
        boolean locked = km != null && km.isKeyguardLocked();

        MomentClock.Next n = MomentClock.decide(today, nowMin, moments, interactive, locked);
        if (n.action == MomentClock.POST) {
            post(ctx, n.moment);
            p.edit().putString("shown:" + n.moment.key, n.moment.date)
                .putLong("postedAt:" + n.moment.key, System.currentTimeMillis()).commit();
            n.moment.shown = true;
            n = MomentClock.decide(today, nowMin, moments, interactive, locked);
        }

        long nowMs = System.currentTimeMillis();
        switch (n.action) {
            case MomentClock.POST: // a second one due at once: the next look posts it
            case MomentClock.SOON:
                schedule(ctx, nowMs + 5_000);
                break;
            case MomentClock.LATER:
                // Held while the screen is off; the minute only matters if the
                // screen comes on and off again within it.
                schedule(ctx, nowMs + 60_000);
                break;
            case MomentClock.AT:
                schedule(ctx, LocalDate.parse(n.moment.date).atTime(n.moment.after / 60, n.moment.after % 60)
                    .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli());
                break;
            default:
                cancel(ctx);
        }
    }

    static void cancel(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(pending(ctx));
    }

    private static List<MomentClock.Moment> read(SharedPreferences p) {
        List<MomentClock.Moment> out = new ArrayList<>();
        JSONArray all;
        try {
            all = new JSONArray(p.getString("moments", "[]"));
        } catch (Exception e) {
            return out;
        }
        for (int i = 0; i < all.length(); i++) {
            try {
                JSONObject m = all.getJSONObject(i);
                // Parsed, so a malformed date is skipped here rather than
                // thrown later while booking the alarm.
                String date = LocalDate.parse(m.getString("date")).toString(), key = m.getString("key");
                out.add(new MomentClock.Moment(date, key, m.getInt("after"), m.getInt("until"),
                    m.optString("title", "RecompOS"), m.optString("body", ""),
                    date.equals(p.getString("shown:" + key, ""))));
            } catch (Exception ignored) {
                // A moment that can't be read is no moment.
            }
        }
        return out;
    }

    /** Build 6 knew only the morning, under its own name. Keep the day it last
     *  posted, so an update never repeats this morning's briefing. */
    private static void carryOverBuild6(Context ctx, SharedPreferences p) {
        SharedPreferences old = ctx.getSharedPreferences("recompos.morning", Context.MODE_PRIVATE);
        if (!old.contains("shown")) return;
        if (!p.contains("shown:morning")) p.edit().putString("shown:morning", old.getString("shown", "")).commit();
        old.edit().clear().commit();
    }

    private static PendingIntent pending(Context ctx) {
        Intent i = new Intent(ctx, MomentReceiver.class).setAction(ACTION_CHECK);
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

    private static void post(Context ctx, MomentClock.Moment m) {
        if (Build.VERSION.SDK_INT >= 33
            && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        // One channel per moment, so either can be tuned or muted on its own in
        // Android's settings. Both pop up (the phone is in hand) and make no
        // sound; the watch buzzes on its own.
        boolean evening = "evening".equals(m.key);
        String channel = "recompos-" + m.key;
        NotificationChannel ch = new NotificationChannel(channel,
            evening ? "Evening hold" : "Morning briefing", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(evening
            ? "Your plan for the evening, the first time you unlock the phone after it starts"
            : "Weather and the day's plan, the first time you unlock the phone in the morning");
        ch.setSound(null, null);
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);

        int nl = m.body.indexOf('\n');
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        NotificationCompat.Builder n = new NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(evening ? R.drawable.ic_stat_evening : R.drawable.ic_stat_morning)
            .setContentTitle(m.title)
            .setContentText(nl > 0 ? m.body.substring(0, nl) : m.body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(m.body))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true);
        if (open != null) {
            n.setContentIntent(PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        }
        try {
            NotificationManagerCompat.from(ctx).notify(evening ? 7002 : 7001, n.build());
        } catch (SecurityException ignored) {
            // Notifications switched off since the check above.
        }
    }
}
