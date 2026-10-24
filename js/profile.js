/* Standard Weather — property weather profile: one page per address, drawn from the other tools' data.
 *
 *   /PastWeather/data/history/*.json     hail (1"+), damaging wind (58 mph+) and tornado reports since 1950 (NCEI, SPC)
 *   /TropicalWeather/hurdat/*.json        NHC HURDAT2 best tracks, for tropical storms and hurricanes within 50 miles
 *   FEMA National Flood Hazard Layer      flood zone and base flood elevation (hazards.fema.gov)
 *   USGS Elevation Point Query Service    ground height (NAVD88)
 *   NWS API (api.weather.gov)             alerts in effect now and the 7-day forecast
 *   Census TIGERweb / Geocoder, USGS GNIS place search (as on the other pages)
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const miles = (km) => Math.round(km * 0.621371 * 10) / 10;
  const kmBetween = (lat1, lon1, lat2, lon2) => {
    const r = Math.PI / 180, a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
  };
  const day = (ms) => new Date(ms).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  const getJson = async (url, ms = 20000) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(`${r.status}`); return await r.json(); } finally { clearTimeout(timer); }
  };

  function parseLatLon(text) {
    const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const lat = Number(m[1]), lon = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
  }
  const STATES = [
    ["AL", "01", "Alabama"], ["AK", "02", "Alaska"], ["AZ", "04", "Arizona"], ["AR", "05", "Arkansas"],
    ["CA", "06", "California"], ["CO", "08", "Colorado"], ["CT", "09", "Connecticut"], ["DE", "10", "Delaware"],
    ["DC", "11", "District of Columbia"], ["FL", "12", "Florida"], ["GA", "13", "Georgia"], ["HI", "15", "Hawaii"],
    ["ID", "16", "Idaho"], ["IL", "17", "Illinois"], ["IN", "18", "Indiana"], ["IA", "19", "Iowa"],
    ["KS", "20", "Kansas"], ["KY", "21", "Kentucky"], ["LA", "22", "Louisiana"], ["ME", "23", "Maine"],
    ["MD", "24", "Maryland"], ["MA", "25", "Massachusetts"], ["MI", "26", "Michigan"], ["MN", "27", "Minnesota"],
    ["MS", "28", "Mississippi"], ["MO", "29", "Missouri"], ["MT", "30", "Montana"], ["NE", "31", "Nebraska"],
    ["NV", "32", "Nevada"], ["NH", "33", "New Hampshire"], ["NJ", "34", "New Jersey"], ["NM", "35", "New Mexico"],
    ["NY", "36", "New York"], ["NC", "37", "North Carolina"], ["ND", "38", "North Dakota"], ["OH", "39", "Ohio"],
    ["OK", "40", "Oklahoma"], ["OR", "41", "Oregon"], ["PA", "42", "Pennsylvania"], ["RI", "44", "Rhode Island"],
    ["SC", "45", "South Carolina"], ["SD", "46", "South Dakota"], ["TN", "47", "Tennessee"], ["TX", "48", "Texas"],
    ["UT", "49", "Utah"], ["VT", "50", "Vermont"], ["VA", "51", "Virginia"], ["WA", "53", "Washington"],
    ["WV", "54", "West Virginia"], ["WI", "55", "Wisconsin"], ["WY", "56", "Wyoming"], ["PR", "72", "Puerto Rico"],
  ];
  function findState(s) {
    const t = s.trim().replace(/\./g, "").toLowerCase();
    return STATES.find(([code, , name]) => code.toLowerCase() === t || name.toLowerCase() === t) || null;
  }
  function splitPlace(text) {
    const comma = text.lastIndexOf(",");
    if (comma > 0) {
      const st = findState(text.slice(comma + 1));
      if (st) return { name: text.slice(0, comma).trim(), state: st };
    }
    for (const words of [2, 1]) {
      const parts = text.trim().split(/\s+/);
      if (parts.length <= words) continue;
      const st = findState(parts.slice(-words).join(" "));
      if (st) return { name: parts.slice(0, -words).join(" "), state: st };
    }
    return { name: text.trim(), state: null };
  }
  const sqlString = (s) => "'" + s.toUpperCase().replace(/'/g, "''") + "'";

  async function arcgisQuery(url, params) {
    const u = new URL(url);
    for (const [k, v] of Object.entries({ f: "json", ...params })) u.searchParams.set(k, v);
    const res = await fetch(u.toString());
    if (!res.ok) throw new Error(`Place search failed (${res.status})`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || "Place search failed");
    return json.features || [];
  }
  async function searchTigerPlaces(name, st) {
    const base = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer";
    const where = `UPPER(BASENAME)=${sqlString(name)}` + (st ? ` AND STATE='${st[1]}'` : "");
    const params = { where, outFields: "BASENAME,STATE,INTPTLAT,INTPTLON,AREALAND", returnGeometry: "false" };
    const results = await Promise.all([4, 5].map((layer) => arcgisQuery(`${base}/${layer}/query`, params).catch(() => [])));
    const hits = results.flat().map((f) => f.attributes);
    if (!hits.length) return null;
    hits.sort((a, b) => (b.AREALAND || 0) - (a.AREALAND || 0));   // without a state, the largest place is the likeliest
    const h = hits[0];
    const s = STATES.find(([, fips]) => fips === h.STATE);
    return { label: `${h.BASENAME}${s ? ", " + s[0] : ""}`, lat: Number(h.INTPTLAT), lon: Number(h.INTPTLON) };
  }
  async function searchGnis(name, st) {
    const where = `UPPER(gaz_name)=${sqlString(name)}` + (st ? ` AND state_alpha='${st[0]}'` : "");
    const features = await arcgisQuery("https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer/3/query", {
      where, outFields: "gaz_name,state_alpha", returnGeometry: "true", outSR: "4326",
    });
    const f = features.find((x) => x.geometry && x.geometry.points && x.geometry.points.length);
    if (!f) return null;
    const [lon, lat] = f.geometry.points[0];
    return { label: `${f.attributes.gaz_name}, ${f.attributes.state_alpha}`, lat, lon };
  }
  /** The Census Geocoder sends no CORS headers, so it is called with JSONP. Street addresses only. */
  function searchCensusAddress(text) {
    return new Promise((resolve, reject) => {
      const cb = "spCensus" + Math.random().toString(36).slice(2);
      const u = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
      u.searchParams.set("address", text);
      u.searchParams.set("benchmark", "Public_AR_Current");
      u.searchParams.set("format", "jsonp");
      u.searchParams.set("callback", cb);
      const script = document.createElement("script");
      const timer = setTimeout(() => done(new Error("Address search timed out")), 12000);
      function done(err, value) { clearTimeout(timer); delete window[cb]; script.remove(); err ? reject(err) : resolve(value); }
      window[cb] = (data) => {
        const m = data?.result?.addressMatches?.[0];
        done(null, m ? { label: m.matchedAddress, lat: m.coordinates.y, lon: m.coordinates.x } : null);
      };
      script.onerror = () => done(new Error("Address search failed"));
      script.src = u.toString();
      document.head.appendChild(script);
    });
  }
  async function geocodePlace(q) {
    const text = q.trim();
    if (!text) throw new Error("Enter a location or lat, lon");
    const direct = parseLatLon(text);
    if (direct) return { label: `${direct.lat.toFixed(4)}, ${direct.lon.toFixed(4)}`, ...direct };
    let hit = null;
    if (/^\d/.test(text)) hit = await searchCensusAddress(text).catch(() => null);
    else {
      const { name, state: st } = splitPlace(text);
      hit = (await searchTigerPlaces(name, st).catch(() => null)) || (await searchGnis(name, st).catch(() => null)) ||
        (await searchCensusAddress(text).catch(() => null));
    }
    if (!hit || !Number.isFinite(hit.lat) || !Number.isFinite(hit.lon)) throw new Error("Place not found. Try “City, ST”, a street address, or lat, lon.");
    return hit;
  }


  // —— Severe storm history (1° tiles from the pastweather repo, also used by ForensicWeather) ——————————
  const RADII = [1, 3, 10];
  const tileName = (lat, lon) => { const a = Math.floor(lat), o = Math.floor(lon); return `${a >= 0 ? "N" : "S"}${pad(Math.abs(a))}${o >= 0 ? "E" : "W"}${String(Math.abs(o)).padStart(3, "0")}`; };
  const rowMs = (t) => Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(8, 10), +t.slice(10, 12));
  const convDay = (ms) => { const d = new Date(ms - 12 * 3600e3); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12); };

  async function severeHistory(p) {
    const maxKm = 10 / 0.621371, dLat = maxKm / 111, dLon = dLat / Math.max(0.2, Math.cos((p.lat * Math.PI) / 180));
    const names = new Set();
    for (const la of [p.lat - dLat, p.lat, p.lat + dLat]) for (const lo of [p.lon - dLon, p.lon, p.lon + dLon]) names.add(tileName(la, lo));
    const [index, ...tiles] = await Promise.all([getJson("/PastWeather/data/history/index.json").catch(() => ({})), ...[...names].map((n) => getJson(`/PastWeather/data/history/${n}.json`).catch(() => null))]);
    const rows = [];
    for (const t of tiles) for (const [time, type, mag, lat, lon] of t?.rows || []) {
      const km = kmBetween(p.lat, p.lon, lat, lon);
      if (km <= maxKm) rows.push({ ms: rowMs(time), type, mag, km });
    }
    return { index, rows };
  }
  function severeHtml(h, radiusMi) {
    const km = radiusMi / 0.621371;
    const days = new Map();
    for (const r of h.rows) {
      if (r.km > km) continue;
      const k = convDay(r.ms);
      const d = days.get(k) || days.set(k, { t: k, hail: null, wind: null, tor: 0 }).get(k);
      if (r.type === "H" && (!d.hail || r.mag > d.hail.mag)) d.hail = r;
      if (r.type === "W" && (!d.wind || r.mag > d.wind.mag)) d.wind = r;
      if (r.type === "T") d.tor++;
    }
    const all = [...days.values()].sort((a, b) => b.t - a.t);
    const hail = all.filter((d) => d.hail), wind = all.filter((d) => d.wind), tor = all.filter((d) => d.tor);
    const big = hail.reduce((m, d) => (!m || d.hail.mag > m.hail.mag ? d : m), null);
    const since10 = Date.UTC(new Date().getUTCFullYear() - 10, 0, 1);
    const ix = h.index || {};
    return `<div class="chips">${RADII.map((r) => `<button type="button" data-radius="${r}" aria-pressed="${r === radiusMi}">${r} mi</button>`).join("")}</div>
      <div class="stat"><span>Hail days (1"+)</span><b>${hail.length}</b></div>
      <div class="stat"><span>Damaging wind days (58 mph+)</span><b>${wind.length}</b></div>
      <div class="stat"><span>Tornado days</span><b>${tor.length}</b></div>
      <div class="stat"><span>In the last 10 years</span><b>${all.filter((d) => d.t >= since10).length} days</b></div>
      <p class="small">${big ? `Largest hail: ${big.hail.mag}" on ${day(big.t)}, ${miles(big.hail.km)} mi away.` : "No hail of 1 inch or more reported."}
        ${hail[0] ? ` Most recent hail day: ${day(hail[0].t)}.` : ""}${tor[0] ? ` Most recent tornado day: ${day(tor[0].t)}.` : ""}
        Reports since ${ix.firstYear || 1950} within ${radiusMi} mi (NCEI Storm Events through ${ix.lastDay || "—"}, then SPC). Reports mark where damage was seen, so the true count is higher.</p>`;
  }

  // —— Tropical storms and hurricanes within 50 miles (HURDAT2) ——————————————————————
  const ptTime = (n) => { const s = String(n); return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10)); };
  async function tropicalHistory(p) {
    const files = [];
    if (p.lon > -110) files.push("atl");
    if (p.lon < -80 || p.lon > 150) files.push("pac");
    const sets = await Promise.all(files.map((f) => getJson(`/TropicalWeather/hurdat/${f}.json`, 60000).catch(() => ({ storms: [] }))));
    const kx = 111.32 * Math.cos((p.lat * Math.PI) / 180), out = [];
    for (const st of sets.flatMap((d) => d.storms)) {
      if (st.year < 1950) continue;
      let best = null;
      for (let i = 0; i + 1 < st.pts.length; i++) {
        const a = st.pts[i], b = st.pts[i + 1];
        const v = Math.max(a[3] || 0, b[3] || 0);
        if (v < 34 || !/TS|HU|SS/.test(a[5] + b[5])) continue;
        const ax = (a[2] - p.lon) * kx, ay = (a[1] - p.lat) * 110.57, bx = (b[2] - p.lon) * kx, by = (b[1] - p.lat) * 110.57;
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        const f = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
        const km = Math.hypot(ax + f * dx, ay + f * dy);
        const kt = (a[3] || 0) + ((b[3] || 0) - (a[3] || 0)) * f;
        if (km <= 80.47 && (!best || kt > best.kt)) best = { km, kt, t: ptTime(a[0]) + f * (ptTime(b[0]) - ptTime(a[0])) };
      }
      if (best) out.push({ id: st.id, name: st.name, year: st.year, ...best });
    }
    return out.sort((a, b) => b.t - a.t);
  }
  const SS = (kt) => (kt >= 137 ? "Cat 5" : kt >= 113 ? "Cat 4" : kt >= 96 ? "Cat 3" : kt >= 83 ? "Cat 2" : kt >= 64 ? "Cat 1" : "TS");
  function tropicalHtml(list) {
    if (!list.length) return `<p class="small">No tropical storm or hurricane has passed within 50 miles since 1950 in NOAA's best-track record.</p>`;
    const hu = list.filter((s) => s.kt >= 64), major = list.filter((s) => s.kt >= 96);
    const top = list.reduce((m, s) => (!m || s.kt > m.kt ? s : m), null);
    return `<div class="stat"><span>Tropical storms and hurricanes</span><b>${list.length}</b></div>
      <div class="stat"><span>Hurricanes</span><b>${hu.length}</b></div>
      <div class="stat"><span>Major hurricanes (Cat 3+)</span><b>${major.length}</b></div>
      <p class="small">Strongest nearby: ${esc(top.name)} (${top.year}), ${SS(top.kt)} with ${Math.round(top.kt)} kt winds ${miles(top.km)} mi away. Most recent: ${list.slice(0, 3).map((s) => `${esc(s.name)} ${s.year} (${SS(s.kt)})`).join(", ")}.
        Counted when the center passed within 50 miles at tropical-storm strength or more, since 1950 (NOAA/NHC HURDAT2).</p>`;
  }

  // —— Flood zone and ground height ————————————————————————————————————————
  const ZONES = {
    A: "1% annual chance flood area, no base flood elevation set", AE: "1% annual chance flood area", AH: "1% annual chance shallow flooding (ponding)",
    AO: "1% annual chance shallow flooding (sheet flow)", AR: "Flood area while a levee is restored", A99: "Flood area to be protected by a levee under construction",
    V: "Coastal high-hazard area (waves), no base flood elevation set", VE: "Coastal high-hazard area with wave action", X: "Outside the 1% annual chance flood area",
    D: "Possible but undetermined flood hazard", "OPEN WATER": "Open water",
  };
  async function floodZone(p) {
    const u = `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?geometry=${p.lon.toFixed(6)},${p.lat.toFixed(6)}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,STATIC_BFE,SFHA_TF&returnGeometry=false&f=json`;
    const d = await getJson(u, 25000);
    const a = d.features?.[0]?.attributes;
    return a ? { zone: a.FLD_ZONE, sub: a.ZONE_SUBTY, bfe: a.STATIC_BFE > -9000 ? a.STATIC_BFE : null, sfha: a.SFHA_TF === "T" } : { none: true };
  }
  async function groundHeight(p) {
    const d = await getJson(`https://epqs.nationalmap.gov/v1/json?x=${p.lon.toFixed(6)}&y=${p.lat.toFixed(6)}&units=Feet&wkid=4326&includeDate=false`, 20000);
    const v = parseFloat(d.value);
    return Number.isFinite(v) && v > -1000 ? v : null;
  }
  function floodHtml(fz, ground) {
    let html = "";
    if (!fz) html += `<p class="small">Loading the FEMA flood map…</p>`;
    else if (fz.error) html += `<p class="small">The FEMA flood map didn't respond. Check the <a href="https://msc.fema.gov/portal/search" target="_blank" rel="noopener">FEMA Flood Map Service Center</a>.</p>`;
    else if (fz.none) html += `<p class="small">No digital FEMA flood map covers this spot yet. Check the <a href="https://msc.fema.gov/portal/search" target="_blank" rel="noopener">FEMA Flood Map Service Center</a> for paper maps.</p>`;
    else html += `<div class="stat"><span>FEMA flood zone</span><b>${esc(fz.zone)}</b></div>
      <p class="small">${esc(ZONES[fz.zone] || fz.sub || "")}${fz.zone === "X" && fz.sub ? ` (${esc(fz.sub.toLowerCase())})` : ""}.${fz.sfha ? " <b>In the Special Flood Hazard Area</b>, where federally backed mortgages require flood insurance." : ""}</p>
      ${fz.bfe != null ? `<div class="stat"><span>Base flood elevation</span><b>${fz.bfe} ft</b></div>` : ""}`;
    if (ground != null) html += `<div class="stat"><span>Ground height</span><b>${ground.toFixed(1)} ft</b></div>
      <p class="small">NAVD88, from USGS 3DEP elevation data.${fz?.bfe != null ? ` The base flood elevation is ${Math.abs(fz.bfe - ground).toFixed(1)} ft ${fz.bfe >= ground ? "above" : "below"} the ground here.` : ""}</p>`;
    return html;
  }

  // —— Now and the week ahead (NWS API) ————————————————————————————————————
  async function nwsNow(p) {
    const [alerts, pt] = await Promise.all([
      getJson(`https://api.weather.gov/alerts/active?point=${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).then((d) => d.features.map((f) => f.properties)).catch(() => null),
      getJson(`https://api.weather.gov/points/${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).catch(() => null),
    ]);
    const fc = pt?.properties?.forecast ? await getJson(pt.properties.forecast).catch(() => null) : null;
    return { alerts, periods: fc?.properties?.periods || null };
  }
  function nowHtml(n) {
    if (!n.alerts) return `<p class="small">NWS alerts didn't load.</p>`;
    return n.alerts.length ? n.alerts.map((a) => `<div class="stat"><span>${esc(a.event)}<small>${esc(a.senderName || "")}</small></span><b>until ${esc(new Date(a.ends || a.expires).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }))}</b></div>`).join("")
      : `<div class="stat"><span>NWS alerts</span><b>None</b></div><p class="small">No watches, warnings or advisories in effect here.</p>`;
  }
  function weekHtml(n) {
    if (!n.periods) return `<p class="small">No NWS forecast for this spot.</p>`;
    return n.periods.filter((x) => x.isDaytime).slice(0, 7).map((x) => `<div class="stat"><span>${esc(x.name)}<small>${esc(x.shortForecast)}${x.probabilityOfPrecipitation?.value ? ` · ${x.probabilityOfPrecipitation.value}% precip` : ""} · ${esc(x.windSpeed)}</small></span><b>${x.temperature}°</b></div>`).join("");
  }

  // —— Page ————————————————————————————————————————————————————————————
  const state = { place: null, radius: 3, severe: null, tropical: null, flood: null, ground: null, now: null };

  function card(title, body, links) {
    return `<article class="service"><h3>${title}</h3>${body}${links ? `<p class="soft-link">${links}</p>` : ""}</article>`;
  }
  function render() {
    const p = state.place;
    if (!p) { $("profile").hidden = true; return; }
    $("profile").hidden = false;
    const ll = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    $("place").textContent = p.label;
    $("coords").textContent = `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)} · prepared ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
    const loading = `<p class="small">Loading…</p>`;
    $("cards").innerHTML = [
      card("Hail, wind and tornadoes", state.severe ? (state.severe.error ? `<p class="small">The storm history didn't load.</p>` : severeHtml(state.severe, state.radius)) : loading,
        `<a href="/ForensicWeather/?loc=${ll}&amp;view=history">Every day in ForensicWeather</a>`),
      card("Tropical storms and hurricanes", state.tropical ? (state.tropical.error ? `<p class="small">The hurricane record didn't load.</p>` : tropicalHtml(state.tropical)) : loading,
        `<a href="/TropicalWeather/?loc=${ll}">Storm by storm in TropicalWeather</a>`),
      card("Flood zone and elevation", floodHtml(state.flood, state.ground), ""),
      card("Right now", state.now ? nowHtml(state.now) : loading, `<a href="/NowWeather/?loc=${ll}">Watch this place in NowWeather</a>`),
      card("The week ahead", state.now ? weekHtml(state.now) : loading, `<a href="/FutureWeather/?loc=${ll}&amp;view=windows">Find work windows in FutureWeather</a>`),
      card("Need it certified?", `<p>This profile is a quick public look. For an insurance claim, a purchase, a lawsuit or a project, Standard Weather can certify the record for this property and a specific date.</p>`,
        `<a href="/ForensicWeather/?${new URLSearchParams({ request: "report", place: p.label, lat: p.lat.toFixed(4), lon: p.lon.toFixed(4), when: "", link: location.href })}#contact">Request a certified report</a>`),
    ].join("");
  }

  async function show(p) {
    state.place = p;
    state.severe = state.tropical = state.flood = state.ground = state.now = null;
    try { localStorage.setItem("sw-place", JSON.stringify({ label: p.label, lat: p.lat, lon: p.lon })); } catch { /* private mode */ }
    history.replaceState(null, "", `?${new URLSearchParams({ loc: $("q").value.trim() || `${p.lat.toFixed(4)},${p.lon.toFixed(4)}` })}`);
    render();
    const set = (k) => (v) => { if (state.place === p) { state[k] = v; render(); } };
    severeHistory(p).then(set("severe"), () => set("severe")({ error: true }));
    tropicalHistory(p).then(set("tropical"), () => set("tropical")({ error: true }));
    floodZone(p).then(set("flood"), () => set("flood")({ error: true }));
    groundHeight(p).then(set("ground"), () => {});
    nwsNow(p).then(set("now"), () => set("now")({ alerts: null, periods: null }));
  }

  $("search").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("err").hidden = true;
    $("go").disabled = true;
    try { await show(await geocodePlace($("q").value)); }
    catch (ex) { $("err").textContent = ex.message; $("err").hidden = false; }
    finally { $("go").disabled = false; }
  });
  $("cards").addEventListener("click", (e) => {
    const r = e.target.closest("[data-radius]")?.dataset.radius;
    if (r) { state.radius = +r; render(); }
  });
  $("print").addEventListener("click", () => window.print());

  const loc = new URLSearchParams(location.search).get("loc");
  if (loc) { $("q").value = loc; $("search").requestSubmit(); }
  else { try { const saved = JSON.parse(localStorage.getItem("sw-place") || "null"); if (saved?.label) $("q").value = saved.label; } catch { /* none saved */ } }
})();
