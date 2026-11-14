"""Fetch Sentinel-1 GRD scene footprints over the study box from Microsoft Planetary Computer STAC.

Used as the SAR "valid observation opportunity" denominator for MSDI (no auth needed for search).
Output: data/raw/sentinel1/s1_grd_footprints.geojsonl (one feature per line)
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
BBOX = [56, 20, 70, 26]
START, END = "2020-01-01T00:00:00Z", "2026-11-01T00:00:00Z"
OUT = Path(__file__).resolve().parent.parent / "data/raw/sentinel1/s1_grd_footprints.geojsonl"
KEEP = ("datetime", "platform", "sat:orbit_state", "sat:relative_orbit", "sar:instrument_mode")


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=900) as r:
                return json.load(r)
        except Exception as e:  # transient STAC errors are common; back off
            print(f"retry {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(2 ** attempt)
    raise RuntimeError("STAC request failed")


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = {"collections": ["sentinel-1-grd"], "bbox": BBOX, "datetime": f"{START}/{END}", "limit": 250}
    n = 0
    with OUT.open("w") as f:
        page = post(STAC, body)
        while True:
            for it in page.get("features", []):
                props = {k: it["properties"].get(k) for k in KEEP}
                f.write(json.dumps({"type": "Feature", "id": it["id"], "geometry": it["geometry"], "properties": props}) + "\n")
                n += 1
            nxt = next((l for l in page.get("links", []) if l.get("rel") == "next"), None)
            if not nxt:
                break
            page = post(nxt["href"], nxt.get("body", body))
            print(f"{n} scenes...", file=sys.stderr)
    print(f"wrote {n} scenes -> {OUT}")


if __name__ == "__main__":
    main()
