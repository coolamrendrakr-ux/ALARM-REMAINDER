/* Jaago — app state (localStorage), voice notes and medicine photos (IndexedDB). */
(function () {
  const KEY = 'jaago.state.v1';

  const DEFAULT_STATE = {
    alarms: [], // custom alarms
    smart: {
      brahma: { on: false, mission: 'none' },
      suryoday: { on: false, mission: 'none' },
      sandhya: { on: false, mission: 'none' },
      sehri: { on: false, mission: 'none', before: 45 },
      iftar: { on: false, mission: 'none' },
      ekadashi: { on: false, mission: 'none', hour: 21 },
    },
    meds: [], // medicines
    doseLog: {}, // "medId@timestamp" -> { s: 'taken' | 'skipped', t }
    appts: [], // doctor appointments
    journey: null, // active bus/train journey
    places: [], // places the user saved for journeys
    voice: 'hi', // spoken reminders: 'hi' | 'en' | 'off'
    location: null, // { lat, lng, name }
    snoozeMinutes: 5,
    snoozeMax: 2,
    snooze: null, // full alarm payload + { at, count }
    setupDone: false,
  };

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return clone(DEFAULT_STATE);
      const s = JSON.parse(raw);
      const base = clone(DEFAULT_STATE);
      return Object.assign(base, s, { smart: Object.assign(base.smart, s.smart || {}) });
    } catch (e) {
      return clone(DEFAULT_STATE);
    }
  }

  /** Drop dose history older than 60 days so storage stays small. */
  function prune(state) {
    const cutoff = Date.now() - 60 * 86400000;
    for (const k of Object.keys(state.doseLog)) {
      const at = +k.split('@')[1];
      if (at < cutoff) delete state.doseLog[k];
    }
  }

  function save(state) {
    try {
      prune(state);
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Could not save state', e);
    }
  }

  function newId(prefix) {
    return (prefix || 'a') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ---- Blobs in IndexedDB: 'voice' (voice notes) and 'photos' (medicine strips) ----
  let dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('jaago', 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('voice')) d.createObjectStore('voice');
        if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function put(store, id, blob) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function get(store, id) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = d.transaction(store).objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function del(store, id) {
    const d = await db();
    return new Promise((resolve) => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  window.JaagoStore = {
    load,
    save,
    newId,
    putVoice: (id, b) => put('voice', id, b),
    getVoice: (id) => get('voice', id),
    deleteVoice: (id) => del('voice', id),
    putPhoto: (id, b) => put('photos', id, b),
    getPhoto: (id) => get('photos', id),
    deletePhoto: (id) => del('photos', id),
  };
})();
