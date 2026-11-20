/* Standard Weather home page: live tiles and "Your place".
 *
 *   Tropics     TropicalWeather's data/tropical.json (active storms, else the highest 7-day outlook chance)
 *   Lightning   NowWeather's data/glm.json, and tornado and severe thunderstorm warnings from the NWS API
 *   Models      FutureWeather's data.json (newest cycle of each model)
 *   Your place  the place saved in this browser (localStorage "sw-place", shared with ForensicWeather,
 *               NowWeather, FutureWeather, FarmWeather and the property profile): NWS forecast and alerts there
 */
(function () {
  "use strict";

  const NWS = "https://api.weather.gov";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CLASS = { HU: "Hurricane", MH: "Major Hurricane", TS: "Tropical Storm", TD: "Tropical Depression", STS: "Subtropical Storm", SS: "Subtropical Storm",
    STD: "Subtropical Depression", SD: "Subtropical Depression", PTC: "Potential Tropical Cyclone", PC: "Post-Tropical Cyclone", TY: "Typhoon" };
  const BASIN = { AL: "Atlantic", EP: "E. Pacific", CP: "C. Pacific" };

  function tile(id, html) { const el = $(id); if (el) { el.innerHTML = html; el.classList.remove("loading"); } }
  const stamp = (f) => `<span class="live__age${f.health === "ok" ? "" : " live__age--" + f.health}">${f.health === "down" ? "unavailable" : `updated ${Feeds.age(f.ageMin)} ago`}</span>`;

  // —— Tropics ——
  // The highest 7-day formation chance in each basin's outlook text.
  function outlookChances(outlooks) {
    return (outlooks || []).map((o) => {
      const pcts = [...String(o.text || "").matchAll(/7 days\.\.\.\w+\.\.\.(?:near )?(\d+) percent/g)].map((m) => +m[1]);
      return { basin: o.basin, pct: pcts.length ? Math.max(...pcts) : 0, areas: pcts.length };
    });
  }
  async function tropics() {
    const f = await Feeds.load("tropical");
    if (!f.data) return tile("tile-tropics", `<b>Tropics</b><p>Storm data is unavailable right now.</p>`);
    const storms = (f.data.storms || []).slice().sort((a, b) => (b.intensity || 0) - (a.intensity || 0));
    let body;
    if (storms.length) {
      body = `<p class="live__big">${storms.length} active storm${storms.length === 1 ? "" : "s"}</p><ul class="live__list">${storms.slice(0, 3).map((s) =>
        `<li>${esc(CLASS[s.classification] || s.classification || "")} <b>${esc(s.name)}</b><span>${s.intensity != null ? `${s.intensity} kt` : ""}</span></li>`).join("")}</ul>`;
    } else {
      const top = outlookChances(f.data.outlooks).sort((a, b) => b.pct - a.pct)[0];
      body = `<p class="live__big">No active storms</p><p>${top && top.pct ? `Highest 7-day formation chance: <b>${top.pct}%</b> in the ${esc(BASIN[top.basin] || top.basin)}.` : "No formation expected in the next 7 days."}</p>`;
    }
    tile("tile-tropics", `<b>Tropics</b>${body}${stamp(f)}`);
  }

  // —— Lightning and warnings ——
  async function lightning() {
    const [f, warn] = await Promise.all([
      Feeds.load("lightning"),
      fetch(`${NWS}/alerts/active?status=actual&event=${encodeURIComponent("Tornado Warning,Severe Thunderstorm Warning")}`, { headers: { Accept: "application/geo+json" } })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    const n = (ev) => (warn?.features || []).filter((x) => x.properties.event === ev).length;
    const flashes = f.data ? `<p class="live__big">${(f.data.flashes || 0).toLocaleString()} lightning flashes</p><p>Seen by GOES in the last ${f.data.windowMinutes || 15} minutes.</p>` : `<p>Lightning data is unavailable right now.</p>`;
    const warnings = warn ? `<ul class="live__list"><li>Tornado warnings<span>${n("Tornado Warning")}</span></li><li>Severe thunderstorm warnings<span>${n("Severe Thunderstorm Warning")}</span></li></ul>` : "";
    tile("tile-lightning", `<b>Storms now</b>${flashes}${warnings}${stamp(f)}`);
  }

  // —— Model runs ——
  async function models() {
    const f = await Feeds.load("models");
    if (!f.data) return tile("tile-models", `<b>Model runs</b><p>Model data is unavailable right now.</p>`);
    const rows = f.models.map((m) => {
      const late = m.ageH > Feeds.modelExpectH(m);
      return `<li><b>${esc(m.name)}</b> ${esc(String(m.cycle).slice(11, 13))}Z ${new Date(m.init).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}<span${late ? ' class="live__warn"' : ""}>${Math.round(m.ageH)} h old</span></li>`;
    }).join("");
    tile("tile-models", `<b>Model runs</b><p class="live__big">${f.models.length} models on FutureWeather</p><ul class="live__list">${rows}</ul>${f.missing.length ? `<p class="live__warn">${esc(f.missing.map((x) => x.toUpperCase()).join(", "))} missing from the latest build.</p>` : ""}${stamp(f)}`);
  }

  // —— Status line under the tiles ——
  async function status() {
    const all = await Feeds.loadAll();
    const bad = all.filter((f) => f.health !== "ok");
    $("live-status").innerHTML = bad.length
      ? `<span class="live__dot live__dot--late"></span>${bad.length} of ${all.length} data feeds ${bad.length === 1 ? "is" : "are"} behind: ${bad.map((f) => esc(f.name)).join(", ")}. <a href="/status.html">See status</a>`
      : `<span class="live__dot"></span>All ${all.length} data feeds are up to date. <a href="/status.html">See status</a>`;
  }

  // —— Your place ——
  const savedPlace = () => { try { const p = JSON.parse(localStorage.getItem("sw-place") || "null"); return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : null; } catch { return null; } };
  function savePlace(p) { try { localStorage.setItem("sw-place", JSON.stringify({ label: p.label, lat: p.lat, lon: p.lon })); } catch { /* private mode: still shown */ } }

  function placeLinks(p) {
    const ll = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    return [["NowWeather", `/NowWeather/?loc=${ll}`], ["FutureWeather", `/FutureWeather/?loc=${ll}`], ["FarmWeather", "/FarmWeather/"],
      ["Property profile", `/profile.html?loc=${encodeURIComponent(p.label || ll)}`], ["ForensicWeather", "/ForensicWeather/"]]
      .map(([name, href]) => `<a href="${href}">${name}</a>`).join("");
  }

  let placeReq = 0;
  async function showPlace(p) {
    const req = ++placeReq;
    $("place-form").hidden = true;
    $("place-body").hidden = false;
    $("place-body").innerHTML = `<div class="place__head"><span class="place__name">${esc(p.label || `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`)}</span><button type="button" class="linkish" id="place-change">Change</button></div>
      <div id="place-wx" class="place__wx"><p>Loading the forecast…</p></div><div class="place__links">${placeLinks(p)}</div>`;
    const geo = { headers: { Accept: "application/geo+json" } };
    const pt = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    try {
      const [point, alerts] = await Promise.all([
        fetch(`${NWS}/points/${pt}`, geo).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? "outside" : r.status)))),
        fetch(`${NWS}/alerts/active?status=actual&point=${pt}`, geo).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      const fc = await fetch(point.properties.forecast, geo).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (req !== placeReq) return;
      const periods = fc?.properties?.periods || [];
      const al = (alerts?.features || []).map((a) => a.properties).filter((a, i, all) => all.findIndex((b) => b.event === a.event) === i);
      $("place-wx").innerHTML = `${al.length ? `<ul class="place__alerts">${al.slice(0, 4).map((a) => `<li>${esc(a.event)}<small>until ${new Date(a.ends || a.expires).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}</small></li>`).join("")}</ul>` : `<p class="place__none">No NWS alerts in effect here.</p>`}
        ${periods.length ? `<div class="place__periods">${periods.slice(0, 3).map((x) => `<div><small>${esc(x.name)}</small><b>${x.temperature}°${esc(x.temperatureUnit)}</b><span>${esc(x.shortForecast)}</span></div>`).join("")}</div>` : "<p>No NWS forecast for this spot right now.</p>"}`;
    } catch (e) {
      if (req !== placeReq) return;
      $("place-wx").innerHTML = `<p>${e.message === "outside" ? "The National Weather Service has no forecast for this spot. NWS forecasts cover the U.S. and its territories." : "The NWS forecast didn't load. Try again in a minute."}</p>`;
    }
  }

  function editPlace() {
    placeReq++;
    $("place-body").hidden = true;
    $("place-form").hidden = false;
    const p = savedPlace();
    $("place-q").value = p?.label || "";
    $("place-q").focus();
  }

  async function setFromQuery(q) {
    $("place-msg").textContent = "Searching…";
    try {
      const p = await Geocode.place(q);
      $("place-msg").textContent = "";
      savePlace(p);
      showPlace(p);
    } catch (e) {
      $("place-msg").textContent = e.message || "The place search didn't work just now.";
    }
  }

  function initPlace() {
    $("place-form").addEventListener("submit", (e) => { e.preventDefault(); const q = $("place-q").value.trim(); if (q) setFromQuery(q); });
    $("place-here").addEventListener("click", () => {
      if (!navigator.geolocation) { $("place-msg").textContent = "This browser can't share its location."; return; }
      $("place-msg").textContent = "Finding you…";
      navigator.geolocation.getCurrentPosition(
        (pos) => { const p = { label: null, lat: pos.coords.latitude, lon: pos.coords.longitude }; p.label = `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`; $("place-msg").textContent = ""; savePlace(p); showPlace(p); },
        () => { $("place-msg").textContent = "Location wasn't shared. Type a place instead."; },
        { timeout: 15000, maximumAge: 600000 });
    });
    $("place").addEventListener("click", (e) => { if (e.target.id === "place-change") editPlace(); });
    const p = savedPlace();
    if (p) showPlace(p);
  }

  initPlace();
  tropics(); lightning(); models(); status();
  // Keep the tiles current while the page stays open.
  setInterval(() => { tropics(); lightning(); models(); status(); }, 5 * 60000);
})();
