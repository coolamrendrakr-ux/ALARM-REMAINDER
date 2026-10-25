package com.jaago.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AlarmPlugin.class);
        super.onCreate(savedInstanceState);
        refreshLockScreenFlags();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        refreshLockScreenFlags();
    }

    @Override
    public void onResume() {
        super.onResume();
        refreshLockScreenFlags();
    }

    /** Show over the lock screen and wake the display only while an alarm is ringing. */
    void refreshLockScreenFlags() {
        boolean ringing = AlarmStore.getRinging(this) != null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(ringing);
            setTurnScreenOn(ringing);
        } else {
            int f = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
            if (ringing) getWindow().addFlags(f);
            else getWindow().clearFlags(f);
        }
        if (ringing) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
