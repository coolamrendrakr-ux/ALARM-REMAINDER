/* Jaago — sun, moon and panchang calculations (no internet needed).
 * Sunrise/sunset: standard Almanac algorithm, accurate to about 1–2 minutes.
 * Tithi: low-precision Sun and Moon longitudes, accurate to roughly 15–30 minutes
 * near a tithi boundary — good enough for reminders, not for muhurat-grade work.
 */
(function () {
  const RAD = Math.PI / 180;
  const sin = (d) => Math.sin(d * RAD);
  const cos = (d) => Math.cos(d * RAD);
  const tan = (d) => Math.tan(d * RAD);
  const asin = (x) => Math.asin(x) / RAD;
  const acos = (x) => Math.acos(x) / RAD;
  const atan = (x) => Math.atan(x) / RAD;
  const norm = (d) => ((d % 360) + 360) % 360;

  function dayOfYear(date) {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = new Date(date.getFullYear(), date.getMonth(), date.getDate()) - start;
    return Math.round(diff / 86400000);
  }

  /**
   * Time the Sun crosses `zenith` degrees on the given local calendar day.
   * zenith 90.833 = sunrise/sunset, 108 = astronomical dawn/dusk (Fajr uses 18°).
   * Returns a Date, or null when the event does not happen that day.
   */
  function sunEvent(date, lat, lng, rising, zenith) {
    zenith = zenith || 90.833;
    const N = dayOfYear(date);
    const lngHour = lng / 15;
    const t = N + ((rising ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    const L = norm(M + 1.916 * sin(M) + 0.02 * sin(2 * M) + 282.634);
    let RA = norm(atan(0.91764 * tan(L)));
    RA = RA + (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90);
    RA = RA / 15;
    const sinDec = 0.39782 * sin(L);
    const cosDec = cos(asin(sinDec));
    const cosH = (cos(zenith) - sinDec * sin(lat)) / (cosDec * cos(lat));
    if (cosH > 1 || cosH < -1) return null;
    const H = (rising ? 360 - acos(cosH) : acos(cosH)) / 15;
    const T = H + RA - 0.06571 * t - 6.622;
    const UT = ((T - lngHour) % 24 + 24) % 24;

    // Place UT on the correct day so the result falls on the requested local date.
    let ms = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) + UT * 3600000;
    let out = new Date(ms);
    for (let i = 0; i < 2; i++) {
      const dl = new Date(out.getFullYear(), out.getMonth(), out.getDate());
      const want = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      if (dl < want) out = new Date(out.getTime() + 86400000);
      else if (dl > want) out = new Date(out.getTime() - 86400000);
    }
    return out;
  }

  function dayTimes(date, lat, lng) {
    const sunrise = sunEvent(date, lat, lng, true, 90.833);
    const sunset = sunEvent(date, lat, lng, false, 90.833);
    const fajr = sunEvent(date, lat, lng, true, 108);
    return {
      sunrise,
      sunset,
      fajr,
      brahmaStart: sunrise ? new Date(sunrise.getTime() - 96 * 60000) : null,
      brahmaEnd: sunrise ? new Date(sunrise.getTime() - 48 * 60000) : null,
    };
  }

  function julianDay(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  function sunLongitude(jd) {
    const n = jd - 2451545.0;
    const L = norm(280.46 + 0.9856474 * n);
    const g = norm(357.528 + 0.9856003 * n);
    return norm(L + 1.915 * sin(g) + 0.02 * sin(2 * g));
  }

  function moonLongitude(jd) {
    const d = jd - 2451545.0;
    const L0 = norm(218.316 + 13.176396 * d);
    const Mm = norm(134.963 + 13.064993 * d);
    const Ms = norm(357.529 + 0.98560028 * d);
    const D = norm(297.85 + 12.190749 * d);
    const F = norm(93.272 + 13.22935 * d);
    return norm(
      L0 +
        6.289 * sin(Mm) -
        1.274 * sin(Mm - 2 * D) +
        0.658 * sin(2 * D) -
        0.186 * sin(Ms) -
        0.059 * sin(2 * Mm - 2 * D) -
        0.057 * sin(Mm - 2 * D + Ms) +
        0.053 * sin(Mm + 2 * D) +
        0.046 * sin(2 * D - Ms) +
        0.041 * sin(Mm - Ms) -
        0.035 * sin(D) -
        0.031 * sin(Mm + Ms) -
        0.015 * sin(2 * F - 2 * D) +
        0.011 * sin(Mm - 4 * D)
    );
  }

  const TITHI_NAMES = [
    'Pratipada', 'Dwitiya', 'Tritiya', 'Chaturthi', 'Panchami',
    'Shashthi', 'Saptami', 'Ashtami', 'Navami', 'Dashami',
    'Ekadashi', 'Dwadashi', 'Trayodashi', 'Chaturdashi',
  ];

  /** Tithi number 1–30 at a moment (1–15 Shukla, 16–30 Krishna). */
  function tithiAt(date) {
    const jd = julianDay(date);
    const elong = norm(moonLongitude(jd) - sunLongitude(jd));
    return Math.floor(elong / 12) + 1;
  }

  function tithiName(n) {
    if (n === 15) return 'Purnima';
    if (n === 30) return 'Amavasya';
    const paksha = n <= 15 ? 'Shukla' : 'Krishna';
    return paksha + ' ' + TITHI_NAMES[(n - 1) % 15];
  }

  /** True when the given date falls in Ramadan (Umm al-Qura calendar). */
  function isRamadan(date) {
    try {
      const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { month: 'numeric' }).formatToParts(date);
      const m = parts.find((p) => p.type === 'month');
      return m ? parseInt(m.value, 10) === 9 : false;
    } catch (e) {
      return false;
    }
  }

  window.JaagoAstro = { sunEvent, dayTimes, tithiAt, tithiName, isRamadan, sunLongitude, moonLongitude, julianDay };
})();
