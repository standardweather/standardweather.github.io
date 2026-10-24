/* FarmWeather — field weather console for standardweather.github.io.
 *
 * Built around fields the visitor saves in this browser (localStorage "sw-farm-fields"). Everything loads live in the
 * browser from public services that allow cross-origin requests:
 *   NWS API (api.weather.gov)        forecast grid (spray check, work windows, Delta T, forecast GDD), alerts at the
 *                                    field and warned storms nearby (arrival times), nearest station observations
 *   NWS/RFC precipitation analysis   rain at the field (24 h, 7 and 30 days, % of normal) and the rainfall layers
 *                                    (NOAA map services, obs/rfc_qpe)
 *   RCC ACIS (data.rcc-acis.org)     PRISM daily highs, lows and rain at the field, this season and 1991–2020,
 *                                    for growing degree days, chill hours, frost dates and rain against normal
 *   Iowa Environmental Mesonet       4-inch soil temperature from the nearest probe (Iowa State soil network, NRCS SCAN)
 *   NOAA GEFS ensemble               member agreement on work windows (FutureWeather's tiles, /js/workwindows.js)
 *   NOAA CPC outlooks                6–10 and 8–14 day layers and the outlook at the field (NOAA map services)
 *   NASA GIBS                        SMAP root-zone soil moisture layer
 *   nowCOAST (NOAA)                  radar loop and watches/warnings layer
 * Collected weekly by GitHub Actions (tools/collect_drought.py → data/drought.json):
 *   U.S. Drought Monitor (NDMC, USDA, NOAA), simplified
 */
