"""Live Global Fishing Watch client: Sentinel-1 SAR vessel detections, worldwide.

Each month is fetched straight from the GFW 4Wings API (AIS-matched and unmatched, 0.1° bins) for the whole
world: about 250 KB per request with gzip. Responses are cached on disk; past months are kept, the two most
recent months refresh after `fresh_hours`. The map and backend/scripts/ingest_real.py share this client and cache.
GFW allows one report at a time per token, so requests are serialised here and a 429 is retried.
Token: GLOBAL_FISHING_WATCH from the environment, or from backend/.env or the repo's .env. It is never logged.
"""
from __future__ import annotations

import contextvars
import gzip
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Callable

from .shared_cache import SharedCache

ROOT = Path(__file__).resolve().parents[1]      # the backend folder: self-contained (code, data/, scripts/), deployable alone
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


class BudgetExceeded(GFWError):
    """The request's time budget for upstream calls ran out before the upstream answered."""


# ---------- per-request time budget for upstream calls ----------
# A Vercel function is killed at maxDuration (60 s, vercel.json). Each API request therefore gets UPSTREAM_BUDGET_S for
# all its upstream calls together: a call that would run past it fails fast with BudgetExceeded (a clear 504), and the
# disk/shared cache can still serve a stale copy. Scripts run with no budget (no deadline set), so ingestion is unaffected.
UPSTREAM_BUDGET_S = float(os.getenv("GHOSTFLEET_UPSTREAM_BUDGET", "40"))
_deadline: contextvars.ContextVar[float | None] = contextvars.ContextVar("upstream_deadline", default=None)


@contextmanager
def upstream_budget(seconds: float = UPSTREAM_BUDGET_S):
    """Every upstream call made inside this block (also from threads started with `parallel`) shares one deadline."""
    token = _deadline.set(time.monotonic() + seconds)
    try:
        yield
    finally:
        _deadline.reset(token)


def time_left() -> float | None:
    """Seconds left in the current request's budget, or None when there is no budget (scripts, tests)."""
    d = _deadline.get()
    return None if d is None else d - time.monotonic()


def call_timeout(timeout: float) -> float:
    """The socket timeout for the next upstream call: its own limit, cut to what is left of the budget."""
    left = time_left()
    if left is None:
        return timeout
    if left < 1.0:
        raise BudgetExceeded(f"upstream sources did not answer within the {UPSTREAM_BUDGET_S:.0f} s allowed per request")
    return min(timeout, left)


def may_wait(seconds: float) -> bool:
    """Is there budget left to sleep `seconds` before a retry and still make a useful call afterwards?"""
    left = time_left()
    return left is None or left - seconds > 3.0


def wait_lock(lock: threading.Lock) -> None:
    """Acquire `lock` (another request may be fetching the same thing), giving up when the budget runs out."""
    left = time_left()
    if not lock.acquire(timeout=-1 if left is None else max(0.0, left)):
        raise BudgetExceeded(f"upstream sources did not answer within the {UPSTREAM_BUDGET_S:.0f} s allowed per request")


def parallel(*fns: Callable[[], object]) -> list:
    """Run independent upstream fetches at once; results in argument order. Each thread inherits the caller's budget.
    The first exception (in argument order) is raised once every call has finished, so no fetch is left half-written."""
    if len(fns) <= 1:
        return [f() for f in fns]
    with ThreadPoolExecutor(max_workers=len(fns), thread_name_prefix="upstream") as pool:   # a pool per call: nesting is safe
        futures = [pool.submit(contextvars.copy_context().run, f) for f in fns]
    return [f.result() for f in futures]


def _token() -> str:
    tok = os.getenv("GLOBAL_FISHING_WATCH", "")
    env = next((p for p in (ROOT / ".env", ROOT.parent / ".env") if p.exists()), ROOT / ".env")
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
        self.shared = SharedCache.from_env()

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
        last, tries = None, 6
        for attempt in range(tries):
            try:
                wait_lock(self._one_report)
                try:
                    with urllib.request.urlopen(req, timeout=call_timeout(self.timeout)) as r:
                        raw = r.read()
                        if r.headers.get("Content-Encoding") == "gzip":
                            raw = gzip.decompress(raw)
                finally:
                    self._one_report.release()
                body = json.loads(raw)
                return [row for e in body.get("entries", []) for rows in e.values() for row in (rows or [])]
            except urllib.error.HTTPError as e:
                if e.code in (401, 403, 422):
                    raise GFWError(f"GFW refused the request (HTTP {e.code})") from e
                last = e   # 429 = another report (e.g. the ingest) is running on this token: wait and retry
            except BudgetExceeded:
                raise
            except Exception as e:  # network hiccup on venue Wi-Fi
                last = e
            pause = min(20, 2 * (attempt + 1))
            if attempt == tries - 1 or not may_wait(pause):
                break
            time.sleep(pause)
        if time_left() is not None and time_left() < 5:
            raise BudgetExceeded(f"GFW did not answer within the {UPSTREAM_BUDGET_S:.0f} s allowed per request")
        raise GFWError(f"GFW unreachable: {type(last).__name__}")

    def detections(self, month: str, refresh: bool = False) -> dict:
        """{'month', 'fetchedAt', 'points': [[lat, lon, unmatched, matched], ...]} for one month, worldwide."""
        path = self.cache_dir / f"sar_{month}.json"
        recent = month in month_axis()[-2:]
        with self._guard:
            lock = self._locks.setdefault(month, threading.Lock())
        wait_lock(lock)   # one fetch per month even under concurrent requests
        try:
            if path.exists() and not refresh and not (recent and time.time() - path.stat().st_mtime > self.fresh_s):
                return json.loads(path.read_text())
            key = f"sar/{month}"
            shared = self.shared.get(key) if self.shared and not refresh else None
            if shared and not (recent and time.time() - shared[0] > self.fresh_s):
                self._write(path, shared[1])
                return shared[1]
            bins: dict[tuple[float, float], list[int]] = {}
            try:
                unmatched, matched_rows = self._request(month, False), self._request(month, True)   # one report at a time
            except GFWError:
                if shared:                 # upstream down or too slow: the last good copy, stamped with its fetch time
                    return shared[1]
                raise
            for matched, rows in ((False, unmatched), (True, matched_rows)):
                for r in rows:
                    k = (round(float(r["lat"]), 2), round(float(r["lon"]), 2))
                    bins.setdefault(k, [0, 0])[1 if matched else 0] += int(r.get("detections", 0) or 0)
            out = {"month": month, "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "points": [[lat, lon, u, m] for (lat, lon), (u, m) in sorted(bins.items())]}
            self._write(path, out)
            if self.shared:
                self.shared.put(key, out, 7 * 86400 if recent else 180 * 86400)
            return out
        finally:
            lock.release()

    @staticmethod
    def _write(path: Path, out: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")   # the API and the ingest may write the same month
        tmp.write_text(json.dumps(out, separators=(",", ":")))
        tmp.replace(path)
