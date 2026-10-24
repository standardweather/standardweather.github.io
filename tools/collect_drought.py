"""Collect the current U.S. Drought Monitor map for FarmWeather (FarmWeather/data/drought.json).

The Drought Monitor (National Drought Mitigation Center, USDA, NOAA) is released every Thursday, valid the Tuesday
before. Its GeoJSON is about 17 MB, too large for a phone, so the polygons are simplified to about 1 km and the
coordinates rounded. Output: {"valid": "YYYY-MM-DD", "fetched": ISO time, "features": [GeoJSON features with "DM"]}.

    pip install requests shapely
    python tools/collect_drought.py
"""

import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from shapely.geometry import mapping, shape

URL = "https://droughtmonitor.unl.edu/data/json/usdm_{}.json"
OUT = Path(__file__).resolve().parent.parent / "FarmWeather" / "data" / "drought.json"
TOLERANCE = 0.01   # degrees, about 1 km


def latest():
    """The newest weekly map: the most recent Tuesday that has a file, looking back up to five weeks."""
    d = date.today()
    d -= timedelta(days=(d.weekday() - 1) % 7)
    for _ in range(6):
        r = requests.get(URL.format(d.strftime("%Y%m%d")), timeout=120)
        if r.ok:
            return d, r.json()
        d -= timedelta(days=7)
    sys.exit("No Drought Monitor map found in the last five weeks")


def rounded(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 3), round(coords[1], 3)]
    return [rounded(c) for c in coords]


def main():
    valid, data = latest()
    if OUT.exists() and json.loads(OUT.read_text()).get("valid") == valid.isoformat():
        print(f"Drought Monitor {valid} already collected")
        return
    features = []
    for f in data["features"]:
        geom = shape(f["geometry"]).simplify(TOLERANCE, preserve_topology=True)
        if geom.is_empty:
            continue
        g = mapping(geom)
        features.append({"type": "Feature", "properties": {"DM": int(f["properties"]["DM"])},
                         "geometry": {"type": g["type"], "coordinates": rounded(g["coordinates"])}})
    features.sort(key=lambda f: f["properties"]["DM"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"valid": valid.isoformat(), "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                               "features": features}, separators=(",", ":")))
    print(f"Drought Monitor {valid}: {len(features)} categories, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
