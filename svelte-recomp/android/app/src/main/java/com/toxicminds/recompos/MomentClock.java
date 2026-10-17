package com.toxicminds.recompos;

import java.util.ArrayList;
import java.util.List;

/**
 * When the app's two daily notifications go out: the morning briefing and the
 * evening hold. Pure, so it can be checked off-device:
 *
 *     java android/app/src/main/java/com/toxicminds/recompos/MomentClock.java
 *
 * (scripts/selfcheck.js runs exactly that).
 *
 * Neither is an alarm. Each goes out the first time the phone is unlocked
 * inside its window, so it arrives when the user is already holding the phone,
 * and on a day they don't pick it up it never arrives. Android has no
 * "first unlock" event an app can sleep on: USER_PRESENT can't be declared in
 * the manifest since Android 8, and a service kept alive to hear it would need
 * a notification of its own. So MomentReceiver asks instead, on a non-waking
 * alarm that Android holds while the screen is off and hands over the moment
 * it comes on. Each delivery is one call to decide().
 */
final class MomentClock {
    /** One notification the web app wrote: shown once, at the first unlock in
     *  [after, until) minutes on its date. */
    static final class Moment {
        final String date, key, title, body;
        final int after, until;
        boolean shown;

        Moment(String date, String key, int after, int until, String title, String body, boolean shown) {
            this.date = date; this.key = key; this.after = after; this.until = until;
            this.title = title; this.body = body; this.shown = shown;
        }
    }

    /** In use and unlocked inside a window: post `moment` now. */
    static final int POST = 0;
    /** Inside a window, screen on but locked: look again in a few seconds. */
    static final int SOON = 1;
    /** Inside a window, screen off: look again once it comes back on. */
    static final int LATER = 2;
    /** Nothing due: sleep until `moment` opens. */
    static final int AT = 3;
    /** Nothing written ahead: wait for the app to write more. */
    static final int NONE = 4;

    static final class Next {
        final int action;
        final Moment moment;
        Next(int action, Moment moment) { this.action = action; this.moment = moment; }
    }

    private MomentClock() {}

    static Next decide(String today, int nowMin, List<Moment> moments, boolean interactive, boolean locked) {
        Moment due = null, next = null;
        for (Moment m : moments) {
            if (m.shown) continue;
            int c = m.date.compareTo(today);
            if (c == 0 && m.after <= nowMin && nowMin < m.until) {
                if (due == null) due = m;
            } else if (c > 0 || (c == 0 && m.after > nowMin)) {
                if (next == null || m.date.compareTo(next.date) < 0 || (m.date.equals(next.date) && m.after < next.after)) next = m;
            }
            // Past its window (or an older date): that day it stays unsaid.
        }
        if (due != null) return new Next(!interactive ? LATER : locked ? SOON : POST, due);
        return next != null ? new Next(AT, next) : new Next(NONE, null);
    }

    /** A weight typed or spoken into the notification: "112.3", "112,3",
     *  "112.3 kg". Null when it isn't a plausible weight. */
    static Double parseKg(CharSequence input) {
        if (input == null) return null;
        String t = input.toString().trim().replace(',', '.').replaceAll("(?i)\\s*kg$", "");
        if (!t.matches("\\d{2,3}(\\.\\d+)?")) return null;
        double kg = Math.round(Double.parseDouble(t) * 10) / 10.0;
        return kg >= 30 && kg <= 400 ? kg : null;
    }

    /** A back rating, 0 to 10. Null for anything else. */
    static Integer parseRating(CharSequence input) {
        if (input == null) return null;
        String t = input.toString().trim().replaceAll("\\s*/\\s*10$", "");
        if (!t.matches("\\d{1,2}")) return null;
        int n = Integer.parseInt(t);
        return n <= 10 ? n : null;
    }

    public static void main(String[] args) {
        String sat = "2026-10-17", sun = "2026-10-18";
        List<Moment> day = new ArrayList<>();
        day.add(new Moment(sat, "morning", 360, 720, "Sat", "", false));
        day.add(new Moment(sat, "evening", 1020, 1380, "Hold", "", false));
        day.add(new Moment(sun, "morning", 360, 720, "Sun", "", false));

        Next n = decide(sat, 359, day, true, false);
        check(n.action == AT && n.moment.key.equals("morning") && n.moment.date.equals(sat), "before six it sleeps until six, even with the phone in use");
        check(decide(sat, 360, day, true, false).action == POST, "in use at six: now");
        check(decide(sat, 400, day, false, true).action == LATER, "screen off: wait for it to come on");
        check(decide(sat, 400, day, true, true).action == SOON, "screen on but locked: any second now");
        n = decide(sat, 401, day, true, false);
        check(n.action == POST && n.moment.key.equals("morning"), "first unlock after six: the morning one");

        day.get(0).shown = true;
        n = decide(sat, 402, day, true, false);
        check(n.action == AT && n.moment.key.equals("evening"), "once a morning; then sleep until the evening window");
        n = decide(sat, 1030, day, true, false);
        check(n.action == POST && n.moment.key.equals("evening"), "first unlock after five on a Saturday: the hold");

        day.get(1).shown = true;
        n = decide(sat, 1031, day, true, false);
        check(n.action == AT && n.moment.date.equals(sun), "both said: sleep until tomorrow's first");

        List<Moment> missed = new ArrayList<>();
        missed.add(new Moment(sat, "morning", 360, 720, "Sat", "", false));
        missed.add(new Moment(sun, "morning", 360, 720, "Sun", "", false));
        n = decide(sat, 720, missed, true, false);
        check(n.action == AT && n.moment.date.equals(sun), "first unlock after noon: that morning's is old news");
        check(decide(sun, 800, missed, true, false).action == NONE, "nothing written ahead: wait for the app");
        check(parseKg("112.3") == 112.3 && parseKg(" 112,3 ") == 112.3 && parseKg("112.3 kg") == 112.3 && parseKg("98") == 98.0, "a weight, however it's typed");
        check(parseKg("1123") == null && parseKg("11.2") == null && parseKg("abc") == null && parseKg("") == null && parseKg(null) == null, "not a weight: ask again");
        check(parseKg("112.34") == 112.3, "to a tenth, like the scale");
        check(parseRating("3") == 3 && parseRating("10") == 10 && parseRating("0") == 0 && parseRating("4/10") == 4, "a rating");
        check(parseRating("11") == null && parseRating("-1") == null && parseRating("three") == null, "not a rating");
        System.out.println("MomentClock: ok");
    }

    private static void check(boolean ok, String what) {
        if (!ok) throw new AssertionError(what);
    }
}
