package com.jaago.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Puts alarms into Android's AlarmManager using setAlarmClock — the most reliable kind of alarm. */
final class AlarmScheduler {
    static final String ACTION_FIRE = "com.jaago.app.FIRE";

    private AlarmScheduler() {}

    private static Intent fireIntent(Context ctx) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction(ACTION_FIRE);
        return i;
    }

    private static void schedule(Context ctx, AlarmManager am, JSONObject alarm) throws JSONException {
        int id = alarm.getInt("id");
        long at = alarm.getLong("at");

        Intent fire = fireIntent(ctx);
        fire.putExtra("alarm", alarm.toString());
        PendingIntent firePi = PendingIntent.getBroadcast(
            ctx, id, fire, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent show = new Intent(ctx, MainActivity.class);
        show.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent showPi = PendingIntent.getActivity(
            ctx, 1, show, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
            // Exact-alarm permission is off: this may ring a few minutes late. The app asks the user to fix it.
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, firePi);
        } else {
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, showPi), firePi);
        }
    }

    static void cancelAll(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        JSONArray old = AlarmStore.getScheduled(ctx);
        for (int i = 0; i < old.length(); i++) {
            JSONObject o = old.optJSONObject(i);
            if (o == null) continue;
            PendingIntent pi = PendingIntent.getBroadcast(
                ctx, o.optInt("id"), fireIntent(ctx), PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
            if (pi != null) {
                am.cancel(pi);
                pi.cancel();
            }
        }
    }

    /** Replaces every scheduled alarm with this list. Returns how many were scheduled. */
    static int scheduleAll(Context ctx, JSONArray alarms) {
        cancelAll(ctx);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        long now = System.currentTimeMillis();
        JSONArray kept = new JSONArray();
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject a = alarms.optJSONObject(i);
            if (a == null || a.optLong("at") <= now) continue;
            try {
                schedule(ctx, am, a);
                kept.put(a);
            } catch (JSONException | SecurityException e) {
                // Skip a bad entry rather than losing every alarm.
            }
        }
        AlarmStore.setScheduled(ctx, kept);
        return kept.length();
    }

    /** After a reboot or app update Android forgets alarms, so put them back. */
    static void restore(Context ctx) {
        scheduleAll(ctx, AlarmStore.getScheduled(ctx));
    }
}
