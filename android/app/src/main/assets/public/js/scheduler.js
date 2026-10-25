/* Jaago — turns every reminder into exact times and hands them to the native alarm code.
 *
 * Kinds of entries sent to Android:
 *   custom / smart / snooze  – ringing alarm with optional wake mission
 *   med                      – ringing medicine alarm (several medicines at the same minute are grouped)
 *   doctor                   – ringing "time to leave for the doctor" alarm
 *   journey                  – ringing backup alarm for a bus/train journey
 *   notify                   – a normal notification, no ringing (refill, checklist, fasting)
 */
(function () {
  const A = window.JaagoAstro;
  const HORIZON_DAYS = 7; // schedule one week ahead; refreshed whenever the app opens or an alarm rings
  const MAX_ALARMS = 400;
  const DAY = 86400000;

  const SMART_LABELS = {
    brahma: 'Brahma Muhurat',
    suryoday: 'Suryoday',
    sandhya: 'Sandhya aarti',
    sehri: 'Sehri',
    iftar: 'Iftar',
    ekadashi: 'Ekadashi tomorrow',
  };

  const FOOD = {
    before: { en: 'Before food', hi: 'खाने से पहले लें।', enSay: 'Take it before food.' },
    after: { en: 'After food', hi: 'खाने के बाद लें।', enSay: 'Take it after food.' },
    with: { en: 'With food', hi: 'खाने के साथ लें।', enSay: 'Take it with food.' },
    any: { en: 'Any time', hi: '', enSay: '' },
  };

  function addDays(d, n) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  }
  function atTime(day, h, m) {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
  }
  function parseDate(s) {
    const [y, m, d] = (s || '').split('-').map(Number);
    return y ? new Date(y, m - 1, d) : null;
  }
  function parseTime(s) {
    const [h, m] = (s || '0:0').split(':').map(Number);
    return [h || 0, m || 0];
  }
  function clock(d) {
    const h = d.getHours();
    return (h % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ---------- Medicines ----------
  function medActiveOn(med, day) {
    const start = parseDate(med.start) || day;
    if (day < start) return false;
    if (med.courseDays > 0 && day >= addDays(start, med.courseDays)) return false;
    if (med.days && med.days.length && !med.days.includes(day.getDay())) return false;
    return true;
  }

  function medEndDate(med) {
    const start = parseDate(med.start);
    return med.courseDays > 0 && start ? addDays(start, med.courseDays) : null;
  }

  /** Every scheduled dose of one medicine between two moments. */
  function medDoses(med, fromMs, toMs) {
    const out = [];
    const first = addDays(new Date(fromMs), 0);
    for (let day = first; day.getTime() <= toMs; day = addDays(day, 1)) {
      if (!medActiveOn(med, day)) continue;
      for (const t of med.times || []) {
        const [h, m] = parseTime(t);
        const at = atTime(day, h, m).getTime();
        if (at >= fromMs && at <= toMs) out.push({ at, key: med.id + '@' + at, medId: med.id });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  /** 'taken' | 'skipped' | 'missed' | 'due' | 'upcoming' */
  function doseStatus(state, dose, now) {
    const log = state.doseLog[dose.key];
    if (log) return log.s;
    if (dose.at > now) return 'upcoming';
    if (dose.at > now - 60 * 60000) return 'due';
    return 'missed';
  }

  function medDaysLeft(med) {
    if (med.stock == null || med.stock === '') return null;
    const perWeekDays = med.days && med.days.length ? med.days.length / 7 : 1;
    const perDay = (med.perDose || 1) * (med.times || []).length * perWeekDays;
    if (!perDay) return null;
    return Math.floor(med.stock / perDay);
  }

  function medSpeech(state, meds) {
    if (state.voice === 'off') return null;
    if (state.voice === 'en') {
      return meds.map((m) => (m.forWhom ? m.forWhom + ', ' : '') + 'time to take ' + m.name + '. ' + FOOD[m.food || 'any'].enSay).join(' ');
    }
    return meds.map((m) => (m.forWhom ? m.forWhom + ', ' : '') + m.name + ' लेने का समय हो गया है। ' + FOOD[m.food || 'any'].hi).join(' ');
  }

  // ---------- Build everything ----------
  function buildOccurrences(state, now) {
    now = now || new Date();
    const nowMs = now.getTime();
    const endMs = nowMs + HORIZON_DAYS * DAY;
    const out = [];
    const today = addDays(now, 0);
    const lang = state.voice === 'en' ? 'en' : 'hi';

    // Custom alarms
    for (const a of state.alarms) {
      if (!a.on) continue;
      const repeat = a.days && a.days.length > 0;
      for (let i = 0; i <= HORIZON_DAYS; i++) {
        const day = addDays(today, i);
        if (repeat && !a.days.includes(day.getDay())) continue;
        const t = atTime(day, a.hour, a.min);
        if (t.getTime() <= nowMs) continue;
        out.push({ at: t.getTime(), label: a.label || 'Alarm', mission: a.mission || 'none', ref: a.id, kind: 'custom' });
        if (!repeat) break;
      }
    }

    // Smart (panchang / sun) alarms
    const loc = state.location;
    if (loc) {
      const s = state.smart;
      for (let i = 0; i <= HORIZON_DAYS; i++) {
        const day = addDays(today, i);
        const t = A.dayTimes(day, loc.lat, loc.lng);
        const push = (key, date) => {
          if (!date) return;
          const at = Math.round(date.getTime() / 60000) * 60000; // ring on the whole minute
          if (at <= nowMs) return;
          out.push({ at, label: SMART_LABELS[key], mission: s[key].mission || 'none', ref: 'smart:' + key, kind: 'smart' });
        };
        if (s.brahma.on) push('brahma', t.brahmaStart);
        if (s.suryoday.on) push('suryoday', t.sunrise);
        if (s.sandhya.on) push('sandhya', t.sunset);
        if (A.isRamadan(day)) {
          if (s.sehri.on && t.fajr) push('sehri', new Date(t.fajr.getTime() - (s.sehri.before || 45) * 60000));
          if (s.iftar.on) push('iftar', t.sunset);
        }
        if (s.ekadashi.on) {
          const nextTimes = A.dayTimes(addDays(day, 1), loc.lat, loc.lng);
          if (nextTimes.sunrise) {
            const tithi = A.tithiAt(nextTimes.sunrise);
            if (tithi === 11 || tithi === 26) push('ekadashi', atTime(day, s.ekadashi.hour || 21, 0));
          }
        }
      }
    }

    // Medicines — doses at the same minute ring together
    const groups = new Map();
    for (const med of state.meds || []) {
      if (!med.on) continue;
      for (const d of medDoses(med, nowMs + 1, endMs)) {
        if (state.doseLog[d.key]) continue; // already marked (e.g. taken early)
        if (!groups.has(d.at)) groups.set(d.at, []);
        groups.get(d.at).push({ med, key: d.key });
      }
    }
    for (const [at, list] of groups) {
      const meds = list.map((x) => x.med);
      out.push({
        at,
        kind: 'med',
        ref: 'med@' + at,
        label: meds.map((m) => m.name).join(', '),
        mission: 'none',
        doses: list.map((x) => ({ key: x.key, medId: x.med.id })),
        speak: medSpeech(state, meds),
        lang,
      });
    }

    // Refill warnings: one notification at the next 10 AM
    for (const med of state.meds || []) {
      if (!med.on) continue;
      const left = medDaysLeft(med);
      if (left == null || left > (med.refillDays || 5)) continue;
      const end = medEndDate(med);
      if (end && end <= addDays(today, left + 1)) continue; // course ends before stock runs out
      let at = atTime(today, 10, 0).getTime();
      if (at <= nowMs) at += DAY;
      out.push({
        at,
        kind: 'notify',
        ref: 'refill:' + med.id,
        label: 'Dawai khatam hone wali hai: ' + med.name,
        body: 'Sirf ' + med.stock + ' bachi hain (lagbhag ' + left + ' din). Aaj hi khareed lein.',
      });
    }

    // Doctor appointments
    for (const ap of state.appts || []) {
      if (ap.status === 'done') continue;
      const day = parseDate(ap.date);
      if (!day) continue;
      const [h, m] = parseTime(ap.time);
      const apAt = atTime(day, h, m).getTime();
      if (apAt <= nowMs) continue;
      const who = ap.forWhom ? ap.forWhom + ' — ' : '';
      const timeStr = clock(new Date(apAt));
      const items = (ap.checklist || []).map((c) => c.t).filter(Boolean);
      const before = addDays(day, -1);

      // 8 PM the night before: what to carry
      const eve = atTime(before, 20, 0).getTime();
      if (eve > nowMs) {
        out.push({
          at: eve,
          kind: 'notify',
          ref: 'appt-eve:' + ap.id,
          label: who + 'Kal ' + timeStr + ' — ' + (ap.doctor || 'Doctor'),
          body: (items.length ? 'Saath le jaayein: ' + items.join(', ') + '.' : '') + (ap.fasting ? ' Khaali pet jaana hai.' : ''),
        });
      }
      // Fasting starts
      if (ap.fasting) {
        const fastAt = atTime(before, ap.fastHour || 22, 0).getTime();
        if (fastAt > nowMs) {
          out.push({
            at: fastAt,
            kind: 'notify',
            ref: 'appt-fast:' + ap.id,
            label: who + 'Ab kuch na khaayein',
            body: 'Kal ' + timeStr + ' ' + (ap.doctor || 'test') + '. Sirf paani pee sakte hain (doctor ne mana na kiya ho to).',
          });
        }
      }
      // Time to leave (rings)
      const travel = ap.travelMins || 0;
      const leaveAt = apAt - (travel ? travel + 15 : 30) * 60000;
      if (leaveAt > nowMs) {
        const say = state.voice === 'off' ? null : state.voice === 'en'
          ? 'Time to leave for ' + (ap.doctor || 'the doctor') + '. Appointment at ' + timeStr + '.'
          : (ap.forWhom ? ap.forWhom + ', ' : '') + (ap.doctor || 'डॉक्टर') + ' के पास जाने का समय हो गया है। अपॉइंटमेंट ' + timeStr + ' बजे है।';
        out.push({
          at: leaveAt,
          kind: 'doctor',
          ref: 'appt:' + ap.id,
          label: travel ? 'Doctor ke paas nikalne ka samay' : 'Doctor appointment in 30 min',
          mission: 'none',
          speak: say,
          lang,
        });
      }
    }

    // Journey backup alarm (time based, works even if GPS fails)
    const j = state.journey;
    if (j && j.backupAt && j.backupAt > nowMs) {
      out.push({
        at: j.backupAt,
        kind: 'journey',
        ref: 'journey',
        label: j.name + ' aane wala hai',
        mission: 'none',
        speak: state.voice === 'off' ? null : state.voice === 'en' ? j.name + ' is coming soon. Get your luggage ready.' : j.name + ' आने वाला है। उठ जाइए, सामान तैयार कर लीजिए।',
        lang,
      });
    }

    // A pending snooze
    if (state.snooze && state.snooze.at > nowMs) {
      out.push(Object.assign({}, state.snooze, { kind: state.snooze.kind === 'custom' || state.snooze.kind === 'smart' ? 'snooze' : state.snooze.kind }));
    }

    out.sort((x, y) => x.at - y.at);
    const trimmed = out.slice(0, MAX_ALARMS);
    trimmed.forEach((o, i) => (o.id = 1000 + i)); // Android request codes
    return trimmed;
  }

  // ---------- Native bridge (with a browser stand-in so the UI can be previewed on a computer) ----------
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  const webMock = (function () {
    const listeners = [];
    let ringing = null;
    let journey = null;
    return {
      setAlarms: async ({ alarms }) => ({ scheduled: alarms.length }),
      getRinging: async () => (ringing ? { alarm: ringing } : {}),
      stopRinging: async () => { ringing = null; return {}; },
      pauseSound: async () => ({}),
      resumeSound: async () => ({}),
      checkSetup: async () => ({ exact: true, notifications: true, fullScreen: true, battery: true }),
      requestNotifications: async () => ({ granted: true }),
      requestLocation: async () => ({ granted: true }),
      openSettings: async () => ({}),
      startJourney: async (opts) => { journey = Object.assign({}, opts, { startedAt: Date.now() }); return {}; },
      stopJourney: async () => { journey = null; return {}; },
      getJourney: async () => (journey ? { active: true, distanceKm: 37.4, updatedAt: Date.now() - 40000, accuracy: 25 } : { active: false }),
      addListener: async (name, cb) => { listeners.push(cb); return { remove() {} }; },
      _fakeRing: (alarm) => { ringing = alarm; listeners.forEach((cb) => cb({ alarm })); },
    };
  })();

  const Native = isNative ? window.Capacitor.Plugins.JaagoAlarm : webMock;

  async function sync(state) {
    const alarms = buildOccurrences(state);
    try {
      await Native.setAlarms({ alarms });
    } catch (e) {
      console.error('Scheduling failed', e);
    }
    return alarms;
  }

  window.JaagoScheduler = {
    buildOccurrences, sync, Native, isNative, SMART_LABELS, FOOD,
    medDoses, doseStatus, medDaysLeft, medActiveOn, medEndDate,
    addDays, atTime, parseDate, parseTime, ymd,
  };
})();
