package com.jaago.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** The bridge between the HTML app (window.Capacitor.Plugins.JaagoAlarm) and Android. */
@CapacitorPlugin(
    name = "JaagoAlarm",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION })
    }
)
public class AlarmPlugin extends Plugin implements AlarmService.Listener {

    @Override
    public void load() {
        AlarmService.listener = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (AlarmService.listener == this) AlarmService.listener = null;
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent != null && intent.getBooleanExtra(AlarmService.EXTRA_RINGING, false)) {
            JSONObject alarm = AlarmStore.getRinging(getContext());
            if (alarm != null) onRinging(alarm);
        }
    }

    // ---------- Scheduling ----------

    @PluginMethod
    public void setAlarms(PluginCall call) {
        JSArray arr = call.getArray("alarms");
        try {
            JSONArray list = arr != null ? new JSONArray(arr.toString()) : new JSONArray();
            int n = AlarmScheduler.scheduleAll(getContext(), list);
            JSObject r = new JSObject();
            r.put("scheduled", n);
            call.resolve(r);
        } catch (JSONException e) {
            call.reject("Bad alarm list", e);
        }
    }

    // ---------- Ringing control ----------

    @PluginMethod
    public void getRinging(PluginCall call) {
        JSObject r = new JSObject();
        JSONObject alarm = AlarmStore.getRinging(getContext());
        if (alarm != null) {
            try {
                r.put("alarm", JSObject.fromJSONObject(alarm));
            } catch (JSONException ignored) {
            }
        }
        call.resolve(r);
    }

    @PluginMethod
    public void stopRinging(PluginCall call) {
        sendToService(AlarmService.ACTION_STOP);
        AlarmStore.setRinging(getContext(), null);
        refreshActivityFlags();
        call.resolve();
    }

    @PluginMethod
    public void pauseSound(PluginCall call) {
        if (AlarmStore.getRinging(getContext()) != null) sendToService(AlarmService.ACTION_PAUSE);
        call.resolve();
    }

    @PluginMethod
    public void resumeSound(PluginCall call) {
        if (AlarmStore.getRinging(getContext()) != null) sendToService(AlarmService.ACTION_RESUME);
        call.resolve();
    }

    private void sendToService(String action) {
        Intent i = new Intent(getContext(), AlarmService.class);
        i.setAction(action);
        try {
            getContext().startService(i);
        } catch (Exception ignored) {
            // App in background — nothing is ringing that we can control from here.
        }
    }

    private void refreshActivityFlags() {
        if (getActivity() instanceof MainActivity) {
            final MainActivity a = (MainActivity) getActivity();
            a.runOnUiThread(a::refreshLockScreenFlags);
        }
    }

    // ---------- Setup checks ----------

    @PluginMethod
    public void checkSetup(PluginCall call) {
        Context ctx = getContext();
        boolean exact = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            exact = am.canScheduleExactAlarms();
        }
        boolean notifications = NotificationManagerCompat.from(ctx).areNotificationsEnabled();
        boolean fullScreen = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            fullScreen = nm.canUseFullScreenIntent();
        }
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        boolean battery = pm.isIgnoringBatteryOptimizations(ctx.getPackageName());

        JSObject r = new JSObject();
        r.put("exact", exact);
        r.put("notifications", notifications);
        r.put("fullScreen", fullScreen);
        r.put("battery", battery);
        call.resolve(r);
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject r = new JSObject();
            r.put("granted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
            call.resolve(r);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsResult");
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String which = call.getString("which", "notifications");
        Context ctx = getContext();
        Uri pkg = Uri.parse("package:" + ctx.getPackageName());
        Intent i;
        if ("location".equals(which)) {
            i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
        } else if ("exact".equals(which) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg);
        } else if ("fullScreen".equals(which) && Build.VERSION.SDK_INT >= 34) {
            i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg);
        } else if ("battery".equals(which)) {
            i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(i);
        } catch (Exception e) {
            Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg);
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(fallback);
        }
        call.resolve();
    }

    // ---------- Location & journey ----------

    private boolean locationGranted() {
        return getPermissionState("location") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void requestLocation(PluginCall call) {
        if (locationGranted()) {
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
            return;
        }
        requestPermissionForAlias("location", call, "locationResult");
    }

    @PermissionCallback
    private void locationResult(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", locationGranted());
        call.resolve(r);
    }

    @PluginMethod
    public void startJourney(PluginCall call) {
        Context ctx = getContext();
        if (!locationGranted()) {
            call.reject("Location permission is off", "NO_PERMISSION");
            return;
        }
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        boolean on = lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        if (!on) {
            call.reject("LOCATION_OFF", "LOCATION_OFF");
            return;
        }
        JSObject j = new JSObject();
        j.put("lat", call.getDouble("lat"));
        j.put("lng", call.getDouble("lng"));
        j.put("radiusKm", call.getDouble("radiusKm", 20.0));
        j.put("label", call.getString("label", "Destination"));
        String speak = call.getString("speak");
        if (speak != null) j.put("speak", speak);
        j.put("lang", call.getString("lang", "hi"));
        if (call.getDouble("lat") == null || call.getDouble("lng") == null) {
            call.reject("Destination missing");
            return;
        }
        Intent i = new Intent(ctx, JourneyService.class);
        i.setAction(JourneyService.ACTION_START);
        i.putExtra("journey", j.toString());
        try {
            ContextCompat.startForegroundService(ctx, i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not start GPS tracking", e);
        }
    }

    @PluginMethod
    public void stopJourney(PluginCall call) {
        Intent i = new Intent(getContext(), JourneyService.class);
        i.setAction(JourneyService.ACTION_STOP);
        try {
            getContext().startService(i);
        } catch (Exception ignored) {
        }
        AlarmStore.setJourney(getContext(), null);
        AlarmStore.setJourneyStatus(getContext(), null);
        call.resolve();
    }

    @PluginMethod
    public void getJourney(PluginCall call) {
        JSObject r = new JSObject();
        r.put("active", AlarmStore.getJourney(getContext()) != null);
        JSONObject s = AlarmStore.getJourneyStatus(getContext());
        if (s != null) {
            if (s.has("distanceKm")) r.put("distanceKm", s.optDouble("distanceKm"));
            r.put("accuracy", s.optDouble("accuracy", 0));
            r.put("updatedAt", s.optLong("updatedAt", 0));
            if (s.has("error")) r.put("error", s.optString("error"));
        }
        call.resolve(r);
    }

    // ---------- Events to the HTML app ----------

    @Override
    public void onRinging(JSONObject alarm) {
        try {
            JSObject data = new JSObject();
            data.put("alarm", JSObject.fromJSONObject(alarm));
            notifyListeners("alarmRinging", data, true);
        } catch (JSONException ignored) {
        }
    }

    @Override
    public void onStopped() {
        notifyListeners("alarmStopped", new JSObject());
        refreshActivityFlags();
    }
}
