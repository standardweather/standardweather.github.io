/* Standard Weather — work windows from the NWS forecast grid (shared by FutureWeather and FarmWeather).
 *
 *   gridSeries     hourly series from an NWS forecast grid property (api.weather.gov …/gridpoints/…)
 *   loadGrid       the grid properties the pages use, in °F, mph, inches and percent
 *   sunElevation   solar elevation, for "daylight only"
 *   workHours      each hour in the next 7 days with what (if anything) rules it out
 *   workWindows    runs of qualifying hours at least a given length
 *   ensAt          NOAA GEFS members at a point, from FutureWeather's packed tiles (make_ensemble.py)
 *   ensWindowOdds  how many members keep a window within its limits
 *
 * A job is a plain object of limits; a blank limit ("" or null) means "any". Limits this file understands:
 *   tmin tmax wind wmin gust pop rain rh thunder dtmin dtmax hours day after
 * (wmin: least wind, mph; dtmin/dtmax: Delta T, °F; after: hours after each hour that must stay dry.)
 */
(function () {
  "use strict";

  const lim = (v) => (v === "" || v == null || !Number.isFinite(+v) ? null : +v);

  /** Hourly series from the NWS forecast grid ("2026-10-20T18:00:00+00:00/PT3H" intervals spread over each hour). */
  function gridSeries(prop, convert = (v) => v, spread = false) {
    const out = new Map();
    for (const { validTime, value } of prop?.values || []) {
      if (value == null) continue;
      const [start, dur] = validTime.split("/");
      const m = dur.match(/P(?:(\d+)D)?T?(?:(\d+)H)?/);
      const hours = Math.max(1, (+(m?.[1] || 0)) * 24 + (+(m?.[2] || 0)));
      const t0 = Date.parse(start);
      for (let i = 0; i < hours; i++) out.set(t0 + i * 3600e3, convert(spread ? value / hours : value));
    }
    return out;
  }

  /** The forecast grid's hourly series in °F, mph, inches and percent. */
  function gridFrom(p) {
    const f2c = (c) => c * 9 / 5 + 32, kmh = (v) => v / 1.60934;
    return {
      temp: gridSeries(p.temperature, f2c), dew: gridSeries(p.dewpoint, f2c),
      wind: gridSeries(p.windSpeed, kmh), gust: gridSeries(p.windGust, kmh), dir: gridSeries(p.windDirection),
      sky: gridSeries(p.skyCover), pop: gridSeries(p.probabilityOfPrecipitation),
      qpf: gridSeries(p.quantitativePrecipitation, (mm) => mm / 25.4, true),
      rh: gridSeries(p.relativeHumidity), thunder: gridSeries(p.probabilityOfThunder),
    };
  }
  async function loadGrid(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`forecast grid ${res.status}`);
    return gridFrom((await res.json()).properties);
  }

  /** Solar elevation in degrees (NOAA's simplified equations, good to a fraction of a degree). */
  function sunElevation(ms, lat, lon) {
    const d = ms / 86400e3 - 10957.5, r = Math.PI / 180;
    const g = (357.529 + 0.98560028 * d) * r, q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * r, e = (23.439 - 0.00000036 * d) * r;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / r;
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    const ha = ((gmst * 15 + lon - ra) % 360) * r;
    return Math.asin(Math.sin(lat * r) * Math.sin(dec) + Math.cos(lat * r) * Math.cos(dec) * Math.cos(ha)) / r;
  }

  /** Delta T (°F): air temperature minus wet-bulb temperature (Stull 2011, good to about 1°F at farm humidities). */
  function deltaT(tempF, rh) {
    if (tempF == null || rh == null) return null;
    const t = (tempF - 32) * 5 / 9, h = Math.max(5, Math.min(99, rh));
    const tw = t * Math.atan(0.151977 * Math.sqrt(h + 8.313659)) + Math.atan(t + h) - Math.atan(h - 1.676331) +
      0.00391838 * h ** 1.5 * Math.atan(0.023101 * h) - 4.686035;
    return Math.max(0, (t - tw) * 9 / 5);
  }

  /** Each hour in the next 7 days with what (if anything) rules it out. */
  function workHours(g, lat, lon, w, days = 7) {
    const now = Math.floor(Date.now() / 3600e3) * 3600e3, out = [];
    const L = Object.fromEntries(["tmin", "tmax", "wind", "wmin", "gust", "pop", "rain", "rh", "thunder", "dtmin", "dtmax", "after"].map((f) => [f, lim(w[f])]));
    const v = (k, t) => (g[k]?.has(t) ? g[k].get(t) : null);
    for (let t = now; t < now + days * 86400e3; t += 3600e3) {
      const temp = v("temp", t);
      if (temp == null) { out.push({ t, fail: ["no forecast"], nodata: true }); continue; }
      const fail = [];
      const dt = deltaT(temp, v("rh", t));
      if (w.day && sunElevation(t + 1800e3, lat, lon) < -0.833) fail.push("dark");
      if (L.tmin != null && temp < L.tmin) fail.push(`${Math.round(temp)}°F`);
      if (L.tmax != null && temp > L.tmax) fail.push(`${Math.round(temp)}°F`);
      if (L.wind != null && (v("wind", t) ?? 0) > L.wind) fail.push(`wind ${Math.round(v("wind", t))} mph`);
      if (L.wmin != null && (v("wind", t) ?? 0) < L.wmin) fail.push(`calm ${Math.round(v("wind", t) ?? 0)} mph`);
      if (L.gust != null && (v("gust", t) ?? 0) > L.gust) fail.push(`gusts ${Math.round(v("gust", t))} mph`);
      if (L.pop != null && (v("pop", t) ?? 0) > L.pop) fail.push(`${Math.round(v("pop", t))}% precip`);
      if (L.rain != null && (v("qpf", t) ?? 0) > L.rain + 1e-6) fail.push(`${(v("qpf", t) ?? 0).toFixed(2)}" rain`);
      if (L.rh != null && (v("rh", t) ?? 0) > L.rh) fail.push(`${Math.round(v("rh", t))}% humidity`);
      if (L.thunder != null && (v("thunder", t) ?? 0) > L.thunder) fail.push(`${Math.round(v("thunder", t))}% thunder`);
      if (L.dtmin != null && dt != null && dt < L.dtmin) fail.push(`Delta T ${dt.toFixed(1)}°F`);
      if (L.dtmax != null && dt != null && dt > L.dtmax) fail.push(`Delta T ${dt.toFixed(1)}°F`);
      if (L.after) {
        // Dry afterwards: under 0.05" in total and no hour over 40% chance of rain.
        let rain = 0, pop = 0;
        for (let k = 1; k <= L.after; k++) { rain += v("qpf", t + k * 3600e3) ?? 0; pop = Math.max(pop, v("pop", t + k * 3600e3) ?? 0); }
        if (rain >= 0.05 || pop > 40) fail.push(`rain within ${L.after} h`);
      }
      out.push({ t, fail, temp, dt, wind: v("wind", t), gust: v("gust", t), pop: v("pop", t), rh: v("rh", t), sky: v("sky", t), qpf: v("qpf", t) });
    }
    return out;
  }

  function workWindows(hours, minH) {
    const out = [];
    let run = null;
    hours.forEach((h) => {
      if (!h.fail.length) { if (!run) run = { start: h.t, end: h.t + 3600e3, hrs: [] }; run.end = h.t + 3600e3; run.hrs.push(h); }
      else { if (run) out.push(run); run = null; }
    });
    if (run) out.push(run);
    return out.filter((r) => r.hrs.length >= Math.max(1, minH || 1));
  }

  // —— NOAA GEFS ensemble at the point (tiles packed by FutureWeather's make_ensemble.py) ——————————
  // 31 runs of the GFS from slightly different starts. Each step covers the 6 hours before it.
  const ens = new Map();   // base URL → { index, tiles }
  async function ensIndex(base) {
    if (!ens.has(base)) ens.set(base, { index: fetch(`${base}index.json?t=${Date.now()}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null), tiles: new Map() });
    return ens.get(base).index;
  }
  /** Every member's series at the grid point nearest (lat, lon): { tmax, tmin, wind, apcp }[member][step], or null outside the grid. */
  async function ensAt(lat, lon, base = "/FutureWeather/ens/") {
    const ix = await ensIndex(base);
    if (!ix) throw new Error("The ensemble hasn't been published yet.");
    const tiles = ens.get(base).tiles;
    const g = ix.grid, M = ix.members.length, S = ix.hours.length;
    const r = Math.round((g.north - lat) / g.res), c = Math.round((lon - g.west) / g.res);
    if (r < 0 || c < 0 || r >= g.nlat || c >= g.nlon) return null;
    const key = `${Math.floor(r / g.tile)}_${Math.floor(c / g.tile)}`;
    if (!tiles.has(key)) tiles.set(key, fetch(`${base}${key}.bin?run=${encodeURIComponent(ix.cycle)}`).then((x) => { if (!x.ok) throw new Error(`ensemble tile ${x.status}`); return x.arrayBuffer(); }));
    const buf = await tiles.get(key).catch((e) => { tiles.delete(key); throw e; });
    const block = M * S * 5, at = ((r % g.tile) * g.tile + (c % g.tile)) * block;
    const u8 = new Uint8Array(buf, at, M * S * 3), dv = new DataView(buf, at + M * S * 3, M * S * 2);
    const series = (k, off) => Array.from({ length: M }, (_, m) => Array.from({ length: S }, (_, s) => { const v = u8[k * M * S + m * S + s]; return v === 255 ? null : v - off; }));
    return {
      ix, lat: g.north - r * g.res, lon: g.west + c * g.res,
      tmax: series(0, 80), tmin: series(1, 80), wind: series(2, 0),
      apcp: Array.from({ length: M }, (_, m) => Array.from({ length: S }, (_, s) => { const v = dv.getUint16((m * S + s) * 2, true); return v === 65535 ? null : v / 100; })),
    };
  }

  /** How many members keep a work window within its limits (6-hour steps, so an approximation). */
  function ensWindowOdds(e, w, r) {
    const init = Date.parse(e.ix.init), L = { tmin: lim(w.tmin), tmax: lim(w.tmax), wind: lim(w.wind), rain: lim(w.rain) };
    const steps = e.ix.hours.map((h, s) => [s, init + (h - 6) * 3600e3, init + h * 3600e3]).filter(([, a, b]) => a < r.end && b > r.start).map(([s]) => s);
    if (!steps.length) return null;
    const rainCap = L.rain != null ? Math.max(0.02, L.rain * 6) : 0.1;
    let ok = 0, n = 0;
    e.tmax.forEach((_, m) => {
      const v = steps.map((s) => [e.tmax[m][s], e.tmin[m][s], e.wind[m][s], e.apcp[m][s]]);
      if (v.some((x) => x.includes(null))) return;
      n++;
      if (v.every(([tx, tn, wd, rn]) => (L.tmin == null || tn >= L.tmin - 2) && (L.tmax == null || tx <= L.tmax + 2) && (L.wind == null || wd <= L.wind) && rn <= rainCap)) ok++;
    });
    return n ? { ok, n } : null;
  }

  window.WorkWindows = { lim, gridSeries, gridFrom, loadGrid, sunElevation, deltaT, workHours, workWindows, ensAt, ensWindowOdds };
})();
