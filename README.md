# Standard Weather — multi-page site

Public site target: https://standardweather.github.io

Static GitHub Pages (`.nojekyll`). Contact form → FormSubmit → standardwx@gmail.com.

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Home: introduction and the free tool cards. Old `/#contact` and `/?request=report` links forward to ForensicWeather |
| `ForensicWeather/` | ForensicWeather (`index.html`, `app.js`, `glm.js`): the forensic and consulting pitch, the archived-weather lookup that was PastWeather, the case file / profile / notable events cards, services and the contact form (FormSubmit). Reads the History and Storm Events files from `/PastWeather/data/`, which the `standardweather/pastweather` repo still builds weekly |
| `about.html` | About Standard Weather / forensic meteorology |
| `profile.html` | Property weather profile (`js/profile.js`): hail, wind and tornado history from the pastweather repo's tiles, hurricanes within 50 mi from TropicalWeather's HURDAT2 files, FEMA flood zone, USGS ground height, NWS alerts and 7-day forecast |
| `FarmWeather/` | FarmWeather (`index.html`, `app.js`): spray check, field work windows, growing degree days, 4-inch soil temperature (nearest Iowa Environmental Mesonet probe, else an air-temperature estimate), chill hours, frost dates, rain against normal, drought and soil moisture for fields saved in the browser. `data/drought.json` is the weekly U.S. Drought Monitor, simplified by `tools/collect_drought.py` (GitHub Actions, `.github/workflows/drought.yml`) |
| `pastweather.html` | Redirect to [ForensicWeather](https://standardweather.github.io/ForensicWeather/) |
| — | [FutureWeather](https://standardweather.github.io/FutureWeather/) lives in the separate `standardweather/FutureWeather` repo and loads `css/site.css` from this site |

Shared: `css/site.css`, `logo.png` (dark ink, used for link previews), and `assets/` (white seal for the dark theme, favicons). Shared scripts: `js/workwindows.js` (NWS forecast grid, work windows and the GEFS ensemble reader, used by FutureWeather and FarmWeather), `js/geocode.js` (place search, same pages) and `js/mrms.js` (MRMS grids, used by ForensicWeather and NowWeather).

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

PastWeather became ForensicWeather. The `standardweather/pastweather` repo now only builds the data ForensicWeather and the property profile read (`/PastWeather/data/`) and redirects `/PastWeather/` links here, keeping their query string. Its data sources are documented there.

FutureWeather (GFS forecast maps, rebuilt every 6 hours by GitHub Actions) lives in the `standardweather/FutureWeather` repo. It links to `/css/site.css` and `/assets/` here, so theme changes in this repo apply to it too — keep those paths stable.
