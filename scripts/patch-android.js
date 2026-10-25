#!/usr/bin/env node
/*
 * Copies Jaago's native alarm code into the Android project and adds the
 * permissions and components it needs to AndroidManifest.xml.
 * Run after `npx cap add android`. Safe to run again any time — it replaces
 * its own blocks instead of adding them twice.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const androidMain = path.join(root, 'android', 'app', 'src', 'main');
const manifestPath = path.join(androidMain, 'AndroidManifest.xml');
const javaDir = path.join(androidMain, 'java', 'com', 'jaago', 'app');
const srcDir = path.join(root, 'native', 'android', 'com', 'jaago', 'app');

if (!fs.existsSync(manifestPath)) {
  console.error('Android project not found. Run "npx cap add android" first.');
  process.exit(1);
}
if (!fs.existsSync(srcDir)) {
  console.error('Missing folder: native/android/com/jaago/app — upload the "native" folder too.');
  process.exit(1);
}

// 1. Java files
fs.mkdirSync(javaDir, { recursive: true });
for (const f of fs.readdirSync(srcDir)) {
  if (!f.endsWith('.java')) continue;
  fs.copyFileSync(path.join(srcDir, f), path.join(javaDir, f));
  console.log('copied  ' + f);
}

// 2. Manifest
const PERMISSIONS = `<!-- jaago:permissions -->
    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.location.gps" android:required="false" />
    <queries>
        <intent>
            <action android:name="android.speech.RecognitionService" />
        </intent>
        <intent>
            <action android:name="android.intent.action.TTS_SERVICE" />
        </intent>
    </queries>
    <!-- /jaago:permissions -->`;

const COMPONENTS = `<!-- jaago:components -->
        <receiver android:name=".AlarmReceiver" android:exported="false" />
        <receiver android:name=".BootReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
            </intent-filter>
        </receiver>
        <service
            android:name=".AlarmService"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />
        <service
            android:name=".JourneyService"
            android:exported="false"
            android:foregroundServiceType="location" />
        <!-- /jaago:components -->`;

let xml = fs.readFileSync(manifestPath, 'utf8');

// Remove blocks from any earlier version of this script (with or without end markers).
xml = xml.replace(/\s*<!-- jaago:permissions -->[\s\S]*?<!-- \/jaago:permissions -->/g, '');
xml = xml.replace(/\s*<!-- jaago:components -->[\s\S]*?<!-- \/jaago:components -->/g, '');
xml = xml.replace(/\s*<!-- jaago:permissions -->[\s\S]*?<\/queries>/g, '');
xml = xml.replace(/\s*<!-- jaago:components -->[\s\S]*?android:foregroundServiceType="mediaPlayback" \/>/g, '');

xml = xml.replace(/(\n\s*)<application/, '\n    ' + PERMISSIONS + '$1<application');
xml = xml.replace(/(\n\s*)<\/application>/, '\n        ' + COMPONENTS + '$1</application>');
fs.writeFileSync(manifestPath, xml);
console.log('updated AndroidManifest.xml');

console.log('\nDone. Next: npx cap sync android && npx cap open android');
