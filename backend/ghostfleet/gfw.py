"""Live Global Fishing Watch client: Sentinel-1 SAR vessel detections, worldwide.

Each month is fetched straight from the GFW 4Wings API (AIS-matched and unmatched, 0.1° bins) for the whole
world: about 250 KB per request with gzip. Responses are cached on disk; past months are kept, the two most
recent months refresh after `fresh_hours`. The map and scripts/ingest_real.py share this client and cache.
GFW allows one report at a time per token, so requests are serialised here and a 429 is retried.
Token: GLOBAL_FISHING_WATCH from the repo's .env (or the environment). It is never logged.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ON_VERCEL = bool(os.getenv("VERCEL"))
# Where fetched data is cached. On Vercel the code directory is read-only, so the cache lives in /tmp: it is private to
# one running instance and disappears when that instance stops. The CDN cache headers in api/main.py do the lasting work there.
CACHE_ROOT = Path(os.getenv("GHOSTFLEET_CACHE") or ("/tmp/ghostfleet" if ON_VERCEL else ROOT / "data" / "raw"))
API = "https://gateway.api.globalfishingwatch.org/v3/4wings/report"
DATASET = "public-global-sar-presence:latest"
BBOX = (-180.0, -85.0, 180.0, 85.0)   # lon0, lat0, lon1, lat1: every ocean
UA = "ghostfleet-x/0.1"           # GFW sits behind Cloudflare, which blocks the default Python user agent


class GFWError(RuntimeError):
    """GFW could not be reached or refused the request."""


def _token() -> str:
    tok = os.getenv("GLOBAL_FISHING_WATCH", "")
    env = ROOT / ".env"
    if not tok and env.exists():
        vals = dict(re.findall(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", env.read_text(), re.M))
        tok = vals.get("GLOBAL_FISHING_WATCH", "")
    tok = tok.strip().strip("'\"")
    if not tok:
        raise GFWError("GLOBAL_FISHING_WATCH token missing from .env")
    return tok


def month_axis(start: str = "2020-01") -> list[str]:
    """2020-01 .. last complete month (GFW SAR data lags about a month)."""
    t = date.today()
    ey, em = (t.year - 1, 12) if t.month == 1 else (t.year, t.month - 1)
    y, m = map(int, start.split("-"))
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


class GFWLive:
    _one_report = threading.Lock()   # GFW: one concurrent report per token

    def __init__(self, cache_dir: Path | None = None, fresh_hours: float = 6.0, timeout: float = 180):
        self.cache_dir = cache_dir or CACHE_ROOT / "gfw" / "global"
        self.fresh_s = fresh_hours * 3600
        self.timeout = timeout
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    def _request(self, month: str, matched: bool) -> list[dict]:
        y, m = map(int, month.split("-"))
        end = f"{y + 1}-01-01" if m == 12 else f"{y}-{m + 1:02d}-01"
        params = {"spatial-resolution": "LOW", "temporal-resolution": "MONTHLY", "datasets[0]": DATASET,
                  "date-range": f"{month}-01,{end}", "format": "JSON", "filters[0]": f"matched='{str(matched).lower()}'"}
        lon0, lat0, lon1, lat1 = BBOX
        geom = {"type": "Polygon", "coordinates": [[[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]]}
        req = urllib.request.Request(f"{API}?{urllib.parse.urlencode(params)}", data=json.dumps({"geojson": geom}).encode(),
                                     headers={"Authorization": f"Bearer {_token()}", "Content-Type": "application/json",
                                              "User-Agent": UA, "Accept-Encoding": "gzip"}, method="POST")
        last = None
        for attempt in range(6):
            try:
                with self._one_report, urllib.request.urlopen(req, timeout=self.timeout) as r:
                    raw = r.read()
                    if r.headers.get("Content-Encoding") == "gzip":
                        raw = gzip.decompress(raw)
                body = json.loads(raw)
                return [row for e in body.get("entries", []) for rows in e.values() for row in (rows or [])]
            except urllib.error.HTTPError as e:
                if e.code in (401, 403, 422):
                    raise GFWError(f"GFW refused the request (HTTP {e.code})") from e
                last = e   # 429 = another report (e.g. the ingest) is running on this token: wait and retry
            except Exception as e:  # network hiccup on venue Wi-Fi
                last = e
            time.sleep(min(20, 2 * (attempt + 1)))
        raise GFWError(f"GFW unreachable: {type(last).__name__}")

    def detections(self, month: str, refresh: bool = False) -> dict:
        """{'month', 'fetchedAt', 'points': [[lat, lon, unmatched, matched], ...]} for one month, worldwide."""
        path = self.cache_dir / f"sar_{month}.json"
        recent = month in month_axis()[-2:]
        with self._guard:
            lock = self._locks.setdefault(month, threading.Lock())
        with lock:   # one fetch per month even under concurrent requests
            if path.exists() and not refresh and not (recent and time.time() - path.stat().st_mtime > self.fresh_s):
                return json.loads(path.read_text())
            bins: dict[tuple[float, float], list[int]] = {}
            for matched in (False, True):
                for r in self._request(month, matched):
                    key = (round(float(r["lat"]), 2), round(float(r["lon"]), 2))
                    bins.setdefault(key, [0, 0])[1 if matched else 0] += int(r.get("detections", 0) or 0)
            out = {"month": month, "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "points": [[lat, lon, u, m] for (lat, lon), (u, m) in sorted(bins.items())]}
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(f".{os.getpid()}.tmp")   # the API and the ingest may write the same month
            tmp.write_text(json.dumps(out, separators=(",", ":")))
            tmp.replace(path)
            return out
