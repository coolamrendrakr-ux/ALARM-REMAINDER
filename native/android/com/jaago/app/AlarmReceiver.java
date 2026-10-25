package com.jaago.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Called by Android at alarm time.
 * "notify" reminders (refill, checklist, fasting) become a normal notification;
 * everything else starts the ringing service.
 */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String alarm = intent.getStringExtra("alarm");
        if (alarm == null) return;

        try {
            JSONObject a = new JSONObject(alarm);
            if ("notify".equals(a.optString("kind"))) {
                AlarmStore.removeScheduled(ctx, a.optInt("id"));
                Reminders.post(ctx, a);
                return;
            }
        } catch (JSONException e) {
            return;
        }

        Intent svc = new Intent(ctx, AlarmService.class);
        svc.setAction(AlarmService.ACTION_START);
        svc.putExtra("alarm", alarm);
        ContextCompat.startForegroundService(ctx, svc);
    }
}
