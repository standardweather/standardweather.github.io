/* Standard Weather — weather case file: one printable document for a place and time.
 *
 * The page opens the tools themselves in hidden frames (same site, so it can read them) and waits for each one's
 * window.SWCase hook to report "ready", then copies its section in:
 *   /ForensicWeather/?loc=…&date=…&time=…       map, written account, summary, reports, warnings, observations
 *   /TropicalWeather/?loc=lat,lon&date=…          wind or water for the tropical cyclone nearest the place that week
 *   /AviationWeather/?view=past&near=lat,lon&t=…  METARs, TAFs, SIGMETs, G-AIRMETs and PIREPs at the nearest airports
 * Each hook's status() is "loading", "ready", "none" (nothing applies, e.g. no storm nearby) or "error".
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const TIMEOUT = 180000;   // per tool; ForensicWeather's radar, lightning and observations can take a minute or more

  function utcText(iso) {
    return new Date(iso).toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " UTC";
  }

  // —— Progress list ————————————————————————————————————————————————
  const steps = {};
  function step(key, label, state, note) {
    const icon = { wait: "○", run: "…", ok: "✓", skip: "–", fail: "✕" }[state];
    let li = steps[key];
    if (!li) { li = steps[key] = document.createElement("li"); $("progress").appendChild(li); }
    li.innerHTML = `<b>${icon}</b><span>${esc(label)}</span><small>${esc(note || "")}</small>`;
  }

  // —— Frames ———————————————————————————————————————————————————————
  function openFrame(src) {
    const f = document.createElement("iframe");
    f.src = src;
    $("frames").appendChild(f);
    return f;
  }
  /** Wait until the frame's SWCase hook leaves "loading", or the timeout passes. */
  async function settle(frame, onTick) {
    const start = Date.now();
    while (Date.now() - start < TIMEOUT) {
      await sleep(1000);
      const hook = frame.contentWindow?.SWCase;
      const s = hook ? hook.status() : "loading";
      if (s !== "loading") return { status: s, hook };
      onTick?.(Math.round((Date.now() - start) / 1000));
    }
    return { status: "timeout", hook: frame.contentWindow?.SWCase };
  }

  // —— Building the file ——————————————————————————————————————————————
  function parseInputs() {
    const loc = $("loc").value.trim();
    const dm = $("date").value.trim().match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
    const tm = $("time").value.trim().match(/^(\d{1,2}):?(\d{2})$/);
    if (!loc) throw new Error("Enter a location.");
    if (!dm || !tm || +tm[1] > 23 || +tm[2] > 59) throw new Error("Use a date like 2024-05-21 and a UTC time like 21:30.");
    const iso = `${dm[1]}-${dm[2]}-${dm[3]}T${pad(+tm[1])}:${tm[2]}:00Z`;
    if (Number.isNaN(Date.parse(iso))) throw new Error("That date isn't valid.");
    if (Date.parse(iso) > Date.now()) throw new Error("That time hasn't happened yet.");
    return { loc, iso, date: iso.slice(0, 10), hhmm: iso.slice(11, 16).replace(":", "") };
  }

  let building = false;
  $("build").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (building) return;
    $("err").hidden = true;
    let inp;
    try { inp = parseInputs(); } catch (ex) { $("err").textContent = ex.message; $("err").hidden = false; return; }
    building = true;
    $("go").disabled = true;
    $("frames").innerHTML = "";
    $("progress").innerHTML = "";
    Object.keys(steps).forEach((k) => delete steps[k]);
    $("progress").hidden = false;
    $("result").hidden = true;
    history.replaceState(null, "", `?${new URLSearchParams({ loc: inp.loc, date: inp.date, time: inp.hhmm })}`);
    try {
      await build(inp);
    } catch (ex) {
      $("err").textContent = ex.message || "The case file couldn't be built.";
      $("err").hidden = false;
    } finally {
      building = false;
      $("go").disabled = false;
    }
  });

  async function build(inp) {
    const sections = [];
    step("past", "ForensicWeather: radar, hail, reports, warnings, lightning, observations", "run", "loading…");
    const pastFrame = openFrame(`/ForensicWeather/?${new URLSearchParams({ loc: inp.loc, date: inp.date, time: inp.hhmm })}`);
    const past = await settle(pastFrame, (s) => step("past", "ForensicWeather: radar, hail, reports, warnings, lightning, observations", "run", `${s} s`));
    if (past.status === "error") { step("past", "ForensicWeather", "fail", past.hook.error()); throw new Error(past.hook.error() || "ForensicWeather couldn't find that place."); }
    const place = past.hook?.place();
    if (!place) { step("past", "ForensicWeather", "fail", "timed out"); throw new Error("ForensicWeather didn't finish loading. Try again in a minute."); }
    try {
      sections.push({ key: "past", ...(await past.hook.section()), complete: past.status === "ready" });
      step("past", "ForensicWeather: radar, hail, reports, warnings, lightning, observations", past.status === "ready" ? "ok" : "fail", past.status === "ready" ? "done" : "timed out; included what loaded");
    } catch (ex) {
      step("past", "ForensicWeather", "fail", ex.message);
    }

    // The other tools need the place's coordinates, which ForensicWeather has now found.
    const ll = `${place.lat.toFixed(4)},${place.lon.toFixed(4)}`;
    const jobs = [];
    if ($("incTropical").checked) {
      const label = "TropicalWeather: hurricane wind or water";
      step("tropical", label, "run", "loading…");
      const f = openFrame(`/TropicalWeather/?${new URLSearchParams({ loc: ll, date: inp.date })}`);
      jobs.push(settle(f, (s) => step("tropical", label, "run", `${s} s`)).then(async (r) => {
        if (r.status === "none") { step("tropical", label, "skip", "no tropical cyclone within 250 mi that week"); return null; }
        if (r.status !== "ready" && !r.hook) { step("tropical", label, "fail", r.status); return null; }
        try {
          const sec = { key: "tropical", ...(await r.hook.section()), complete: r.status === "ready" };
          step("tropical", label, r.status === "ready" ? "ok" : "fail", r.status === "ready" ? "done" : "timed out; included what loaded");
          return sec;
        } catch (ex) { step("tropical", label, "fail", ex.message); return null; }
      }));
    }
    if ($("incAviation").checked) {
      const label = "AviationWeather: nearest airports";
      step("aviation", label, "run", "loading…");
      const f = openFrame(`/AviationWeather/?${new URLSearchParams({ view: "past", near: ll, t: `${inp.date.replace(/-/g, "")}T${inp.hhmm}Z`, h: "3" })}`);
      jobs.push(settle(f, (s) => step("aviation", label, "run", `${s} s`)).then(async (r) => {
        if (r.status === "none") { step("aviation", label, "skip", "no reporting airport within 60 nm"); return null; }
        if (r.status === "error") { step("aviation", label, "fail", r.hook.error()); return null; }
        if (!r.hook) { step("aviation", label, "fail", r.status); return null; }
        try {
          const sec = { key: "aviation", ...(await r.hook.section()), complete: r.status === "ready" };
          step("aviation", label, r.status === "ready" ? "ok" : "fail", r.status === "ready" ? "done" : "timed out; included what loaded");
          return sec;
        } catch (ex) { step("aviation", label, "fail", ex.message); return null; }
      }));
    }
    for (const s of await Promise.all(jobs)) if (s) sections.push(s);
    compose(inp, place, sections);
    $("frames").innerHTML = "";
  }

  const HEADINGS = {
    past: "Storm data at the place (ForensicWeather)",
    tropical: "Hurricane wind or water (TropicalWeather)",
    aviation: "Nearest airports' weather record (AviationWeather)",
  };

  function compose(inp, place, sections) {
    const ref = $("ref").value.trim(), forWhom = $("for").value.trim();
    const skipped = [];
    if ($("incTropical").checked && !sections.some((s) => s.key === "tropical")) skipped.push("No tropical cyclone passed within 250 miles of the place within 3 days of the date, or its record couldn't be loaded.");
    if ($("incAviation").checked && !sections.some((s) => s.key === "aviation")) skipped.push("No airport weather record was included (no reporting airport within 60 nautical miles, or the archive couldn't be loaded).");
    const facts = [
      ["Place", `${place.label}${/^-?\d/.test(place.label) ? "" : ` (${place.lat.toFixed(4)}, ${place.lon.toFixed(4)})`}`],
      ["Event time", utcText(place.isoUtc)],
      ref ? ["Reference", ref] : null,
      forWhom ? ["Prepared for", forWhom] : null,
      ["Prepared", `${utcText(new Date().toISOString())} by Standard Weather Forensics & Consulting`],
      ["Link", location.href],
    ].filter(Boolean);
    $("paper").innerHTML = `
      <div class="cover"><div><h1>Weather case file</h1><p class="meta">Standard Weather Forensics &amp; Consulting · standardweather.github.io</p>
        <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div>
        <img src="assets/logo-light.png" alt="" /></div>
      <h3>Contents</h3><ol class="toc">${sections.map((s) => `<li>${esc(HEADINGS[s.key] || s.title)}${s.complete ? "" : " (partly loaded)"}</li>`).join("")}<li>Sources and limits</li></ol>
      ${skipped.map((t) => `<p class="meta">${esc(t)}</p>`).join("")}
      ${sections.map((s, i) => `<section class="case-sec"><h2>${i + 1}. ${esc(HEADINGS[s.key] || s.title)}</h2>${s.key !== "past" ? `<p class="meta">${esc(s.title)}</p>` : ""}${s.complete ? "" : `<p class="missing">Part of this section was still loading when the file was built.</p>`}${s.html}</section>`).join("")}
      <section class="case-sec" style="break-before:auto"><h2>${sections.length + 1}. Sources and limits</h2>
        <p class="meta">Radar, hail size, rotation and rain: NOAA MRMS. Storm reports: NOAA SPC (preliminary) and the NCEI Storm Events Database (official). Station observations: NOAA NCEI and the National Weather Service.
          Warnings: NWS products archived by the Iowa Environmental Mesonet. Lightning: NOAA GOES Geostationary Lightning Mapper. Climate normals and records: NOAA ACIS.
          Tropical cyclone tracks and wind radii: NOAA/NHC HURDAT2, with wind at the place estimated from them; water levels: NOAA CO-OPS tide gauges; ground height: USGS 3DEP.
          Airport reports, forecasts and advisories: NWS and the Aviation Weather Center, archived by the Iowa Environmental Mesonet.</p>
        <p class="meta">Radar hail sizes and modeled hurricane winds are estimates, not measurements, and storm reports show only where hail or damage was seen.
          This case file was assembled automatically from public data and is not a certified weather analysis. For a certified report, contact Standard Weather Forensics &amp; Consulting.</p></section>`;
    $("request").href = `/ForensicWeather/?${new URLSearchParams({ request: "report", place: place.label, lat: place.lat.toFixed(4), lon: place.lon.toFixed(4), when: utcText(place.isoUtc), link: location.href })}#contact`;
    document.title = `Case file · ${place.label} · ${inp.date} | Standard Weather`;
    $("result").hidden = false;
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("print").addEventListener("click", () => window.print());

  // A shared link (?loc=…&date=…&time=…) builds straight away; otherwise offer the place last used on any page.
  const p = new URLSearchParams(location.search);
  if (p.get("loc")) {
    $("loc").value = p.get("loc");
    $("date").value = p.get("date") || "";
    $("time").value = (p.get("time") || "").replace(/^(\d{2})(\d{2})$/, "$1:$2");
    if (p.get("ref")) $("ref").value = p.get("ref");
    if ($("date").value && $("time").value) $("build").requestSubmit();
  } else {
    try { const saved = JSON.parse(localStorage.getItem("sw-place") || "null"); if (saved?.label) $("loc").value = saved.label; } catch { /* none saved */ }
  }
})();
