package com.jaago.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.util.Locale;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Station alarm. Follows the phone's location during a bus or train trip and starts
 * the ringing alarm when the destination is within the chosen distance.
 * GPS checks are spaced out while far away to save battery.
 */
public class JourneyService extends Service implements LocationListener {
    static final String ACTION_START = "com.jaago.app.JOURNEY_START";
    static final String ACTION_STOP = "com.jaago.app.JOURNEY_STOP";

    private static final String CHANNEL_ID = "jaago_journey_v1";
    private static final int NOTIFICATION_ID = 4202;
    private static final int ALARM_ID = 999;

    private LocationManager lm;
    private JSONObject target;
    private long currentInterval = -1;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            finish(false);
            return START_NOT_STICKY;
        }

        if (ACTION_START.equals(action)) {
            try {
                target = new JSONObject(intent.getStringExtra("journey"));
            } catch (JSONException | NullPointerException e) {
                stopSelf();
                return START_NOT_STICKY;
            }
            AlarmStore.setJourney(this, target);
            AlarmStore.setJourneyStatus(this, null);
        } else {
            // Restarted by Android after being killed: continue the saved journey.
            target = AlarmStore.getJourney(this);
            if (target == null) {
                stopSelf();
                return START_NOT_STICKY;
            }
        }

        if (!hasLocationPermission()) {
            finish(false);
            return START_NOT_STICKY;
        }

        createChannel();
        try {
            Notification n = buildNotification(null);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
        } catch (Exception e) {
            // Android refuses a location service started from the background without permission.
            finish(false);
            return START_NOT_STICKY;
        }

        lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        currentInterval = -1;
        requestUpdates(20000);
        return START_STICKY;
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestUpdates(long intervalMs) {
        if (lm == null || intervalMs == currentInterval) return;
        currentInterval = intervalMs;
        try {
            lm.removeUpdates(this);
            boolean any = false;
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, intervalMs, 50f, this, Looper.getMainLooper());
                any = true;
            }
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, intervalMs, 50f, this, Looper.getMainLooper());
                any = true;
            }
            if (!any) saveStatus(-1, 0, "LOCATION_OFF");
        } catch (SecurityException e) {
            finish(false);
        }
    }

    @Override
    public void onLocationChanged(@NonNull Location loc) {
        if (target == null) return;
        float[] out = new float[1];
        Location.distanceBetween(loc.getLatitude(), loc.getLongitude(), target.optDouble("lat"), target.optDouble("lng"), out);
        double km = out[0] / 1000.0;
        double radius = target.optDouble("radiusKm", 20);
        saveStatus(km, loc.getAccuracy(), null);

        if (km <= radius) {
            ringAlarm(km);
            finish(true);
            return;
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(NOTIFICATION_ID, buildNotification(km));

        // Check less often while far away
        double left = km - radius;
        requestUpdates(left > 80 ? 180000 : left > 25 ? 60000 : 20000);
    }

    @Override public void onProviderEnabled(@NonNull String provider) { currentInterval = -1; requestUpdates(20000); }
    @Override public void onProviderDisabled(@NonNull String provider) {}
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}

    private void saveStatus(double km, float accuracy, String error) {
        JSONObject s = new JSONObject();
        try {
            if (km >= 0) s.put("distanceKm", km);
            s.put("accuracy", accuracy);
            s.put("updatedAt", System.currentTimeMillis());
            if (error != null) s.put("error", error);
        } catch (JSONException ignored) {
        }
        AlarmStore.setJourneyStatus(this, s);
    }

    private void ringAlarm(double km) {
        String name = target.optString("label", "Destination");
        JSONObject alarm = new JSONObject();
        try {
            alarm.put("id", ALARM_ID);
            alarm.put("at", System.currentTimeMillis());
            alarm.put("kind", "journey");
            alarm.put("ref", "journey");
            alarm.put("mission", "none");
            alarm.put("label", name + " aane wala hai");
            alarm.put("distanceKm", km);
            if (target.has("speak") && !target.isNull("speak")) alarm.put("speak", target.optString("speak"));
            alarm.put("lang", target.optString("lang", "hi"));
        } catch (JSONException ignored) {
        }
        Intent svc = new Intent(this, AlarmService.class);
        svc.setAction(AlarmService.ACTION_START);
        svc.putExtra("alarm", alarm.toString());
        ContextCompat.startForegroundService(this, svc);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Journey tracking", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shows distance to your stop during a bus or train trip");
        nm.createNotificationChannel(ch);
    }

    private Notification buildNotification(Double km) {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 4, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String name = target != null ? target.optString("label", "destination") : "destination";
        String text = km == null ? "Finding your location…"
            : String.format(Locale.US, "%.0f km left · alarm at %.0f km", km, target.optDouble("radiusKm", 20));
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Going to " + name)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pi)
            .build();
    }

    /** Stop tracking. reached = true keeps the last status so the app can show it. */
    private void finish(boolean reached) {
        if (lm != null) {
            try {
                lm.removeUpdates(this);
            } catch (SecurityException ignored) {
            }
        }
        AlarmStore.setJourney(this, null);
        if (!reached) AlarmStore.setJourneyStatus(this, null);
        target = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (lm != null) {
            try {
                lm.removeUpdates(this);
            } catch (SecurityException ignored) {
            }
        }
        super.onDestroy();
    }
}
