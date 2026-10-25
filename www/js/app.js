/* Jaago — core: navigation, alarms, panchang, settings, ringing screen.
 * Health (medicine + doctor) and Journey screens live in health.js and journey.js
 * and plug in through window.JaagoApp.
 */
(function () {
  const Store = window.JaagoStore;
  const Sched = window.JaagoScheduler;
  const Astro = window.JaagoAstro;
  const M = window.JaagoMissions;
  const Native = Sched.Native;

  let state = Store.load();
  let setup = { exact: true, notifications: true, fullScreen: true, battery: true };
  let ringingNow = null;

  const views = {}; // name -> render()
  const actions = {}; // data-action name -> fn(el, event)
  const changes = {}; // data-change name -> fn(el)
  const ringHandlers = {}; // alarm kind -> fn(alarm, ctx)
  const viewEnter = {}; // name -> fn() when the tab is opened
  let currentView = 'home';

  // ---------- Helpers ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');

  function fmt(date) {
    let h = date.getHours();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return { hm: h + ':' + pad(date.getMinutes()), ap };
  }
  function fmtStr(date) {
    if (!date) return '—';
    const f = fmt(date);
    return f.hm + ' ' + f.ap;
  }
  function fmtHM(h, m) {
    return fmt(new Date(2000, 0, 1, h, m));
  }
  function fmtTimeStr(t) {
    const [h, m] = Sched.parseTime(t);
    return fmtStr(new Date(2000, 0, 1, h, m));
  }
  function fmtDate(d) {
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function untilText(ms) {
    const mins = Math.max(0, Math.round(ms / 60000));
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    if (d) return d + 'd ' + h + 'h';
    return h ? h + 'h ' + pad(m) + 'm' : m + ' min';
  }
  const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const DAY_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function daysText(days) {
    if (!days || !days.length) return 'Once';
    if (days.length === 7) return 'Daily';
    const s = [...days].sort().join(',');
    if (s === '1,2,3,4,5') return 'Mon–Fri';
    if (s === '1,2,3,4,5,6') return 'Mon–Sat';
    if (s === '0,6') return 'Weekends';
    return [...days].sort().map((d) => DAY_NAME[d]).join(', ');
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2800);
  }

  const ICON = {
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:currentColor;stroke:none"><path d="M7 4.5v15l13-7.5z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:currentColor;stroke:none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    family: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 5.5 4.8"/></svg>',
    pill: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="m8.5 8.5 7 7"/></svg>',
    steth: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3v6a5 5 0 0 0 10 0V3"/><path d="M10 14v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="12" r="2"/></svg>',
    train: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14"/><circle cx="9" cy="14" r=".5"/><circle cx="15" cy="14" r=".5"/><path d="m8 21 2-4M16 21l-2-4"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  };

  function persist() {
    Store.save(state);
    Sched.sync(state);
    renderAll();
  }

  function switchHtml(name, checked, label) {
    return '<label class="switch"><input type="checkbox" data-toggle="' + esc(name) + '"' + (checked ? ' checked' : '') +
      ' aria-label="' + esc(label) + '"><span></span></label>';
  }

  function missionChip(m) {
    if (m === 'voice') return '<span class="chip voice">VOICE</span>';
    if (m === 'light') return '<span class="chip light">LIGHT</span>';
    return '';
  }

  // Photos stored in IndexedDB are shown through object URLs, cached per id.
  const photoUrls = {};
  function hydratePhotos(root) {
    (root || document).querySelectorAll('img[data-photo]').forEach(async (img) => {
      const id = img.dataset.photo;
      if (photoUrls[id] === undefined) {
        const blob = await Store.getPhoto(id).catch(() => null);
        photoUrls[id] = blob ? URL.createObjectURL(blob) : null;
      }
      if (photoUrls[id]) {
        img.src = photoUrls[id];
        img.hidden = false;
      }
    });
  }
  function forgetPhoto(id) {
    if (photoUrls[id]) URL.revokeObjectURL(photoUrls[id]);
    delete photoUrls[id];
  }

  // ---------- Navigation ----------
  function showView(name) {
    currentView = name;
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle('active', on);
      if (on) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    if (name === 'settings') refreshSetup();
    if (viewEnter[name]) viewEnter[name]();
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

  // ---------- Home ----------
  function setupIncomplete() {
    return Sched.isNative && (!setup.exact || !setup.notifications || !setup.fullScreen);
  }

  function renderHome() {
    const now = new Date();
    const occ = Sched.buildOccurrences(state, now);
    const next = occ.find((o) => o.kind !== 'notify');
    const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

    let html = '<div class="header"><div><p class="sub">' + esc(dateStr) + '</p>' +
      '<h1>Suprabhat <span class="hi">सुप्रभात</span></h1></div>' +
      '<button class="icon-btn" data-action="add" aria-label="Add alarm">' + ICON.plus + '</button></div>';

    if (setupIncomplete()) {
      html += '<div class="banner"><div><div class="title">Finish setup so alarms can ring</div>' +
        '<div class="meta">A few phone permissions are still off.</div></div>' +
        '<button class="btn primary small" data-action="go-settings">Fix now</button></div>';
    }

    if (next) {
      const d = new Date(next.at);
      const f = fmt(d);
      const sameDay = d.toDateString() === now.toDateString();
      html += '<div class="hero"><div class="tag">Next · in ' + untilText(next.at - now.getTime()) + (sameDay ? '' : ' · ' + esc(fmtDate(d))) + '</div>' +
        '<div class="time">' + f.hm + ' <small>' + f.ap + '</small></div>' +
        '<div class="label">' + esc(next.label) + '</div>' +
        (next.kind === 'smart' && state.location ? '<div class="meta">' + ICON.pin + ' Moves daily with the sun · ' + esc(state.location.name) + '</div>' : '') +
        '</div>';
    } else {
      html += '<div class="hero empty"><div class="tag" style="color:var(--muted)">No alarm set</div>' +
        '<div class="label">Tap + to add an alarm, or turn on a Panchang alarm.</div></div>';
    }

    // Shortcuts into Health and Journey
    const shortcuts = [];
    if ((state.meds || []).some((m) => m.on)) {
      const today = Sched.addDays(now, 0).getTime();
      let total = 0, taken = 0;
      for (const med of state.meds) {
        if (!med.on) continue;
        for (const d of Sched.medDoses(med, today, today + 86400000 - 1)) {
          total++;
          if (Sched.doseStatus(state, d, now.getTime()) === 'taken') taken++;
        }
      }
      if (total) shortcuts.push('<button class="card shortcut" data-action="go" data-view="health">' + ICON.pill +
        '<span class="grow"><span class="title">Aaj ki dawai</span><span class="meta">' + taken + ' of ' + total + ' taken</span></span></button>');
    }
    if (state.journey) {
      shortcuts.push('<button class="card shortcut" data-action="go" data-view="journey">' + ICON.train +
        '<span class="grow"><span class="title">Journey to ' + esc(state.journey.name) + '</span><span class="meta">Station alarm is on</span></span></button>');
    }
    html += shortcuts.join('');

    const smartRows = Object.keys(Sched.SMART_LABELS).filter((k) => state.smart[k].on).map((k) => {
      const o = occ.find((x) => x.ref === 'smart:' + k);
      const t = o ? fmt(new Date(o.at)) : null;
      return '<div class="card alarm">' +
        '<button class="open" data-action="smart" data-key="' + k + '">' +
        '<div class="t">' + (t ? t.hm + ' <small>' + t.ap + '</small>' : '<small>Not this week</small>') + '</div>' +
        '<div class="m"><span class="chip auto">AUTO</span>' + missionChip(state.smart[k].mission) + esc(Sched.SMART_LABELS[k]) + '</div>' +
        '</button>' + switchHtml('smart:' + k, true, Sched.SMART_LABELS[k]) + '</div>';
    });

    const sorted = [...state.alarms].sort((a, b) => a.hour * 60 + a.min - (b.hour * 60 + b.min));
    const customRows = sorted.map((a) => {
      const t = fmtHM(a.hour, a.min);
      return '<div class="card alarm' + (a.on ? '' : ' off') + '">' +
        '<button class="open" data-action="edit" data-id="' + esc(a.id) + '">' +
        '<div class="t">' + t.hm + ' <small>' + t.ap + '</small></div>' +
        '<div class="m">' + missionChip(a.mission) + esc(a.label || 'Alarm') + ' · ' + esc(daysText(a.days)) + '</div>' +
        '</button>' + switchHtml('alarm:' + a.id, a.on, (a.label || 'Alarm') + ' on') + '</div>';
    });

    html += '<div class="eyebrow">Your alarms</div><div>';
    if (!smartRows.length && !customRows.length) {
      html += '<div class="card empty-state">No alarms yet.<br>Tap <b>+</b> to add one.</div>';
    }
    html += smartRows.join('') + customRows.join('') + '</div>';
    $('#view-home').innerHTML = html;
  }

  // ---------- Panchang ----------
  function sunArcSvg(times, now) {
    const P0 = [8, 86], P1 = [175, -40], P2 = [342, 86];
    let progress = '';
    if (times.sunrise && times.sunset) {
      const t = (now - times.sunrise) / (times.sunset - times.sunrise);
      if (t > 0 && t < 1) {
        const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
        const c1 = lerp(P0, P1, t);
        const pt = lerp(c1, lerp(P1, P2, t), t);
        progress = '<path d="M8 86 Q' + c1[0].toFixed(1) + ' ' + c1[1].toFixed(1) + ' ' + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1) +
          '" stroke="#F6A623" stroke-width="3"/><circle cx="' + pt[0].toFixed(1) + '" cy="' + pt[1].toFixed(1) + '" r="9" fill="#F6A623" stroke="none"/>';
      }
    }
    return '<svg class="arc" viewBox="0 0 350 92" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<path d="M8 86 Q175 -40 342 86" stroke="#3A4560" stroke-width="2" stroke-dasharray="4 6"/>' + progress +
      '<line x1="0" y1="86" x2="350" y2="86" stroke="#232C42" stroke-width="1.5"/></svg>';
  }

  function renderPanchang() {
    const now = new Date();
    let html = '<div class="header"><div><h1>Panchang <span class="hi">पंचांग</span></h1>' +
      '<p class="sub">' + ICON.pin + (state.location ? esc(state.location.name) : 'Location not set') + '</p></div></div>';

    if (!state.location) {
      html += '<div class="card family-hero"><h2>Set your location</h2>' +
        '<p>Sunrise, sunset and muhurat times depend on where you are. Your location stays on this phone.</p>' +
        '<button class="btn primary block" data-action="locate">' + ICON.pin + ' Use my location</button>' +
        '<button class="btn secondary block" data-action="manual-loc">Enter manually</button></div>';
      $('#view-panchang').innerHTML = html;
      return;
    }

    const loc = state.location;
    const times = Astro.dayTimes(now, loc.lat, loc.lng);
    const tithi = Astro.tithiName(Astro.tithiAt(now));
    html += '<div class="card sun-card">' + sunArcSvg(times, now) +
      '<div class="stats">' +
      '<div class="stat"><div class="k">SUNRISE</div><div class="v">' + fmtStr(times.sunrise) + '</div></div>' +
      '<div class="stat"><div class="k">SUNSET</div><div class="v">' + fmtStr(times.sunset) + '</div></div>' +
      '<div class="stat"><div class="k">TITHI NOW</div><div class="v">' + esc(tithi) + '</div></div>' +
      '</div></div>';

    const ramadan = Astro.isRamadan(now);
    const sb = state.smart.sehri.before || 45;
    const rows = [
      ['brahma', 'Brahma Muhurat', '96 min before sunrise · ' + fmtStr(times.brahmaStart)],
      ['suryoday', 'Suryoday', 'At sunrise · ' + fmtStr(times.sunrise)],
      ['sandhya', 'Sandhya aarti', 'At sunset · ' + fmtStr(times.sunset)],
      ['sehri', 'Sehri', sb + ' min before Fajr' + (ramadan ? ' · ' + fmtStr(times.fajr ? new Date(times.fajr - sb * 60000) : null) : ' · rings only in Ramzan')],
      ['iftar', 'Iftar', 'At sunset' + (ramadan ? ' · ' + fmtStr(times.sunset) : ' · rings only in Ramzan')],
      ['ekadashi', 'Ekadashi reminder', 'Night before at ' + fmtStr(new Date(2000, 0, 1, state.smart.ekadashi.hour || 21, 0))],
    ];
    html += '<div class="eyebrow">Smart alarms · update daily</div><div class="card list">' +
      rows.map((r) => '<div class="row"><button class="grow plain" data-action="smart" data-key="' + r[0] + '">' +
        '<span class="title">' + esc(r[1]) + ' ' + missionChip(state.smart[r[0]].mission) + '</span><span class="meta">' + esc(r[2]) + '</span></button>' +
        switchHtml('smart:' + r[0], state.smart[r[0]].on, r[1]) + '</div>').join('') + '</div>' +
      '<p class="note">Times are calculated on your phone for ' + loc.lat.toFixed(2) + '°, ' + loc.lng.toFixed(2) +
      '° and are usually within 1–2 minutes. Tithi is approximate near its start and end time.</p>' +
      '<button class="btn secondary small" data-action="locate">Update location</button>';
    $('#view-panchang').innerHTML = html;
  }

  // ---------- Settings ----------
  async function refreshSetup() {
    try {
      setup = await Native.checkSetup();
    } catch (e) {}
    renderSettings();
    renderHome();
  }

  function selectHtml(setting, value, options, label) {
    return '<select class="input select-sm" data-setting="' + setting + '" aria-label="' + esc(label) + '">' +
      options.map((o) => '<option value="' + o[0] + '"' + (String(value) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') +
      '</select>';
  }

  function renderSettings() {
    const item = (ok, title, meta, which) =>
      '<div class="row"><span class="dot ' + (ok ? 'ok' : 'bad') + '"></span><div class="grow"><span class="title">' + esc(title) +
      '</span><span class="meta">' + esc(meta) + '</span></div>' +
      (ok ? '<span class="meta">On</span>' : '<button class="btn primary small" data-action="fix" data-which="' + which + '">Turn on</button>') + '</div>';

    let html = '<div class="header"><div><h1>Settings</h1><p class="sub">Make sure every alarm rings</p></div></div>';
    html += '<div class="eyebrow">Phone setup</div><div class="card list">' +
      item(setup.notifications, 'Notifications', 'Needed to show the alarm screen', 'notifications') +
      item(setup.exact, 'Alarms & reminders', 'Lets alarms ring at the exact minute', 'exact') +
      item(setup.fullScreen, 'Full-screen alarm', 'Shows the alarm over the lock screen', 'fullScreen') +
      item(setup.battery, 'Battery: unrestricted', 'Stops the phone from blocking alarms', 'battery') +
      '</div>' +
      '<p class="note">Phones from Xiaomi, Vivo, Oppo, Realme and Samsung may also need "Autostart" turned on for Jaago in their own settings app.</p>';

    html += '<div class="eyebrow">Spoken reminders</div><div class="card list">' +
      '<div class="row"><div class="grow"><span class="title">Voice</span><span class="meta">Speaks medicine, doctor and station alarms</span></div>' +
      selectHtml('voice', state.voice, [['hi', 'Hindi'], ['en', 'English'], ['off', 'Off']], 'Voice language') + '</div></div>';

    html += '<div class="eyebrow">Snooze</div><div class="card list">' +
      '<div class="row"><div class="grow"><span class="title">Snooze length</span></div>' +
      selectHtml('snoozeMinutes', state.snoozeMinutes, [[3, '3 min'], [5, '5 min'], [10, '10 min'], [15, '15 min']], 'Snooze length') + '</div>' +
      '<div class="row"><div class="grow"><span class="title">Snoozes allowed</span></div>' +
      selectHtml('snoozeMax', state.snoozeMax, [[0, 'None'], [1, '1'], [2, '2'], [3, '3']], 'Snoozes allowed') + '</div></div>';

    html += '<div class="eyebrow">Location</div><div class="card list"><div class="row"><div class="grow"><span class="title">' +
      (state.location ? esc(state.location.name) : 'Not set') + '</span><span class="meta">' +
      (state.location ? state.location.lat.toFixed(3) + ', ' + state.location.lng.toFixed(3) : 'Used for sunrise and panchang times') +
      '</span></div><button class="btn secondary small" data-action="locate">Update</button></div></div>';

    html += '<div class="eyebrow">Family</div><div class="card list"><div class="row">' + '<span style="color:var(--accent)">' + ICON.family + '</span>' +
      '<div class="grow"><span class="title">Family alarms — coming soon</span><span class="meta">Set alarms and medicine reminders on Maa-Papa\'s phone from yours, and get alerted if a dose is missed.</span></div></div></div>';

    html += '<div class="eyebrow">Test</div>' +
      '<button class="btn secondary block" data-action="test">' + ICON.bell + ' Ring a test alarm in 1 minute</button>' +
      '<p class="note">Lock your phone after tapping — the alarm should wake the screen.</p>';
    $('#view-settings').innerHTML = html;
  }

  function renderAll() {
    renderHome();
    renderPanchang();
    renderSettings();
    for (const k of Object.keys(views)) views[k]();
  }

  // ---------- Location (for panchang) ----------
  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('No GPS'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        reject,
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
      );
    });
  }

  async function locate() {
    toast('Finding your location…');
    try {
      await Native.requestLocation().catch(() => {});
      const p = await getPosition();
      state.location = { lat: p.lat, lng: p.lng, name: 'Your location' };
      persist();
      toast('Location saved');
    } catch (e) {
      toast('Could not get location — enter it manually');
      manualLocation();
    }
  }

  function manualLocation() {
    const loc = state.location || { lat: '', lng: '', name: '' };
    openSheet('Your location',
      '<div class="field"><label for="loc-name">Place name</label><input id="loc-name" class="input" value="' + esc(loc.name) + '" placeholder="e.g. Sasaram"></div>' +
      '<div class="field"><label for="loc-lat">Latitude</label><input id="loc-lat" class="input" inputmode="decimal" value="' + esc(loc.lat) + '" placeholder="24.95"></div>' +
      '<div class="field"><label for="loc-lng">Longitude</label><input id="loc-lng" class="input" inputmode="decimal" value="' + esc(loc.lng) + '" placeholder="84.03"></div>' +
      '<p class="note">Find these by long-pressing your town in Google Maps.</p>' +
      '<button class="btn primary block" id="loc-save">Save location</button>');
    $('#loc-save').onclick = () => {
      const lat = parseFloat($('#loc-lat').value);
      const lng = parseFloat($('#loc-lng').value);
      if (!(lat >= -66 && lat <= 66) || !(lng >= -180 && lng <= 180)) return toast('Enter a valid latitude and longitude');
      state.location = { lat, lng, name: $('#loc-name').value.trim() || 'Your location' };
      closeSheet();
      persist();
    };
  }

  // ---------- Bottom sheet ----------
  let sheetCleanup = null;
  function openSheet(title, body) {
    if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
    const panel = $('.sheet-panel');
    panel.innerHTML = '<div class="sheet-head"><h2 id="sheet-title">' + esc(title) + '</h2>' +
      '<button class="close" data-close aria-label="Close">' + ICON.close + '</button></div>' + body;
    $('#sheet').hidden = false;
    panel.scrollTop = 0;
    return panel;
  }
  function closeSheet() {
    if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
    $('#sheet').hidden = true;
    $('.sheet-panel').innerHTML = '';
  }
  $('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });

  /** Segmented single-choice buttons. Returns html; wire with bindSeg. */
  function segHtml(name, current, options, label) {
    return '<div class="seg" role="group" aria-label="' + esc(label) + '" data-seg="' + name + '" style="grid-template-columns:repeat(' + options.length + ',minmax(0,1fr))">' +
      options.map((o) => '<button type="button" data-val="' + esc(o[0]) + '" aria-pressed="' + (String(current) === String(o[0])) + '">' + (o[2] || '') + esc(o[1]) + '</button>').join('') + '</div>';
  }
  function bindSeg(root, name, onPick) {
    const seg = root.querySelector('[data-seg="' + name + '"]');
    if (!seg) return;
    seg.querySelectorAll('button').forEach((b) => (b.onclick = () => {
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      onPick(b.dataset.val);
    }));
  }

  function missionSeg(current, allowVoice) {
    const opts = [['none', 'None', ICON.bell], ['light', 'Light', ICON.bulb]];
    if (allowVoice) opts.splice(1, 0, ['voice', 'Say reason', ICON.mic]);
    return segHtml('mission', current, opts, 'Wake mission');
  }

  // ---------- Add / edit alarm ----------
  async function openAlarmSheet(id) {
    const existing = state.alarms.find((a) => a.id === id);
    const a = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: Store.newId(), hour: 6, min: 0, days: [1, 2, 3, 4, 5, 6], label: '', mission: 'none', phrase: '', lang: 'hi-IN', on: true,
    };
    let voiceBlob = existing ? await Store.getVoice(a.id).catch(() => null) : null;
    let voiceChanged = false;
    let recorder = null;

    const panel = openSheet(existing ? 'Edit alarm' : 'New alarm',
      '<input id="f-time" class="input time-input" type="time" value="' + pad(a.hour) + ':' + pad(a.min) + '" aria-label="Alarm time">' +
      '<div class="field"><span class="lbl">Repeat</span><div class="days">' +
      DAY_SHORT.map((d, i) => '<button type="button" class="day" data-day="' + i + '" aria-label="' + DAY_NAME[i] + '" aria-pressed="' + a.days.includes(i) + '">' + d + '</button>').join('') +
      '</div></div>' +
      '<div class="field"><label for="f-label">Label</label><input id="f-label" class="input" maxlength="40" value="' + esc(a.label) + '" placeholder="e.g. Shop opening"></div>' +
      '<div class="field"><span class="lbl">Wake mission</span>' + missionSeg(a.mission, true) + '</div>' +
      '<div id="voice-section"></div>' +
      '<button class="btn primary block" id="f-save">Save alarm</button>' +
      (existing ? '<button class="btn danger block" id="f-del">Delete alarm</button>' : ''));

    function renderVoice() {
      const box = $('#voice-section');
      if (!box) return;
      if (a.mission !== 'voice') { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="card voice-box">' +
        '<div class="voice-row"><button type="button" class="icon-btn' + (voiceBlob ? ' ghost' : '') + '" id="v-rec" aria-label="' + (recorder ? 'Stop recording' : 'Record your reason') + '">' + (recorder ? ICON.stop : ICON.mic) + '</button>' +
        '<span class="meta">' + (recorder ? 'Recording… tap to stop (8 sec max)' : voiceBlob ? 'Voice note saved. Tap mic to record again.' : 'Record why you must wake up. It plays when the alarm rings.') + '</span>' +
        (voiceBlob && !recorder ? '<button type="button" class="icon-btn ghost" id="v-play" aria-label="Play voice note">' + ICON.play + '</button>' : '') + '</div>' +
        '<div class="field"><label for="v-phrase">Line to say back</label><textarea id="v-phrase" class="input" maxlength="120" placeholder="Aaj 9 baje shop kholni hai">' + esc(a.phrase) + '</textarea></div>' +
        '<div class="voice-row"><select id="v-lang" class="input" style="flex:1;height:44px" aria-label="Speaking language">' +
        [['hi-IN', 'Hindi'], ['en-IN', 'English (India)']].map((l) => '<option value="' + l[0] + '"' + (a.lang === l[0] ? ' selected' : '') + '>' + l[1] + '</option>').join('') +
        '</select><button type="button" class="btn secondary small" id="v-learn">' + ICON.mic + ' Fill by speaking</button></div>' +
        '<p class="note">Tip: use "Fill by speaking" so the line is written the way the phone hears you — matching works best that way.</p></div>';

      $('#v-phrase').oninput = (e) => (a.phrase = e.target.value);
      $('#v-lang').onchange = (e) => (a.lang = e.target.value);
      $('#v-rec').onclick = async () => {
        if (recorder) {
          voiceBlob = await recorder.stop();
          voiceChanged = true;
          recorder = null;
          renderVoice();
          return;
        }
        try {
          recorder = await M.startRecording(8000);
          renderVoice();
          recorder.done.then((blob) => {
            if (!recorder) return;
            voiceBlob = blob;
            voiceChanged = true;
            recorder = null;
            renderVoice();
          });
        } catch (e) {
          toast('Microphone permission is needed to record');
        }
      };
      const play = $('#v-play');
      if (play) play.onclick = () => M.playBlob(voiceBlob);
      $('#v-learn').onclick = async () => {
        const btn = $('#v-learn');
        btn.disabled = true;
        btn.textContent = 'Listening…';
        try {
          const guesses = await M.listen(a.lang);
          if (guesses.length) {
            a.phrase = guesses[0];
            $('#v-phrase').value = a.phrase;
          } else toast('Did not catch that — try again');
        } catch (e) {
          toast(e.message || 'Could not listen');
        }
        btn.disabled = false;
        btn.innerHTML = ICON.mic + ' Fill by speaking';
      };
    }

    sheetCleanup = () => { if (recorder) recorder.stop(); };

    panel.querySelectorAll('.day').forEach((b) => (b.onclick = () => {
      const d = +b.dataset.day;
      a.days = a.days.includes(d) ? a.days.filter((x) => x !== d) : [...a.days, d];
      b.setAttribute('aria-pressed', a.days.includes(d));
    }));
    bindSeg(panel, 'mission', (v) => { a.mission = v; renderVoice(); });
    renderVoice();

    $('#f-save').onclick = async () => {
      const [h, m] = ($('#f-time').value || '06:00').split(':').map(Number);
      a.hour = h;
      a.min = m;
      a.label = $('#f-label').value.trim();
      a.on = true;
      if (a.mission === 'voice' && !a.phrase.trim()) return toast('Write or speak the line you will say back');
      if (recorder) { voiceBlob = await recorder.stop(); recorder = null; voiceChanged = true; }
      if (a.mission === 'voice' && voiceBlob && voiceChanged) await Store.putVoice(a.id, voiceBlob).catch(() => {});
      const i = state.alarms.findIndex((x) => x.id === a.id);
      if (i >= 0) state.alarms[i] = a;
      else state.alarms.push(a);
      closeSheet();
      persist();
      const occ = Sched.buildOccurrences(state).find((o) => o.ref === a.id);
      if (occ) toast('Alarm in ' + untilText(occ.at - Date.now()));
    };
    const del = $('#f-del');
    if (del) del.onclick = async () => {
      state.alarms = state.alarms.filter((x) => x.id !== a.id);
      await Store.deleteVoice(a.id).catch(() => {});
      closeSheet();
      persist();
      toast('Alarm deleted');
    };
  }

  // ---------- Smart alarm settings ----------
  function openSmartSheet(key) {
    const s = JSON.parse(JSON.stringify(state.smart[key]));
    let extra = '';
    if (key === 'sehri') {
      extra = '<div class="field"><label for="s-before">Minutes before Fajr</label><select id="s-before" class="input">' +
        [20, 30, 45, 60, 75, 90].map((n) => '<option value="' + n + '"' + (s.before === n ? ' selected' : '') + '>' + n + ' min</option>').join('') + '</select></div>';
    }
    if (key === 'ekadashi') {
      extra = '<div class="field"><label for="s-hour">Remind me the night before at</label><select id="s-hour" class="input">' +
        [19, 20, 21, 22].map((n) => '<option value="' + n + '"' + (s.hour === n ? ' selected' : '') + '>' + fmtStr(new Date(2000, 0, 1, n, 0)) + '</option>').join('') + '</select></div>';
    }
    const panel = openSheet(Sched.SMART_LABELS[key],
      '<div class="card list"><div class="row"><div class="grow"><span class="title">Alarm on</span></div>' +
      '<label class="switch"><input type="checkbox" id="s-on"' + (s.on ? ' checked' : '') + ' aria-label="Alarm on"><span></span></label></div></div>' +
      extra +
      '<div class="field"><span class="lbl">Wake mission</span>' + missionSeg(s.mission, false) + '</div>' +
      '<button class="btn primary block" id="s-save">Save</button>');
    bindSeg(panel, 'mission', (v) => (s.mission = v));
    $('#s-save').onclick = () => {
      s.on = $('#s-on').checked;
      if ($('#s-before')) s.before = +$('#s-before').value;
      if ($('#s-hour')) s.hour = +$('#s-hour').value;
      state.smart[key] = s;
      if (s.on && !state.location) { closeSheet(); persist(); showView('panchang'); return toast('Set your location first'); }
      closeSheet();
      persist();
    };
  }

  // ---------- Global click / change handling ----------
  Object.assign(actions, {
    add: () => openAlarmSheet(null),
    edit: (el) => openAlarmSheet(el.dataset.id),
    smart: (el) => openSmartSheet(el.dataset.key),
    'go-settings': () => showView('settings'),
    go: (el) => showView(el.dataset.view),
    locate: () => locate(),
    'manual-loc': () => manualLocation(),
    fix: (el) => fixSetup(el.dataset.which),
    test: () => testAlarm(),
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (fn) fn(el, e);
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.change && changes[t.dataset.change]) return changes[t.dataset.change](t);
    if (t.dataset.toggle) {
      const [kind, id] = t.dataset.toggle.split(':');
      if (kind === 'alarm') {
        const a = state.alarms.find((x) => x.id === id);
        if (a) a.on = t.checked;
      } else if (kind === 'smart') {
        if (t.checked && !state.location) {
          t.checked = false;
          showView('panchang');
          return toast('Set your location first');
        }
        state.smart[id].on = t.checked;
      }
      persist();
    } else if (t.dataset.setting) {
      const v = t.value;
      state[t.dataset.setting] = /^\d+$/.test(v) ? +v : v;
      persist();
    }
  });

  async function fixSetup(which) {
    if (which === 'notifications') {
      const r = await Native.requestNotifications().catch(() => ({}));
      if (!r.granted) await Native.openSettings({ which: 'notifications' }).catch(() => {});
    } else {
      await Native.openSettings({ which }).catch(() => {});
    }
    setTimeout(refreshSetup, 800);
  }

  function testAlarm() {
    state.snooze = { at: Date.now() + 60000, label: 'Test alarm', mission: 'none', ref: 'test', kind: 'custom', count: 0 };
    persist();
    toast('Test alarm will ring in 1 minute');
    if (!Sched.isNative) setTimeout(() => Native._fakeRing({ id: 1, at: Date.now(), label: 'Test alarm', mission: 'none', ref: 'test', kind: 'snooze', count: 0 }), 3000);
  }

  // ---------- Ringing screen ----------
  const ringCleanup = [];
  function cleanupRing() {
    ringCleanup.forEach((fn) => { try { fn(); } catch (e) {} });
    ringCleanup.length = 0; // keep the same array: ringApi.cleanup points to it
  }

  function ringShell(alarm, kicker, sub) {
    const el = $('#ring');
    const f = fmt(new Date());
    el.innerHTML = '<div><div class="kicker">' + esc(kicker) + '</div>' +
      '<div class="big" style="text-align:center">' + f.hm + '</div><div class="when">' + esc(f.ap + (sub ? ' · ' + sub : '')) + '</div></div>' +
      '<div id="ring-body" class="ring-body"></div>' +
      '<div class="actions" id="ring-actions"></div>';
    el.hidden = false;
    el.scrollTop = 0;
    return { body: $('#ring-body'), actions: $('#ring-actions') };
  }

  async function showRing(alarm) {
    if (!alarm || !alarm.ref) return;
    if (ringingNow && ringingNow.id === alarm.id && ringingNow.at === alarm.at) return;
    cleanupRing();
    ringingNow = alarm;
    closeSheet();

    const handler = ringHandlers[alarm.kind];
    if (handler) return handler(alarm, ringApi);
    genericRing(alarm);
  }

  function genericRing(alarm) {
    const custom = state.alarms.find((x) => x.id === alarm.ref);
    let mission = alarm.mission || 'none';
    const phrase = custom && custom.phrase ? custom.phrase : '';
    if (mission === 'voice' && !phrase) mission = 'none';
    const snoozesLeft = Math.max(0, state.snoozeMax - (alarm.count || 0));

    const now = new Date();
    const loc = state.location;
    let when = now.toLocaleDateString('en-IN', { weekday: 'long' });
    if (loc && (alarm.ref === 'smart:brahma' || alarm.ref === 'smart:sehri')) {
      const sr = Astro.dayTimes(now, loc.lat, loc.lng).sunrise;
      if (sr && sr > now) when += ' · ' + untilText(sr - now) + ' before sunrise';
    }
    const { body, actions: actionsEl } = ringShell(alarm, alarm.label || 'Alarm', when);

    function renderActions(showLightSwitch) {
      actionsEl.innerHTML =
        (showLightSwitch ? '<button class="btn secondary" id="r-light">' + ICON.bulb + ' Use light instead</button>' : '') +
        (snoozesLeft > 0 ? '<button class="btn secondary muted" id="r-snooze">Snooze ' + state.snoozeMinutes + ' min (' + snoozesLeft + ' left)</button>' : '');
      const sn = $('#r-snooze');
      if (sn) sn.onclick = () => snoozeRing(alarm, state.snoozeMinutes);
      const lt = $('#r-light');
      if (lt) lt.onclick = () => lightMission();
    }

    function noMission() {
      body.innerHTML = '<div class="center"><button class="btn primary slide-stop" id="r-stop">Stop alarm</button></div>';
      $('#r-stop').onclick = () => finishRing(alarm);
      renderActions(false);
    }

    function lightMission() {
      cleanupRing();
      body.innerHTML = '<div class="card mission"><div class="eyebrow" style="margin:0">Light mission</div>' +
        '<div class="phrase" style="font-family:Manrope">Point the camera at daylight or a switched-on bulb</div></div>' +
        '<video class="cam" id="r-cam" muted playsinline></video><div class="meter" aria-hidden="true"><div id="r-meter"></div></div>' +
        '<div class="hint" id="r-hint">Hold steady for 2 seconds</div>';
      renderActions(false);
      M.startLight($('#r-cam'), (level, progress) => {
        const m = $('#r-meter');
        if (m) m.style.width = Math.round(Math.max(level * 60, progress * 100)) + '%';
      }, () => finishRing(alarm)).then((stop) => ringCleanup.push(stop)).catch(() => {
        const h = $('#r-hint');
        if (h) { h.textContent = 'Camera permission is needed for the light mission'; h.classList.add('err'); }
        setTimeout(noMission, 2500); // the user must always be able to stop the alarm
      });
    }

    function voiceMission() {
      let tries = 3;
      body.innerHTML = '<div class="card mission">' +
        '<div class="voice-row"><button class="icon-btn" id="r-replay" aria-label="Play your voice note">' + ICON.play + '</button>' +
        '<span class="meta">Your voice · from last night</span></div>' +
        '<div class="eyebrow" style="margin:0">Say this to stop the alarm</div>' +
        '<div class="phrase">"' + esc(phrase) + '"</div></div>' +
        '<div class="center"><div class="mic-ring"><button class="mic" id="r-mic" aria-label="Tap and speak">' + ICON.mic + '</button></div>' +
        '<div class="hint" id="r-hint">Tap the mic and speak · 3 tries</div></div>';
      renderActions(true);

      async function playVoice() {
        const blob = await Store.getVoice(alarm.ref).catch(() => null);
        if (!blob) return;
        await Native.pauseSound().catch(() => {});
        await M.playBlob(blob);
        if (ringingNow === alarm) await Native.resumeSound().catch(() => {});
      }
      $('#r-replay').onclick = playVoice;
      setTimeout(playVoice, 600);

      $('#r-mic').onclick = async () => {
        const mic = $('#r-mic');
        const hint = $('#r-hint');
        if (mic.classList.contains('listening')) return;
        mic.classList.add('listening');
        hint.classList.remove('err');
        hint.textContent = 'Listening…';
        await Native.pauseSound().catch(() => {});
        let guesses = [];
        try {
          guesses = await M.listen(custom.lang || 'hi-IN');
        } catch (e) {
          hint.textContent = e.message || 'Could not listen';
          hint.classList.add('err');
        }
        mic.classList.remove('listening');
        if (M.matchScore(phrase, guesses) >= M.PASS_SCORE) return finishRing(alarm);
        if (ringingNow === alarm) await Native.resumeSound().catch(() => {});
        tries--;
        if (tries <= 0) {
          hint.textContent = 'Out of tries — use the light mission to stop the alarm';
          hint.classList.add('err');
          mic.disabled = true;
          setTimeout(() => ringingNow === alarm && lightMission(), 1500);
          return;
        }
        hint.textContent = (guesses.length ? 'Heard "' + guesses[0] + '". ' : 'Did not catch that. ') + tries + (tries === 1 ? ' try' : ' tries') + ' left';
        hint.classList.add('err');
      };
    }

    if (mission === 'voice') voiceMission();
    else if (mission === 'light') lightMission();
    else noMission();
  }

  function hideRing() {
    cleanupRing();
    ringingNow = null;
    const el = $('#ring');
    el.hidden = true;
    el.innerHTML = '';
  }

  /** Stop the sound, close the ringing screen and tidy up one-time alarms. */
  async function finishRing(alarm, message) {
    await Native.stopRinging().catch(() => {});
    const a = state.alarms.find((x) => x.id === alarm.ref);
    if (a && (!a.days || !a.days.length)) a.on = false; // a one-time alarm is done
    if (state.snooze && state.snooze.ref === alarm.ref) state.snooze = null;
    hideRing();
    persist();
    toast(message || (new Date().getHours() < 12 ? 'Suprabhat! Have a good day.' : 'Alarm stopped'));
  }

  async function snoozeRing(alarm, minutes) {
    await Native.stopRinging().catch(() => {});
    const copy = Object.assign({}, alarm);
    delete copy.id;
    state.snooze = Object.assign(copy, { at: Date.now() + minutes * 60000, count: (alarm.count || 0) + 1 });
    hideRing();
    persist();
    toast('Snoozed for ' + minutes + ' minutes');
  }

  const ringApi = { shell: ringShell, finish: finishRing, snooze: snoozeRing, cleanup: ringCleanup, isCurrent: (a) => ringingNow === a };

  async function checkRinging() {
    try {
      const r = await Native.getRinging();
      if (r && r.alarm && r.alarm.ref) showRing(r.alarm);
      else if (ringingNow && Sched.isNative) hideRing(); // stopped elsewhere (10-minute timeout)
    } catch (e) {}
  }

  // ---------- Public API for health.js / journey.js ----------
  window.JaagoApp = {
    get state() { return state; },
    persist, save: () => Store.save(state), renderAll, toast, openSheet, closeSheet,
    setSheetCleanup: (fn) => (sheetCleanup = fn),
    segHtml, bindSeg, switchHtml, hydratePhotos, forgetPhoto, getPosition, showView,
    get currentView() { return currentView; },
    fmt, fmtStr, fmtHM, fmtTimeStr, fmtDate, pad, esc, untilText, daysText, DAY_SHORT, DAY_NAME, ICON,
    registerView: (name, fn) => (views[name] = fn),
    onEnterView: (name, fn) => (viewEnter[name] = fn),
    registerAction: (name, fn) => (actions[name] = fn),
    registerChange: (name, fn) => (changes[name] = fn),
    registerRing: (kind, fn) => (ringHandlers[kind] = fn),
    genericRing,
    Native,
  };

  // ---------- Start ----------
  async function start() {
    renderAll();
    Native.addListener('alarmRinging', (data) => data && data.alarm && showRing(data.alarm));
    await checkRinging();
    if (!state.setupDone && Sched.isNative) {
      state.setupDone = true;
      Store.save(state);
      await Native.requestNotifications().catch(() => {});
    }
    if (state.snooze && state.snooze.at < Date.now() - 15 * 60000) state.snooze = null;
    Store.save(state);
    await Sched.sync(state);
    refreshSetup();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      checkRinging();
      Sched.sync(state);
      refreshSetup();
      if (viewEnter[currentView]) viewEnter[currentView]();
    });
    setInterval(() => {
      if (!document.hidden && !ringingNow) renderAll();
    }, 60000);
  }

  document.addEventListener('DOMContentLoaded', start);
})();
