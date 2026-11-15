"""Build the "apparent fishing inside no-take protected areas" layer (stdlib only).

Global Fishing Watch publishes about 50,000 apparent-fishing events a day and the events API cannot filter by
protected area, so this pages through whole days (1,000 events per request, ~250 KB gzipped) and keeps the events
GFW itself tags as inside a no-take marine protected area. Each finished day is cached in backend/data/raw/sea/.

Output: backend/data/processed/protected_fishing.json  (served by GET /api/sea/protected-fishing)

    python3 -I backend/scripts/ingest_sea.py [--days 3] [--lag 4]

"Apparent fishing" is inferred by GFW from how a vessel moves. A no-take area can still permit named vessels,
research or transit, so every record is a lead to check with the managing authority, never a finding.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))          # ROOT is the backend folder
from ghostfleet.gfw import GFWError  # noqa: E402
from ghostfleet.sea import GFW, PROTECTED_FISHING, _get, slim_fishing  # noqa: E402

RAW = ROOT / "data/raw/sea"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def fetch_day(day: date) -> dict:
    path = RAW / f"fishing_notake_{day.isoformat()}.json"
    if path.exists():
        return json.loads(path.read_text())
    q = {"datasets[0]": "public-global-fishing-events:latest", "start-date": day.isoformat(),
         "end-date": (day + timedelta(days=1)).isoformat(), "limit": "1000"}
    kept, scanned, offset, total = [], 0, 0, None
    while offset is not None:
        d = json.loads(_get(f"{GFW}/events?{urllib.parse.urlencode({**q, 'offset': str(offset)})}", token=True, timeout=90, tries=5))
        page = d.get("entries") or []
        total = d.get("total", total)
        scanned += len(page)
        for e in page:
            reg = e.get("regions") or {}
            if reg.get("mpaNoTake") or reg.get("mpaNoTakePartial"):
                kept.append(slim_fishing(e))
        offset = d.get("nextOffset") if page else None
        if scanned % 10000 == 0 or offset is None:
            log(f"  {day}: {scanned}/{total} events scanned, {len(kept)} inside no-take areas")
    out = {"day": day.isoformat(), "scanned": scanned, "events": kept}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=3, help="how many days to scan (about 3 minutes and 13 MB each)")
    ap.add_argument("--lag", type=int, default=4, help="GFW events arrive a few days late; the newest day scanned is today minus this")
    a = ap.parse_args()
    last = date.today() - timedelta(days=a.lag)
    days = [last - timedelta(days=k) for k in range(a.days)]
    seen, events, scanned, done = set(), [], 0, []
    for day in days:                                        # newest first, so a partial run still shows the latest day
        log(f"apparent-fishing events for {day}")
        try:
            d = fetch_day(day)
        except GFWError as e:
            log(f"stopped at {day}: {e}. Finished days are cached; run again to resume.")
            break
        done.append(day.isoformat())
        scanned += d["scanned"]
        for e in d["events"]:
            if e["id"] not in seen and e["lat"] is not None:
                seen.add(e["id"])
                events.append(e)
        out = {"fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "days": sorted(done),
               "scanned": scanned, "events": events}
        PROTECTED_FISHING.parent.mkdir(parents=True, exist_ok=True)
        tmp = PROTECTED_FISHING.with_suffix(".tmp")
        tmp.write_text(json.dumps(out, separators=(",", ":")))
        tmp.replace(PROTECTED_FISHING)
    log(f"wrote {PROTECTED_FISHING}: {len(events)} events inside no-take areas out of {scanned} scanned, days {sorted(done)}")


if __name__ == "__main__":
    main()
