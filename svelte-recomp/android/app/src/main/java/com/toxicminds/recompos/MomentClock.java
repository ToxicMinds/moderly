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
        return parseWeight(input, "kg");
    }

    /** The same in the person's own unit (the briefing's actions.unit): kg;
     *  lb ("247.8", "247.8 lb"); or st, typed "17 9", "17st 9lb", "17" (stones
     *  up to 40) or "249" (pounds), returned as total pounds, which is the unit
     *  the briefing's weighRange is in for stone. Null when it isn't a weight. */
    static Double parseWeight(CharSequence input, String unit) {
        if (input == null) return null;
        String t = input.toString().trim().toLowerCase().replace(',', '.');
        if ("st".equals(unit)) {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("^(\\d{1,2})\\s*(?:st|stone)?\\s+(\\d{1,2}(?:\\.\\d+)?)\\s*(?:lb|lbs)?$").matcher(t);
            double lb;
            if (m.matches()) lb = Double.parseDouble(m.group(1)) * 14 + Double.parseDouble(m.group(2));
            else {
                t = t.replaceAll("\\s*(st|stone|lb|lbs)$", "");
                if (!t.matches("\\d{1,3}(\\.\\d+)?")) return null;
                double n = Double.parseDouble(t);
                lb = n <= 40 ? n * 14 : n;
            }
            lb = Math.round(lb * 10) / 10.0;
            return lb >= 66 && lb <= 880 ? lb : null;
        }
        boolean pounds = "lb".equals(unit);
        t = t.replaceAll(pounds ? "\\s*(lb|lbs)$" : "\\s*kg$", "");
        if (!t.matches("\\d{2,3}(\\.\\d+)?")) return null;
        double v = Math.round(Double.parseDouble(t) * 10) / 10.0;
        return pounds ? (v >= 66 && v <= 880 ? v : null) : (v >= 30 && v <= 400 ? v : null);
    }

    /** A back rating, 0 to 10. Null for anything else. */
    static Integer parseRating(CharSequence input) {
        if (input == null) return null;
        String t = input.toString().trim().replaceAll("\\s*/\\s*10$", "");
        if (!t.matches("\\d{1,2}")) return null;
        int n = Integer.parseInt(t);
        return n <= 10 ? n : null;
    }

    /** A typed weight against the app's trend range [lo, hi] (the app asks
     *  before saving anything outside it): fine, far (ask), or the same far
     *  value sent a second time, which is the answer. */
    static final int KG_OK = 0, KG_FAR = 1, KG_CONFIRMED = 2;

    static int weighVerdict(double kg, double[] range, Double lastFar) {
        if (range == null || (kg >= range[0] && kg <= range[1])) return KG_OK;
        return lastFar != null && Math.abs(lastFar - kg) < 0.05 ? KG_CONFIRMED : KG_FAR;
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
        check(parseWeight("247.8", "lb") == 247.8 && parseWeight("247.8 lbs", "lb") == 247.8 && parseWeight("45", "lb") == null, "pounds");
        check(parseWeight("17 9", "st") == 247.0 && parseWeight("17st 9lb", "st") == 247.0 && parseWeight("17", "st") == 238.0 && parseWeight("249", "st") == 249.0, "stone, as total pounds");
        check(parseWeight("seventeen", "st") == null && parseWeight("3", "st") == null, "not a weight in stone");
        check(parseRating("3") == 3 && parseRating("10") == 10 && parseRating("0") == 0 && parseRating("4/10") == 4, "a rating");
        check(parseRating("11") == null && parseRating("-1") == null && parseRating("three") == null, "not a rating");
        double[] range = { 109.6, 116.6 };
        check(weighVerdict(113.0, range, null) == KG_OK && weighVerdict(66.6, null, null) == KG_OK, "near the trend, or no trend yet: fine");
        check(weighVerdict(141.3, range, null) == KG_FAR && weighVerdict(141.3, range, 114.0) == KG_FAR, "far: ask first");
        check(weighVerdict(141.3, range, 141.3) == KG_CONFIRMED, "the same far value again: that's the answer");
        System.out.println("MomentClock: ok");
    }

    private static void check(boolean ok, String what) {
        if (!ok) throw new AssertionError(what);
    }
}
