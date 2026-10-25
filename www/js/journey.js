/* Jaago — Journey tab: GPS station alarm for bus and train trips. */
(function () {
  const App = window.JaagoApp;
  const Sched = window.JaagoScheduler;
  const Store = window.JaagoStore;
  const Native = App.Native;
  const { esc, ICON, fmtStr, toast } = App;
  const $ = (sel, root) => (root || document).querySelector(sel);

  const RADIUS_OPTS = [[10, '10 km'], [20, '20 km'], [30, '30 km'], [50, '50 km']];
  const S = () => App.state;

  const plan = { place: null, radius: 20, arrival: '' };
  let query = '';
  let status = null; // last status from the GPS service
  let pollTimer = null;

  function allPlaces() {
    const saved = (S().places || []).map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, area: 'Saved', saved: true }));
    const builtIn = (window.JaagoPlaces || []).map((p) => ({ id: 'b:' + p[0], name: p[0], lat: p[1], lng: p[2], area: p[3] }));
    return saved.concat(builtIn);
  }

  function search(q) {
    const s = q.trim().toLowerCase();
    const list = allPlaces();
    if (!s) return list.filter((p) => p.saved).slice(0, 6);
    return list.filter((p) => p.name.toLowerCase().includes(s) || (p.area || '').toLowerCase().startsWith(s)).slice(0, 8);
  }

  function speech(name) {
    const v = S().voice;
    if (v === 'off') return null;
    return v === 'en' ? name + ' is coming soon. Get your luggage ready.' : name + ' आने वाला है। उठ जाइए, सामान तैयार कर लीजिए।';
  }

  // ---------- Render ----------
  function renderJourney() {
    const root = $('#view-journey');
    const j = S().journey;
    let html = '<div class="header"><div><h1>Journey <span class="hi">यात्रा</span></h1>' +
      '<p class="sub">Station alarm for bus and train</p></div></div>';

    if (j) {
      html += activeHtml(j);
      root.innerHTML = html;
      return;
    }

    html += '<div class="card pad"><div class="field"><label for="j-q">Kahan jaa rahe hain? · Where to?</label>' +
      '<input id="j-q" class="input" autocomplete="off" placeholder="Search a town, e.g. Patna" value="' + esc(query) + '"></div>' +
      '<div id="j-results" class="results"></div>' +
      '<button class="btn ghost-btn small" data-action="j-save-here">' + ICON.pin + ' Save my current location as a place</button></div>';

    if (plan.place) {
      html += '<div class="card selected">' + ICON.pin + '<span class="grow"><span class="title">' + esc(plan.place.name) + '</span>' +
        '<span class="meta">' + esc(plan.place.area || '') + '</span></span>' +
        '<button class="close" data-action="j-clear" aria-label="Clear destination">' + ICON.close + '</button></div>';
    }

    html += '<div class="field"><span class="lbl">Ring when this close</span>' + App.segHtml('radius', plan.radius, RADIUS_OPTS, 'Alarm distance') +
      '<p class="note">At train speed, 20 km gives you about 15–20 minutes to get ready.</p></div>' +
      '<div class="field"><label for="j-arr">Arrival time (optional backup)</label>' +
      '<input id="j-arr" class="input" type="time" value="' + esc(plan.arrival) + '">' +
      '<p class="note">If GPS fails, an alarm still rings 30 minutes before this time.</p></div>' +
      '<button class="btn primary block" data-action="j-start"' + (plan.place ? '' : ' disabled') + '>' + ICON.train + ' Start journey alarm</button>' +
      '<p class="note">Uses GPS during the trip only. Keep Location on and the phone charged; Jaago stops tracking as soon as the alarm rings.</p>';
    root.innerHTML = html;

    renderResults();
    $('#j-q').oninput = (e) => { query = e.target.value; renderResults(); };
    App.bindSeg(root, 'radius', (v) => (plan.radius = +v));
    $('#j-arr').onchange = (e) => (plan.arrival = e.target.value);
  }

  function renderResults() {
    const box = $('#j-results');
    if (!box) return;
    const list = search(query);
    if (!list.length) {
      box.innerHTML = query ? '<p class="note">Not in the list. Save the place when you are there, or pick the nearest town.</p>' : '';
      return;
    }
    box.innerHTML = list.map((p) => '<div class="result"><button class="grow plain" data-action="j-pick" data-id="' + esc(p.id) + '">' +
      '<span class="title">' + esc(p.name) + '</span><span class="meta">' + esc(p.area || '') + '</span></button>' +
      (p.saved ? '<button class="close" data-action="j-del-place" data-id="' + esc(p.id) + '" aria-label="Delete ' + esc(p.name) + '">' + ICON.trash + '</button>' : '') + '</div>').join('');
  }

  function activeHtml(j) {
    const st = status;
    let distLine = 'Waiting for GPS…';
    let updated = '';
    if (st && st.active && st.distanceKm != null) {
      distLine = (st.distanceKm < 10 ? st.distanceKm.toFixed(1) : Math.round(st.distanceKm)) + ' km';
      if (st.updatedAt) updated = 'Updated ' + App.untilText(Date.now() - st.updatedAt) + ' ago';
    }
    const stopped = st && !st.active;
    return '<div class="hero"><div class="tag">Going to</div><div class="label big-label">' + esc(j.name) + '</div>' +
      '<div class="time" id="j-dist">' + esc(stopped ? '—' : distLine) + '</div>' +
      '<div class="meta">' + (stopped ? 'GPS tracking has stopped' : 'Alarm rings at ' + j.radiusKm + ' km' + (updated ? ' · ' + esc(updated) : '')) + '</div></div>' +
      (stopped ? '<div class="banner"><div><div class="title">GPS tracking is off</div><div class="meta">The phone may have stopped it. Restart so the alarm can ring.</div></div>' +
        '<button class="btn primary small" data-action="j-restart">Restart</button></div>' : '') +
      '<div class="card list">' +
      '<div class="row"><div class="grow"><span class="title">Backup alarm</span><span class="meta">' +
      (j.backupAt ? fmtStr(new Date(j.backupAt)) + ' (time based)' : 'Not set') + '</span></div></div>' +
      '<div class="row"><div class="grow"><span class="title">Started</span><span class="meta">' + fmtStr(new Date(j.startedAt)) + '</span></div></div></div>' +
      '<ul class="tips"><li>Keep Location (GPS) on.</li><li>Keep the phone charged — GPS uses battery.</li><li>You can lock the phone and sleep. Jaago will wake you.</li></ul>' +
      '<button class="btn danger block" data-action="j-stop">Stop journey</button>';
  }

  // ---------- Live status ----------
  async function poll() {
    if (!S().journey) return;
    try {
      status = await Native.getJourney();
    } catch (e) {
      status = null;
    }
    if (App.currentView === 'journey') renderJourney();
  }

  function startPolling() {
    clearInterval(pollTimer);
    poll();
    pollTimer = setInterval(() => {
      if (App.currentView !== 'journey' || document.hidden || !S().journey) return clearInterval(pollTimer);
      poll();
    }, 10000);
  }

  // ---------- Actions ----------
  function backupFor(arrival) {
    if (!arrival) return null;
    const [h, m] = Sched.parseTime(arrival);
    const now = Date.now();
    let at = Sched.atTime(new Date(), h, m).getTime();
    if (at < now) at += 86400000; // arrival is tomorrow
    const ring = at - 30 * 60000;
    return ring > now + 60000 ? ring : null;
  }

  async function startTracking(j) {
    const perm = await Native.requestLocation().catch(() => ({ granted: false }));
    if (!perm.granted) {
      toast('Location permission is needed for the station alarm');
      return false;
    }
    try {
      await Native.startJourney({ lat: j.lat, lng: j.lng, radiusKm: j.radiusKm, label: j.name, speak: speech(j.name), lang: S().voice === 'en' ? 'en' : 'hi' });
      return true;
    } catch (e) {
      const msg = String((e && (e.message || e.code)) || '');
      if (msg.includes('LOCATION_OFF')) {
        toast('Turn on Location (GPS) first');
        Native.openSettings({ which: 'location' }).catch(() => {});
      } else {
        toast('Could not start GPS: ' + msg);
      }
      return false;
    }
  }

  async function start() {
    if (!plan.place) return toast('Pick where you are going');
    const j = {
      name: plan.place.name, lat: plan.place.lat, lng: plan.place.lng, radiusKm: plan.radius,
      startedAt: Date.now(), backupAt: backupFor(plan.arrival),
    };
    if (!(await startTracking(j))) return;
    S().journey = j;
    status = null;
    App.persist();
    startPolling();
    toast('Journey alarm on — rings ' + j.radiusKm + ' km before ' + j.name);
  }

  async function stop(message) {
    await Native.stopJourney().catch(() => {});
    S().journey = null;
    status = null;
    plan.place = null;
    plan.arrival = '';
    query = '';
    App.persist();
    if (message) toast(message);
  }

  function saveHere() {
    const panel = App.openSheet('Save this place',
      '<p class="note">Save your home, village or any stop while you are there. Next time, pick it as a destination.</p>' +
      '<div class="field"><label for="p-name">Name</label><input id="p-name" class="input" maxlength="30" placeholder="e.g. Ghar, Nani ka gaon"></div>' +
      '<button class="btn primary block" id="p-save">' + ICON.pin + ' Save current location</button>');
    $('#p-save', panel).onclick = async () => {
      const name = $('#p-name').value.trim();
      if (!name) return toast('Enter a name');
      const btn = $('#p-save');
      btn.disabled = true;
      btn.textContent = 'Finding location…';
      try {
        await Native.requestLocation().catch(() => {});
        const p = await App.getPosition();
        S().places = (S().places || []).concat([{ id: Store.newId('p'), name, lat: p.lat, lng: p.lng }]);
        App.closeSheet();
        App.persist();
        toast(name + ' saved');
      } catch (e) {
        btn.disabled = false;
        btn.innerHTML = ICON.pin + ' Save current location';
        toast('Could not get location. Turn on GPS and try again.');
      }
    };
  }

  App.registerView('journey', renderJourney);
  App.onEnterView('journey', () => { if (S().journey) startPolling(); });
  App.registerAction('j-pick', (el) => {
    plan.place = allPlaces().find((p) => p.id === el.dataset.id) || null;
    query = '';
    renderJourney();
  });
  App.registerAction('j-clear', () => { plan.place = null; renderJourney(); });
  App.registerAction('j-start', () => start());
  App.registerAction('j-stop', () => stop('Journey alarm stopped'));
  App.registerAction('j-restart', async () => {
    if (await startTracking(S().journey)) { status = null; startPolling(); toast('GPS tracking restarted'); }
  });
  App.registerAction('j-save-here', () => saveHere());
  App.registerAction('j-del-place', (el) => {
    S().places = (S().places || []).filter((p) => p.id !== el.dataset.id);
    App.persist();
  });

  // ---------- Ringing: station is near ----------
  App.registerRing('journey', (alarm, ring) => {
    const j = S().journey;
    const name = (j && j.name) || (alarm.label || '').replace(' aane wala hai', '');
    const { body, actions } = ring.shell(alarm, 'स्टेशन आने वाला है', name);
    body.innerHTML = '<div class="center"><div class="arrive">' + ICON.train + '</div>' +
      '<div class="title-xl">' + esc(name) + ' aane wala hai</div>' +
      '<p class="note" style="text-align:center">Uth jaaiye, saamaan tayaar kar lijiye.</p></div>';
    actions.innerHTML = '<div class="stack"><button class="btn primary slide-stop" id="r-awake">' + ICON.check + ' Main jaag gaya — stop</button>' +
      ((alarm.count || 0) < 2 ? '<button class="btn secondary muted" id="r-again">Remind again in 5 min</button>' : '') + '</div>';
    $('#r-awake').onclick = async () => {
      await Native.stopJourney().catch(() => {});
      S().journey = null;
      status = null;
      ring.finish(alarm, 'Shubh yatra! Safe journey.');
    };
    const again = $('#r-again');
    if (again) again.onclick = () => ring.snooze(alarm, 5);
  });
})();
