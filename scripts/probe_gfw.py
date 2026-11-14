"""Probe Global Fishing Watch access for the study area (critical-path check).

Asks the 4Wings report API for Sentinel-1 SAR vessel detections, AIS-matched vs unmatched,
over a small box off Karachi for one quarter. Reads GLOBAL_FISHING_WATCH from ../.env; never prints it.

    python3 scripts/probe_gfw.py [--full]   # --full: whole study box 20-26N 56-70E, 2024
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://gateway.api.globalfishingwatch.org/v3/4wings/report"
DATASET = "public-global-sar-presence:latest"


def token() -> str:
    env = dict(re.findall(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", (ROOT / ".env").read_text(), re.M))
    t = env.get("GLOBAL_FISHING_WATCH", "").strip().strip("'\"")
    if not t:
        sys.exit("GLOBAL_FISHING_WATCH missing from .env")
    return t


def box(lon0, lat0, lon1, lat1) -> dict:
    return {"type": "Polygon", "coordinates": [[[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]]}


def report(tok: str, geom: dict, date_range: str, matched: bool | None) -> tuple[int, dict | str, float]:
    params = {
        "spatial-resolution": "LOW",          # 0.1 degree
        "temporal-resolution": "MONTHLY",
        "datasets[0]": DATASET,
        "date-range": date_range,
        "format": "JSON",
    }
    if matched is not None:
        params["filters[0]"] = f"matched='{str(matched).lower()}'"
    url = f"{API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, data=json.dumps({"geojson": geom}).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json",
                                          "User-Agent": "ghostfleet-x/0.1"})   # Cloudflare 1010 blocks Python-urllib
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return r.status, json.load(r), time.time() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:600], time.time() - t0


def summarise(body: dict) -> tuple[int, int, set]:
    rows = [row for entry in body.get("entries", []) for rows in entry.values() for row in (rows or [])]
    months = {r.get("date") for r in rows}
    total = sum(int(r.get("detections", r.get("value", 0)) or 0) for r in rows)
    return len(rows), total, months


def main():
    full = "--full" in sys.argv
    tok = token()
    geom = box(56, 20, 70, 26) if full else box(66.0, 23.5, 67.5, 24.9)   # small box off Karachi
    dr = "2024-01-01,2025-01-01" if full else "2024-01-01,2024-04-01"
    print(f"area={'study box' if full else 'Karachi coast box'} dates={dr}")
    for label, matched in (("unmatched (dark)", False), ("AIS-matched", True)):
        status, body, dt = report(tok, geom, dr, matched)
        if status != 200:
            print(f"  {label:17s} HTTP {status} in {dt:.0f}s -> {body}")
            continue
        n, total, months = summarise(body)
        print(f"  {label:17s} HTTP 200 in {dt:.0f}s: {n} cell-months, {total} detections, months={sorted(m for m in months if m)}")
        if n:
            sample = next(row for entry in body["entries"] for rows in entry.values() for row in rows)
            print(f"  sample row keys: {sorted(sample)}")


if __name__ == "__main__":
    main()
