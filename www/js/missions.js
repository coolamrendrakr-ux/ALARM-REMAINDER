/* Jaago — wake missions: record your reason, speak it back, or show the camera some light. */
(function () {
  const Plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  // ---------- Voice note recording ----------
  async function startRecording(maxMs) {
    maxMs = maxMs || 8000;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
    let finish;
    const done = new Promise((resolve) => (finish = resolve));
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      finish(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
    };
    rec.start();
    const timer = setTimeout(() => rec.state !== 'inactive' && rec.stop(), maxMs);
    return {
      stop() {
        clearTimeout(timer);
        if (rec.state !== 'inactive') rec.stop();
        return done;
      },
      done,
    };
  }

  function playBlob(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.play().catch(() => resolve());
    });
  }

  // ---------- Speech recognition ----------
  async function ensureSpeechPermission() {
    const SR = Plugins.SpeechRecognition;
    if (!isNative || !SR) return true;
    const avail = await SR.available().catch(() => ({ available: false }));
    if (!avail.available) throw new Error('Speech recognition is not available on this phone. Install or update the Google app.');
    let p = await SR.checkPermissions().catch(() => ({}));
    if (p.speechRecognition !== 'granted') p = await SR.requestPermissions();
    if (p.speechRecognition !== 'granted') throw new Error('Microphone permission is needed for the voice mission.');
    return true;
  }

  /** Listen once and return the recognizer's guesses. */
  async function listen(lang) {
    lang = lang || 'hi-IN';
    if (isNative && Plugins.SpeechRecognition) {
      await ensureSpeechPermission();
      const res = await Plugins.SpeechRecognition.start({
        language: lang,
        maxResults: 5,
        partialResults: false,
        popup: false,
      });
      return (res && res.matches) || [];
    }
    // Browser preview (Chrome)
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) throw new Error('Speech recognition is not available in this browser.');
    return new Promise((resolve, reject) => {
      const r = new Ctor();
      r.lang = lang;
      r.maxAlternatives = 5;
      r.onresult = (e) => resolve(Array.from(e.results[0]).map((a) => a.transcript));
      r.onerror = (e) => reject(new Error(e.error || 'Could not hear you'));
      r.onnomatch = () => resolve([]);
      r.start();
    });
  }

  function normalize(s) {
    return (s || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return dp[a.length][b.length];
  }

  /** Share of the expected words that were spoken (0–1), best across all guesses. */
  function matchScore(expected, guesses) {
    const want = normalize(expected).split(' ').filter(Boolean);
    if (!want.length) return 1;
    let best = 0;
    for (const g of guesses) {
      const got = normalize(g).split(' ').filter(Boolean);
      let hit = 0;
      for (const w of want) {
        if (got.some((x) => x === w || (w.length > 3 && editDistance(w, x) <= 1))) hit++;
      }
      best = Math.max(best, hit / want.length);
    }
    return best;
  }

  const PASS_SCORE = 0.6;

  // ---------- Light mission ----------
  async function startLight(videoEl, onLevel, onDone) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 320 }, height: { ideal: 240 } },
      audio: false,
    });
    videoEl.srcObject = stream;
    videoEl.setAttribute('playsinline', '');
    videoEl.muted = true;
    await videoEl.play().catch(() => {});
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let brightTicks = 0;
    let stopped = false;
    const NEED_TICKS = 8; // 8 × 250 ms = 2 seconds of steady light

    const timer = setInterval(() => {
      if (stopped || videoEl.readyState < 2) return;
      ctx.drawImage(videoEl, 0, 0, 64, 48);
      const px = ctx.getImageData(0, 0, 64, 48).data;
      let sum = 0;
      let bright = 0;
      for (let i = 0; i < px.length; i += 4) {
        const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        sum += y;
        if (y > 235) bright++;
      }
      const avg = sum / (px.length / 4);
      const brightShare = bright / (px.length / 4);
      const level = Math.min(1, Math.max(avg / 150, brightShare / 0.12));
      const isBright = avg >= 150 || brightShare >= 0.12;
      brightTicks = isBright ? brightTicks + 1 : 0;
      onLevel(level, brightTicks / NEED_TICKS);
      if (brightTicks >= NEED_TICKS) {
        stop();
        onDone();
      }
    }, 250);

    function stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      videoEl.srcObject = null;
    }
    return stop;
  }

  window.JaagoMissions = { startRecording, playBlob, listen, ensureSpeechPermission, matchScore, PASS_SCORE, startLight, normalize };
})();
