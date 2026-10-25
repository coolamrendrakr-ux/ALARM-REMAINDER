/* Jaago — Health tab: medicine reminders and doctor appointments. */
(function () {
  const App = window.JaagoApp;
  const Sched = window.JaagoScheduler;
  const Store = window.JaagoStore;
  const { esc, ICON, fmtStr, fmtTimeStr, fmtDate, toast } = App;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const DAY = 86400000;

  const FOOD_OPTS = [['before', 'Pehle'], ['after', 'Baad'], ['with', 'Saath'], ['any', 'Kabhi bhi']];
  const COURSE_OPTS = [[0, 'Ongoing'], [5, '5 days'], [7, '7 days'], [10, '10 days'], [15, '15 days'], [30, '30 days']];
  const TRAVEL_OPTS = [[0, 'No travel'], [15, '15 min'], [30, '30 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours']];
  const DEFAULT_CHECKLIST = ['Purani reports', 'Prescription file', 'Aadhaar card', 'Fees', 'Dawai ki list'];

  const S = () => App.state;
  const todayStart = () => Sched.addDays(new Date(), 0).getTime();

  function foodText(f) {
    return (Sched.FOOD[f || 'any'] || Sched.FOOD.any).en;
  }

  function thumb(med, size) {
    size = size || 44;
    return '<span class="thumb" style="width:' + size + 'px;height:' + size + 'px">' + ICON.pill +
      (med.hasPhoto ? '<img data-photo="' + esc(med.id) + '" alt="" hidden>' : '') + '</span>';
  }

  // ---------- Dose logging ----------
  function markDose(key, medId, status) {
    const st = S();
    if (st.doseLog[key]) return;
    st.doseLog[key] = { s: status, t: Date.now() };
    const med = st.meds.find((m) => m.id === medId);
    if (status === 'taken' && med && typeof med.stock === 'number') {
      med.stock = Math.max(0, +(med.stock - (med.perDose || 1)).toFixed(2));
    }
    // A pending medicine snooze is no longer needed once all its doses are marked
    const sn = st.snooze;
    if (sn && sn.kind === 'med' && (sn.doses || []).every((d) => st.doseLog[d.key])) st.snooze = null;
  }

  // ---------- Health tab ----------
  function renderHealth() {
    const st = S();
    const now = Date.now();
    const meds = st.meds || [];
    let html = '<div class="header"><div><h1>Health <span class="hi">स्वास्थ्य</span></h1>' +
      '<p class="sub">Medicines and doctor visits</p></div></div>';

    // Refill warnings
    for (const med of meds) {
      if (!med.on) continue;
      const left = Sched.medDaysLeft(med);
      if (left == null || left > (med.refillDays || 5)) continue;
      const end = Sched.medEndDate(med);
      if (end && end.getTime() <= todayStart() + (left + 1) * DAY) continue;
      html += '<div class="banner"><div><div class="title">' + esc(med.name) + ' khatam hone wali hai</div>' +
        '<div class="meta">' + esc(med.stock) + ' left · about ' + left + (left === 1 ? ' day' : ' days') + '. Buy more soon.</div></div>' +
        '<button class="btn primary small" data-action="med-restock" data-id="' + esc(med.id) + '">Refilled</button></div>';
    }

    // Today's doses
    const ts = todayStart();
    const doses = [];
    for (const med of meds) {
      if (!med.on) continue;
      for (const d of Sched.medDoses(med, ts, ts + DAY - 1)) doses.push(Object.assign({ med }, d));
    }
    doses.sort((a, b) => a.at - b.at || a.med.name.localeCompare(b.med.name));

    html += '<div class="section-head"><div class="eyebrow">Aaj ki dawai · Today</div>' +
      (meds.length ? '<button class="link" data-action="med-history">History</button>' : '') + '</div>';
    if (!doses.length) {
      html += '<div class="card empty-state">' + (meds.length ? 'No medicine due today.' : 'Add a medicine and Jaago will remind you on time — in Hindi.') + '</div>';
    } else {
      html += '<div class="card list">' + doses.map((d) => {
        const status = Sched.doseStatus(st, d, now);
        let right;
        if (status === 'taken') right = '<span class="chip ok">' + ICON.check + 'Taken</span>';
        else if (status === 'skipped') right = '<span class="chip once">Skipped</span>';
        else right = '<button class="btn ' + (status === 'upcoming' ? 'secondary' : 'primary') + ' small" data-action="dose-take" data-key="' + esc(d.key) + '" data-med="' + esc(d.med.id) + '">Le liya</button>';
        return '<div class="row' + (status === 'missed' ? ' missed' : '') + '">' + thumb(d.med) +
          '<div class="grow"><span class="title">' + esc(d.med.name) + (d.med.dose ? ' <span class="meta">· ' + esc(d.med.dose) + '</span>' : '') + '</span>' +
          '<span class="meta">' + fmtStr(new Date(d.at)) + ' · ' + esc(foodText(d.med.food)) + (d.med.forWhom ? ' · ' + esc(d.med.forWhom) : '') +
          (status === 'missed' ? ' · <b class="warn">Missed</b>' : '') + '</span></div>' + right + '</div>';
      }).join('') + '</div>';
    }

    // Medicines
    html += '<div class="section-head"><div class="eyebrow">Medicines</div>' +
      '<button class="icon-btn small" data-action="med-add" aria-label="Add medicine">' + ICON.plus + '</button></div>';
    if (!meds.length) {
      html += '<button class="card add-card" data-action="med-add">' + ICON.pill + '<span>Add your first medicine</span></button>';
    } else {
      html += '<div>' + meds.map((med) => {
        const end = Sched.medEndDate(med);
        const finished = end && end.getTime() <= ts;
        const left = Sched.medDaysLeft(med);
        const week = adherence(med, 7);
        const metaBits = [(med.times || []).map(fmtTimeStr).join(', '), foodText(med.food)];
        const info = [];
        if (finished) info.push('Course complete');
        else if (end) info.push('Till ' + fmtDate(new Date(end.getTime() - DAY)));
        if (left != null) info.push(med.stock + ' left (~' + left + 'd)');
        if (week) info.push('7 days: ' + week.pct + '% taken');
        return '<div class="card alarm' + (med.on && !finished ? '' : ' off') + '">' + thumb(med, 48) +
          '<button class="open" data-action="med-edit" data-id="' + esc(med.id) + '">' +
          '<div class="title-lg">' + esc(med.name) + (med.forWhom ? ' <small>· ' + esc(med.forWhom) + '</small>' : '') + '</div>' +
          '<div class="m">' + esc(metaBits.join(' · ')) + '</div>' +
          (info.length ? '<div class="m">' + esc(info.join(' · ')) + '</div>' : '') +
          '</button>' + App.switchHtml(med.id, med.on, med.name + ' reminders').replace('data-toggle=', 'data-change="med-toggle" data-id=') + '</div>';
      }).join('') + '</div>';
    }

    // Doctor visits
    const appts = (st.appts || []).slice().sort((a, b) => apptTime(a) - apptTime(b));
    const open = appts.filter((a) => a.status !== 'done');
    const done = appts.filter((a) => a.status === 'done').slice(-3).reverse();
    html += '<div class="section-head"><div class="eyebrow">Doctor visits</div>' +
      '<button class="icon-btn small" data-action="appt-add" aria-label="Add doctor appointment">' + ICON.plus + '</button></div>';
    if (!open.length) {
      html += '<button class="card add-card" data-action="appt-add">' + ICON.steth + '<span>Add a doctor appointment</span></button>';
    }
    for (const ap of open) {
      const at = apptTime(ap);
      if (at + 60 * 60000 < now) {
        html += '<div class="card appt past"><div class="grow"><span class="title">Visit ho gayi? · ' + esc(ap.doctor || 'Doctor') + '</span>' +
          '<span class="meta">' + esc(fmtDate(new Date(at))) + ' · Set the next visit</span></div>' +
          '<div class="follow">' + [[7, '1 week'], [15, '15 days'], [30, '1 month'], [0, 'No follow-up']].map((o) =>
            '<button class="btn ' + (o[0] ? 'secondary' : 'ghost-btn') + ' small" data-action="appt-follow" data-id="' + esc(ap.id) + '" data-days="' + o[0] + '">' + o[1] + '</button>').join('') +
          '</div></div>';
        continue;
      }
      const d = new Date(at);
      const ready = (ap.checklist || []).filter((c) => c.done).length;
      const total = (ap.checklist || []).length;
      const leave = ap.travelMins ? new Date(at - (ap.travelMins + 15) * 60000) : null;
      html += '<button class="card appt" data-action="appt-edit" data-id="' + esc(ap.id) + '">' +
        '<span class="date-chip"><b>' + d.getDate() + '</b>' + d.toLocaleDateString('en-IN', { month: 'short' }) + '</span>' +
        '<span class="grow"><span class="title">' + esc(ap.doctor || 'Doctor') + (ap.forWhom ? ' · ' + esc(ap.forWhom) : '') + '</span>' +
        '<span class="meta">' + esc(d.toLocaleDateString('en-IN', { weekday: 'short' })) + ' ' + fmtStr(d) + (ap.place ? ' · ' + esc(ap.place) : '') + '</span>' +
        '<span class="meta">' + (leave ? 'Leave by ' + fmtStr(leave) + ' · ' : '') + (total ? ready + '/' + total + ' things ready' : '') +
        (ap.fasting ? ' · <b class="warn">Khaali pet</b>' : '') + '</span></span></button>';
    }
    if (done.length) {
      html += '<div class="card list">' + done.map((ap) => '<div class="row"><div class="grow"><span class="title muted-t">' + esc(ap.doctor || 'Doctor') +
        '</span><span class="meta">' + esc(fmtDate(new Date(apptTime(ap)))) + ' · done</span></div>' +
        '<button class="icon-btn ghost small" data-action="appt-del" data-id="' + esc(ap.id) + '" aria-label="Remove visit">' + ICON.trash + '</button></div>').join('') + '</div>';
    }
    html += '<p class="note">Reminders only. Always follow your doctor\'s advice on doses.</p>';

    const root = $('#view-health');
    root.innerHTML = html;
    App.hydratePhotos(root);
  }

  function apptTime(ap) {
    const d = Sched.parseDate(ap.date);
    const [h, m] = Sched.parseTime(ap.time);
    return d ? Sched.atTime(d, h, m).getTime() : 0;
  }

  function adherence(med, days) {
    const now = Date.now();
    const doses = Sched.medDoses(med, now - days * DAY, now - 60 * 60000);
    if (!doses.length) return null;
    const taken = doses.filter((d) => (S().doseLog[d.key] || {}).s === 'taken').length;
    return { taken, total: doses.length, pct: Math.round((taken / doses.length) * 100) };
  }

  // ---------- History ----------
  function openHistory() {
    const st = S();
    const now = Date.now();
    let body = '';
    for (let i = 0; i < 7; i++) {
      const dayStart = todayStart() - i * DAY;
      const rows = [];
      for (const med of st.meds) {
        for (const d of Sched.medDoses(med, dayStart, Math.min(dayStart + DAY - 1, now + DAY))) {
          rows.push({ med, d, status: Sched.doseStatus(st, d, now) });
        }
      }
      if (!rows.length) continue;
      rows.sort((a, b) => a.d.at - b.d.at);
      body += '<div class="eyebrow">' + (i === 0 ? 'Today' : i === 1 ? 'Yesterday' : esc(fmtDate(new Date(dayStart)))) + '</div><div class="card list">' +
        rows.map((r) => '<div class="row"><div class="grow"><span class="title">' + esc(r.med.name) + '</span><span class="meta">' + fmtStr(new Date(r.d.at)) +
          (r.med.forWhom ? ' · ' + esc(r.med.forWhom) : '') + '</span></div>' + statusChip(r.status) + '</div>').join('') + '</div>';
    }
    const summary = st.meds.map((m) => adherence(m, 7) ? esc(m.name) + ': ' + adherence(m, 7).taken + '/' + adherence(m, 7).total : '').filter(Boolean).join(' · ');
    App.openSheet('Last 7 days', (summary ? '<p class="note">' + summary + ' doses taken</p>' : '') + (body || '<div class="card empty-state">No doses yet.</div>') +
      '<p class="note">Show this list to your doctor at the next visit.</p>');
  }

  function statusChip(s) {
    if (s === 'taken') return '<span class="chip ok">' + ICON.check + 'Taken</span>';
    if (s === 'skipped') return '<span class="chip once">Skipped</span>';
    if (s === 'missed') return '<span class="chip bad">Missed</span>';
    if (s === 'due') return '<span class="chip auto">Due</span>';
    return '<span class="chip once">Later</span>';
  }

  // ---------- Photo: resize before saving ----------
  function resizeImage(file, max) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('Photo failed'))), 'image/jpeg', 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read photo')); };
      img.src = url;
    });
  }

  // ---------- Add / edit medicine ----------
  function openMedSheet(id) {
    const st = S();
    const existing = st.meds.find((m) => m.id === id);
    const med = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: Store.newId('m'), name: '', forWhom: '', dose: '1 tablet', times: ['08:00', '21:00'], food: 'after', days: [],
      start: Sched.ymd(new Date()), courseDays: 0, stock: null, perDose: 1, refillDays: 5, hasPhoto: false, on: true,
    };
    let photoBlob = null;
    let photoRemoved = false;
    let previewUrl = null;

    const panel = App.openSheet(existing ? 'Edit medicine' : 'Add medicine',
      '<div class="photo-pick">' +
      '<div class="photo-box" id="m-photo-box">' + ICON.camera + (med.hasPhoto ? '<img data-photo="' + esc(med.id) + '" alt="Medicine strip" hidden>' : '') + '</div>' +
      '<div class="grow"><span class="title">Photo of the strip</span><span class="meta">Shown when the alarm rings, so the right medicine is easy to find.</span>' +
      '<div class="row-btns"><label class="btn secondary small file-btn">' + ICON.camera + ' Take photo<input type="file" id="m-photo" accept="image/*" capture="environment"></label>' +
      '<button type="button" class="btn ghost-btn small" id="m-photo-del"' + (med.hasPhoto ? '' : ' hidden') + '>Remove</button></div></div></div>' +
      '<div class="field"><label for="m-name">Medicine name</label><input id="m-name" class="input" maxlength="40" value="' + esc(med.name) + '" placeholder="e.g. Thyronorm 50"></div>' +
      '<div class="two"><div class="field"><label for="m-dose">Dose</label><input id="m-dose" class="input" maxlength="24" value="' + esc(med.dose) + '" placeholder="1 tablet"></div>' +
      '<div class="field"><label for="m-who">For whom</label><input id="m-who" class="input" maxlength="20" value="' + esc(med.forWhom) + '" placeholder="Maa, Papa…"></div></div>' +
      '<div class="field"><span class="lbl">Times a day</span><div class="chips">' +
      [['1×', ['08:00']], ['2×', ['08:00', '21:00']], ['3×', ['08:00', '14:00', '21:00']], ['4×', ['07:00', '12:00', '17:00', '22:00']]].map((p) =>
        '<button type="button" class="chip-btn" data-preset="' + p[1].join(',') + '">' + p[0] + '</button>').join('') + '</div>' +
      '<div id="m-times" class="times"></div>' +
      '<button type="button" class="btn ghost-btn small" id="m-add-time">' + ICON.plus + ' Add time</button></div>' +
      '<div class="field"><span class="lbl">Khaane se</span>' + App.segHtml('food', med.food, FOOD_OPTS, 'Food timing') + '</div>' +
      '<div class="field"><span class="lbl">Repeat</span>' + App.segHtml('rep', med.days.length ? 'some' : 'daily', [['daily', 'Every day'], ['some', 'Some days']], 'Repeat') +
      '<div class="days" id="m-days"' + (med.days.length ? '' : ' hidden') + '>' +
      App.DAY_SHORT.map((d, i) => '<button type="button" class="day" data-day="' + i + '" aria-label="' + App.DAY_NAME[i] + '" aria-pressed="' + med.days.includes(i) + '">' + d + '</button>').join('') + '</div></div>' +
      '<div class="two"><div class="field"><label for="m-course">Course</label><select id="m-course" class="input">' +
      COURSE_OPTS.map((o) => '<option value="' + o[0] + '"' + (+med.courseDays === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
      (COURSE_OPTS.some((o) => o[0] === +med.courseDays) ? '' : '<option value="' + med.courseDays + '" selected>' + med.courseDays + ' days</option>') +
      '</select></div><div class="field"><label for="m-start">Starting</label><input id="m-start" class="input" type="date" value="' + esc(med.start) + '"></div></div>' +
      '<div class="field"><span class="lbl">Stock (optional) — for refill reminder</span><div class="two">' +
      '<input id="m-stock" class="input" type="number" min="0" inputmode="numeric" value="' + (med.stock == null ? '' : esc(med.stock)) + '" placeholder="Tablets left" aria-label="Tablets left">' +
      '<select id="m-per" class="input" aria-label="Tablets per dose">' + [0.5, 1, 2, 3].map((n) => '<option value="' + n + '"' + (+med.perDose === n ? ' selected' : '') + '>' + n + ' per dose</option>').join('') + '</select></div>' +
      '<select id="m-refill" class="input" aria-label="Remind before running out">' + [3, 5, 7, 10].map((n) => '<option value="' + n + '"' + (+med.refillDays === n ? ' selected' : '') + '>Remind me ' + n + ' days before it runs out</option>').join('') + '</select></div>' +
      '<button class="btn primary block" id="m-save">Save medicine</button>' +
      (existing ? '<button class="btn danger block" id="m-del">Delete medicine</button>' : ''));

    App.hydratePhotos(panel);
    App.setSheetCleanup(() => { if (previewUrl) URL.revokeObjectURL(previewUrl); });

    function renderTimes() {
      $('#m-times').innerHTML = med.times.map((t, i) =>
        '<div class="time-row"><input type="time" class="input" data-ti="' + i + '" value="' + esc(t) + '" aria-label="Dose time ' + (i + 1) + '">' +
        (med.times.length > 1 ? '<button type="button" class="close" data-rm="' + i + '" aria-label="Remove time">' + ICON.close + '</button>' : '') + '</div>').join('');
      panel.querySelectorAll('[data-ti]').forEach((inp) => (inp.onchange = () => (med.times[+inp.dataset.ti] = inp.value)));
      panel.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { med.times.splice(+b.dataset.rm, 1); renderTimes(); }));
    }
    renderTimes();
    panel.querySelectorAll('[data-preset]').forEach((b) => (b.onclick = () => { med.times = b.dataset.preset.split(','); renderTimes(); }));
    $('#m-add-time').onclick = () => { if (med.times.length < 6) { med.times.push('12:00'); renderTimes(); } };

    App.bindSeg(panel, 'food', (v) => (med.food = v));
    App.bindSeg(panel, 'rep', (v) => {
      $('#m-days').hidden = v !== 'some';
      if (v === 'daily') {
        med.days = [];
        panel.querySelectorAll('#m-days .day').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      }
    });
    panel.querySelectorAll('#m-days .day').forEach((b) => (b.onclick = () => {
      const d = +b.dataset.day;
      med.days = med.days.includes(d) ? med.days.filter((x) => x !== d) : [...med.days, d];
      b.setAttribute('aria-pressed', med.days.includes(d));
    }));

    $('#m-photo').onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        photoBlob = await resizeImage(file, 720);
        photoRemoved = false;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(photoBlob);
        const box = $('#m-photo-box');
        box.querySelectorAll('img').forEach((x) => x.remove());
        box.insertAdjacentHTML('beforeend', '<img alt="Medicine strip" src="' + previewUrl + '">');
        $('#m-photo-del').hidden = false;
      } catch (err) {
        toast(err.message);
      }
    };
    $('#m-photo-del').onclick = () => {
      photoBlob = null;
      photoRemoved = true;
      $('#m-photo-box').querySelectorAll('img').forEach((x) => x.remove());
      $('#m-photo-del').hidden = true;
    };

    $('#m-save').onclick = async () => {
      med.name = $('#m-name').value.trim();
      med.dose = $('#m-dose').value.trim();
      med.forWhom = $('#m-who').value.trim();
      med.courseDays = +$('#m-course').value;
      med.start = $('#m-start').value || Sched.ymd(new Date());
      const stockVal = $('#m-stock').value.trim();
      med.stock = stockVal === '' ? null : Math.max(0, +stockVal);
      med.perDose = +$('#m-per').value;
      med.refillDays = +$('#m-refill').value;
      med.times = [...new Set(med.times.filter(Boolean))].sort();
      if (!med.name) return toast('Enter the medicine name');
      if (!med.times.length) return toast('Add at least one time');
      if (med.days.length === 0 && panel.querySelector('[data-seg="rep"] [aria-pressed="true"]').dataset.val === 'some') return toast('Pick the days');
      if (photoBlob) {
        await Store.putPhoto(med.id, photoBlob).catch(() => toast('Could not save photo'));
        med.hasPhoto = true;
        App.forgetPhoto(med.id);
      } else if (photoRemoved) {
        await Store.deletePhoto(med.id).catch(() => {});
        med.hasPhoto = false;
        App.forgetPhoto(med.id);
      }
      med.on = true;
      const i = st.meds.findIndex((m) => m.id === med.id);
      if (i >= 0) st.meds[i] = med;
      else st.meds.push(med);
      App.closeSheet();
      App.persist();
      const next = Sched.buildOccurrences(st).find((o) => o.kind === 'med' && o.doses.some((d) => d.medId === med.id));
      toast(next ? 'Next dose ' + fmtStr(new Date(next.at)) + (new Date(next.at).toDateString() === new Date().toDateString() ? '' : ', ' + fmtDate(new Date(next.at))) : 'Medicine saved');
    };

    const del = $('#m-del');
    if (del) del.onclick = async () => {
      st.meds = st.meds.filter((m) => m.id !== med.id);
      for (const k of Object.keys(st.doseLog)) if (k.startsWith(med.id + '@')) delete st.doseLog[k];
      await Store.deletePhoto(med.id).catch(() => {});
      App.forgetPhoto(med.id);
      App.closeSheet();
      App.persist();
      toast('Medicine deleted');
    };
  }

  function restock(id) {
    const st = S();
    const med = st.meds.find((m) => m.id === id);
    if (!med) return;
    const panel = App.openSheet('Refill ' + med.name,
      '<div class="field"><label for="r-count">How many tablets do you have now?</label>' +
      '<input id="r-count" class="input" type="number" min="0" inputmode="numeric" value="' + esc(med.stock || '') + '"></div>' +
      '<div class="chips">' + [10, 15, 30, 60].map((n) => '<button type="button" class="chip-btn" data-add="' + n + '">+' + n + '</button>').join('') + '</div>' +
      '<button class="btn primary block" id="r-save">Save</button>');
    panel.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => {
      const inp = $('#r-count');
      inp.value = (+inp.value || 0) + +b.dataset.add;
    }));
    $('#r-save').onclick = () => {
      med.stock = Math.max(0, +$('#r-count').value || 0);
      App.closeSheet();
      App.persist();
      toast('Stock updated');
    };
  }

  // ---------- Doctor appointments ----------
  function openApptSheet(id, preset) {
    const st = S();
    const existing = st.appts.find((a) => a.id === id);
    const tomorrow = Sched.ymd(Sched.addDays(new Date(), 1));
    const ap = existing ? JSON.parse(JSON.stringify(existing)) : Object.assign({
      id: Store.newId('d'), doctor: '', place: '', forWhom: '', date: tomorrow, time: '10:00', travelMins: 60,
      fasting: false, fastHour: 22, checklist: DEFAULT_CHECKLIST.map((t) => ({ t, done: false })), notes: '', status: 'upcoming',
    }, preset || {});

    const panel = App.openSheet(existing ? 'Doctor appointment' : 'New doctor appointment',
      '<div class="field"><label for="d-doc">Doctor / test</label><input id="d-doc" class="input" maxlength="40" value="' + esc(ap.doctor) + '" placeholder="e.g. Dr. Sharma, Blood test"></div>' +
      '<div class="two"><div class="field"><label for="d-place">Hospital / place</label><input id="d-place" class="input" maxlength="40" value="' + esc(ap.place) + '" placeholder="e.g. Patna"></div>' +
      '<div class="field"><label for="d-who">For whom</label><input id="d-who" class="input" maxlength="20" value="' + esc(ap.forWhom) + '" placeholder="Papa"></div></div>' +
      '<div class="two"><div class="field"><label for="d-date">Date</label><input id="d-date" class="input" type="date" value="' + esc(ap.date) + '"></div>' +
      '<div class="field"><label for="d-time">Time</label><input id="d-time" class="input" type="time" value="' + esc(ap.time) + '"></div></div>' +
      '<div class="field"><label for="d-travel">Travel time to reach</label><select id="d-travel" class="input">' +
      TRAVEL_OPTS.map((o) => '<option value="' + o[0] + '"' + (+ap.travelMins === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>' +
      '<div class="card list"><div class="row"><div class="grow"><span class="title">Khaali pet jaana hai</span><span class="meta">Fasting for a blood test</span></div>' +
      '<label class="switch"><input type="checkbox" id="d-fast"' + (ap.fasting ? ' checked' : '') + ' aria-label="Fasting needed"><span></span></label></div>' +
      '<div class="row" id="d-fast-row"' + (ap.fasting ? '' : ' hidden') + '><div class="grow"><span class="title">Stop eating from</span><span class="meta">The night before</span></div>' +
      '<select id="d-fasthour" class="input select-sm" aria-label="Stop eating from">' + [20, 21, 22, 23].map((h) => '<option value="' + h + '"' + (+ap.fastHour === h ? ' selected' : '') + '>' + fmtStr(new Date(2000, 0, 1, h, 0)) + '</option>').join('') + '</select></div></div>' +
      '<div class="field"><span class="lbl">Saath le jaana hai · Checklist</span><div class="card list" id="d-list"></div>' +
      '<div class="two-auto"><input id="d-item" class="input" maxlength="40" placeholder="Add item, e.g. X-ray" aria-label="New checklist item"><button type="button" class="btn secondary" id="d-add">Add</button></div></div>' +
      '<div class="field"><label for="d-notes">Notes</label><textarea id="d-notes" class="input" maxlength="300" placeholder="Questions to ask the doctor…">' + esc(ap.notes) + '</textarea></div>' +
      '<p class="note" id="d-plan"></p>' +
      '<button class="btn primary block" id="d-save">Save appointment</button>' +
      (existing ? '<button class="btn danger block" id="d-del">Delete appointment</button>' : ''));

    function renderList() {
      $('#d-list').innerHTML = ap.checklist.length ? ap.checklist.map((c, i) =>
        '<div class="row"><label class="check-row"><input type="checkbox" data-ci="' + i + '"' + (c.done ? ' checked' : '') + '><span>' + esc(c.t) + '</span></label>' +
        '<button type="button" class="close" data-cr="' + i + '" aria-label="Remove ' + esc(c.t) + '">' + ICON.close + '</button></div>').join('')
        : '<div class="row"><span class="meta">Nothing to carry.</span></div>';
      panel.querySelectorAll('[data-ci]').forEach((x) => (x.onchange = () => (ap.checklist[+x.dataset.ci].done = x.checked)));
      panel.querySelectorAll('[data-cr]').forEach((x) => (x.onclick = () => { ap.checklist.splice(+x.dataset.cr, 1); renderList(); }));
    }
    renderList();

    function renderPlan() {
      const d = Sched.parseDate($('#d-date').value);
      const [h, m] = Sched.parseTime($('#d-time').value);
      if (!d) return;
      const at = Sched.atTime(d, h, m).getTime();
      const travel = +$('#d-travel').value;
      const leave = new Date(at - (travel ? travel + 15 : 30) * 60000);
      const bits = ['Checklist reminder at 8:00 PM the night before'];
      if ($('#d-fast').checked) bits.push('stop-eating reminder at ' + fmtStr(new Date(2000, 0, 1, +$('#d-fasthour').value, 0)));
      bits.push('alarm at ' + fmtStr(leave) + (travel ? ' to leave' : ''));
      $('#d-plan').textContent = 'You will get: ' + bits.join(', ') + '.';
    }
    ['#d-date', '#d-time', '#d-travel', '#d-fasthour'].forEach((s) => ($(s).onchange = renderPlan));
    $('#d-fast').onchange = () => { $('#d-fast-row').hidden = !$('#d-fast').checked; renderPlan(); };
    renderPlan();

    $('#d-add').onclick = () => {
      const v = $('#d-item').value.trim();
      if (!v) return;
      ap.checklist.push({ t: v, done: false });
      $('#d-item').value = '';
      renderList();
    };

    $('#d-save').onclick = () => {
      ap.doctor = $('#d-doc').value.trim();
      ap.place = $('#d-place').value.trim();
      ap.forWhom = $('#d-who').value.trim();
      ap.date = $('#d-date').value;
      ap.time = $('#d-time').value;
      ap.travelMins = +$('#d-travel').value;
      ap.fasting = $('#d-fast').checked;
      ap.fastHour = +$('#d-fasthour').value;
      ap.notes = $('#d-notes').value.trim();
      if (!ap.doctor) return toast('Enter the doctor or test name');
      if (!ap.date || !ap.time) return toast('Pick the date and time');
      if (apptTime(ap) < Date.now() && !existing) return toast('That time has already passed');
      ap.status = 'upcoming';
      const i = st.appts.findIndex((a) => a.id === ap.id);
      if (i >= 0) st.appts[i] = ap;
      else st.appts.push(ap);
      App.closeSheet();
      App.persist();
      toast('Appointment saved · ' + fmtDate(new Date(apptTime(ap))));
    };
    const del = $('#d-del');
    if (del) del.onclick = () => {
      st.appts = st.appts.filter((a) => a.id !== ap.id);
      App.closeSheet();
      App.persist();
      toast('Appointment deleted');
    };
  }

  function followUp(id, days) {
    const st = S();
    const ap = st.appts.find((a) => a.id === id);
    if (!ap) return;
    ap.status = 'done';
    if (days > 0) {
      const d = Sched.addDays(Sched.parseDate(ap.date), days);
      openApptSheet(null, {
        doctor: ap.doctor, place: ap.place, forWhom: ap.forWhom, date: Sched.ymd(d), time: ap.time,
        travelMins: ap.travelMins, fasting: ap.fasting, fastHour: ap.fastHour,
        checklist: (ap.checklist || []).map((c) => ({ t: c.t, done: false })), notes: '',
      });
      App.save();
      App.renderAll();
      return;
    }
    App.persist();
  }

  // ---------- Ringing: medicine ----------
  App.registerRing('med', (alarm, ring) => {
    const st = S();
    const items = (alarm.doses || []).map((d) => ({ d, med: st.meds.find((m) => m.id === d.medId) })).filter((x) => x.med);
    const pending = () => items.filter((x) => !st.doseLog[x.d.key]);
    if (!pending().length) return ring.finish(alarm, 'Dawai pehle hi li ja chuki hai'); // already marked

    const who = [...new Set(items.map((x) => x.med.forWhom).filter(Boolean))].join(', ');
    const { body, actions } = ring.shell(alarm, 'दवाई का समय · Medicine time', who || new Date().toLocaleDateString('en-IN', { weekday: 'long' }));
    const single = items.length === 1;

    function render() {
      body.innerHTML = items.map((x) => {
        const done = !!st.doseLog[x.d.key];
        return '<div class="card med-ring' + (done ? ' done' : '') + (single ? ' single' : '') + '">' +
          (x.med.hasPhoto ? '<img class="strip" data-photo="' + esc(x.med.id) + '" alt="Photo of ' + esc(x.med.name) + '" hidden>' : '') +
          '<div class="med-info"><div class="title-lg">' + esc(x.med.name) + '</div>' +
          '<div class="meta">' + esc([x.med.dose, foodText(x.med.food), x.med.forWhom].filter(Boolean).join(' · ')) + '</div></div>' +
          (single ? '' : done ? '<span class="chip ok">' + ICON.check + 'Taken</span>' :
            '<button class="btn secondary small" data-take="' + esc(x.d.key) + '">Le liya</button>') + '</div>';
      }).join('');
      App.hydratePhotos(body);
      body.querySelectorAll('[data-take]').forEach((b) => (b.onclick = () => {
        const x = items.find((i) => i.d.key === b.dataset.take);
        markDose(x.d.key, x.med.id, 'taken');
        App.save();
        if (!pending().length) return ring.finish(alarm, 'Shabaash! Sab dawai le li.');
        render();
      }));
      const snoozes = alarm.count || 0;
      actions.innerHTML = '<div class="stack">' +
        '<button class="btn primary slide-stop" id="r-taken">' + ICON.check + (single ? ' Le liya' : ' Sab le liya') + '</button>' +
        '<div class="actions">' +
        (snoozes < 3 ? '<button class="btn secondary" id="r-later">10 min baad</button>' : '') +
        '<button class="btn secondary muted" id="r-skip">Skip</button></div></div>';
      $('#r-taken').onclick = () => {
        pending().forEach((x) => markDose(x.d.key, x.med.id, 'taken'));
        ring.finish(alarm, 'Shabaash! Dawai le li.');
      };
      const later = $('#r-later');
      if (later) later.onclick = () => ring.snooze(alarm, 10);
      $('#r-skip').onclick = () => {
        pending().forEach((x) => markDose(x.d.key, x.med.id, 'skipped'));
        ring.finish(alarm, 'Dose skipped');
      };
    }
    render();
  });

  // ---------- Ringing: doctor ----------
  App.registerRing('doctor', (alarm, ring) => {
    const st = S();
    const id = (alarm.ref || '').split(':')[1];
    const ap = st.appts.find((a) => a.id === id);
    if (!ap) return App.genericRing(alarm);
    const at = new Date(apptTime(ap));
    const { body, actions } = ring.shell(alarm, alarm.label, 'Appointment ' + fmtStr(at));
    body.innerHTML = '<div class="card mission"><div class="title-lg">' + esc(ap.doctor) + (ap.forWhom ? ' · ' + esc(ap.forWhom) : '') + '</div>' +
      '<div class="meta">' + fmtStr(at) + (ap.place ? ' · ' + esc(ap.place) : '') + '</div>' +
      (ap.fasting ? '<div class="banner slim"><b>Khaali pet jaana hai</b> — kuch na khaayein.</div>' : '') + '</div>' +
      (ap.checklist && ap.checklist.length ? '<div class="eyebrow" style="align-self:flex-start">Saath le jaayein</div><div class="card list" style="width:100%">' +
        ap.checklist.map((c, i) => '<div class="row"><label class="check-row"><input type="checkbox" data-ci="' + i + '"' + (c.done ? ' checked' : '') + '><span>' + esc(c.t) + '</span></label></div>').join('') + '</div>' : '') +
      (ap.notes ? '<p class="note" style="align-self:flex-start">Notes: ' + esc(ap.notes) + '</p>' : '');
    body.querySelectorAll('[data-ci]').forEach((x) => (x.onchange = () => { ap.checklist[+x.dataset.ci].done = x.checked; App.save(); }));
    actions.innerHTML = '<div class="stack"><button class="btn primary slide-stop" id="r-stop">Stop alarm</button>' +
      ((alarm.count || 0) < 2 ? '<button class="btn secondary muted" id="r-snooze">Remind in 10 min</button>' : '') + '</div>';
    $('#r-stop').onclick = () => ring.finish(alarm, 'All the best! Jaldi theek ho jaayein.');
    const sn = $('#r-snooze');
    if (sn) sn.onclick = () => ring.snooze(alarm, 10);
  });

  // ---------- Wiring ----------
  App.registerView('health', renderHealth);
  App.registerAction('med-add', () => openMedSheet(null));
  App.registerAction('med-edit', (el) => openMedSheet(el.dataset.id));
  App.registerAction('med-history', () => openHistory());
  App.registerAction('med-restock', (el) => restock(el.dataset.id));
  App.registerAction('dose-take', (el) => {
    markDose(el.dataset.key, el.dataset.med, 'taken');
    App.persist();
    toast('Marked as taken');
  });
  App.registerChange('med-toggle', (el) => {
    const med = S().meds.find((m) => m.id === el.dataset.id);
    if (med) med.on = el.checked;
    App.persist();
  });
  App.registerAction('appt-add', () => openApptSheet(null));
  App.registerAction('appt-edit', (el) => openApptSheet(el.dataset.id));
  App.registerAction('appt-follow', (el) => followUp(el.dataset.id, +el.dataset.days));
  App.registerAction('appt-del', (el) => {
    S().appts = S().appts.filter((a) => a.id !== el.dataset.id);
    App.persist();
  });

  window.JaagoHealth = { markDose, apptTime };
})();
