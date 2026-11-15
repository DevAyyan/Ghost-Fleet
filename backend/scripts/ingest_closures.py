"""Build the "fishing during seasonal closures" layer: backend/data/processed/closures.json (served by /api/sea/closures).

For each seasonal ban below and each year it applied, this asks Global Fishing Watch for apparent fishing effort (AIS) in
the country's EEZ during the ban and during windows of the same length just before and just after it. Each 4Wings report
is cached in backend/data/raw/sea/closures/, so a run interrupted by the network resumes where it stopped.

    python3 backend/scripts/ingest_closures.py

Limits, written into every record: AIS covers mostly larger vessels; bans exempt some vessels (traditional craft,
territorial waters, some licensed fleets) that cannot be told apart in gridded effort; the India coasts are split by
longitude, an approximation. Every record is a lead to check with the fisheries authority, never a finding.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))          # ROOT is the backend folder
from ghostfleet.gfw import CACHE_ROOT, GFWError  # noqa: E402
from ghostfleet.sea import CLOSURES as OUT, GFW, _get  # noqa: E402

CACHE = CACHE_ROOT / "sea" / "closures"
TOP_CELLS = 250
INDIA_SPLIT_LON = 77.6      # Kanyakumari: cells west of it are the west coast (incl. Lakshadweep), east of it the east coast

# Checked against official notices and press reports in Nov 2026. Re-check before each season: dates change.
RULES = [
    {"id": "IN-W", "country": "India", "name": "India west coast monsoon ban", "eez": "8480", "lonMax": INDIA_SPLIT_LON,
     "from": "06-01", "to": "07-31", "years": [2024, 2025, 2026], "confidence": "HIGH",
     "scope": "Fishing vessels in India's EEZ beyond territorial waters on the west coast, including Lakshadweep. "
              "Non-motorised traditional craft are exempt.",
     "sources": ["https://fsi.gov.in/sites/default/files/ministry-notifications-Document/FishingBan.pdf",
                 "https://lakshadweep.gov.in/notice/department-of-fisheries-utla-the-president-of-india-is-pleased-to-impose-a-uniform-ban-on-fishing-vessels-in-the-indian-eez-beyond-territorial-waters-on-the-west-coast-including-lakshadweep-islands/"]},
    {"id": "IN-E", "country": "India", "name": "India east coast ban", "eez": "8480", "lonMin": INDIA_SPLIT_LON,
     "from": "04-15", "to": "06-14", "years": [2024, 2025, 2026], "confidence": "HIGH",
     "scope": "Fishing vessels in India's EEZ beyond territorial waters on the east coast. "
              "Non-motorised traditional craft are exempt. The Andaman and Nicobar EEZ is not included here.",
     "sources": ["https://fsi.gov.in/sites/default/files/ministry-notifications-Document/FishingBan.pdf",
                 "https://styandptg.py.gov.in/2026/APRIL/EXTRAORDINARYPART-I/081-PART-I%20dated%2010-04-2026.pdf"]},
    {"id": "BD", "country": "Bangladesh", "name": "Bangladesh Bay of Bengal ban", "eez": "8481",
     "from": "04-15", "to": "06-11", "years": [2025, 2026], "confidence": "MODERATE",
     "scope": "All fishing in Bangladesh's marine waters (58 days, aligned with India's east coast since 2025; "
              "before 2025 it was 65 days from 20 May, not analysed here).",
     "sources": ["https://www.tbsnews.net/bangladesh/58-day-fishing-ban-be-imposed-bay-bengal-15-april-1404636",
                 "https://today.thefinancialexpress.com.bd/print/58-day-ban-on-fishing-in-bay-to-begin-apr-15-1739810162"]},
    {"id": "PK", "country": "Pakistan", "name": "Pakistan shrimp closed season", "eez": "8359",
     "from": "06-01", "to": "07-31", "years": [2024, 2025, 2026], "confidence": "LOW",
     "scope": "A federal notification closes shrimp catching in the whole Exclusive Fishery Zone from 1 June to 31 July; "
              "Sindh also closes its provincial waters in June and July, but has shortened or lifted the ban early "
              "(2025: lifted on 1 July). Fishing effort from AIS cannot tell shrimp trawling from other fishing.",
     "sources": ["https://tribune.com.pk/story/2553883/sindh-lifts-ban-on-fishing-before-time",
                 "https://balochistan.gov.pk/wp-content/uploads/2024/10/The-Balochistan-Sea-Fisheries-Ordinance-1971-1971.pdf"]},
]


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def report(eez: str, start: date, end: date) -> list[dict]:
    """Fishing-hour cells (0.1 degree) in an EEZ over start..end inclusive, cached on disk."""
    path = CACHE / f"{eez}_{start}_{end}.json"
    if path.exists():
        return json.loads(path.read_text())
    q = {"spatial-resolution": "LOW", "temporal-resolution": "ENTIRE", "datasets[0]": "public-global-fishing-effort:latest",
         "date-range": f"{start},{end + timedelta(days=1)}", "format": "JSON", "region-id": eez,
         "region-dataset": "public-eez-areas"}
    d = json.loads(_get(f"{GFW}/4wings/report?{urllib.parse.urlencode(q)}", token=True, timeout=240, tries=3))
    rows = next(iter(d["entries"][0].values()), None) or []
    cells = [{"lat": r["lat"], "lon": r["lon"], "hours": round(r["hours"], 2), "vessels": r.get("vesselIDs", 0)} for r in rows]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cells, separators=(",", ":")))
    return cells


def in_rule(rule: dict, c: dict) -> bool:
    return ("lonMax" not in rule or c["lon"] < rule["lonMax"]) and ("lonMin" not in rule or c["lon"] >= rule["lonMin"])


def season(rule: dict, year: int) -> dict:
    a = date.fromisoformat(f"{year}-{rule['from']}")
    b = date.fromisoformat(f"{year}-{rule['to']}")
    n = (b - a).days + 1
    windows = {"before": (a - timedelta(days=n), a - timedelta(days=1)), "during": (a, b),
               "after": (b + timedelta(days=1), b + timedelta(days=n))}
    totals, during_cells = {}, []
    for name, (s, e) in windows.items():
        cells = [c for c in report(rule["eez"], s, e) if in_rule(rule, c)]
        totals[name] = round(sum(c["hours"] for c in cells), 1)
        if name == "during":
            during_cells = sorted(cells, key=lambda c: -c["hours"])
    ref = [totals["before"], totals["after"]]
    ref_mean = sum(ref) / 2
    return {"year": year, "start": a.isoformat(), "end": b.isoformat(), "days": n,
            "hoursBefore": totals["before"], "hoursDuring": totals["during"], "hoursAfter": totals["after"],
            "ratio": round(totals["during"] / ref_mean, 3) if ref_mean > 0 else None,
            "cellsDuring": len(during_cells), "cells": during_cells[:TOP_CELLS]}


def main() -> None:
    out = []
    for rule in RULES:
        seasons = []
        for year in rule["years"]:
            if date.fromisoformat(f"{year}-{rule['to']}") + timedelta(days=60) > date.today():
                log(f"{rule['id']} {year}: season not over long enough ago, skipped")
                continue
            for attempt in range(3):
                try:
                    seasons.append(season(rule, year))
                    break
                except GFWError as e:
                    log(f"{rule['id']} {year}: {e} (try {attempt + 1})")
                    time.sleep(5)
            else:
                log(f"{rule['id']} {year}: gave up; finished reports are cached, run again to resume")
                continue
            s = seasons[-1]
            log(f"{rule['id']} {year}: {s['hoursDuring']} h during vs {s['hoursBefore']} before / {s['hoursAfter']} after")
        out.append({k: v for k, v in rule.items() if k != "years"} | {"seasons": seasons})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = {"fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "closures": out}
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, separators=(",", ":")))
    tmp.replace(OUT)
    log(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