(() => {
  "use strict";

  const NWS = "https://api.weather.gov";
  const NOWCOAST = "https://nowcoast.noaa.gov/geoserver";
  const MAPSERVICES = "https://mapservices.weather.noaa.gov";
  const RFC_QPE = `${MAPSERVICES}/raster/rest/services/obs/rfc_qpe/MapServer`;
  const ACIS = "https://data.rcc-acis.org";
  const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
  const CONUS = [[24, -125], [50, -66]];
  const WW = window.WorkWindows, lim = WW.lim;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const hhmmZ = (t) => { const d = new Date(t); return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`; };
  const r0 = (v) => (v == null ? "—" : Math.round(v));
  const params = new URLSearchParams(location.search);

  // —— Crops: growing degree day base and cap (°F), and the usual start of the season ————————————————
  // Rules of thumb from extension services; every value can be changed on the Season tab.
  const CROPS = {
    corn: { name: "Corn", group: "Row crops", base: 50, cap: 86, start: "05-01" },
    soybeans: { name: "Soybeans", group: "Row crops", base: 50, cap: 86, start: "05-10" },
    wheat: { name: "Winter wheat", group: "Row crops", base: 32, cap: null, start: "01-01", note: "Winter wheat GDD usually count from January 1 (base 32°F)." },
    apples: { name: "Apples", group: "Orchards & vineyards", base: 43, cap: null, start: "03-01", fruit: true },
    grapes: { name: "Grapes", group: "Orchards & vineyards", base: 50, cap: null, start: "04-01", fruit: true, note: "Base 50°F from April 1 is the Winkler index used to rank grape-growing regions." },
    cherries: { name: "Cherries & stone fruit", group: "Orchards & vineyards", base: 40, cap: null, start: "03-01", fruit: true },
    tomatoes: { name: "Tomatoes", group: "Vegetables", base: 50, cap: null, start: "05-15" },
    sweetcorn: { name: "Sweet corn", group: "Vegetables", base: 50, cap: 86, start: "05-10" },
    potatoes: { name: "Potatoes", group: "Vegetables", base: 45, cap: null, start: "04-20" },
    peas: { name: "Peas & cool-season vegetables", group: "Vegetables", base: 40, cap: null, start: "04-01" },
    custom: { name: "Other (custom base)", group: "Other", base: 50, cap: null, start: "05-01" },
  };
  // Temperatures that harm the crop (°F), roughly the 10% kill point at each stage. Washington State University
  // and Michigan State University tables for fruit; common extension guidance for the rest.
  const FROST = {
    apples: [["Silver tip", 15], ["Green tip", 18], ["Half-inch green", 23], ["Tight cluster", 27], ["Pink", 28], ["Bloom", 28], ["Petal fall", 28]],
    cherries: [["First swell", 17], ["Side green", 22], ["Green tip", 25], ["Tight cluster", 26], ["White bud", 27], ["Bloom", 28], ["Petal fall", 28]],
    grapes: [["Bud swell", 20], ["Budbreak", 28], ["First leaves", 30], ["Shoots and clusters", 31]],
    corn: [["Seedlings (growing point below ground)", 28], ["Seedlings (growing point above ground)", 32], ["Late season", 32]],
    soybeans: [["Seedlings", 30], ["Late season", 32]],
    wheat: [["Jointing", 24], ["Boot", 28], ["Heading and flowering", 30]],
    tomatoes: [["Tender crop", 32]], sweetcorn: [["Seedlings", 30]], potatoes: [["Foliage", 30]], peas: [["Hardy crop", 28]],
    custom: [["Tender crop", 32], ["Hardy crop", 28]],
  };

  // —— Field jobs for work windows. Presets are common rules of thumb, not standards; every limit can be changed. ——
  const JOBS = {
    spray: { name: "Spraying", wmin: 3, wind: 10, gust: 15, tmax: 90, pop: 20, rain: 0, dtmin: 3.6, dtmax: 14.4, after: 4, hours: 2, day: true,
      note: "Wind 3–10 mph and Delta T 3.6–14.4°F (2–8°C) are the usual spray guidance; calm air risks an inversion and drift. The label always rules, and many products need several rain-free hours after application." },
    hay: { name: "Cut hay", pop: 30, rain: 0, hours: 60, day: false,
      note: "Dry hay usually needs about three rain-free days to cure; haylage needs less. Sun, wind and low humidity speed drying." },
    plant: { name: "Planting", tmin: 50, pop: 30, rain: 0, hours: 8, day: true,
      note: "Corn and soybeans want soil at 50°F and rising and no cold soaking rain in the first two days. The windows use forecast air temperature; check the soil temperature below before planting." },
    harvest: { name: "Grain harvest", rh: 75, pop: 20, rain: 0, hours: 6, day: false,
      note: "Dew and humidity above about 75% slow combining and raise grain moisture." },
    fieldwork: { name: "Tillage & fieldwork", pop: 30, rain: 0, hours: 8, day: true,
      note: "Soils usually need a dry day or two after half an inch of rain; Today shows recent rain at the field." },
    manure: { name: "Manure", pop: 30, rain: 0, after: 48, hours: 4, day: true,
      note: "Many state rules bar spreading when heavy rain is forecast within 24–72 hours, or on frozen or snow-covered ground." },
    transplant: { name: "Transplanting", tmin: 50, tmax: 85, wind: 15, pop: 30, rain: 0, hours: 4, day: true,
      note: "Cloudy, calm afternoons ease transplant shock; tender crops want nights above 50°F." },
    pick: { name: "Picking", tmax: 90, pop: 30, rain: 0, hours: 4, day: true,
      note: "Picking dry plants limits the spread of disease; heat lowers quality and is hard on crews." },
    frost: { name: "Frost nights", frost: true, note: "Hours at or below the critical temperature for the crop and stage, when frost protection is needed." },
    custom: { name: "Custom", wind: 20, pop: 30, hours: 4, day: false, note: "" },
  };
  const JOB_FIELDS = [["tmin", "Min temp °F"], ["tmax", "Max temp °F"], ["wmin", "Min wind mph"], ["wind", "Max wind mph"], ["gust", "Max gust mph"],
    ["pop", "Max precip chance %"], ["rain", "Max rain in/hr"], ["rh", "Max humidity %"], ["thunder", "Max thunder chance %"],
    ["dtmin", "Min Delta T °F"], ["dtmax", "Max Delta T °F"], ["after", "Dry hours after"], ["hours", "Shortest window, hours"]];
  function jobFromUrl() {
    const k = JOBS[params.get("job")] ? params.get("job") : "spray";
    const w = { preset: k, ...JOBS[k] };
    JOB_FIELDS.forEach(([f]) => { if (params.has(f)) w[f] = params.get(f) === "" ? "" : +params.get(f); });
    if (params.has("day")) w.day = params.get("day") === "1";
    if (params.has("crit")) w.crit = +params.get("crit");
    return w;
  }

  const VIEWS = ["today", "windows", "season", "map"];
  const state = {
    view: VIEWS.includes(params.get("view")) ? params.get("view") : "today",
    fields: [], active: null, field: null,     // field: the one shown (saved, or a spot from the map or a link)
    editing: null,                               // the add/edit form's draft
    job: jobFromUrl(), jobOpen: false,
    on: { radar: true, alerts: true, drought: false, soil: false }, rain: "off", cpc: "off",
    storms: [], drought: null,
    radar: { times: [], layers: [], idx: 0, timer: null, opacity: 0.75 },
  };

  // —— Saved fields ———————————————————————————————————————————————————
  const FIELDS_KEY = "sw-farm-fields";
  function loadFields() {
    try {
      const d = JSON.parse(localStorage.getItem(FIELDS_KEY) || "null");
      if (d && Array.isArray(d.list)) { state.fields = d.list.filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon)).map((f) => ({ ...f, plantedSet: !!f.planted })); state.active = d.active; }
    } catch { /* private mode */ }
  }
  function saveFields() {
    try { localStorage.setItem(FIELDS_KEY, JSON.stringify({ active: state.active, list: state.fields.map(({ id, name, lat, lon, crop, planted, base, cap }) => ({ id, name, lat, lon, crop, planted, base, cap })) })); } catch { /* private mode */ }
  }
  const newId = () => Math.random().toString(36).slice(2, 10);

  // —— Map ————————————————————————————————————————————————————————
  const map = L.map("map", { zoomControl: false, minZoom: 3, maxZoom: 13 }).fitBounds(CONUS);
  L.control.zoom({ position: "topright" }).addTo(map);
  map.attributionControl.setPrefix("");
  [["soil", 280], ["drought", 290], ["rain", 300], ["cpc", 310], ["radar", 330], ["alerts", 400], ["points", 620], ["labels", 640]]
    .forEach(([n, z]) => { map.createPane(n).style.zIndex = z; });
  ["labels", "alerts", "rain", "cpc", "soil"].forEach((n) => { map.getPane(n).style.pointerEvents = "none"; });
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, attribution: "Esri" }).addTo(map);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, pane: "labels", opacity: 0.85 }).addTo(map);
  map.attributionControl.addAttribution("NWS · NOAA · USDM · NASA");

  /** An ArcGIS MapServer drawn as tiles through its export endpoint (NOAA map services). */
  const ExportLayer = L.TileLayer.extend({
    getTileUrl(c) {
      const size = this.getTileSize();
      const a = L.CRS.EPSG3857.project(map.unproject([c.x * size.x, c.y * size.y], c.z));
      const b = L.CRS.EPSG3857.project(map.unproject([(c.x + 1) * size.x, (c.y + 1) * size.y], c.z));
      return `${this.options.base}/export?bbox=${a.x},${b.y},${b.x},${a.y}&bboxSR=3857&imageSR=3857&size=${size.x},${size.y}&layers=show:${this.options.ids}&format=png32&transparent=true&dpi=96&f=image&_=${Math.floor(Date.now() / 1800e3)}`;
    },
  });
  const DM = [["D0", "Abnormally dry", "#ffff00"], ["D1", "Moderate drought", "#fcd37f"], ["D2", "Severe drought", "#ffaa00"], ["D3", "Extreme drought", "#e60000"], ["D4", "Exceptional drought", "#730000"]];
  const layers = {
    alerts: L.tileLayer.wms(`${NOWCOAST}/alerts/wms`, { layers: "watches_warnings_advisories", format: "image/png", transparent: true, version: "1.3.0", pane: "alerts", opacity: 0.55, tileSize: 512, attribution: "" }),
    drought: L.layerGroup(),
    soil: L.tileLayer(`${GIBS}/SMAP_L4_Analyzed_Root_Zone_Soil_Moisture/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`, { pane: "soil", maxNativeZoom: 6, maxZoom: 13, opacity: 0.7, attribution: "" }),
    rain: null, cpc: null,
    fields: L.layerGroup().addTo(map),
    tracks: L.layerGroup().addTo(map),
  };
  Object.entries(state.on).forEach(([k, v]) => { if (v && layers[k] && k !== "radar") layers[k].addTo(map); });
  const RAIN = { d1: [28, "Rain, last 24 hours (in)"], d3: [40, "Rain, last 3 days (in)"], d7: [56, "Rain, last 7 days (in)"], d30: [68, "Rain, last 30 days (in)"], pct30: [227, "Rain, last 30 days, % of normal"] };
  const CPC = [["6_10", 0, "6–10 day temperature"], ["6_10", 1, "6–10 day precipitation"], ["8_14", 0, "8–14 day temperature"], ["8_14", 1, "8–14 day precipitation"]];
  const cpcBase = (i) => `${MAPSERVICES}/vector/rest/services/outlooks/cpc_${CPC[i][0]}_day_outlk/MapServer`;

  const Legend = L.Control.extend({ options: { position: "topleft" }, onAdd() { const d = L.DomUtil.create("div", "maplegend"); d.id = "legend"; return d; } });
  new Legend().addTo(map);
  const legendCache = {};
  async function arcLegend(base, id, title, every = 1) {
    legendCache[base] ||= fetch(`${base}/legend?f=json`).then((r) => r.json()).then((d) => Object.fromEntries(d.layers.map((l) => [l.layerId, l]))).catch(() => ({}));
    const items = ((await legendCache[base])[id]?.legend || []).filter((x, i) => !/Missing|Less than 0\.01/i.test(x.label) && (i % every === 0 || /Near/.test(x.label)));
    return `<h5 class="sub">${esc(title)}</h5><div class="key">${items.map((x) =>
      `<span><img alt="" src="data:${x.contentType};base64,${x.imageData}" width="12" height="12" style="display:inline;vertical-align:-2px;margin:0 .3rem 0 0">${esc((x.label || "").replace("Greater than or equal to", "≥").replace(/\s+/g, " "))}</span>`).join("")}</div>`;
  }
  async function drawLegend() {
    const parts = [];
    if (state.rain !== "off") parts.push(await arcLegend(RFC_QPE, RAIN[state.rain][0], RAIN[state.rain][1]));
    if (state.cpc !== "off") parts.push(await arcLegend(cpcBase(+state.cpc), CPC[+state.cpc][1], `CPC ${CPC[+state.cpc][2]} outlook · chance of above or below normal`, 2));
    if (state.on.drought) parts.push(`<h5 class="sub">U.S. Drought Monitor${state.drought?.valid ? `, valid ${esc(fmtDate(state.drought.valid))}` : ""}</h5><div class="key">${DM.map(([k, n, c]) => `<span><i style="background:${c}"></i>${k} ${esc(n)}</span>`).join("")}</div>`);
    if (state.on.soil) parts.push(`<h5 class="sub">Root-zone soil moisture (NASA SMAP, m³/m³)</h5><img alt="Soil moisture color scale, dry to wet" src="https://gibs.earthdata.nasa.gov/legends/SMAP_Analyzed_Soil_Moisture_H.svg" />`);
    $("legend").innerHTML = parts.join("");
  }
  function drawRainCpc() {
    layers.rain?.remove(); layers.rain = null;
    layers.cpc?.remove(); layers.cpc = null;
    if (state.rain !== "off") layers.rain = new ExportLayer("", { base: RFC_QPE, ids: RAIN[state.rain][0], pane: "rain", opacity: 0.65, attribution: "" }).addTo(map);
    if (state.cpc !== "off") layers.cpc = new ExportLayer("", { base: cpcBase(+state.cpc), ids: CPC[+state.cpc][1], pane: "cpc", opacity: 0.55, attribution: "" }).addTo(map);
    document.querySelectorAll("[data-pick]").forEach((g) => g.querySelectorAll("[data-v]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === state[g.dataset.pick])));
    drawLegend();
  }

  async function loadDrought() {
    if (state.drought) return state.drought;
    const res = await fetch("data/drought.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`drought ${res.status}`);
    state.drought = await res.json();
    L.geoJSON(state.drought, { pane: "drought", interactive: false, style: (f) => ({ stroke: false, fillColor: DM[f.properties.DM]?.[2] || "#888", fillOpacity: 0.5 }) }).addTo(layers.drought);
    return state.drought;
  }
  /** Drought Monitor category at a point (ray casting over the simplified polygons), or -1 for none. */
  function droughtAt(lat, lon) {
    const d = state.drought;
    if (!d) return null;
    const inRing = (ring) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    const inPoly = (rings) => inRing(rings[0]) && !rings.slice(1).some(inRing);
    let cat = -1;
    for (const f of d.features) {
      const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      if (polys.some(inPoly)) cat = Math.max(cat, f.properties.DM);
    }
    return cat;
  }

  function setStatus(msg) { $("status").textContent = msg || ""; $("status").hidden = !msg; }

  // —— Radar loop (nowCOAST base reflectivity mosaic) ———————————————————
  const RADAR_FRAMES = 12, RADAR_STEP = 10 * 60000;
  async function radarTimes() {
    const res = await fetch(`${NOWCOAST}/observations/weather_radar/wms?service=WMS&version=1.3.0&request=GetCapabilities&_=${Date.now()}`);
    const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
    const layer = [...xml.getElementsByTagName("Layer")].find((l) => l.getElementsByTagName("Name")[0]?.textContent === "base_reflectivity_mosaic");
    const dim = [...(layer?.getElementsByTagName("Dimension") || [])].find((d) => d.getAttribute("name") === "time");
    if (!dim) throw new Error("no radar times");
    const all = dim.textContent.trim().split(",").map((s) => s.trim()).filter(Boolean).sort();
    const picked = [];
    let next = Infinity;
    for (let i = all.length - 1; i >= 0 && picked.length < RADAR_FRAMES; i--) {
      const t = Date.parse(all[i]);
      if (t <= next) { picked.unshift(all[i]); next = t - RADAR_STEP + 60000; }
    }
    return picked;
  }
  function clearRadar() {
    radarLoop(false);
    state.radar.layers.forEach((l) => l.remove());
    state.radar.layers = [];
    state.radar.times = [];
  }
  async function loadRadar(force) {
    const r = state.radar;
    if (!state.on.radar) { clearRadar(); $("t1").textContent = "Radar off"; $("t0").textContent = ""; return; }
    try {
      const times = await radarTimes();
      if (!force && times[times.length - 1] === r.times[r.times.length - 1]) return;
      clearRadar();
      r.times = times;
      r.layers = times.map((t, i) => L.tileLayer.wms(`${NOWCOAST}/observations/weather_radar/wms`, {
        layers: "base_reflectivity_mosaic", format: "image/png", transparent: true, version: "1.3.0", time: t,
        pane: "radar", opacity: i === times.length - 1 ? r.opacity : 0, tileSize: 512, attribution: "",
      }));
      r.idx = times.length - 1;
      r.layers[r.idx].addTo(map);
      $("frame").max = times.length - 1;
      $("frame").value = r.idx;
      $("t0").textContent = hhmmZ(times[0]);
      radarLabel();
    } catch {
      $("t1").textContent = "Radar unavailable";
    }
  }
  function radarLabel() { const t = state.radar.times[state.radar.idx]; if (t) $("t1").textContent = `Radar ${hhmmZ(t)}`; }
  function radarShow(i) {
    const r = state.radar, n = r.layers.length;
    if (!n) return;
    const next = (i + n) % n;
    if (!map.hasLayer(r.layers[next])) r.layers[next].addTo(map);
    r.layers[next].setOpacity(r.opacity);
    r.layers.forEach((l, j) => { if (j !== next) l.setOpacity(0); });
    r.idx = next;
    $("frame").value = next;
    radarLabel();
  }
  function radarLoop(force) {
    const r = state.radar;
    const playing = force ?? !r.timer;
    clearInterval(r.timer);
    r.timer = null;
    $("play").textContent = playing ? "❚❚" : "▶";
    $("play").setAttribute("aria-label", playing ? "Pause radar loop" : "Play radar loop");
    if (!playing || !r.layers.length) return;
    r.layers.forEach((l) => { if (!map.hasLayer(l)) l.addTo(map); });
    let hold = 0;
    r.timer = setInterval(() => {
      if (r.idx === r.layers.length - 1 && hold++ < 2) return;
      hold = 0;
      radarShow(r.idx + 1);
    }, 500);
  }
  $("play").onclick = () => radarLoop();
  $("frame").oninput = (e) => { radarLoop(false); radarShow(+e.target.value); };

  // —— The field's data: NWS point, forecast grid, alerts, observations, rain ——————————————————
  const tzOf = (f) => f?.pt?.timeZone || undefined;
  const fmt = (f, t, o) => new Date(t).toLocaleString("en-US", { timeZone: tzOf(f), ...o });
  const hourLabel = (f, t) => fmt(f, t, { hour: "numeric" }).replace(" ", " ");
  const dayHour = (f, t) => fmt(f, t, { weekday: "short", hour: "numeric" });
  const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const kmBetween = (lat1, lon1, lat2, lon2) => {
    const r = Math.PI / 180, a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
  };
  const mi = (km) => (km * 0.621371 < 10 ? (km * 0.621371).toFixed(1) : Math.round(km * 0.621371));
  const getJson = (u, o) => fetch(u, o).then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); });

  async function loadField(f) {
    f.err = null;
    try {
      const pr = (await getJson(`${NWS}/points/${f.lat.toFixed(4)},${f.lon.toFixed(4)}`)).properties;
      if (!pr?.forecastGridData) throw new Error("no grid");
      f.pt = pr;
      const rel = pr.relativeLocation?.properties;
      if (rel && f.temp) { f.place = `${rel.city}, ${rel.state}`; if (/^-?\d/.test(f.name)) f.name = `Spot near ${f.place}`; }
    } catch {
      f.err = "The National Weather Service doesn't forecast for this spot. FarmWeather covers the U.S. and its territories.";
      render();
      return;
    }
    if (state.field !== f) return;
    render();
    await Promise.allSettled([
      WW.loadGrid(f.pt.forecastGridData).then((g) => { f.grid = g; f.updated = Date.now(); }).catch(() => { f.grid = { temp: new Map() }; }),
      loadPointAlerts(f), loadObs(f), loadRain(f),
    ].map((p) => p.then(() => { if (state.field === f) render(); })));
    if (state.field === f) { render(); $("updated").textContent = `updated ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`; }
  }
  async function loadPointAlerts(f) {
    try { f.alerts = (await getJson(`${NWS}/alerts/active?point=${f.lat.toFixed(4)},${f.lon.toFixed(4)}`, { headers: { Accept: "application/geo+json" } })).features.map((x) => x.properties); }
    catch { f.alerts = null; }
  }
  async function loadObs(f) {
    try {
      const list = await getJson(f.pt.observationStations);
      const st = list.features?.[0];
      if (!st) return;
      const o = (await getJson(`${NWS}/stations/${st.properties.stationIdentifier}/observations/latest`)).properties;
      const v = (q) => (q && q.value != null ? q.value : null);
      const c2f = (c) => (c == null ? null : c * 9 / 5 + 32), kmh = (k) => (k == null ? null : k / 1.60934);
      f.obs = { id: st.properties.stationIdentifier, name: st.properties.name, km: kmBetween(f.lat, f.lon, st.geometry.coordinates[1], st.geometry.coordinates[0]),
        t: o.timestamp, temp: c2f(v(o.temperature)), dew: c2f(v(o.dewpoint)), rh: v(o.relativeHumidity), wind: kmh(v(o.windSpeed)), gust: kmh(v(o.windGust)), dir: v(o.windDirection), text: o.textDescription };
    } catch { f.obs = null; }
  }
  /** Rain at the field from the NWS/RFC precipitation analysis (gauge-adjusted radar, updated daily). */
  async function loadRain(f) {
    const ids = { d1: 28, d7: 56, d30: 68, pct30: 227 };
    const u = new URL(`${RFC_QPE}/identify`);
    Object.entries({ geometry: `${f.lon},${f.lat}`, geometryType: "esriGeometryPoint", sr: 4326, layers: `all:${Object.values(ids).join(",")}`, tolerance: 1,
      mapExtent: `${f.lon - 0.5},${f.lat - 0.5},${f.lon + 0.5},${f.lat + 0.5}`, imageDisplay: "400,400,96", returnGeometry: false, f: "json" }).forEach(([k, v]) => u.searchParams.set(k, v));
    try {
      const d = await getJson(u);
      f.rain = Object.fromEntries(Object.entries(ids).map(([k, id]) => {
        const r = d.results?.find((x) => x.layerId === id);
        const v = parseFloat(r?.attributes?.["Service Pixel Value"]);
        return [k, Number.isFinite(v) && v >= 0 && v < 1e4 ? v : null];
      }));
    } catch { f.rain = null; }
  }

  // —— Soil temperature at 4 inches: the nearest probe, else an estimate from recent air temperatures ——————
  // Probes come from the Iowa Environmental Mesonet's current readings for networks that report soil temperature
  // at 4 inches: the Iowa State soil moisture network (first sensor, 4 in) and NRCS SCAN (second sensor, 4 in).
  const SOIL_NETWORKS = { ISUSM: "c1tmpf", SCAN: "c2tmpf" };
  const SOIL_KM = 48.3;   // 30 miles
  let soilProbes = null, soilProbesAt = 0;
  async function probes() {
    if (soilProbes && Date.now() - soilProbesAt < 30 * 60000) return soilProbes;
    const lists = await Promise.all(Object.entries(SOIL_NETWORKS).map(([n, k]) => getJson(`https://mesonet.agron.iastate.edu/api/1/currents.json?network=${n}`)
      .then((d) => d.data.filter((r) => r[k] != null && r.lat != null && Date.now() - Date.parse(r.utc_valid) < 6 * 3600e3)
        .map((r) => ({ id: r.station, name: r.name, state: r.state, network: n, lat: r.lat, lon: r.lon, t: r.utc_valid, temp: r[k] })))
      .catch(() => [])));
    soilProbes = lists.flat();
    soilProbesAt = Date.now();
    return soilProbes;
  }
  /** Mean of the daily high/low average over the last 5 days with data (PRISM): roughly tracks 4-inch soil in spring. */
  function soilEstimate(days) {
    const ok = days.filter((d) => d[1] != null && d[2] != null).slice(-5);
    return ok.length >= 3 ? { temp: ok.reduce((a, d) => a + (d[1] + d[2]) / 2, 0) / ok.length, n: ok.length, through: ok.at(-1)[0] } : null;
  }
  async function loadSoil(f) {
    if (f.soil) return;
    f.soil = "loading";
    let soil = null;
    try {
      const near = (await probes()).map((p) => ({ ...p, km: kmBetween(f.lat, f.lon, p.lat, p.lon) })).filter((p) => p.km <= SOIL_KM).sort((a, b) => a.km - b.km)[0];
      if (near) soil = { kind: "probe", ...near };
    } catch { /* fall back to the estimate */ }
    if (!soil) {
      try {
        const today = iso(new Date());
        const est = soilEstimate(await acisDaily(f, addDays(today, -8), addDays(today, -1)));
        if (est) soil = { kind: "estimate", ...est };
      } catch { /* none */ }
    }
    f.soil = soil || { kind: "none" };
    if (state.field === f && (state.view === "season" || state.view === "windows")) render();
  }
  function soilHtml(f) {
    const s = f.soil;
    if (!s || s === "loading") { loadSoil(f); return stat("Soil temperature, 4 in", "…", "Looking for a soil probe nearby"); }
    if (s.kind === "none") return stat("Soil temperature, 4 in", "—", "No soil probe within 30 mi and no recent air temperatures to estimate from");
    const v = `${Math.round(s.temp)}°F`, cold = s.temp < 50;
    const why = cold ? "below the 50°F most corn and soybean guidance calls for" : "at or above 50°F";
    return s.kind === "probe"
      ? stat("Soil temperature, 4 in", v, `Measured at ${esc(s.name)}, ${esc(s.state)} (${s.network === "ISUSM" ? "Iowa State soil network" : "NRCS SCAN"}), ${mi(s.km)} mi away · ${esc(fmt(f, s.t, { weekday: "short", hour: "numeric", minute: "2-digit" }))} · ${why}`)
      : stat("Soil temperature, 4 in (estimate)", `~${v}`, `No soil probe within 30 mi, so this is the average air temperature over the last ${s.n} days to ${esc(fmtDate(s.through))} (PRISM), a rough guide to 4-inch soil in spring · ${why}`);
  }

  // —— Warned storms heading for the field (storm motion in each NWS warning, as on NowWeather) ——————————
  async function loadStorms() {
    try {
      const d = await getJson(`${NWS}/alerts/active?status=actual&event=${encodeURIComponent("Tornado Warning,Severe Thunderstorm Warning,Extreme Wind Warning,Special Weather Statement")}`, { headers: { Accept: "application/geo+json" } });
      state.storms = d.features.map((x) => x.properties);
    } catch { /* keep the last list */ }
  }
  function stormMotion(a) {
    const m = (a.parameters?.eventMotionDescription || [])[0]?.match(/^(\S+?)\.\.\.(\w+)\.\.\.(\d+)DEG\.\.\.(\d+)KT\.\.\.(.+)$/);
    if (!m) return null;
    const pts = m[5].trim().split(/\s+/).map((ll) => ll.split(",").map(Number)).filter(([la, lo]) => isFinite(la) && isFinite(lo));
    const t = Date.parse(m[1]);
    if (!pts.length || !isFinite(t)) return null;
    return { t, kind: m[2], from: +m[3], kt: +m[4], pts };
  }
  const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
  /** When a warned storm reaches the field if it keeps its heading and speed (same method as NowWeather's My place). */
  function stormArrival(mo, p, now = Date.now()) {
    const kx = 111.32 * Math.cos((p.lat * Math.PI) / 180), ky = 110.57;
    const toward = ((mo.from + 180) * Math.PI) / 180;
    const u = [Math.sin(toward), Math.cos(toward)];
    const kmh = mo.kt * 1.852;
    const ac = mo.pts.map(([la, lo]) => {
      const dx = (lo - p.lon) * kx, dy = (la - p.lat) * ky;
      return { along: dx * u[0] + dy * u[1], cross: dx * u[1] - dy * u[0] };
    });
    let hit = null;
    for (let i = 0; i < ac.length - 1 && !hit; i++) {
      const [a, b] = [ac[i], ac[i + 1]];
      if ((a.cross <= 0 && b.cross >= 0) || (a.cross >= 0 && b.cross <= 0)) {
        const fr = a.cross === b.cross ? 0 : a.cross / (a.cross - b.cross);
        hit = { along: a.along + fr * (b.along - a.along), cross: 0 };
      }
    }
    if (!hit) hit = ac.reduce((best, c) => (Math.abs(c.cross) < Math.abs(best.cross) ? c : best));
    if (!kmh) return null;
    const eta = mo.t + (-hit.along / kmh) * 3600000;
    const side = hit.cross === 0 ? "" : compass((toward * 180) / Math.PI + (hit.cross > 0 ? 90 : -90));
    return { eta, missKm: Math.abs(hit.cross), side, minutes: (eta - now) / 60000, mph: Math.round(mo.kt * 1.15078), toward: compass((toward * 180) / Math.PI), line: mo.pts.length > 1 };
  }
  function approachingStorms(p) {
    const out = [];
    for (const a of state.storms) {
      const mo = stormMotion(a);
      if (!mo || kmBetween(p.lat, p.lon, mo.pts[0][0], mo.pts[0][1]) > 500) continue;
      const r = stormArrival(mo, p);
      if (!r || r.missKm > 24.1 || r.minutes < -15 || r.minutes > 180) continue;
      out.push({ a, mo, ...r });
    }
    return out.sort((x, y) => x.eta - y.eta);
  }
  function drawStormTracks() {
    layers.tracks.clearLayers();
    const p = state.field;
    if (!p) return;
    approachingStorms(p).forEach((s) => {
      const color = /Tornado/.test(s.a.event) ? "#ff2b2b" : "#ffa500";
      L.polyline(s.mo.pts.length > 1 ? s.mo.pts : [s.mo.pts[0], [p.lat, p.lon]], { pane: "points", color, weight: s.mo.pts.length > 1 ? 4 : 2, dashArray: s.mo.pts.length > 1 ? null : "6 6", opacity: 0.9 })
        .bindTooltip(`${esc(s.a.event)} · arrives about ${esc(fmt(p, s.eta, { hour: "numeric", minute: "2-digit" }))}`, { className: "tw-tip", sticky: true }).addTo(layers.tracks);
    });
  }

  // —— Today: spray check, conditions now, rain, alerts, storms ————————————————————————————
  /** Spray conditions for one hour: "go", "maybe" or "no", with reasons. */
  function sprayHour(f, h) {
    const no = [], maybe = [];
    const elev = WW.sunElevation(h.t + 1800e3, f.lat, f.lon);
    const wind = Math.round(h.wind ?? 0), gust = h.gust != null ? Math.round(h.gust) : null;
    if (wind > 10) no.push(`wind ${wind} mph`);
    else if (wind < 3) maybe.push(`calm ${wind} mph`);
    if (gust != null && gust > 20) no.push(`gusts ${gust}`);
    else if (gust != null && gust > 15) maybe.push(`gusts ${gust}`);
    // Surface inversions form on clear evenings and nights with light wind and last until the sun heats the ground.
    if ((elev < 0 && wind < 6 && (h.sky ?? 100) < 50) || (elev < 5 && wind < 5 && (h.sky ?? 100) < 40)) no.push("inversion likely");
    else if (elev < -0.833) maybe.push("dark");
    if (h.dt != null && h.dt > 18) no.push(`Delta T ${h.dt.toFixed(0)}`);
    else if (h.dt != null && h.dt > 14.4) maybe.push(`Delta T ${h.dt.toFixed(0)}`);
    else if (h.dt != null && h.dt < 3.6) maybe.push(`Delta T ${h.dt.toFixed(1)}`);
    if ((h.qpf ?? 0) > 0.005 || (h.pop ?? 0) > 40) no.push(`rain ${Math.round(h.pop ?? 0)}%`);
    else if ((h.pop ?? 0) > 20) maybe.push(`rain ${Math.round(h.pop)}%`);
    if (h.rainSoon) no.push("rain within 4 h");
    if (h.temp > 90) maybe.push(`${Math.round(h.temp)}°F`);
    return { s: no.length ? "no" : maybe.length ? "maybe" : "go", why: [...no, ...maybe] };
  }
  function sprayHours(f, days = 3) {
    const hrs = WW.workHours(f.grid, f.lat, f.lon, { after: 4 }, days);
    return hrs.filter((h) => !h.nodata).map((h) => ({ ...h, rainSoon: h.fail.some((x) => /^rain within/.test(x)), ...sprayHour(f, { ...h, rainSoon: h.fail.some((x) => /^rain within/.test(x)) }) }));
  }
  function verdictHtml(c, title, sub) { return `<div class="verdict" style="--c:${c}"><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}</div>`; }
  const stat = (label, value, small) => `<div class="stat"><span>${label}${small ? `<small>${small}</small>` : ""}</span><b>${value}</b></div>`;
  const COLORS = { go: "#3fcf9a", maybe: "#ffbf47", no: "#ff6b5a" };

  function todayView() {
    const f = state.field;
    let html = `<div class="pad">`;
    if (!f.grid) return html + `<p class="note">Loading the forecast for ${esc(f.name)}…</p></div>`;
    const hrs = sprayHours(f);
    if (!hrs.length) return html + `<p class="note">No forecast grid for this spot.</p></div>`;
    // Spray verdict: now, and the next run of good hours.
    const now = hrs[0];
    const runEnd = (i, ok) => { let j = i; while (j + 1 < hrs.length && ok(hrs[j + 1])) j++; return hrs[j].t + 3600e3; };
    const nextGo = hrs.findIndex((h, i) => i > 0 && h.s === "go" && WW.sunElevation(h.t + 1800e3, f.lat, f.lon) > -0.833);
    const later = nextGo > 0 ? `Next good hours: ${esc(dayHour(f, hrs[nextGo].t))}–${esc(hourLabel(f, runEnd(nextGo, (h) => h.s === "go")))}.` : "No good spray hours in the next 3 days.";
    if (now.s === "go") html += verdictHtml(COLORS.go, `Good to spray until ${esc(hourLabel(f, runEnd(0, (h) => h.s === "go")))}`, `Wind ${r0(now.wind)} mph${now.gust ? `, gusts ${r0(now.gust)}` : ""} ${now.dt != null ? ` · Delta T ${now.dt.toFixed(1)}°F` : ""} · ${r0(now.pop)}% rain chance.`);
    else if (now.s === "maybe") html += verdictHtml(COLORS.maybe, `Spray with care: ${esc(now.why.join(", "))}`, later);
    else html += verdictHtml(COLORS.no, `Don't spray now: ${esc(now.why.join(", "))}`, later);
    // Next 12 hours, then a 3-day strip.
    html += `<h5 class="sub">Spray check, next 12 hours</h5><table class="hrs"><thead><tr><th></th><th>Wind</th><th>ΔT °F</th><th>Rain</th><th>°F</th><th></th></tr></thead><tbody>${hrs.slice(0, 12).map((h) =>
      `<tr><td>${esc(hourLabel(f, h.t))}</td><td>${r0(h.wind)}${h.gust ? `<span class="dim"> g${r0(h.gust)}</span>` : ""}</td><td>${h.dt == null ? "—" : h.dt.toFixed(1)}</td><td>${r0(h.pop)}%</td><td>${r0(h.temp)}</td><td><span class="pill ${h.s}">${h.s === "go" ? "Go" : h.s === "maybe" ? "Care" : "No"}</span> ${esc(h.why.join(", "))}</td></tr>`).join("")}</tbody></table>`;
    html += stripHtml(f, hrs, (h) => (h.s === "go" ? "ok" : h.s), (h) => (h.why.length ? h.why.join(", ") : "good"));
    html += `<p class="chart-key"><span style="color:#3fcf9a">▮</span> good <span style="color:#ffbf47">▮</span> with care <span style="color:#ff6b5a">▮</span> don't spray. Wind is the sustained forecast at 33 ft; Delta T is air minus wet-bulb temperature. Inversions are likely on clear nights under 6 mph and near sunrise or sunset under 5 mph. <a href="#" data-gojob="spray">Spray windows for 7 days</a></p>`;

    // Frost risk in the next 36 hours.
    const nextLow = hrs.slice(0, 36).reduce((m, h) => (h.temp < (m?.temp ?? 999) ? h : m), null);
    const crop = cropOf(f), crit = FROST[crop.key]?.[0]?.[1] ?? 32;
    html += `<h5 class="sub" style="margin-top:1rem">Conditions</h5>`;
    const o = f.obs;
    html += o ? stat("Now", `${r0(o.temp)}°F`, `${esc(o.name)} (${o.id}), ${mi(o.km)} mi · dew point ${r0(o.dew)}° · wind ${o.dir != null ? compass(o.dir) + " " : ""}${r0(o.wind)} mph${o.gust ? `, gusts ${r0(o.gust)}` : ""} · ${esc(fmt(f, o.t, { hour: "numeric", minute: "2-digit" }))}`) : "";
    if (nextLow) html += stat("Low, next 36 h", `${r0(nextLow.temp)}°F`, `${esc(dayHour(f, nextLow.t))}${nextLow.temp <= crit ? ` · <b style="color:#ff6b5a">at or below ${crit}°F</b>, frost protection may be needed` : nextLow.temp <= crit + 4 ? ` · within ${Math.ceil(nextLow.temp - crit)}° of frost damage (${crit}°F)` : ""}`);
    const r = f.rain;
    html += r ? stat("Rain, last 24 h", r.d1 == null ? "—" : `${r.d1.toFixed(2)}"`, `7 days ${r.d7 == null ? "—" : r.d7.toFixed(2) + '"'} · 30 days ${r.d30 == null ? "—" : r.d30.toFixed(2) + '"'}${r.pct30 != null ? ` (${Math.round(r.pct30)}% of normal)` : ""} · NWS precipitation analysis, to 12Z today`) : stat("Rain", "—", "Precipitation analysis unavailable");
    let rain7 = 0;
    for (let t = hrs[0].t; t < hrs[0].t + 7 * 86400e3; t += 3600e3) rain7 += f.grid.qpf?.get(t) ?? 0;
    html += stat("Rain, next 7 days", `${rain7.toFixed(2)}"`, "NWS forecast");
    // Alerts and storms.
    html += `<h5 class="sub" style="margin-top:1rem">Alerts</h5>`;
    if (f.alerts == null) html += `<p class="note">Alerts unavailable.</p>`;
    else if (!f.alerts.length) html += stat("Alerts", "None", "No NWS watches, warnings or advisories in effect here");
    else html += f.alerts.map((a) => stat(`<i class="dot" style="background:${/Warning/.test(a.event) ? "#ff6b5a" : /Watch/.test(a.event) ? "#ffbf47" : "#7cb8ff"}"></i>${esc(a.event)}`, "", `${esc(a.senderName?.replace("NWS ", "") || "")} · until ${esc(dayHour(f, a.ends || a.expires))} · ${esc(a.headline || "")}`)).join("");
    const storms = approachingStorms(f);
    html += storms.length ? storms.map((s) => stat(`${s.minutes < 0 ? "Storm passed" : s.line ? "Line of storms arrives" : "Storm arrives"}<small>${esc(s.a.event)} · moving ${s.toward} at ${s.mph} mph${s.missKm >= 1.6 ? ` · passes ${mi(s.missKm)} mi to the ${s.side}` : " · on a direct path"}</small>`, s.minutes < 0 ? `${Math.round(-s.minutes)} min ago` : esc(fmt(f, s.eta, { hour: "numeric", minute: "2-digit" })), "")).join("")
      : stat("Storms heading here", "None", "No warned storm is on course to pass within 15 mi in the next 3 hours");
    html += `<p class="note"><a href="/NowWeather/?loc=${f.lat.toFixed(4)},${f.lon.toFixed(4)}">Watch this field live on NowWeather</a> · <a href="${esc(`https://forecast.weather.gov/MapClick.php?lat=${f.lat.toFixed(4)}&lon=${f.lon.toFixed(4)}`)}" target="_blank" rel="noopener">NWS forecast ↗</a></p></div>`;
    return html;
  }

  /** Day-by-hour strip, one row per local day. */
  function stripHtml(f, hrs, cls, title) {
    const days = [];
    hrs.forEach((h) => { const k = fmt(f, h.t, { weekday: "short", month: "numeric", day: "numeric" }); (days.at(-1)?.k === k ? days.at(-1) : (days.push({ k, hrs: [] }), days.at(-1))).hrs.push(h); });
    return `<div class="strip">${days.map((d) => `<div class="strip__row"><span>${esc(d.k)}</span><div>${Array.from({ length: 24 }, (_, i) => {
      const h = d.hrs.find((x) => +fmt(f, x.t, { hour: "numeric", hourCycle: "h23" }) === i);
      return h ? `<i class="${cls(h)}" title="${esc(dayHour(f, h.t))}: ${esc(title(h))}"></i>` : `<i class="na"></i>`;
    }).join("")}</div></div>`).join("")}
      <div class="strip__row"><span></span><div class="strip__ticks"><b>12a</b><b>6a</b><b>12p</b><b>6p</b></div></div></div>`;
  }

  // —— Work windows ————————————————————————————————————————————————————
  function jobSummary(w) {
    const L = (k) => lim(w[k]);
    return [L("tmin") != null && L("tmax") != null ? `${L("tmin")}–${L("tmax")}°F` : L("tmin") != null ? `${L("tmin")}°F+` : L("tmax") != null ? `≤ ${L("tmax")}°F` : "",
      L("wmin") != null && L("wind") != null ? `wind ${L("wmin")}–${L("wind")}` : L("wind") != null ? `wind ≤ ${L("wind")}` : L("wmin") != null ? `wind ≥ ${L("wmin")}` : "",
      L("gust") != null ? `gusts ≤ ${L("gust")}` : "", L("pop") != null ? `precip ≤ ${L("pop")}%` : "", L("rh") != null ? `humidity ≤ ${L("rh")}%` : "",
      L("thunder") != null ? `thunder ≤ ${L("thunder")}%` : "", L("dtmin") != null || L("dtmax") != null ? `Delta T ${L("dtmin") ?? 0}–${L("dtmax") ?? "∞"}` : "",
      L("after") ? `dry ${L("after")} h after` : "", w.day ? "daylight" : "", L("hours") ? `${L("hours")}+ h` : ""].filter(Boolean).join(" · ") || "none";
  }
  function windowsView() {
    const f = state.field, w = state.job;
    let html = `<div class="pad"><p class="note" style="margin-top:0">The hours in the next 7 days when the forecast meets a job's weather limits.</p>
      <div class="chips" role="group" aria-label="Job">${Object.entries(JOBS).map(([k, v]) => `<button data-job="${k}" aria-pressed="${k === w.preset}">${esc(v.name)}</button>`).join("")}</div>`;
    const crop = cropOf(f);
    if (w.frost) {
      const stages = FROST[crop.key] || FROST.custom;
      const crit = w.crit ?? stages[0][1];
      html += `<form id="limits" class="limits"><label class="wide">${esc(crop.name)}: stage and critical temperature<select name="stage">${stages.map(([n, t]) => `<option value="${t}"${t === crit ? " selected" : ""}>${esc(n)} · ${t}°F</option>`).join("")}<option value="custom"${stages.some(([, t]) => t === crit) ? "" : " selected"}>Other</option></select></label>
        <label>Critical temp °F<input name="crit" inputmode="decimal" value="${esc(crit)}" /></label></form><p class="note">${esc(JOBS.frost.note)} Change the crop on the Season tab. Critical temperatures are rough 10%-damage points; buds that have been cold-hardened tolerate more.</p></div>`;
      if (!f.grid) return html + `<p class="empty">Loading the forecast…</p>`;
      const hrs = WW.workHours(f.grid, f.lat, f.lon, {}, 7).filter((h) => !h.nodata);
      const cold = hrs.filter((h) => h.temp <= crit);
      // Nights: runs of hours at or below the critical temperature, merged when under 3 hours apart.
      const runs = [];
      cold.forEach((h) => { const last = runs.at(-1); if (last && h.t - last.end <= 3 * 3600e3) { last.end = h.t + 3600e3; last.hrs.push(h); } else runs.push({ start: h.t, end: h.t + 3600e3, hrs: [h] }); });
      html += `<div class="pad" style="padding-top:0"><h5 class="sub">${esc(f.name)} · next 7 days</h5>`;
      html += runs.length ? `<table class="t"><tbody>${runs.map((r) => `<tr><td><b style="color:#fff">${esc(dayHour(f, r.start))}–${esc(hourLabel(f, r.end))}</b><small>${r.hrs.length} h at or below ${crit}°F · low ${r0(Math.min(...r.hrs.map((h) => h.temp)))}°F · wind ${r0(Math.min(...r.hrs.map((h) => h.wind ?? 0)))}–${r0(Math.max(...r.hrs.map((h) => h.wind ?? 0)))} mph</small></td></tr>`).join("")}</tbody></table>`
        : verdictHtml(COLORS.go, `No hours at or below ${crit}°F forecast`, `Lowest: ${r0(Math.min(...hrs.map((h) => h.temp)))}°F.`);
      html += stripHtml(f, hrs, (h) => (h.temp <= crit ? "no" : h.temp <= crit + 3 ? "maybe" : "ok"), (h) => `${r0(h.temp)}°F`);
      html += `<p class="chart-key"><span style="color:#ff6b5a">▮</span> at or below ${crit}°F <span style="color:#ffbf47">▮</span> within 3° <span style="color:#3fcf9a">▮</span> warmer. Forecast air temperature at 2 m; on clear, calm nights low spots and bud level can run several degrees colder.</p></div>`;
      return html;
    }
    html += `<details class="limits-box"${state.jobOpen ? " open" : ""}><summary>Limits: ${esc(jobSummary(w))}</summary>
      <form id="limits" class="limits">${JOB_FIELDS.map(([k, label]) => `<label>${label}<input name="${k}" inputmode="decimal" value="${esc(w[k] ?? "")}" placeholder="any" /></label>`).join("")}
        <label class="day"><input type="checkbox" name="day"${w.day ? " checked" : ""} /> Daylight only</label></form></details>
      ${JOBS[w.preset].note ? `<p class="note">${esc(JOBS[w.preset].note)}</p>` : ""}${w.preset === "plant" ? soilHtml(f) : ""}</div>`;
    if (!f.grid) return html + `<p class="empty">Loading the forecast for ${esc(f.name)}…</p>`;
    if (!f.ens) loadEns(f);
    const hours = WW.workHours(f.grid, f.lat, f.lon, w);
    if (hours.every((h) => h.nodata)) return html + `<p class="empty">No forecast grid for this spot.</p>`;
    const wins = WW.workWindows(hours, lim(w.hours));
    const span = (r) => `${dayHour(f, r.start)}–${fmt(f, r.end, { hour: "numeric", timeZoneName: "short" })}`;
    const why = {};
    hours.forEach((h) => h.fail.filter((x) => x !== "dark").forEach((x) => { const k = x.replace(/[\d.]+(°F|%|"| h)?\s*/g, "").trim() || "temperature"; why[k] = (why[k] || 0) + 1; }));
    const ok = hours.filter((h) => !h.fail.length).length;
    html += `<div class="pad" style="padding-top:0"><h5 class="sub">${esc(f.name)} · next 7 days</h5>`;
    html += wins.length
      ? `<table class="t"><tbody>${wins.map((r) => { const odds = f.ens?.tmax ? WW.ensWindowOdds(f.ens, w, r) : null; return `<tr><td><b style="color:#fff">${esc(span(r))}</b>${odds ? `<span class="odds" title="GEFS ensemble members that keep this window within the temperature, wind and rain limits">${odds.ok} of ${odds.n} members agree</span>` : ""}<small>${r.hrs.length} h · ${r0(Math.min(...r.hrs.map((h) => h.temp)))}–${r0(Math.max(...r.hrs.map((h) => h.temp)))}°F · wind ${r0(Math.min(...r.hrs.map((h) => h.wind ?? 0)))}–${r0(Math.max(...r.hrs.map((h) => h.wind ?? 0)))} mph · precip ≤ ${r0(Math.max(...r.hrs.map((h) => h.pop ?? 0)))}%${r.hrs.some((h) => h.dt != null) && (lim(w.dtmin) != null || lim(w.dtmax) != null) ? ` · Delta T ${Math.min(...r.hrs.map((h) => h.dt ?? 99)).toFixed(1)}–${Math.max(...r.hrs.map((h) => h.dt ?? 0)).toFixed(1)}°F` : ""}</small></td></tr>`; }).join("")}</tbody></table>`
      : `<p class="note"><b>No window of ${lim(w.hours) || 1}+ hours</b> meets these limits in the next 7 days.</p>`;
    html += stripHtml(f, hours, (h) => (h.nodata ? "na" : h.fail.length ? (h.fail.length === 1 && h.fail[0] === "dark" ? "dark" : "no") : "ok"), (h) => (h.fail.length ? h.fail.join(", ") : "OK"));
    html += `<p class="chart-key"><span style="color:#3fcf9a">▮</span> meets limits <span style="color:#ff6b5a">▮</span> doesn't <span style="color:rgba(255,255,255,.25)">▮</span> dark. Hover an hour for the reason.</p>
      <p class="note">${ok} of ${hours.length} hours qualify.${Object.keys(why).length ? ` Most often ruled out by ${Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${esc(k)} (${n} h)`).join(", ")}.` : ""}
        From the NWS forecast grid.${f.ens?.tmax ? " “Members agree” counts the GEFS ensemble's 31 runs that stay within the temperature, wind and rain limits over the window's 6-hour steps." : ""} Winds are sustained at 33 ft; timing gets less certain after 3 days.
        <button class="linkish" data-share="1">Copy link</button></p></div>`;
    return html;
  }
  async function loadEns(f) {
    if (f.ens) return;
    f.ens = "loading";
    try { f.ens = (await WW.ensAt(f.lat, f.lon)) || {}; } catch { f.ens = {}; }
    if (state.field === f && state.view === "windows") render();
  }

  // —— Season: GDD, rain, frost dates and chill hours from PRISM daily grids (RCC ACIS) ————————————
  const NORMAL_YEARS = [1991, 2020];
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3);
  async function acisDaily(f, sdate, edate) {
    const res = await fetch(`${ACIS}/GridData`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loc: `${f.lon.toFixed(4)},${f.lat.toFixed(4)}`, sdate, edate, grid: "21", elems: [{ name: "maxt" }, { name: "mint" }, { name: "pcpn" }] }) });
    if (!res.ok) throw new Error(`ACIS ${res.status}`);
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    return d.data.map(([date, x, n, p]) => [date, x === -999 ? null : x, n === -999 ? null : n, p === -999 ? null : p]);
  }
  /** 1991–2020 daily highs, lows and rain at the field, cached in this browser (about 150 KB per spot). */
  async function normals(f) {
    const key = `sw-farm-normals:${f.lat.toFixed(2)},${f.lon.toFixed(2)}`;
    try { const c = JSON.parse(localStorage.getItem(key) || "null"); if (c?.v === 1) return c.days; } catch { /* none */ }
    const [y0, y1] = NORMAL_YEARS, parts = [];
    for (let y = y0; y <= y1; y += 10) parts.push([`${y}-01-01`, `${Math.min(y + 9, y1)}-12-31`]);
    const days = (await Promise.all(parts.map(([a, b]) => acisDaily(f, a, b)))).flat();
    try { localStorage.setItem(key, JSON.stringify({ v: 1, days })); } catch { /* full or private mode: refetch next time */ }
    return days;
  }
  function gddDay(x, n, base, cap) {
    if (x == null || n == null) return null;
    const c = (v) => Math.max(base, cap != null ? Math.min(cap, v) : v);
    return Math.max(0, (c(x) + c(n)) / 2 - base);
  }
  /** Hours above 32°F and at or below 45°F, estimated from the day's high and low (low at 6 am, high at 3 pm). */
  function chillDay(x, n) {
    if (x == null || n == null) return null;
    let c = 0;
    for (let h = 0; h < 24; h++) {
      const t = h >= 6 && h <= 15 ? n + (x - n) * (1 - Math.cos((Math.PI * (h - 6)) / 9)) / 2 : x - (x - n) * (1 - Math.cos((Math.PI * (h >= 15 ? h - 15 : h + 9)) / 15)) / 2;
      if (t > 32 && t <= 45) c++;
    }
    return c;
  }
  const pctl = (arr, p) => { const a = arr.filter((v) => v != null).sort((x, y) => x - y); if (!a.length) return null; const i = (a.length - 1) * p, lo = Math.floor(i); return a[lo] + (a[Math.min(a.length - 1, lo + 1)] - a[lo]) * (i - lo); };

  function cropOf(f) {
    const key = CROPS[f?.crop] ? f.crop : "corn";
    const c = CROPS[key];
    return { key, ...c, base: f?.base ?? c.base, cap: f?.cap !== undefined ? f.cap : c.cap };
  }
  /** The season start: the field's planting date, or the crop's usual date this year (last year if it's still ahead). */
  function seasonStart(f) {
    if (f.planted) return f.planted;
    const today = iso(new Date()), y = +today.slice(0, 4), md = cropOf(f).start;
    return `${y}-${md}` <= today ? `${y}-${md}` : `${y - 1}-${md}`;
  }

  async function loadSeason(f) {
    if (f.season && f.season.key === seasonKey(f)) return;
    const key = seasonKey(f);
    f.season = { key, loading: true };
    render();
    try {
      const today = iso(new Date()), y = +today.slice(0, 4);
      const from = `${y - 1}-01-01`;
      const [cur, norm] = await Promise.all([acisDaily(f, from, addDays(today, -1)), normals(f)]);
      if (f.season.key !== key) return;
      f.season = { key, cur, norm };
    } catch (e) {
      if (f.season.key === key) f.season = { key, error: `Season data didn't load (${e.message}). PRISM covers the lower 48 states.` };
    }
    if (state.field === f && state.view === "season") render();
  }
  const seasonKey = (f) => `${f.lat},${f.lon},${iso(new Date())}`;

  function seasonView() {
    const f = state.field, crop = cropOf(f), start = seasonStart(f);
    let html = `<form class="form" id="cropform"><div class="row2"><label>Crop<select name="crop">${[...new Set(Object.values(CROPS).map((c) => c.group))].map((g) => `<optgroup label="${esc(g)}">${Object.entries(CROPS).filter(([, c]) => c.group === g).map(([k, c]) => `<option value="${k}"${k === crop.key ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</optgroup>`).join("")}</select></label>
      <label>Planted or season start<input type="date" name="planted" value="${esc(start)}" /></label></div>
      <div class="row2"><label>GDD base °F<input name="base" inputmode="decimal" value="${esc(crop.base)}" /></label><label>Upper cap °F<input name="cap" inputmode="decimal" value="${esc(crop.cap ?? "")}" placeholder="none" /></label></div></form>`;
    if (!f.season || f.season.key !== seasonKey(f)) { loadSeason(f); return html + `<p class="empty">Loading PRISM daily data for ${esc(f.name)}… The first look at a spot takes about 20 seconds while 30 years of normals load.</p>`; }
    if (f.season.loading) return html + `<p class="empty">Loading PRISM daily data for ${esc(f.name)}… The first look at a spot takes about 20 seconds while 30 years of normals load.</p>`;
    if (f.season.error) return html + `<p class="empty">${esc(f.season.error)}</p>`;
    const { cur, norm } = f.season;
    const today = iso(new Date());
    const byDate = new Map(cur.map((d) => [d[0], d]));
    const normBy = new Map(norm.map((d) => [d[0], d]));
    const lastObs = [...cur].reverse().find((d) => d[1] != null)?.[0];
    if (start > today) return html + `<p class="empty">The season start is in the future. Pick a date this year to compare with normal.</p>`;
    const nDays = daysBetween(start, lastObs || today) + 1;
    // This season, day by day.
    let g = 0, p = 0;
    const series = [];
    for (let i = 0; i < nDays; i++) {
      const d = byDate.get(addDays(start, i));
      g += gddDay(d?.[1], d?.[2], crop.base, crop.cap) ?? 0;
      p += d?.[3] ?? 0;
      series.push({ g, p });
    }
    // Forecast GDD for the next 7 days from the NWS grid's daily highs and lows.
    const fc = [];
    if (f.grid?.temp?.size) {
      const daysF = new Map();
      for (const [t, v] of f.grid.temp) { const k = fmt(f, t, { year: "numeric", month: "2-digit", day: "2-digit" }); const [mm, dd, yy] = k.split("/"); const key2 = `${yy}-${mm}-${dd}`; if (key2 < today) continue; const e = daysF.get(key2) || daysF.set(key2, { x: -999, n: 999, c: 0 }).get(key2); e.x = Math.max(e.x, v); e.n = Math.min(e.n, v); e.c++; }
      let acc = g;
      [...daysF.entries()].filter(([, e]) => e.c >= 20).slice(0, 7).forEach(([k, e]) => { acc += gddDay(e.x, e.n, crop.base, crop.cap); fc.push({ k, g: acc }); });
    }
    // Normal: the same calendar span in each year 1991–2020.
    const md0 = start.slice(5), years = [];
    for (let y = NORMAL_YEARS[0]; y <= NORMAL_YEARS[1]; y++) {
      const s = md0 === "02-29" ? `${y}-03-01` : `${y}-${md0}`;
      let gg = 0, pp = 0;
      const ys = [];
      for (let i = 0; i < nDays + fc.length + 60; i++) { const d = normBy.get(addDays(s, i)); gg += gddDay(d?.[1], d?.[2], crop.base, crop.cap) ?? 0; pp += d?.[3] ?? 0; ys.push({ g: gg, p: pp }); }
      years.push(ys);
    }
    const at = (i, k, q) => pctl(years.map((ys) => ys[i]?.[k]), q);
    const avg = (i, k) => { const v = years.map((ys) => ys[i]?.[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const gNow = series.at(-1).g, gNorm = avg(nDays - 1, "g"), pNow = series.at(-1).p, pNorm = avg(nDays - 1, "p");
    const ahead = gNorm ? gNow - gNorm : 0;
    // About how many days ahead or behind: the day the normal curve reaches this season's total.
    let dayEq = null;
    for (let i = 0; i < nDays + fc.length + 60; i++) if ((avg(i, "g") ?? 0) >= gNow) { dayEq = i; break; }
    const shift = dayEq != null ? nDays - 1 - dayEq : null;
    html += `<div class="pad"><h5 class="sub">${esc(crop.name)} · since ${esc(fmtDate(start))} · base ${crop.base}°F${crop.cap != null ? `, cap ${crop.cap}°F` : ""}</h5>
      ${verdictHtml(Math.abs(ahead) < 0.05 * (gNorm || 1) ? "#4ad1ff" : ahead > 0 ? "#ffbf47" : "#7cb8ff", `${Math.round(gNow).toLocaleString()} growing degree days, ${Math.abs(Math.round(ahead)).toLocaleString()} ${ahead >= 0 ? "above" : "below"} normal`, `${shift != null && Math.abs(shift) >= 1 ? `About ${Math.abs(shift)} day${Math.abs(shift) === 1 ? "" : "s"} ${shift > 0 ? "ahead of" : "behind"} a normal season. ` : ""}Through ${esc(fmtDate(lastObs))}.${fc.length ? ` Forecast to reach ${Math.round(fc.at(-1).g).toLocaleString()} by ${esc(fmtDate(fc.at(-1).k))}.` : ""}`)}
      ${seasonChart(series, fc, years.length ? Array.from({ length: nDays + fc.length }, (_, i) => [at(i, "g", 0.1), avg(i, "g"), at(i, "g", 0.9)]) : [], "g", start)}
      <p class="chart-key"><span style="color:#ffbf47">━</span> this season <span style="color:#ffbf47">┅</span> NWS forecast <span style="color:rgba(255,255,255,.6)">━</span> 1991–2020 average <span style="color:rgba(255,255,255,.25)">▮</span> 10–90% of years</p>
      ${crop.note ? `<p class="note">${esc(crop.note)}</p>` : ""}
      <h5 class="sub" style="margin-top:1rem">Rain since ${esc(fmtDate(start))}</h5>
      <div class="cmp"><div><b>${pNow.toFixed(1)}"</b><small>this season</small></div><div><b>${pNorm == null ? "—" : pNorm.toFixed(1) + '"'}</b><small>normal</small></div><div><b>${pNorm ? Math.round((pNow / pNorm) * 100) + "%" : "—"}</b><small>of normal</small></div></div>
      ${seasonChart(series, [], Array.from({ length: nDays }, (_, i) => [at(i, "p", 0.1), avg(i, "p"), at(i, "p", 0.9)]), "p", start)}
      <p class="chart-key"><span style="color:#4ad1ff">━</span> this season <span style="color:rgba(255,255,255,.6)">━</span> 1991–2020 average <span style="color:rgba(255,255,255,.25)">▮</span> 10–90% of years (in)</p>`;
    html += `<h5 class="sub" style="margin-top:1rem">Soil</h5>${soilHtml(f)}`;
    html += frostHtml(f, cur, norm, today);
    if (crop.fruit) html += chillHtml(cur, norm, today);
    html += `<p class="note">From PRISM daily highs, lows and rain (about 4 km) via the Applied Climate Information System. PRISM runs a day or two behind. Normals are the 1991–2020 average for the same dates at this spot.</p></div>`;
    return html;
  }

  function seasonChart(series, fc, band, k, start) {
    const W = 336, H = 150, L0 = 38, R0 = 8, T0 = 8, B0 = 18, n = Math.max(series.length + fc.length, 2);
    const vals = [...series.map((s) => s[k]), ...fc.map((s) => s.g), ...band.map((b) => b[2] ?? 0)];
    const hi = Math.max(1, ...vals) * 1.05;
    const step = k === "p" ? (hi > 20 ? 10 : hi > 8 ? 4 : 1) : [100, 200, 500, 1000].find((s) => hi / s <= 6) || 1000;
    const x = (i) => L0 + (i / (n - 1)) * (W - L0 - R0), y = (v) => T0 + (1 - v / hi) * (H - T0 - B0);
    const mono = 'font-family="IBM Plex Mono, monospace" font-size="9" fill="rgba(255,255,255,.42)"';
    let svg = "";
    for (let v = 0; v <= hi; v += step) svg += `<line x1="${L0}" x2="${W - R0}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.07)"/><text x="${L0 - 4}" y="${y(v) + 3}" text-anchor="end" ${mono}>${v.toLocaleString()}${k === "p" ? '"' : ""}</text>`;
    // Month ticks.
    for (let i = 0; i < n; i++) { const d = addDays(start, i); if (d.endsWith("-01")) svg += `<line x1="${x(i)}" x2="${x(i)}" y1="${T0}" y2="${H - B0}" stroke="rgba(255,255,255,.08)"/><text x="${x(i) + 2}" y="${H - 5}" ${mono}>${new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}</text>`; }
    if (band.length) {
      const up = band.map((b, i) => `${x(i).toFixed(1)},${y(b[2] ?? 0).toFixed(1)}`), dn = band.map((b, i) => `${x(i).toFixed(1)},${y(b[0] ?? 0).toFixed(1)}`).reverse();
      svg += `<polygon points="${[...up, ...dn].join(" ")}" fill="rgba(255,255,255,.08)"/><polyline fill="none" stroke="rgba(255,255,255,.6)" stroke-width="1.2" points="${band.map((b, i) => `${x(i).toFixed(1)},${y(b[1] ?? 0).toFixed(1)}`).join(" ")}"/>`;
    }
    const color = k === "p" ? "#4ad1ff" : "#ffbf47";
    svg += `<polyline fill="none" stroke="${color}" stroke-width="2" points="${series.map((s, i) => `${x(i).toFixed(1)},${y(s[k]).toFixed(1)}`).join(" ")}"/>`;
    if (fc.length) svg += `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="3 3" points="${[[series.length - 1, series.at(-1).g], ...fc.map((s, j) => [series.length + j, s.g])].map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}"/>`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${k === "p" ? "Rain" : "Growing degree days"} since the season start against normal">${svg}</svg>`;
  }

  /** Last spring and first fall freeze, this year and in 1991–2020 (median and the 10% / 90% dates). */
  function frostHtml(f, cur, norm, today) {
    const y = +today.slice(0, 4);
    const doy = (s) => daysBetween(`${s.slice(0, 4)}-01-01`, s);
    const fromDoy = (d) => new Date(Date.UTC(2021, 0, 1 + Math.round(d))).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const freezeDates = (days, yr, th) => {
      let last = null, first = null;
      for (const [d, , n] of days) {
        if (n == null || +d.slice(0, 4) !== yr || n > th) continue;
        if (d.slice(5) < "07-15") last = d;
        else if (!first) first = d;
      }
      return { last, first };
    };
    const row = (th) => {
      const yrs = [];
      for (let yy = NORMAL_YEARS[0]; yy <= NORMAL_YEARS[1]; yy++) yrs.push(freezeDates(norm, yy, th));
      const lastD = yrs.map((r) => (r.last ? doy(r.last) : null)), firstD = yrs.map((r) => (r.first ? doy(r.first) : null));
      const noSpring = lastD.filter((v) => v == null).length, noFall = firstD.filter((v) => v == null).length;
      const now = freezeDates(cur, y, th);
      const season = now.first && now.last ? daysBetween(now.last, now.first) : null;
      return `<tr><td><b style="color:#fff">${th}°F</b></td>
        <td>${now.last ? esc(fmtDate(now.last)) : "none"}<small>normal ${noSpring > 15 ? "rare" : `${fromDoy(pctl(lastD, 0.5))} · 1 in 10 after ${fromDoy(pctl(lastD, 0.9))}`}</small></td>
        <td>${now.first ? esc(fmtDate(now.first)) : today.slice(5) >= "07-15" ? "not yet" : "—"}<small>normal ${noFall > 15 ? "rare" : `${fromDoy(pctl(firstD, 0.5))} · 1 in 10 before ${fromDoy(pctl(firstD, 0.1))}`}</small></td></tr>${season ? `<tr><td></td><td colspan="2"><small>${season} frost-free days this year</small></td></tr>` : ""}`;
    };
    return `<h5 class="sub" style="margin-top:1rem">Frost dates, ${y}</h5>
      <table class="t"><thead><tr><th>Low at or below</th><th>Last in spring</th><th>First in fall</th></tr></thead><tbody>${row(32)}${row(28)}</tbody></table>
      <p class="chart-key">PRISM daily lows. Normals from 1991–2020; “1 in 10” dates are the 10% and 90% points.</p>`;
  }

  /** Chill hours (32–45°F) since October 1 against 1991–2020. */
  function chillHtml(cur, norm, today) {
    const y = +today.slice(0, 4), m = +today.slice(5, 7);
    const s = m >= 10 ? `${y}-10-01` : `${y - 1}-10-01`;
    const n = daysBetween(s, today);
    let c = 0;
    const byDate = new Map(cur.map((d) => [d[0], d]));
    let through = null;
    for (let i = 0; i < n; i++) { const d = byDate.get(addDays(s, i)); const v = chillDay(d?.[1], d?.[2]); if (v != null) { c += v; through = d[0]; } }
    const normBy = new Map(norm.map((d) => [d[0], d]));
    const tot = [], toDate = [];
    for (let yy = NORMAL_YEARS[0]; yy < NORMAL_YEARS[1]; yy++) {
      let a = 0, b = 0;
      for (let i = 0; i < 182; i++) { const d = normBy.get(addDays(`${yy}-10-01`, i)); const v = chillDay(d?.[1], d?.[2]) ?? 0; a += v; if (i < n) b += v; }
      tot.push(a); toDate.push(b);
    }
    const avg = (a) => a.reduce((p, q) => p + q, 0) / a.length;
    return `<h5 class="sub" style="margin-top:1rem">Chill hours since ${esc(fmtDate(s))}</h5>
      <div class="cmp"><div><b>${Math.round(c).toLocaleString()}</b><small>so far${through ? `, to ${esc(fmtDate(through).replace(/, \d{4}$/, ""))}` : ""}</small></div><div><b>${Math.round(avg(toDate)).toLocaleString()}</b><small>normal to date</small></div><div><b>${Math.round(avg(tot)).toLocaleString()}</b><small>normal by Apr 1</small></div></div>
      <p class="chart-key">Hours above 32°F and at or below 45°F, estimated from daily highs and lows. Apples typically need 800–1,200 chill hours, peaches 400–1,000, and many grapes 100–500.</p>`;
  }

  // —— Map tab: the layers in words, and what they say at the field ——————————————————————
  async function loadOutlookAt(f) {
    if (f.cpc) return;
    f.cpc = "loading";
    const q = (i) => getJson(`${cpcBase(i)}/${CPC[i][1]}/query?geometry=${f.lon},${f.lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=prob,cat&returnGeometry=false&f=json`)
      .then((d) => d.features?.[0]?.attributes || null).catch(() => null);
    f.cpc = await Promise.all([0, 1, 2, 3].map(q));
    if (state.field === f && state.view === "map") render();
  }
  function mapView() {
    const f = state.field;
    loadOutlookAt(f);
    if (!state.drought) loadDrought().then(() => { if (state.view === "map") render(); }).catch(() => {});
    const dm = droughtAt(f.lat, f.lon);
    const cpcText = (a) => (!a ? "—" : /Near/i.test(a.cat) || !a.prob ? "near normal" : `${Math.round(a.prob)}% ${a.cat.toLowerCase()}`);
    let html = `<div class="pad"><h5 class="sub">At ${esc(f.name)}</h5>`;
    html += stat("Drought Monitor", dm == null ? "…" : dm < 0 ? "None" : `<i class="dm" style="background:${DM[dm][2]}"></i>${DM[dm][0]}`, dm == null ? "Loading" : `${dm < 0 ? "Not in drought or abnormally dry" : DM[dm][1]} · valid ${esc(fmtDate(state.drought.valid))}`);
    if (f.rain?.pct30 != null) html += stat("Rain, last 30 days", `${Math.round(f.rain.pct30)}%`, `of normal · ${f.rain.d30?.toFixed(2) ?? "—"}" fell`);
    if (Array.isArray(f.cpc)) {
      html += stat("Days 6–10", "", `Temperature: ${esc(cpcText(f.cpc[0]))} · precipitation: ${esc(cpcText(f.cpc[1]))}`);
      html += stat("Days 8–14", "", `Temperature: ${esc(cpcText(f.cpc[2]))} · precipitation: ${esc(cpcText(f.cpc[3]))}`);
    }
    html += `<h5 class="sub" style="margin-top:1rem">Map layers</h5>
      <div class="checks">${[["radar", "Radar"], ["alerts", "Watches & warnings"], ["drought", "Drought Monitor"], ["soil", "Soil moisture"]].map(([k, n]) => `<label><input type="checkbox" data-layer="${k}"${state.on[k] ? " checked" : ""} /> ${n}</label>`).join("")}</div>
      <div class="satpick" data-pick="rain"><span>Rainfall</span>${[["off", "Off"], ["d1", "24 h"], ["d7", "7 days"], ["d30", "30 days"], ["pct30", "% of normal"]].map(([v, n]) => `<button data-v="${v}" aria-pressed="${state.rain === v}">${n}</button>`).join("")}</div>
      <div class="satpick" data-pick="cpc"><span>Outlook</span>${[["off", "Off"], ["0", "6–10 temp"], ["1", "6–10 rain"], ["2", "8–14 temp"], ["3", "8–14 rain"]].map(([v, n]) => `<button data-v="${v}" aria-pressed="${state.cpc === v}">${n}</button>`).join("")}</div>
      <p class="note">Rainfall is the NWS precipitation analysis (radar adjusted to gauges), updated each morning. Soil moisture is NASA's SMAP root-zone estimate (about the top 3 ft), a day or two behind. The Drought Monitor comes out on Thursdays. Outlooks are the Climate Prediction Center's chances of above or below normal.</p></div>`;
    return html;
  }

  // —— Fields: the bar, the add/edit form, markers ————————————————————————————
  function fieldbarHtml() {
    if (!state.fields.length && !state.field) return `<button class="btn" data-addfield="1" style="min-height:2rem;padding:0 .8rem;font-size:.82rem;border-radius:6px;box-shadow:none">Add a field</button><span class="dim" style="font-size:.78rem">or click the map</span>`;
    const opts = state.fields.map((x) => `<option value="${esc(x.id)}"${state.field?.id === x.id ? " selected" : ""}>${esc(x.name)}</option>`).join("");
    const temp = state.field?.temp ? `<option value="" selected>${esc(state.field.name)} (not saved)</option>` : "";
    return `<select id="fieldpick" aria-label="Field">${temp}${opts}</select>${state.field?.temp ? `<button class="linkish" data-savefield="1">Save</button>` : `<button class="linkish" data-editfield="1">Edit</button>`}<button class="linkish" data-addfield="1">+ Add</button>`;
  }
  function editView() {
    const e = state.editing;
    return `<form class="form" id="fieldform">
      <label>Field name<input name="name" value="${esc(e.name || "")}" placeholder="North 80, Home orchard…" autocomplete="off" /></label>
      <label>Location<input name="q" value="${esc(e.q || "")}" placeholder="City, ST · street address · lat, lon" autocomplete="off" /></label>
      <p class="note" style="margin:0">${e.lat != null ? `At ${e.lat.toFixed(4)}, ${e.lon.toFixed(4)}. Click the map to move it.` : "Search, use your location, or click the map."}</p>
      <div class="row2"><label>Crop<select name="crop">${Object.entries(CROPS).map(([k, c]) => `<option value="${k}"${k === (e.crop || "corn") ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
        <label>Planted (optional)<input type="date" name="planted" value="${esc(e.planted || "")}" /></label></div>
      ${e.err ? `<p class="err">${esc(e.err)}</p>` : ""}
      <div class="actions"><button class="btn" type="submit">Save field</button><button class="linkish" type="button" data-locate="1">Use my location</button><button class="linkish" type="button" data-canceledit="1">Cancel</button>${e.id ? `<button class="linkish" type="button" data-deletefield="1" style="color:var(--err)">Delete</button>` : ""}</div>
      <p class="note" style="margin:0">Fields are kept in this browser only.</p></form>`;
  }
  function drawFields() {
    layers.fields.clearLayers();
    state.fields.forEach((x) => {
      const on = state.field?.id === x.id;
      L.circleMarker([x.lat, x.lon], { pane: "points", radius: on ? 7 : 5, color: "#fff", weight: on ? 2.5 : 1.5, fillColor: on ? "#3fcf9a" : "#2a7a5c", fillOpacity: 1 })
        .bindTooltip(esc(x.name), { className: "tw-tip", direction: "top", offset: [0, -6] }).on("click", (ev) => { L.DomEvent.stop(ev); showField(x); }).addTo(layers.fields);
    });
    const f = state.field;
    if (f?.temp) L.circleMarker([f.lat, f.lon], { pane: "points", radius: 6, color: "#fff", weight: 2, fillColor: "#4ad1ff", fillOpacity: 1 }).bindTooltip(esc(f.name), { className: "tw-tip", direction: "top", offset: [0, -6] }).addTo(layers.fields);
    const e = state.editing;
    if (e?.lat != null) L.circleMarker([e.lat, e.lon], { pane: "points", radius: 7, color: "#fff", weight: 2, dashArray: "3 3", fillColor: "#ffbf47", fillOpacity: 1 }).addTo(layers.fields);
  }
  function showField(f, fly = true) {
    state.editing = null;
    state.field = f;
    if (!f.temp) { state.active = f.id; saveFields(); }
    drawFields();
    drawStormTracks();
    if (fly) map.flyTo([f.lat, f.lon], Math.max(map.getZoom(), 8), { duration: 0.6 });
    render();
    syncUrl();
    if (!f.pt && !f.err) loadField(f);
  }
  function spotAt(lat, lon, name) {
    return { temp: true, id: null, name: name || `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon, crop: state.field?.crop || "corn" };
  }

  // —— Render ———————————————————————————————————————————————————————
  function render() {
    $("fieldbar").innerHTML = fieldbarHtml();
    document.querySelectorAll("#views button").forEach((b) => b.setAttribute("aria-selected", b.dataset.view === state.view));
    let html;
    if (state.editing) html = editView();
    else if (!state.field) html = `<div class="pad"><p class="note" style="margin-top:0"><b>FarmWeather</b> turns the forecast into calls for your fields: whether to spray now, the week's windows for haying, planting, harvest, manure and frost nights, and how the season is running on growing degree days, chill hours, frost dates and rain.</p>
      <div class="actions" style="display:flex;gap:.8rem;align-items:center;margin-top:.8rem"><button class="btn" data-addfield="1" style="min-height:2.1rem;padding:0 .9rem;font-size:.82rem;border-radius:6px;box-shadow:none">Add a field</button><button class="linkish" data-locate="1">Use my location</button></div>
      <p class="note">Or click anywhere on the map to check a spot.</p></div>`;
    else if (state.field.err) html = `<p class="empty">${esc(state.field.err)}</p>`;
    else if (!state.field.pt) html = `<p class="empty">Loading ${esc(state.field.name)}…</p>`;
    else html = { today: todayView, windows: windowsView, season: seasonView, map: mapView }[state.view]();
    $("panel").innerHTML = html;
  }
  function syncUrl() {
    const u = new URLSearchParams();
    if (state.view !== "today") u.set("view", state.view);
    if (state.field) u.set("loc", `${state.field.lat.toFixed(4)},${state.field.lon.toFixed(4)}`);
    if (state.view === "windows") {
      const w = state.job;
      u.set("job", w.preset);
      if (w.frost) { if (w.crit != null) u.set("crit", w.crit); }
      else {
        JOB_FIELDS.forEach(([k]) => { if (String(w[k] ?? "") !== String(JOBS[w.preset][k] ?? "")) u.set(k, w[k]); });
        if (!!w.day !== !!JOBS[w.preset].day) u.set("day", w.day ? "1" : "0");
      }
    }
    history.replaceState(null, "", `${location.pathname}${u.toString() ? `?${u}` : ""}`);
  }

  // —— Events ———————————————————————————————————————————————————————
  $("views").addEventListener("click", (e) => {
    const v = e.target.closest("[data-view]")?.dataset.view;
    if (!v) return;
    state.view = v;
    if (state.editing && state.field) state.editing = null;
    render(); syncUrl();
  });
  $("fieldbar").addEventListener("change", (e) => {
    if (e.target.id !== "fieldpick") return;
    const f = state.fields.find((x) => x.id === e.target.value);
    if (f) showField(f);
  });
  function startEdit(f) {
    state.editing = f ? { id: f.id, name: f.name, lat: f.lat, lon: f.lon, crop: f.crop, planted: f.planted, q: "" } : { crop: state.field?.crop || "corn", ...(state.field?.temp ? { lat: state.field.lat, lon: state.field.lon } : {}) };
    render(); drawFields();
  }
  function locate(then) {
    if (!navigator.geolocation) { setStatus("Location isn't available in this browser"); return; }
    setStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition((pos) => { setStatus(""); then(pos.coords.latitude, pos.coords.longitude); },
      () => { setStatus("Couldn't get your location"); setTimeout(() => setStatus(""), 3000); }, { timeout: 15000 });
  }
  function clickHandler(e) {
    const t = e.target.closest("button, a[data-gojob]");
    if (!t) return;
    if (t.dataset.addfield) { startEdit(null); return; }
    if (t.dataset.editfield && state.field) { startEdit(state.field); return; }
    if (t.dataset.savefield && state.field) { startEdit(null); state.editing.name = state.field.place || ""; render(); return; }
    if (t.dataset.canceledit) { state.editing = null; drawFields(); render(); return; }
    if (t.dataset.deletefield) {
      const id = state.editing.id;
      state.fields = state.fields.filter((x) => x.id !== id);
      state.editing = null;
      if (state.field?.id === id) state.field = state.fields[0] || null;
      state.active = state.field?.id || null;
      saveFields(); drawFields(); render(); syncUrl();
      if (state.field && !state.field.pt) loadField(state.field);
      return;
    }
    if (t.dataset.locate) {
      locate((lat, lon) => {
        map.flyTo([lat, lon], 10, { duration: 0.6 });
        if (state.editing) { Object.assign(state.editing, { lat, lon, err: null }); drawFields(); render(); }
        else showField(spotAt(lat, lon, "My location"), false);
      });
      return;
    }
    if (t.dataset.gojob) { e.preventDefault(); state.job = { preset: t.dataset.gojob, ...JOBS[t.dataset.gojob] }; state.view = "windows"; render(); syncUrl(); return; }
    if (t.dataset.job) { state.job = { preset: t.dataset.job, ...JOBS[t.dataset.job] }; render(); syncUrl(); return; }
    if (t.dataset.share) { navigator.clipboard?.writeText(location.href).then(() => { setStatus("Link copied"); setTimeout(() => setStatus(""), 2000); }); return; }
    const pick = t.closest("[data-pick]");
    if (pick && t.dataset.v != null) { state[pick.dataset.pick] = t.dataset.v; drawRainCpc(); if (state.view === "map") render(); }
  }
  $("fieldbar").addEventListener("click", clickHandler);
  $("panel").addEventListener("click", clickHandler);
  document.querySelectorAll(".layers [data-pick]").forEach((g) => g.addEventListener("click", clickHandler));
  function toggleLayer(k, on) {
    state.on[k] = on;
    document.querySelectorAll(`[data-layer="${k}"]`).forEach((c) => { c.checked = on; });
    if (k === "radar") { loadRadar(true); return; }
    if (on) layers[k].addTo(map); else layers[k].remove();
    if (k === "drought" && on) loadDrought().then(drawLegend).catch(() => setStatus("Drought Monitor unavailable"));
    drawLegend();
  }
  $("layers").addEventListener("change", (e) => { const k = e.target.dataset?.layer; if (k) toggleLayer(k, e.target.checked); });

  $("panel").addEventListener("change", (e) => {
    if (e.target.dataset?.layer) { toggleLayer(e.target.dataset.layer, e.target.checked); return; }
    const lf = e.target.closest("#limits");
    if (lf) {
      const w = state.job;
      if (w.frost) {
        if (e.target.name === "stage" && e.target.value !== "custom") w.crit = +e.target.value;
        else if (e.target.name === "crit" && Number.isFinite(+e.target.value)) w.crit = +e.target.value;
      } else {
        state.jobOpen = true;
        JOB_FIELDS.forEach(([k]) => { const v = lf.elements[k].value.trim(); w[k] = v === "" ? "" : +v; });
        w.day = lf.elements.day.checked;
      }
      render(); syncUrl();
      return;
    }
    const cf = e.target.closest("#cropform");
    if (cf) {
      const f = state.field;
      if (e.target.name === "crop") { f.crop = e.target.value; delete f.base; delete f.cap; if (!f.plantedSet) f.planted = undefined; }
      if (e.target.name === "planted") { f.planted = e.target.value || undefined; f.plantedSet = !!e.target.value; }
      if (e.target.name === "base" && Number.isFinite(+e.target.value) && e.target.value !== "") f.base = +e.target.value;
      if (e.target.name === "cap") f.cap = e.target.value === "" ? null : Number.isFinite(+e.target.value) ? +e.target.value : f.cap;
      if (!f.temp) saveFields();
      if (state.job.frost) state.job.crit = undefined;
      render();
    }
  });
  $("panel").addEventListener("submit", async (e) => {
    if (e.target.id !== "fieldform") return;
    e.preventDefault();
    const fm = e.target.elements, d = state.editing;
    Object.assign(d, { name: fm.name.value.trim(), q: fm.q.value.trim(), crop: fm.crop.value, planted: fm.planted.value || undefined, err: null });
    if (d.q) {
      try { const hit = await Geocode.place(d.q); Object.assign(d, { lat: hit.lat, lon: hit.lon }); if (!d.name) d.name = hit.label; map.flyTo([hit.lat, hit.lon], 10, { duration: 0.6 }); }
      catch (err) { d.err = err.message; render(); return; }
    }
    if (d.lat == null) { d.err = "Pick a location: search, use your location, or click the map."; render(); return; }
    if (!d.name) d.name = `Field ${state.fields.length + 1}`;
    let f = d.id ? state.fields.find((x) => x.id === d.id) : null;
    const moved = !f || f.lat !== d.lat || f.lon !== d.lon;
    if (!f) { f = { id: newId() }; state.fields.push(f); }
    Object.assign(f, { name: d.name, lat: d.lat, lon: d.lon, crop: d.crop, planted: d.planted, plantedSet: !!d.planted });
    if (moved) ["pt", "grid", "alerts", "obs", "rain", "ens", "season", "cpc", "soil", "err"].forEach((k) => delete f[k]);
    state.editing = null;
    saveFields();
    showField(f);
  });
  map.on("click", (e) => {
    const { lat, lng } = e.latlng;
    if (state.editing) { Object.assign(state.editing, { lat, lon: lng, q: "", err: null }); drawFields(); render(); return; }
    showField(spotAt(lat, lng), false);
  });

  // —— Load & refresh ———————————————————————————————————————————————
  function init() {
    loadFields();
    loadRadar(true);
    drawRainCpc();
    const loc = Geocode.parseLatLon(params.get("loc") || "");
    const saved = state.fields.find((x) => loc && Math.abs(x.lat - loc.lat) < 1e-4 && Math.abs(x.lon - loc.lon) < 1e-4);
    if (saved) showField(saved);
    else if (loc) showField(spotAt(loc.lat, loc.lon));
    else if (state.fields.length) showField(state.fields.find((x) => x.id === state.active) || state.fields[0]);
    else {
      // Offer the place last used on any Standard Weather page.
      try { const sp = JSON.parse(localStorage.getItem("sw-place") || "null"); if (sp && Number.isFinite(sp.lat)) showField(spotAt(sp.lat, sp.lon, sp.label)); } catch { /* none */ }
      if (!state.field) render();
    }
    loadStorms().then(() => { drawStormTracks(); if (state.view === "today" && state.field?.pt) render(); });
    setInterval(() => loadStorms().then(() => { drawStormTracks(); if (state.view === "today" && state.field?.pt && !state.editing) render(); }), 2 * 60000);
    setInterval(() => { const f = state.field; if (f?.pt) { loadPointAlerts(f).then(() => { if (state.field === f && state.view === "today" && !state.editing) render(); }); } }, 2 * 60000);
    // The forecast grid, observations and rain every 30 minutes, without blanking the panel.
    setInterval(() => {
      const f = state.field;
      if (!f?.pt || Date.now() - (f.updated || 0) < 30 * 60000) return;
      f.updated = Date.now();
      Promise.allSettled([WW.loadGrid(f.pt.forecastGridData).then((g) => { f.grid = g; }), loadObs(f), loadRain(f)])
        .then(() => { if (state.field === f && !state.editing) { render(); $("updated").textContent = `updated ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`; } });
    }, 5 * 60000);
    setInterval(() => { if (!state.radar.timer) loadRadar(false); }, 4 * 60000);
  }

  init();
})();
