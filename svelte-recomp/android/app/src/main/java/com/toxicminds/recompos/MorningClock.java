package com.toxicminds.recompos;

/**
 * When the morning briefing goes out. Pure, so it can be checked off-device:
 *
 *     java android/app/src/main/java/com/toxicminds/recompos/MorningClock.java
 *
 * (scripts/selfcheck.js runs exactly that).
 *
 * The briefing goes out the first time the phone is unlocked after the user's
 * morning time — not at a time, because an alarm is the one thing the user
 * didn't want. Android has no "first unlock" event an app can sleep on:
 * USER_PRESENT can't be declared in the manifest since Android 8, and a
 * service kept alive all night to hear it would need a notification of its
 * own. So MorningReceiver asks instead, on a non-waking alarm that Android
 * holds while the screen is off and hands over the moment it comes on. Each
 * delivery is one call to decide().
 */
final class MorningClock {
    /** Before the morning time: look again at it. */
    static final int WAIT = 0;
    /** Nothing more to do today: look again tomorrow at the morning time. */
    static final int DONE = 1;
    /** In use and unlocked: post it now. */
    static final int POST = 2;
    /** Screen on, still locked: look again in a few seconds. */
    static final int SOON = 3;
    /** Screen off: look again once it comes back on. */
    static final int LATER = 4;

    /** Past noon a morning briefing is old news; the day's been seen. */
    static final int CUTOFF = 12 * 60;

    private MorningClock() {}

    static int decide(String today, int nowMin, int afterMin, String shown,
                      boolean hasBriefing, boolean interactive, boolean locked) {
        if (today.equals(shown)) return DONE;
        if (nowMin < afterMin) return WAIT;
        // No briefing for today means the app wasn't opened since yesterday's;
        // a stale one would be wrong, so say nothing until it next is.
        if (nowMin >= CUTOFF || !hasBriefing) return DONE;
        if (!interactive) return LATER;
        return locked ? SOON : POST;
    }

    public static void main(String[] args) {
        String d = "2026-10-18";
        int six = 6 * 60;
        check(decide(d, six - 1, six, "2026-10-17", true, true, false) == WAIT, "before the morning time it waits, even with the phone in use");
        check(decide(d, six, six, "2026-10-17", true, true, false) == POST, "in use at the morning time: now");
        check(decide(d, six + 40, six, "2026-10-17", true, false, true) == LATER, "screen off: wait for it to come on");
        check(decide(d, six + 40, six, "2026-10-17", true, true, true) == SOON, "screen on but locked: any second now");
        check(decide(d, six + 41, six, "2026-10-17", true, true, false) == POST, "first unlock after six: post");
        check(decide(d, six + 42, six, d, true, true, false) == DONE, "once a day");
        check(decide(d, six + 40, six, "2026-10-17", false, true, false) == DONE, "nothing written for today: nothing to say");
        check(decide(d, CUTOFF, six, "2026-10-17", true, true, false) == DONE, "first unlock after noon: not a morning any more");
        check(decide(d, CUTOFF - 1, six, "", true, true, false) == POST, "never shown before");
        System.out.println("MorningClock: ok");
    }

    private static void check(boolean ok, String what) {
        if (!ok) throw new AssertionError(what);
    }
}
