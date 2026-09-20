/**
 * PastWeather — live client-side lookup (IEM radar + SPC reports + Nominatim).
 * No API keys. No proxy. Demo fallback only if fetches fail.
 *
 * Data sources:
 *   IEM scans:  https://mesonet.agron.iastate.edu/json/radar.py?...
 *   IEM tiles:  https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::USCOMP-N0Q-{YYYYMMDDHHMI}/{z}/{x}/{y}.png
 *   SPC CSV:    https://www.spc.noaa.gov/climo/reports/{YYMMDD}_rpts_filtered.csv
 *   Geocode:    Nominatim (session cache) + lat,lon paste fallback
 *
 * CORS note: use plain GET — no custom headers (SPC/IEM reject preflight).
 */
(function () {
  "use strict";

  const IEM_BASE = "https://mesonet.agron.iastate.edu";
  const SPC_BASE = "https://www.spc.noaa.gov/climo/reports";
  const NOMINATIM = "https://nominatim.openstreetmap.org/search";
  const GEO_CACHE_KEY = "pw-geocode-v1";
  const RADIUS_KM = 250;
  const DEMO_REPORTS = [
    {
      type: "hail",
      timeUtc: "",
      magnitude: "1.00",
      location: "near Bixby",
      county: "",
      state: "OK",
      comments: "1.00 in hail reported near Bixby",
      distanceKm: 4,
      demo: true,
    },
    {
      type: "wind",
      timeUtc: "",
      magnitude: "60",
      location: "",
      county: "",
      state: "",
      comments: "60 mph thunderstorm wind damage",
      distanceKm: 7,
      demo: true,
    },
    {
      type: "tornado",
      timeUtc: "",
      magnitude: null,
      location: "",
      county: "",
      state: "",
      comments: "Brief tornado debris signature noted aloft",
      distanceKm: 18,
      demo: true,
    },
  ];

  // —— DOM ——
  const form = document.getElementById("pw-form");
  const locationInput = document.getElementById("location");
  const whenInput = document.getElementById("when");
  const showBtn = document.getElementById("showBtn");
  const errorEl = document.getElementById("pw-error");
  const statusEl = document.getElementById("pw-status");
  const results = document.getElementById("pw-results");
  const resultMeta = document.getElementById("resultMeta");
  const resultMetaSub = document.getElementById("resultMetaSub");
  const radarWrap = document.getElementById("radar-wrap");
  const reportsList = document.getElementById("reports-list");
  const reportsNote = document.getElementById("reports-note");

  if (!form) return;

  let map = null;
  let basemapLayer = null;
  let radarLayer = null;
  let marker = null;

  // —— Geo helpers ——
  function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function scanTsToLayerId(ts) {
    const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return String(ts).replace(/\D/g, "").slice(0, 12);
      const pad = (n) => String(n).padStart(2, "0");
      return (
        `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
        `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
      );
    }
    return `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}`;
  }

  /** SPC storm-day key YYMMDD (12Z–12Z) */
  function spcStormDayKey(isoUtc) {
    const d = new Date(isoUtc);
    const adj = new Date(d);
    if (d.getUTCHours() < 12) adj.setUTCDate(adj.getUTCDate() - 1);
    const yy = String(adj.getUTCFullYear()).slice(-2);
    const mm = String(adj.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(adj.getUTCDate()).padStart(2, "0");
    return `${yy}${mm}${dd}`;
  }

  function parseLatLon(text) {
    const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
  }

  function toIsoUtcFromLocalInput(value) {
    // datetime-local is wall-clock without zone; treat as local, emit UTC ISO
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  function formatDisplayUtc(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return (
      d.toLocaleString("en-GB", {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }) + " UTC"
    );
  }

  function formatReportTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || "";
    return (
      d.toLocaleString("en-US", {
        timeZone: "UTC",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }) + " UTC"
    );
  }

  function miles(km) {
    if (km == null) return "";
    return `${Math.round(km * 0.621371 * 10) / 10} miles`;
  }

  // —— Geocode (Nominatim + lat,lon + session cache) ——
  function readGeoCache() {
    try {
      return JSON.parse(sessionStorage.getItem(GEO_CACHE_KEY) || "{}");
    } catch {
      return {};
    }
  }
  function writeGeoCache(key, value) {
    try {
      const all = readGeoCache();
      all[key] = value;
      sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify(all));
    } catch {
      /* ignore quota */
    }
  }

  async function geocodePlace(query) {
    const q = query.trim();
    if (!q) throw new Error("Enter a location or lat, lon.");

    const direct = parseLatLon(q);
    if (direct) {
      return {
        label: `${direct.lat.toFixed(4)}, ${direct.lon.toFixed(4)}`,
        lat: direct.lat,
        lon: direct.lon,
        source: "latlon",
      };
    }

    const cacheKey = q.toLowerCase();
    const cached = readGeoCache()[cacheKey];
    if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lon)) {
      return { ...cached, source: "cache" };
    }

    const url = new URL(NOMINATIM);
    url.searchParams.set("q", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");

    // No custom headers — browser CORS; identify via Referer (GitHub Pages).
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Geocode failed (${res.status}). Try lat, lon instead.`);
    }
    const data = await res.json();
    if (!data?.length) {
      throw new Error("Place not found. Try a clearer name or lat, lon.");
    }
    const hit = data[0];
    const lat = Number(hit.lat);
    const lon = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("Invalid geocode result. Try lat, lon.");
    }
    const short =
      (hit.display_name && hit.display_name.split(",").slice(0, 3).join(",").trim()) ||
      q;
    const result = { label: short, lat, lon, source: "nominatim" };
    writeGeoCache(cacheKey, { label: short, lat, lon });
    return result;
  }

  // —— IEM radar ——
  function iemRadarScansUrl(radar, product, startIso, endIso) {
    const u = new URL(`${IEM_BASE}/json/radar.py`);
    u.searchParams.set("operation", "list");
    u.searchParams.set("radar", radar);
    u.searchParams.set("product", product);
    u.searchParams.set("start", startIso);
    u.searchParams.set("end", endIso);
    return u.toString();
  }

  function iemRadarTileTemplate(radar, product, layerTime) {
    return `${IEM_BASE}/c/tile.py/1.0.0/ridge::${radar}-${product}-${layerTime}/{z}/{x}/{y}.png`;
  }

  function windowAround(isoUtc, minutes) {
    const t = new Date(isoUtc).getTime();
    const start = new Date(t - minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const end = new Date(t + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    return { start, end };
  }

  function nearestScan(scans, targetIso) {
    if (!scans.length) return null;
    const target = new Date(targetIso).getTime();
    let best = scans[0];
    let bestDiff = Math.abs(new Date(best.ts).getTime() - target);
    for (let i = 1; i < scans.length; i++) {
      const s = scans[i];
      const diff = Math.abs(new Date(s.ts).getTime() - target);
      if (diff < bestDiff) {
        best = s;
        bestDiff = diff;
      }
    }
    return best;
  }

  async function listScans(radar, product, start, end) {
    const url = iemRadarScansUrl(radar, product, start, end);
    const res = await fetch(url); // plain GET, no custom headers
    if (!res.ok) return [];
    const json = await res.json();
    const raw = json.scans || json.data || [];
    return raw.map((s) => ({
      ts: s.ts,
      layerId: scanTsToLayerId(s.ts),
      product,
      radar,
    }));
  }

  /** Exported hook for Developer — fetch nearest USCOMP scan */
  async function fetchRadar(isoUtc) {
    const { start, end } = windowAround(isoUtc, 90);
    let scans = await listScans("USCOMP", "N0Q", start, end);
    let product = "N0Q";
    if (!scans.length) {
      scans = await listScans("USCOMP", "N0B", start, end);
      product = "N0B";
    }
    const nearest = nearestScan(scans, isoUtc);
    if (!nearest) return null;
    return { ...nearest, product, radar: "USCOMP" };
  }

  // —— SPC reports ——
  function parseCsvLine(line) {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQ = !inQ;
        continue;
      }
      if (c === "," && !inQ) {
        out.push(cur);
        cur = "";
        continue;
      }
      cur += c;
    }
    out.push(cur);
    return out;
  }

  function hhmmToIso(dayKey, hhmm) {
    const yy = Number(dayKey.slice(0, 2));
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    const month = Number(dayKey.slice(2, 4));
    const day = Number(dayKey.slice(4, 6));
    const hh = Number(hhmm.slice(0, 2));
    const mm = Number(hhmm.slice(2, 4));
    const d = new Date(Date.UTC(year, month - 1, day, hh, mm, 0));
    // SPC times before 12Z belong to the next calendar day of the storm day
    if (hh < 12) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }

  function spcFilteredCsvUrl(isoUtc) {
    return `${SPC_BASE}/${spcStormDayKey(isoUtc)}_rpts_filtered.csv`;
  }

  /** Exported hook for Developer — fetch nearby SPC storm reports */
  async function fetchReports(isoUtc, lat, lon, radiusKm) {
    const radius = radiusKm ?? RADIUS_KM;
    const dayKey = spcStormDayKey(isoUtc);
    const url = spcFilteredCsvUrl(isoUtc);
    const res = await fetch(url); // GET only, no custom headers
    if (!res.ok) {
      throw new Error(`SPC CSV fetch failed: ${res.status}`);
    }
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(Boolean);

    let section = null;
    const reports = [];
    let idx = 0;

    for (const line of lines) {
      const upper = line.toUpperCase();
      if (upper.startsWith("TIME,") && upper.includes("F_SCALE")) {
        section = "tornado";
        continue;
      }
      if (upper.startsWith("TIME,") && upper.includes("SIZE")) {
        section = "hail";
        continue;
      }
      if (upper.startsWith("TIME,") && upper.includes("SPEED")) {
        section = "wind";
        continue;
      }
      if (!section || upper.startsWith("TIME,")) continue;

      const cols = parseCsvLine(line);
      if (cols.length < 7) continue;
      const [time, mag, location, county, state, rlat, rlon, ...rest] = cols;
      const plat = Number(rlat);
      const plon = Number(rlon);
      if (!Number.isFinite(plat) || !Number.isFinite(plon)) continue;
      const d = distanceKm(lat, lon, plat, plon);
      if (d > radius) continue;

      const comments = rest.join(",").trim();
      reports.push({
        id: `spc-${section}-${dayKey}-${idx++}`,
        type: section,
        timeUtc: /^\d{4}$/.test(time || "") ? hhmmToIso(dayKey, time) : time || "",
        lat: plat,
        lon: plon,
        location: location || "",
        county: county || "",
        state: state || "",
        magnitude: mag && mag !== "UNK" ? mag : null,
        comments,
        distanceKm: Math.round(d * 10) / 10,
        demo: false,
      });
    }

    return reports.sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
  }

  // —— Map (Leaflet) ——
  function ensureMap(lat, lon) {
    if (typeof L === "undefined") return null;
    if (!map) {
      map = L.map("radar-map", {
        zoomControl: true,
        attributionControl: true,
      }).setView([lat, lon], 8);
      basemapLayer = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 16, attribution: "Esri" }
      ).addTo(map);
    } else {
      map.setView([lat, lon], 8);
    }
    if (marker) map.removeLayer(marker);
    marker = L.circleMarker([lat, lon], {
      radius: 7,
      color: "#2A1C14",
      weight: 2,
      fillColor: "#F2F0E6",
      fillOpacity: 1,
    }).addTo(map);
    setTimeout(() => map.invalidateSize(), 80);
    return map;
  }

  function setRadarTiles(scan) {
    if (!map) return;
    if (radarLayer) {
      map.removeLayer(radarLayer);
      radarLayer = null;
    }
    if (!scan || !scan.layerId) return;
    const radar = scan.radar || "USCOMP";
    const product = scan.product || "N0Q";
    const url = iemRadarTileTemplate(radar, product, scan.layerId);
    radarLayer = L.tileLayer(url, {
      maxZoom: 10,
      opacity: 0.8,
      attribution: `IEM ${radar}-${product}`,
    }).addTo(map);
  }

  function showDemoRadar(lat, lon) {
    radarWrap.innerHTML = "";
    radarWrap.className = "radar-wrap";
    const demo = document.createElement("div");
    demo.className = "demo-radar";
    demo.setAttribute("aria-label", "Demo radar composite (live data unavailable)");
    demo.innerHTML =
      '<span class="pin" aria-hidden="true"></span>' +
      '<span class="radar-badge">Demo composite — live radar unavailable</span>';
    radarWrap.appendChild(demo);
    // Reset Leaflet so next live load recreates #radar-map
    map = null;
    radarLayer = null;
    basemapLayer = null;
    marker = null;
  }

  function prepareLiveRadarMount() {
    radarWrap.innerHTML = "";
    radarWrap.className = "radar-wrap";
    const mapDiv = document.createElement("div");
    mapDiv.id = "radar-map";
    mapDiv.setAttribute("role", "img");
    mapDiv.setAttribute("aria-label", "Archived radar map");
    radarWrap.appendChild(mapDiv);
    map = null;
    radarLayer = null;
    basemapLayer = null;
    marker = null;
  }

  function showRadarLoading() {
    radarWrap.innerHTML = '<div class="radar-loading">Loading radar and reports…</div>';
    map = null;
  }

  function showRadarEmpty(msg) {
    radarWrap.innerHTML = `<div class="radar-empty">${msg || "No radar available for this time and area."}</div>`;
    map = null;
  }

  // —— Reports UI ——
  function typeLabel(t) {
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Report";
  }

  function renderReports(reports, opts) {
    reportsList.innerHTML = "";
    if (opts && opts.error) {
      reportsList.innerHTML = `<li class="reports-empty">${opts.error}</li>`;
      if (reportsNote) {
        reportsNote.hidden = false;
        reportsNote.textContent = opts.demo
          ? "Demo storm reports shown — live SPC data could not be loaded."
          : "";
      }
      return;
    }
    if (!reports || !reports.length) {
      reportsList.innerHTML =
        '<li class="reports-empty">No storm reports found nearby for this time.</li>';
      if (reportsNote) {
        reportsNote.hidden = true;
        reportsNote.textContent = "";
      }
      return;
    }
    const frag = document.createDocumentFragment();
    reports.slice(0, 12).forEach((r) => {
      const li = document.createElement("li");
      const mag = r.magnitude ? ` · ${r.magnitude}` : "";
      const dist = miles(r.distanceKm);
      const timePart = r.timeUtc ? ` · ${formatReportTime(r.timeUtc)}` : "";
      const place = [r.location, r.county, r.state].filter(Boolean).join(", ");
      const body = (r.comments && r.comments.trim()) || place || "Storm report";
      li.innerHTML =
        `<span class="t">${typeLabel(r.type)}${mag}${timePart}${dist ? ` · ${dist}` : ""}${
          r.demo ? " · Demo" : ""
        }</span>` +
        `${escapeHtml(body)}` +
        (place && r.comments && r.comments.trim()
          ? `<span class="place">${escapeHtml(place)}</span>`
          : "");
      frag.appendChild(li);
    });
    reportsList.appendChild(frag);
    if (reportsNote) {
      const anyDemo = reports.some((r) => r.demo);
      reportsNote.hidden = !anyDemo;
      reportsNote.textContent = anyDemo
        ? "Demo storm reports — live SPC data unavailable for this request."
        : "";
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setError(msg) {
    if (!errorEl) return;
    if (msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    } else {
      errorEl.textContent = "";
      errorEl.hidden = true;
    }
  }

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || "";
  }

  // —— Main flow ——
  async function runLookup() {
    setError(null);
    const locQ = (locationInput.value || "").trim();
    const whenVal = whenInput.value;
    const isoUtc = toIsoUtcFromLocalInput(whenVal);
    if (!locQ) {
      setError("Enter a location or lat, lon.");
      return;
    }
    if (!isoUtc) {
      setError("Choose a date and time.");
      return;
    }

    showBtn.disabled = true;
    setStatus("Resolving location…");
    results.hidden = false;
    showRadarLoading();
    renderReports([], {});

    let geo;
    try {
      geo = await geocodePlace(locQ);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve location.");
      setStatus("");
      showBtn.disabled = false;
      results.hidden = true;
      return;
    }

    resultMeta.textContent = `${geo.label} · ${formatDisplayUtc(isoUtc)}`;
    if (resultMetaSub) {
      resultMetaSub.textContent = "Loading radar and reports…";
      resultMetaSub.hidden = false;
    }
    setStatus("Fetching radar and storm reports…");

    let scan = null;
    let reports = [];
    let radarFailed = false;
    let reportsFailed = false;

    const [scanResult, reportsResult] = await Promise.all([
      fetchRadar(isoUtc).catch(() => {
        radarFailed = true;
        return null;
      }),
      fetchReports(isoUtc, geo.lat, geo.lon, RADIUS_KM).catch(() => {
        reportsFailed = true;
        return null;
      }),
    ]);

    scan = scanResult;
    if (reportsResult) reports = reportsResult;

    // Radar UI
    if (scan && scan.layerId && typeof L !== "undefined") {
      prepareLiveRadarMount();
      ensureMap(geo.lat, geo.lon);
      setRadarTiles(scan);
      const badge = document.createElement("span");
      badge.className = "radar-badge";
      badge.textContent = `IEM ${scan.radar || "USCOMP"}-${scan.product || "N0Q"} · ${scan.layerId}`;
      radarWrap.appendChild(badge);
      if (resultMetaSub) {
        resultMetaSub.textContent = `Nearest scan ${formatDisplayUtc(
          scan.ts.endsWith("Z") ? scan.ts : scan.ts + "Z"
        )}`;
        resultMetaSub.hidden = false;
      }
    } else if (typeof L === "undefined" || radarFailed || !scan) {
      showDemoRadar(geo.lat, geo.lon);
      if (resultMetaSub) {
        resultMetaSub.textContent = radarFailed
          ? "Demo radar — live IEM data unavailable"
          : "No radar scan found nearby — showing demo";
        resultMetaSub.hidden = false;
      }
    } else {
      showRadarEmpty();
      if (resultMetaSub) {
        resultMetaSub.textContent = "No radar available for this time and area.";
        resultMetaSub.hidden = false;
      }
    }

    // Reports UI — demo fallback only if fetch failed
    if (reportsFailed) {
      renderReports(DEMO_REPORTS, { demo: true });
    } else {
      renderReports(reports, {});
    }

    setStatus("");
    showBtn.disabled = false;
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runLookup();
  });

  // Default datetime: a known active severe day (optional UX aid)
  if (whenInput && !whenInput.value) {
    whenInput.value = "2024-05-21T18:30";
  }
  if (locationInput && !locationInput.value) {
    locationInput.placeholder = "Address, place, or lat, lon";
  }

  // Expose hooks for Developer / console debugging
  window.PastWeather = {
    fetchRadar,
    fetchReports,
    geocodePlace,
    iemRadarTileTemplate,
    spcFilteredCsvUrl,
    spcStormDayKey,
  };
})();
