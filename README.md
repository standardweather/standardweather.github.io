# Standard Weather — multi-page site

Public site target: https://standardweather.github.io

Static GitHub Pages (`.nojekyll`). Contact form → FormSubmit → standardwx@gmail.com.

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Home — services + contact |
| `about.html` | About Standard Weather / forensic meteorology |
| `pastweather.html` | Redirect to [PastWeather](https://standardweather.github.io/PastWeather/) (separate `standardweather/PastWeather` repo) |
| — | [FutureWeather](https://standardweather.github.io/FutureWeather/) lives in the separate `standardweather/FutureWeather` repo and loads `css/site.css` from this site |

Shared: `css/site.css`, `logo.png` (dark ink, used for link previews), and `assets/` (white seal for the dark theme, favicons).

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

PastWeather itself lives in the `standardweather/PastWeather` repo; its data sources are documented there.

FutureWeather (GFS forecast maps, rebuilt every 6 hours by GitHub Actions) lives in the `standardweather/FutureWeather` repo. It links to `/css/site.css` and `/assets/` here, so theme changes in this repo apply to it too — keep those paths stable.
