/* Standard Weather — the data files the sites' GitHub Actions publish, with how fresh each one is.
 * Used by the home page's live tiles and by status.html.
 *
 *   Feeds.load(id)   → { id, name, page, updated, ageMin, health: "ok" | "late" | "stale" | "down", detail, data }
 *   Feeds.loadAll()  → every feed, in FEEDS order
 *   Feeds.age(min)   → "4 min", "3 h 10 min", "2 days"
 *
 * Each feed says how often it's meant to update; "late" is past twice that, "stale" past five times.
 */
(function () {
  "use strict";

  const MIN = 60000;
  const ageMin = (t) => (Date.now() - t) / MIN;

  // Newest of several ISO times (or null).
  const newest = (...ts) => ts.map((t) => Date.parse(t)).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), -Infinity);

  async function getJson(url) {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }

  const MODEL_EVERY = { gfs: 6, ecmwf: 12, nbm: 6, hrrr: 1 };   // hours between the cycles each model publishes

  const FEEDS = [
    {
      id: "lightning", name: "NowWeather lightning", page: "/NowWeather/", url: "/NowWeather/data/glm.json", every: 5,
      read: (d) => ({ updated: Date.parse(d.generated), detail: `${(d.flashes || 0).toLocaleString()} flashes in the last ${d.windowMinutes || 15} min${d.errors?.length ? ` · ${d.errors.length} GOES files failed` : ""}` }),
    },
    {
      id: "tropical", name: "TropicalWeather storms and outlooks", page: "/TropicalWeather/", url: "/TropicalWeather/data/tropical.json", every: 15,
      read: (d) => ({ updated: Date.parse(d.generated), detail: `${d.storms?.length || 0} active storm${d.storms?.length === 1 ? "" : "s"} · ${d.recon?.missions?.length || 0} recon mission${d.recon?.missions?.length === 1 ? "" : "s"}${d.errors?.length ? ` · ${d.errors.length} sources failed` : ""}` }),
    },
    {
      id: "models", name: "FutureWeather model maps", page: "/FutureWeather/", url: "/FutureWeather/data.json", every: 6 * 60,
      // The run is only as fresh as its model cycle. Judge each model by its own cycle and keep the worst.
      read: (d) => {
        const models = (d.models || []).map((m) => {
          const init = Date.parse(m.init || String(m.cycle).replace(/Z$/, ":00Z"));
          return { id: m.id, name: m.name, cycle: m.cycle, init, hours: m.hours?.length || 0, ageH: ageMin(init) / 60, everyH: MODEL_EVERY[m.id] || 6 };
        });
        const missing = Object.keys(MODEL_EVERY).filter((id) => !models.some((m) => m.id === id));
        return { updated: Date.parse(d.generated), models, missing,
          detail: models.map((m) => `${m.name} ${String(m.cycle).slice(11, 13)}Z`).join(" · ") + (missing.length ? ` · missing ${missing.map((x) => x.toUpperCase()).join(", ")}` : "") };
      },
    },
    {
      id: "tfr", name: "AviationWeather TFRs", page: "/AviationWeather/", url: "/AviationWeather/data/tfr.json", every: 30,
      read: (d) => ({ updated: Date.parse(d.generated), detail: `${d.features?.length || 0} TFR shapes` }),
    },
    {
      id: "drought", name: "FarmWeather Drought Monitor", page: "/FarmWeather/", url: "/FarmWeather/data/drought.json", every: 7 * 24 * 60,
      read: (d) => ({ updated: newest(`${d.valid}T12:00:00Z`), detail: `Map valid ${d.valid}` }),
    },
    {
      id: "history", name: "ForensicWeather storm history", page: "/ForensicWeather/", url: "/PastWeather/data/history/index.json", every: 7 * 24 * 60,
      read: (d) => ({ updated: newest(`${d.spcThrough}T12:00:00Z`), detail: `SPC reports through ${d.spcThrough} · NCEI through ${d.lastDay}` }),
    },
    {
      id: "jobs", name: "WxCareers jobs", page: "https://wxcareers.com/", url: "https://wxcareers.com/jobs.json", every: 24 * 60,
      read: (d) => ({ updated: Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(d.updated) ? d.updated : `${d.updated}Z`), detail: `${(d.count || 0).toLocaleString()} open jobs` }),
    },
  ];

  // A model run is published about 4 to 6 hours after its cycle, and FutureWeather rebuilds every 6 hours, so a
  // healthy model's newest cycle is up to max(6, its spacing) + 6 hours old.
  const modelExpectH = (m) => Math.max(6, m.everyH) + 6;

  function health(feed, r) {
    if (!Number.isFinite(r.updated)) return "down";
    const a = ageMin(r.updated);
    let h = a > 5 * feed.every ? "stale" : a > 2 * feed.every ? "late" : "ok";
    if (r.models) {
      const over = r.models.reduce((w, m) => Math.max(w, m.ageH - modelExpectH(m)), -Infinity);
      const mh = over > 12 ? "stale" : over > 0 || r.missing.length ? "late" : "ok";
      if (["ok", "late", "stale"].indexOf(mh) > ["ok", "late", "stale"].indexOf(h)) h = mh;
    }
    return h;
  }

  async function load(id) {
    const feed = FEEDS.find((f) => f.id === id);
    const base = { id: feed.id, name: feed.name, page: feed.page, every: feed.every };
    try {
      const data = await getJson(feed.url);
      const r = feed.read(data);
      return { ...base, ...r, data, ageMin: Number.isFinite(r.updated) ? ageMin(r.updated) : null, health: health(feed, r) };
    } catch (e) {
      return { ...base, data: null, updated: null, ageMin: null, health: "down", detail: `Couldn't load the file (${e.message})` };
    }
  }

  function age(min) {
    if (min == null || !Number.isFinite(min)) return "—";
    const m = Math.max(0, Math.round(min));
    if (m < 60) return `${m} min`;
    if (m < 48 * 60) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
    return `${Math.round(m / 1440)} days`;
  }

  window.Feeds = { FEEDS, modelExpectH, load, loadAll: () => Promise.all(FEEDS.map((f) => load(f.id))), age };
})();
