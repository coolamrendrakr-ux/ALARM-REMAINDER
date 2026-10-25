package com.jaago.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Remembers scheduled alarms (so they survive a reboot), the ringing alarm, and the active journey. */
final class AlarmStore {
    private static final String PREFS = "jaago_alarms";
    private static final String KEY_SCHEDULED = "scheduled";
    private static final String KEY_RINGING = "ringing";
    private static final String KEY_JOURNEY = "journey";
    private static final String KEY_JOURNEY_STATUS = "journey_status";

    private AlarmStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONObject getObject(Context ctx, String key) {
        String s = prefs(ctx).getString(key, null);
        if (s == null) return null;
        try {
            return new JSONObject(s);
        } catch (JSONException e) {
            return null;
        }
    }

    private static void setObject(Context ctx, String key, JSONObject value) {
        SharedPreferences.Editor e = prefs(ctx).edit();
        if (value == null) e.remove(key);
        else e.putString(key, value.toString());
        e.commit();
    }

    static JSONArray getScheduled(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY_SCHEDULED, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    static void setScheduled(Context ctx, JSONArray alarms) {
        prefs(ctx).edit().putString(KEY_SCHEDULED, alarms.toString()).apply();
    }

    /** Forget one alarm after it has fired, so a reboot does not bring it back. */
    static void removeScheduled(Context ctx, int id) {
        JSONArray all = getScheduled(ctx);
        JSONArray kept = new JSONArray();
        for (int i = 0; i < all.length(); i++) {
            JSONObject o = all.optJSONObject(i);
            if (o != null && o.optInt("id") != id) kept.put(o);
        }
        setScheduled(ctx, kept);
    }

    static JSONObject getRinging(Context ctx) {
        return getObject(ctx, KEY_RINGING);
    }

    static void setRinging(Context ctx, JSONObject alarm) {
        setObject(ctx, KEY_RINGING, alarm);
    }

    static JSONObject getJourney(Context ctx) {
        return getObject(ctx, KEY_JOURNEY);
    }

    static void setJourney(Context ctx, JSONObject journey) {
        setObject(ctx, KEY_JOURNEY, journey);
    }

    static JSONObject getJourneyStatus(Context ctx) {
        return getObject(ctx, KEY_JOURNEY_STATUS);
    }

    static void setJourneyStatus(Context ctx, JSONObject status) {
        setObject(ctx, KEY_JOURNEY_STATUS, status);
    }
}
