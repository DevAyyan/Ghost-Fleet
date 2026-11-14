"""Build the real Ghost Fleet X panel for every ocean from live APIs (stdlib only).

Sources (all fetched live and cached in data/raw/; the two most recent months are re-fetched):
  * Global Fishing Watch 4Wings  public-global-sar-presence  -> SAR detections, AIS-matched / unmatched (0.1°),
    one gzipped request per month and match flag for the whole world (~250 KB each), via backend/ghostfleet/gfw.py
  * Element 84 Earth Search STAC  sentinel-1-grd (IW)         -> Sentinel-1 scenes touching each cell each month,
    counted on the server (geohash aggregation), so no footprints are downloaded
  * NASA POWER monthly regional WS10M                         -> wind, only for the 10° tiles that contain cells

The analysis grid is the geohash precision-3 grid: 1.40625° cells (360/256 = 180/128), which is what lets the
Sentinel-1 coverage be counted server-side. AIS reception is approximated per ~11° region (8 x 8 cells) by the
AIS-matched radar detections per pass there. Chlorophyll is not fetched for the global build.

Output: data/processed/panel_real.json  (read by backend/ghostfleet/real.py)

    python3 -I scripts/ingest_real.py [--start 2020-01] [--refresh-all] [--skip-wind] [--min-detections 150]
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from ghostfleet.gfw import GFWError, GFWLive  # noqa: E402  (stdlib-only module; shares the map's cache)

RAW = ROOT / "data/raw"
OUT = ROOT / "data/processed/panel_real.json"
UA = "ghostfleet-x/0.1"
RES = 1.40625                          # analysis cell size, degrees (geohash precision 3)
NLAT, NLON = 128, 256
REGION = 8                             # AIS-reception region = 8 x 8 cells (11.25°)
ES = "https://earth-search.aws.element84.com/v1/aggregate"
ES_AGG = "geometry_geohash_grid_frequency"
ES_BANDS = 8                           # 45° longitude bands keep each answer under the server's 10,000-bucket cap
ES_BUCKET_CAP = 10000
# GFW's detections only used Sentinel-1A/B until mid-2026: from Jan 2025 (Sentinel-1C in service) to Jun 2026 the
# detections per scene halve if 1C/1D scenes are counted, then jump back in Jul 2026 when detections double.
# So 1C/1D scenes count as observation opportunities only from this month on. See docs/decisions.md item 14.
GFW_USES_S1CD_FROM = "2026-07"
S1CD_FIRST_MONTH = "2024-12"
B32 = "0123456789bcdefghjkmnpqrstuvwxyz"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def http(url: str, body: dict | None = None, headers: dict | None = None, timeout=90, tries=5) -> bytes:
    h = {"User-Agent": UA, "Accept-Encoding": "gzip", **(headers or {})}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=timeout) as r:
                raw = r.read()
                return gzip.decompress(raw) if r.headers.get("Content-Encoding") == "gzip" else raw
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403, 404, 422):
                raise RuntimeError(f"HTTP {e.code} for {url.split('?')[0]}: {e.read().decode(errors='replace')[:300]}")
            log(f"  retry {i + 1} ({e.code})")
        except Exception as e:  # network hiccup
            log(f"  retry {i + 1} ({type(e).__name__}: {e})")
        time.sleep(3 * 2 ** i)
    raise RuntimeError(f"failed after {tries} tries: {url.split('?')[0]}")


# ---------------------------------------------------------------- time axis
def month_range(start: str, end: str) -> list[str]:
    y, m = map(int, start.split("-"))
    ey, em = map(int, end.split("-"))
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def last_complete_month() -> str:
    t = date.today()
    y, m = (t.year - 1, 12) if t.month == 1 else (t.year, t.month - 1)
    return f"{y:04d}-{m:02d}"


def next_month(m: str) -> str:
    y, mo = map(int, m.split("-"))
    return f"{y + 1}-01" if mo == 12 else f"{y}-{mo + 1:02d}"


# ---------------------------------------------------------------- grid
def cell_of(lat: float, lon: float) -> tuple[int, int]:
    return min(NLAT - 1, max(0, int((lat + 90) // RES))), int((lon + 180) // RES) % NLON


def cell_center(i: int, j: int) -> tuple[float, float]:
    return -90 + (i + 0.5) * RES, -180 + (j + 0.5) * RES


def cell_id(i: int, j: int) -> str:
    lat, lon = cell_center(i, j)
    return f"{'N' if lat >= 0 else 'S'}{abs(lat):.2f}{'E' if lon >= 0 else 'W'}{abs(lon):.2f}"


def geohash_cell(h: str) -> tuple[int, int]:
    """Precision-3 geohash -> (i, j) on the analysis grid (bits alternate lon, lat, starting with lon)."""
    lat = lon = 0
    n = 0
    for ch in h:
        v = B32.index(ch)
        for k in (4, 3, 2, 1, 0):
            b = (v >> k) & 1
            if n % 2 == 0:
                lon = lon * 2 + b
            else:
                lat = lat * 2 + b
            n += 1
    return lat, lon


# ---------------------------------------------------------------- GFW SAR detections
def fetch_sar(months, refresh_all: bool):
    """Per-cell monthly unmatched / matched detections for the whole world."""
    gfw = GFWLive(timeout=90)      # a month normally arrives in a few seconds; fail fast on a stalled connection
    T = len(months)
    unmatched = defaultdict(lambda: [0.0] * T)
    matched = defaultdict(lambda: [0.0] * T)
    for k, m in enumerate(months):
        t0 = time.time()
        try:
            d = gfw.detections(m, refresh=refresh_all)
        except GFWError as e:
            sys.exit(f"GFW failed at {m}: {e}. Months already fetched are cached; run again to resume.")
        for lat, lon, u, mm in d["points"]:
            c = cell_of(lat, lon)
            unmatched[c][k] += u
            matched[c][k] += mm
        dt = time.time() - t0
        if dt > 0.5 or k % 12 == 0 or k == T - 1:
            log(f"GFW SAR {m}: {len(d['points'])} locations{'' if dt > 0.5 else ' (cached)'}")
    return unmatched, matched


# ---------------------------------------------------------------- Sentinel-1 coverage (counted server-side)
def s1ab_only(m: str) -> bool:
    return S1CD_FIRST_MONTH <= m < GFW_USES_S1CD_FROM


def fetch_s1_month(m: str) -> dict:
    cover, truncated = {}, 0
    query = {"sar:instrument_mode": {"eq": "IW"}}
    if s1ab_only(m):
        query["platform"] = {"in": ["sentinel-1a", "sentinel-1b"]}
    width = NLON // ES_BANDS
    for b in range(ES_BANDS):
        lon0 = -180 + b * 360 / ES_BANDS
        q = {"collections": "sentinel-1-grd", "datetime": f"{m}-01T00:00:00Z/{next_month(m)}-01T00:00:00Z",
             "bbox": f"{lon0},-90,{lon0 + 360 / ES_BANDS},90", "aggregations": f"total_count,{ES_AGG}",
             f"{ES_AGG}_precision": "3", "query": json.dumps(query)}
        aggs = {a["name"]: a for a in json.loads(http(f"{ES}?{urllib.parse.urlencode(q)}"))["aggregations"]}
        buckets = aggs[ES_AGG]["buckets"]
        truncated += len(buckets) >= ES_BUCKET_CAP
        for bk in buckets:
            i, j = geohash_cell(bk["key"])
            if j // width == b:          # a scene touching a cell also touches the cell's band, so this count is complete
                cover[(i, j)] = bk["frequency"]
    return {"cells": [[i, j, n] for (i, j), n in sorted(cover.items())], "truncatedBands": truncated}


def fetch_s1(months, force_months, workers: int):
    def one(m):
        path = RAW / f"sentinel1/cover_{m}{'_s1ab' if s1ab_only(m) else ''}.json"
        if path.exists() and m not in force_months:
            return m, json.loads(path.read_text())
        d = fetch_s1_month(m)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(d, separators=(",", ":")))
        log(f"Sentinel-1 coverage {m}: {len(d['cells'])} cells, {sum(c[2] for c in d['cells'])} scene-cell overlaps")
        return m, d
    with ThreadPoolExecutor(workers) as ex:
        out = dict(ex.map(one, months))
    bad = [m for m, d in out.items() if d.get("truncatedBands")]
    if bad:
        log(f"WARNING: coverage answer hit the bucket cap in {len(bad)} month(s); low-coverage cells may be missing")
    return {m: {(i, j): n for i, j, n in d["cells"]} for m, d in out.items()}, bad


# ---------------------------------------------------------------- NASA POWER wind (10° tiles that contain cells)
MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def fetch_wind(cells, y0: int, y1: int, workers: int, force: bool):
    """cell -> {month: mean WS10M over the POWER grid points inside the cell}. Tiles that fail are skipped."""
    cellset = set(cells)
    tiles = sorted({(int(math.floor(lat / 10) * 10), int(math.floor(lon / 10) * 10))
                    for lat, lon in (cell_center(*c) for c in cells)})
    log(f"NASA POWER wind: {len(tiles)} tiles of 10°")
    done = [0]

    def one(t):
        la, lo = t
        path = RAW / f"power/global/WS10M_{la:+03d}_{lo:+04d}_{y0}-{y1}.csv"
        if not path.exists() or force:
            url = ("https://power.larc.nasa.gov/api/temporal/monthly/regional?parameters=WS10M&community=RE"
                   f"&latitude-min={la}&latitude-max={la + 10}&longitude-min={lo}&longitude-max={lo + 10}"
                   f"&start={y0}&end={y1}&format=CSV")
            try:
                data = http(url, timeout=90, tries=3)
            except RuntimeError as e:
                log(f"  wind tile {la},{lo} unavailable: {e}")
                return t, None
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            done[0] += 1
            if done[0] % 20 == 0:
                log(f"  wind: {done[0]} tiles downloaded")
        return t, path.read_text()

    with ThreadPoolExecutor(workers) as ex:
        texts = list(ex.map(one, tiles))
    acc = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
    for _, text in texts:
        if not text:
            continue
        body = text[text.index("-END HEADER-") + len("-END HEADER-"):].lstrip() if "-END HEADER-" in text else text
        for row in csv.DictReader(io.StringIO(body)):
            try:
                c = cell_of(float(row["LAT"]), float(row["LON"]))
            except (KeyError, ValueError):
                continue
            if c not in cellset:
                continue
            for k, name in enumerate(MON):
                v = float(row.get(name) or -999)
                if v > -900:
                    a = acc[c][f"{row['YEAR']}-{k + 1:02d}"]
                    a[0] += v
                    a[1] += 1
    missing = sum(1 for _, text in texts if not text)
    return {c: {m: s / n for m, (s, n) in mm.items()} for c, mm in acc.items()}, missing, len(tiles)


# ---------------------------------------------------------------- assemble
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2020-01")
    ap.add_argument("--end", default=last_complete_month())
    ap.add_argument("--refresh-all", action="store_true", help="ignore every cache")
    ap.add_argument("--skip-wind", action="store_true", help="build without NASA POWER wind (the weather step then does nothing)")
    ap.add_argument("--skip-chl", action="store_true", help="accepted for compatibility; chlorophyll is never fetched globally")
    ap.add_argument("--min-detections", type=int, default=150,
                    help="keep cells with at least this many radar detections over the whole window")
    ap.add_argument("--offline", action="store_true", help="do not re-fetch the two most recent months of Sentinel-1 coverage")
    ap.add_argument("--workers", type=int, default=8, help="parallel requests for Sentinel-1 coverage (wind uses half)")
    a = ap.parse_args()

    months = month_range(a.start, a.end)
    T = len(months)
    force_months = set(months) if a.refresh_all else set() if a.offline else set(months[-2:])
    log(f"window {months[0]}..{months[-1]} ({T} months), whole world, {RES}° cells")

    # Sentinel-1 coverage downloads in the background while the GFW months come in one at a time
    with ThreadPoolExecutor(1) as bg:
        s1_job = bg.submit(fetch_s1, months, force_months, a.workers)
        unmatched, matched = fetch_sar(months, a.refresh_all)
        cover, truncated_months = s1_job.result()

    total = {c: sum(unmatched[c]) + sum(matched[c]) for c in set(unmatched) | set(matched)}
    cells = sorted(c for c, n in total.items() if n >= a.min_detections)
    log(f"{len(cells)} analysis cells with >= {a.min_detections} detections (of {len(total)} cells with any)")
    centers = {c: cell_center(*c) for c in cells}
    opp = {c: [float(cover[m].get(c, 0)) for m in months] for c in cells}

    # AIS reception per region: AIS-matched radar detections per Sentinel-1 pass over the region's cells
    region_of = {c: f"R{c[0] // REGION:02d}_{c[1] // REGION:02d}" for c in cells}
    reg_m = defaultdict(lambda: [0.0] * T)
    reg_o = defaultdict(lambda: [0.0] * T)
    for c in cells:
        for k in range(T):
            if opp[c][k] > 0:
                reg_m[region_of[c]][k] += matched[c][k]
                reg_o[region_of[c]][k] += opp[c][k]
    ais_regions = {r: [reg_m[r][k] / reg_o[r][k] if reg_o[r][k] >= 3 else math.nan for k in range(T)] for r in reg_o}

    wind_by_cell, notes = {}, ["Chlorophyll is not included in the global build; the weather step uses wind only."]
    if a.skip_wind:
        notes.append("Wind not included in this build (--skip-wind); the weather step does nothing.")
        log("wind skipped (--skip-wind)")
    else:
        y0, y1 = int(months[0][:4]), min(int(months[-1][:4]), date.today().year - 1)
        wind_by_cell, missing, n_tiles = fetch_wind(cells, y0, y1, max(1, a.workers // 2), a.refresh_all)
        if missing:
            notes.append(f"Wind is missing for {missing} of {n_tiles} tiles (NASA POWER did not answer); those cells use seasonal normal.")
    if truncated_months:
        notes.append(f"Sentinel-1 coverage may be incomplete for low-coverage cells in {len(truncated_months)} month(s).")
    wind = {c: [wind_by_cell.get(c, {}).get(m, math.nan) for m in months] for c in cells}

    cellset = set(cells)
    neighbors = {cell_id(i, j): [cell_id(i + di, j + dj) for di in (-1, 0, 1) for dj in (-1, 0, 1)
                                 if (di or dj) and (i + di, j + dj) in cellset] for (i, j) in cells}

    def ring(i, j):
        lat, lon = cell_center(i, j)
        h = RES / 2
        return [[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h]]

    def clean(xs, nd=4):
        return [None if (x is None or (isinstance(x, float) and math.isnan(x))) else round(x, nd) for x in xs]

    def ints(xs):
        return [int(x) for x in xs]

    out = {
        "schema": 1,
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "months": months,
        "grid": {"resolutionDeg": RES, "bbox": [-180, -90, 180, 90]},
        "cells": [{
            "id": cell_id(*c), "center": [round(centers[c][1], 6), round(centers[c][0], 6)], "boundary": ring(*c),
            "unmatched": ints(unmatched[c]), "matched": ints(matched[c]), "opportunities": ints(opp[c]),
            "wind": clean(wind[c], 2) if c in wind_by_cell else None, "chl": None, "aisRegion": region_of[c],
        } for c in cells],
        "neighbors": neighbors,
        "aisReceptionByRegion": {r: clean(v, 5) for r, v in sorted(ais_regions.items())},
        "notes": notes,
        "sources": [
            {"name": "Global Fishing Watch SAR vessel detections (public-global-sar-presence), worldwide",
             "role": "Vessel detections, AIS-matched/unmatched", "url": "https://globalfishingwatch.org/our-apis/"},
            {"name": "Sentinel-1 GRD IW scenes, counted per cell by Element 84 Earth Search (STAC aggregation)",
             "role": "Observation opportunities (scenes touching the cell each month)",
             "url": "https://earth-search.aws.element84.com/v1/collections/sentinel-1-grd"},
            {"name": "AIS-matched radar detections per pass in the surrounding ~11° region (from the GFW data above)",
             "role": "AIS reception proxy (also reflects real traffic changes, e.g. 2024 Red Sea rerouting)",
             "url": "https://globalfishingwatch.org/our-apis/"},
            {"name": "NASA POWER monthly WS10M", "role": "Wind (to the last full year; later months use seasonal normal)",
             "url": "https://power.larc.nasa.gov/"},
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, separators=(",", ":")))
    tmp.replace(OUT)
    n_det = sum(sum(c["unmatched"]) + sum(c["matched"]) for c in out["cells"])
    log(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB): {len(cells)} cells x {T} months, {n_det} detections, "
        f"{len(ais_regions)} AIS regions, wind for {len(wind_by_cell)} cells")


if __name__ == "__main__":
    main()
