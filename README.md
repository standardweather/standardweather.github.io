# Standard Weather — multi-page site

Public site target: https://standardweather.github.io

Static GitHub Pages (`.nojekyll`). Contact form → FormSubmit → standardwx@gmail.com.

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Home — services + contact |
| `about.html` | About Standard Weather / forensic meteorology |
| `pastweather.html` | PastWeather — live IEM radar + SPC reports (Leaflet) |

Shared: `css/site.css`, `js/pastweather.js`, `logo.png`.

## Upload to GitHub Pages

1. Create or open the `standardweather.github.io` repo (or the Pages-enabled branch).
2. Copy **all** files from this folder to the site root (keep `css/`, `js/`, `.nojekyll`).
3. Commit and push. Pages should serve `index.html` at `/`.
4. Confirm FormSubmit still delivers to `standardwx@gmail.com` after the first live submit.

## Local preview

```bash
cd standard-weather-multipage
python3 -m http.server 8080
# open http://localhost:8080/
```

PastWeather needs network access to IEM, SPC, and Nominatim. Geocode is rate-limited; prefer `lat, lon` if Nominatim throttles.

## PastWeather data (Developer)

Live client-side fetches (no API keys, no proxy):

- Radar scans: `https://mesonet.agron.iastate.edu/json/radar.py?operation=list&radar=USCOMP&product=N0Q&start=…&end=…`
- Tiles: `https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::USCOMP-N0Q-{YYYYMMDDHHMI}/{z}/{x}/{y}.png`
- SPC: `https://www.spc.noaa.gov/climo/reports/{YYMMDD}_rpts_filtered.csv` (GET only, no custom headers)
- Geocode: Nominatim + `lat, lon` paste; sessionStorage cache

Hooks on `window.PastWeather`: `fetchRadar`, `fetchReports`, `geocodePlace`, `iemRadarTileTemplate`, `spcFilteredCsvUrl`.

Demo radar/reports appear only if live fetch fails.
