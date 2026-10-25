# Jaago — Panchang & Family Alarm (Android)

HTML/CSS/JS app inside **Capacitor 8**, with native Android alarm code so alarms ring
even when the app is closed, the phone is locked, or the phone was restarted.

## What works in this version

| Feature | Status |
|---|---|
| Custom alarms (time, repeat days, label) | Done |
| Sunrise-based alarms: Brahma Muhurat, Suryoday, Sandhya | Done — calculated on the phone for your location |
| Sehri / Iftar (only ring during Ramzan) | Done |
| Ekadashi reminder the night before | Done — tithi calculated on the phone |
| "Say your reason" mission — your recorded voice plays, you speak the line back | Done (Hindi or English) |
| Light mission — show the camera daylight or a bulb | Done |
| Limited snooze, gradual volume, vibration, 10-minute auto stop | Done |
| Rings over the lock screen, survives restart | Done |
| Medicine reminders: several doses a day, before/after food, strip photo, "Le liya" log, missed doses, 7-day history, refill reminder, course length | Done |
| Spoken reminders in Hindi or English (medicine, doctor, station) | Done — uses the phone's text-to-speech |
| Doctor appointments: checklist the night before, fasting reminder, alarm to leave based on travel time, one-tap follow-up | Done |
| Bus / train station alarm: rings when you are 10–50 km from your stop (GPS), plus optional time-based backup | Done |
| Family remote alarms and missed-dose alerts to family | Not yet — needs an online backend (Firebase) |

## Folder layout

```
www/                    The app screens (edit these like a normal website)
  index.html
  css/app.css
  js/astro.js           Sunrise, sunset, Fajr, tithi, Ramzan maths
  js/store.js           Saves settings and voice notes on the phone
  js/scheduler.js       Works out the next week of alarm times
  js/missions.js        Voice recording, speech matching, light check
  js/app.js             All screens and buttons
native/android/...      Native Java: alarm scheduling, ringing service, reboot restore
scripts/patch-android.js  Copies the Java files in and adds Android permissions
android/                Android Studio project (already patched)
```

## Build the APK

You need **Node.js 20+** and **Android Studio** (with JDK 21, which Android Studio includes).

```bash
cd jaago
npm install
npx cap sync android
npx cap open android
```

Android Studio opens. Wait for Gradle to finish, then:

- **Test on your phone:** connect it with USB debugging on, press the green Run button.
- **APK file:** Build › Build Bundle(s) / APK(s) › Build APK(s).
- **Play Store:** Build › Generate Signed Bundle / APK › Android App Bundle.

If you ever delete the `android` folder, recreate it with:

```bash
npm run setup:android
```

## After editing the HTML/CSS/JS

```bash
npx cap sync android
```

Then press Run again in Android Studio.

**Preview in a computer browser:** `npm run preview`, then open http://localhost:5173.
In the browser, alarms are simulated: Settings › "Ring a test alarm" shows the ringing screen after 3 seconds.

## First run on the phone

1. Open Jaago and allow notifications.
2. Panchang tab → **Use my location**.
3. Settings tab → turn on every item in **Phone setup**.
4. Settings → **Ring a test alarm in 1 minute**, lock the phone, and wait.

On Xiaomi, Vivo, Oppo, Realme and some Samsung phones, also turn on **Autostart** for Jaago
and set battery to **No restrictions** in the phone's own settings. Without that, those
phones can block any alarm app.

## Play Store notes

- The app uses `USE_EXACT_ALARM`. Google allows it only for apps whose main job is alarms
  or calendars — Jaago qualifies. Declare it as an alarm clock app in the Play Console form.
- Microphone, camera and location are only used for the wake missions, medicine photos, sunrise times and the station alarm.
  Say so in your privacy policy and Data Safety form; nothing is uploaded.
- The station alarm uses a foreground service of type "location". In the Play Console, declare it under
  Foreground service permissions (Location: "the user starts a trip and the app alerts them near their stop").
- Medicine features are reminders only. Don't describe the app as giving medical advice.
- The voice mission uses the phone's Google speech service. On phones without the Google app,
  the line can't be checked, so the alarm switches to the light mission after 3 tries.

## Accuracy

Sunrise and sunset are usually within 1–2 minutes. Tithi is approximate within about
30 minutes of its start or end. Good for reminders, not for exact muhurat calculation.
