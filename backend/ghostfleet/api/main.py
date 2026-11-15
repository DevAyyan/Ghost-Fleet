"""FastAPI app. Run: uvicorn ghostfleet.api.main:app --reload  (from backend/)

Data source: GHOSTFLEET_DATA=real (default; live data built by backend/scripts/ingest_real.py) or synthetic (tests only).
There is deliberately no silent fallback: if the real panel is missing, data endpoints return 503.
"""
from __future__ import annotations

import hmac
import logging
import os
import threading
from datetime import date
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from ..gfw import ON_VERCEL, UPSTREAM_BUDGET_S, BudgetExceeded, GFWError, GFWLive, month_axis, parallel, upstream_budget
from ..analytics.scan_io import cache_path, load_scan, panel_digest
from ..real import DataUnavailable, load_real_panel, panel_path
from ..sea import CONTEXT_LAYERS, MAX_SPAN_DAYS, LayerNotBuilt, SeaWatch, default_period
from ..synthetic import make_panel
from . import schemas as S
from . import sea_service
from .service import GhostFleetService, NotFound

log = logging.getLogger("ghostfleet.api")
MAX_MAP_CELLS = int(os.getenv("GHOSTFLEET_MAX_MAP_CELLS", "20000"))   # the global build has a few thousand


def load_service() -> GhostFleetService:
    source = os.getenv("GHOSTFLEET_DATA", "real")
    if source == "synthetic":
        return GhostFleetService(make_panel(seed=int(os.getenv("GHOSTFLEET_SEED", "7"))))
    if source == "real":
        path = panel_path()
        panel, extras = load_real_panel(path)
        # The scan of the global panel takes ~35 s: use the copy saved by scripts/build_scan.py when it matches this panel.
        result = load_scan(cache_path(path), panel_digest(path), alpha=0.05)
        if result is None:
            log.warning("no matching scan cache: scanning now (run scripts/build_scan.py to skip this on cold starts)")
        return GhostFleetService(panel, extras=extras, result=result)
    raise RuntimeError(f"Unknown GHOSTFLEET_DATA={source!r} (use 'real' or 'synthetic')")


def _try_load(app: FastAPI) -> None:
    try:
        app.state.svc, app.state.load_error = load_service(), None
    except DataUnavailable as e:
        log.error("data unavailable: %s", e)
        app.state.svc, app.state.load_error = None, str(e)


_load_lock = threading.Lock()


def _ensure_loaded(app: FastAPI) -> None:
    """Load the panel and run the scan once. Lazy, so a serverless cold start only pays for it when a request needs it."""
    if getattr(app.state, "loaded", False):
        return
    with _load_lock:
        if not getattr(app.state, "loaded", False):
            _try_load(app)
            app.state.loaded = True


def _client(app: FastAPI, name: str, make):
    """app.state.<name>, created on first use: serverless hosts do not always run the startup hook."""
    obj = getattr(app.state, name, None)
    if obj is None:
        obj = make()
        setattr(app.state, name, obj)
    return obj


def gfw_live(request: Request) -> GFWLive:
    return _client(request.app, "gfw", GFWLive)


def sea_watch(request: Request) -> SeaWatch:
    return _client(request.app, "sea", SeaWatch)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.gfw = GFWLive()
    app.state.sea = SeaWatch()
    app.state.loaded = False
    if not ON_VERCEL:        # a long-running server scans at startup; on Vercel the scan waits for the first request that needs it
        _ensure_loaded(app)
    yield


app = FastAPI(title="Ghost Fleet X API", version="1.0.0", lifespan=lifespan,
              description="Maritime change intelligence: investigation leads, never accusations.",
              responses={404: {"model": S.ErrorResponse}, 422: {"model": S.ErrorResponse},
                         500: {"model": S.ErrorResponse}, 503: {"model": S.ErrorResponse}})
# Any site may call the API from a browser by default: it is public, read-only and uses no cookies, and the frontend is
# usually deployed at a different address. One fixed "*" header also keeps responses cacheable by a CDN. Restrict it with
# GHOSTFLEET_CORS=https://site-a,https://site-b if needed.
app.add_middleware(CORSMiddleware,
                   allow_origins=[o.strip() for o in os.getenv("GHOSTFLEET_CORS", "*").split(",") if o.strip()],
                   allow_methods=["GET", "POST"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=2000)   # a global month of detections is several MB of JSON


@app.middleware("http")
async def _cdn_cache(request: Request, call_next):
    """Let a CDN in front of the API (Vercel's) keep successful GETs for an hour and serve a stale copy while it refreshes.
    Browsers always revalidate (max-age=0). This is what makes a serverless deployment usable: the function's own disk
    cache dies with each instance, the CDN's does not."""
    response = await call_next(request)
    if request.method == "GET" and response.status_code == 200 and request.url.path.startswith("/api/") \
            and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400"
    return response


# ---------- one error shape everywhere ----------
def _err(status: int, code: str, message: str, details=None) -> JSONResponse:
    body = S.ErrorResponse(error=S.ErrorBody(code=code, message=message, details=details))
    return JSONResponse(status_code=status, content=body.model_dump(by_alias=True, exclude_none=True))


@app.exception_handler(DataUnavailable)
async def _unavailable(_: Request, exc: DataUnavailable):
    return _err(503, "DATA_UNAVAILABLE", str(exc))


@app.exception_handler(BudgetExceeded)
async def _too_slow(_: Request, exc: BudgetExceeded):
    return _err(504, "UPSTREAM_TIMEOUT", f"The data sources were too slow to answer ({exc}). Try again in a minute: "
                "whatever was fetched in the meantime is kept, so a retry is quicker.")


@app.exception_handler(GFWError)
async def _gfw_down(_: Request, exc: GFWError):
    return _err(502, "UPSTREAM_UNAVAILABLE", f"Global Fishing Watch: {exc}")


@app.exception_handler(LayerNotBuilt)
async def _layer_missing(_: Request, exc: LayerNotBuilt):
    return _err(503, "DATA_UNAVAILABLE", str(exc))


@app.exception_handler(NotFound)
async def _not_found(_: Request, exc: NotFound):
    return _err(404, "NOT_FOUND", str(exc))


@app.exception_handler(RequestValidationError)
async def _validation(_: Request, exc: RequestValidationError):
    details = [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]
    return _err(422, "VALIDATION_ERROR", "Request validation failed", details)


@app.exception_handler(StarletteHTTPException)
async def _http(_: Request, exc: StarletteHTTPException):
    code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
    return _err(exc.status_code, code, str(exc.detail))


@app.exception_handler(Exception)
async def _unhandled(_: Request, exc: Exception):
    log.exception("unhandled error", exc_info=exc)
    return _err(500, "INTERNAL_ERROR", "Internal server error")


def svc(request: Request) -> GhostFleetService:
    _ensure_loaded(request.app)
    s = getattr(request.app.state, "svc", None)
    if s is None:
        raise DataUnavailable(getattr(request.app.state, "load_error", None) or "Data not loaded")
    return s


# ---------- endpoints ----------
@app.get("/api/health")
def get_health():
    return {"status": "ok", "service": "Ghost Fleet X"}


@app.get("/api/meta", response_model=S.MetaResponse)
def get_meta(request: Request):
    _ensure_loaded(request.app)
    s = getattr(request.app.state, "svc", None)
    if s is not None:
        return s.meta()
    # No analysis panel yet: the live map still works straight from GFW.
    return S.MetaResponse(
        is_demo_data=False, source_note="Live Global Fishing Watch SAR detections. Change analysis not built yet.",
        months=month_axis(), alpha=0.05, steps=[], alerts_by_step={}, cell_count=0, event_count=0,
        sensors=["Sentinel-1 SAR (via Global Fishing Watch)"], disclaimer="Investigation leads, never accusations.")


@app.get("/api/cells", response_model=S.CellsResponse)
def get_cells(request: Request, only: str | None = Query(None, pattern="^events$")):
    """Every analysis cell, or with `?only=events` just the cells that belong to a change event (all the map needs)."""
    s = svc(request)
    if only == "events":
        return s.event_cells()
    if len(s.panel.cell_ids) > MAX_MAP_CELLS:
        return _err(422, "TOO_MANY_CELLS", f"Map layer has {len(s.panel.cell_ids)} cells (max {MAX_MAP_CELLS})")
    return s.cells()


@app.get("/api/detections", response_model=S.DetectionsResponse)
def get_detections(request: Request, month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"), compact: bool = False):
    """Vessel detections for one month (default: latest), fetched live from Global Fishing Watch (cached on disk).
    `?compact=true` returns the points as `packed` rows: a worldwide month is over 5 MB as objects, about 2 MB packed."""
    if os.getenv("GHOSTFLEET_DATA", "real") == "synthetic":
        r = svc(request).detections(month)
        if compact:
            r.packed, r.points = [(p.lat, p.lon, p.unmatched, p.matched) for p in r.points], []
        return r
    months = month_axis()
    m = month or months[-1]
    if m not in months:
        raise NotFound("Month", m)
    with upstream_budget(DETECTIONS_BUDGET_S):
        d = gfw_live(request).detections(m)
    rows = [(p[0], p[1], int(p[2]), int(p[3])) for p in d["points"]]
    totals = {"total_unmatched": sum(r[2] for r in rows), "total_matched": sum(r[3] for r in rows)}
    if compact:
        return S.DetectionsResponse(is_demo_data=False, month=m, points=[], packed=rows, fetched_at=d["fetchedAt"], **totals)
    pts = [S.DetectionPoint(lat=r[0], lon=r[1], unmatched=r[2], matched=r[3]) for r in rows]
    return S.DetectionsResponse(is_demo_data=False, month=m, points=pts, fetched_at=d["fetchedAt"], **totals)


# ---------- live awareness layers (free sources; see ghostfleet/sea.py) ----------
DAY = r"^\d{4}-\d{2}-\d{2}$"
# Every handler that calls upstream runs inside upstream_budget(): all its upstream calls together get UPSTREAM_BUDGET_S
# (40 s), well inside Vercel's 60 s maxDuration. The two worldwide SAR reports of /api/detections are slower, so they get more.
DETECTIONS_BUDGET_S = max(UPSTREAM_BUDGET_S, 50.0)


class BadPeriod(ValueError):
    pass


def period(start: str | None, end: str | None) -> tuple[str, str]:
    """Validate an inclusive start..end period (default: the last 30 days)."""
    if not start and not end:
        return default_period()
    if not (start and end):
        raise BadPeriod("Give both start and end, or neither")
    try:
        a, b = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError as e:
        raise BadPeriod("start and end must be real dates (YYYY-MM-DD)") from e
    if a > b:
        raise BadPeriod("start must not be after end")
    if b > date.today():
        raise BadPeriod("end must not be in the future")
    if a < date(2020, 1, 1):
        raise BadPeriod("start must be 2020-01-01 or later")
    if (b - a).days + 1 > MAX_SPAN_DAYS:
        raise BadPeriod(f"The period can be at most {MAX_SPAN_DAYS} days")
    return start, end


def _compact(resp, compact: bool, records: str = "events"):
    """`?compact=true` on a list endpoint: each distinct statement once per response (see sea_service.pool_statements)."""
    return sea_service.pool_statements(resp, records) if compact else resp


@app.exception_handler(BadPeriod)
async def _bad_period(_: Request, exc: BadPeriod):
    return _err(422, "VALIDATION_ERROR", str(exc))


@app.get("/api/sea/ais-off", response_model=S.AisOffResponse)
def get_ais_off(request: Request, start: str | None = Query(None, pattern=DAY), end: str | None = Query(None, pattern=DAY),
                compact: bool = Query(False, description="Send each distinct statement once (statementTable + statementIds)")):
    """Vessels that switched AIS off in a period (default: the last 30 days), where it happened most, and labelled hypotheses."""
    with upstream_budget():
        d = sea_watch(request).ais_off(*period(start, end))
    return _compact(sea_service.ais_off(d), compact)


@app.get("/api/sea/slicks", response_model=S.SlicksResponse)
def get_slicks(request: Request, start: str | None = Query(None, pattern=DAY), end: str | None = Query(None, pattern=DAY),
               compact: bool = Query(False, description="Send each distinct statement once (statementTable + statementIds)")):
    """Largest possible oil slicks in a period (default: the last 30 days), machine-detected on Sentinel-1 radar (SkyTruth Cerulean),
    each with Cerulean's ranked candidate sources, cross-checked against AIS switched off within 48 hours."""
    sw, (s, e) = sea_watch(request), period(start, end)

    def gaps():
        try:
            return sw.ais_off(s, e)["events"]
        except GFWError:
            return []    # the slicks still load; candidates just are not cross-checked against AIS switch-offs
    with upstream_budget():
        sl, gp = parallel(lambda: sw.slicks(s, e), gaps)
    return _compact(sea_service.slicks(sl, gp), compact, "slicks")


@app.get("/api/sea/protected-fishing", response_model=S.ProtectedFishingResponse)
def get_protected_fishing(request: Request, start: str | None = Query(None, pattern=DAY), end: str | None = Query(None, pattern=DAY),
                          compact: bool = Query(False, description="Send each distinct statement once (statementTable + statementIds)")):
    """Apparent fishing inside no-take protected areas in a period. Built by backend/scripts/ingest_sea.py; 503 until that has run."""
    s, e = period(start, end) if (start or end) else (None, None)
    return _compact(sea_service.protected_fishing(sea_watch(request).protected_fishing(), s, e), compact)


@app.get("/api/sea/vessels/search", response_model=S.VesselSearchResponse)
def search_vessels(request: Request, q: str = Query(..., min_length=3, max_length=60)):
    """Find a ship by name, MMSI, IMO or call sign (Global Fishing Watch vessel identity)."""
    with upstream_budget():
        found = sea_watch(request).search(q.strip())
    return S.VesselSearchResponse(is_demo_data=False, query=q, results=[sea_service.identity(i) for i in found])


@app.get("/api/sea/vessels/{vessel_id}", response_model=S.VesselResponse)
def get_vessel(vessel_id: str, request: Request, start: str | None = Query(None, pattern=DAY), end: str | None = Query(None, pattern=DAY)):
    """One ship in a period: its path through its recorded events, and where and when it stopped broadcasting."""
    try:
        with upstream_budget():
            return sea_service.vessel(sea_watch(request).vessel(vessel_id, *period(start, end)))
    except LookupError:
        raise NotFound("Vessel", vessel_id) from None


@app.get("/api/sea/lanes/{z}/{x}/{y}.png", responses={200: {"content": {"image/png": {}}}})
def get_lane_tile(z: int, x: int, y: int, request: Request, month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$")):
    """Shipping-lane tile: AIS vessel presence for one month (default latest), drawn by Global Fishing Watch (disk-cached)."""
    if not (0 <= z <= 7 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
        raise NotFound("Tile", f"{z}/{x}/{y}")
    if month and month not in month_axis():
        raise NotFound("Month", month)
    with upstream_budget():
        png = sea_watch(request).lanes_tile(z, x, y, month)
    return Response(png, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400, s-maxage=2592000"})   # a month's lanes never change


@app.get("/api/sea/encounters", response_model=S.EncountersResponse)
def get_encounters(request: Request, start: str | None = Query(None, pattern=DAY), end: str | None = Query(None, pattern=DAY),
                   compact: bool = Query(False, description="Send each distinct statement once (statementTable + statementIds)")):
    """Fishing vessels meeting carriers, bunkers, support vessels or tankers at sea (possible transshipment) in a period,
    each checked for AIS switched off by either vessel within 48 hours. Strongest leads first."""
    sw, (s, e) = sea_watch(request), period(start, end)
    with upstream_budget():
        enc, gaps = parallel(lambda: sw.encounters(s, e), lambda: sw.ais_off(s, e))
    return _compact(sea_service.encounters(enc, gaps["events"]), compact)


@app.get("/api/sea/loitering", response_model=S.LoiteringResponse)
def get_loitering(request: Request, start: str | None = Query(None, pattern=DAY), end: str | None = Query(None, pattern=DAY),
                  compact: bool = Query(False, description="Send each distinct statement once (statementTable + statementIds)")):
    """Carriers and bunker tankers loitering 20+ nautical miles offshore in a period, each checked for a recorded meeting."""
    sw, (s, e) = sea_watch(request), period(start, end)
    with upstream_budget():
        lo, enc = parallel(lambda: sw.loitering(s, e), lambda: sw.encounters(s, e))
    return _compact(sea_service.loitering(lo, enc["events"]), compact)


@app.get("/api/sea/vessels/{vessel_id}/insights", response_model=S.VesselInsights)
def get_vessel_insights(vessel_id: str, request: Request, start: str | None = Query(None, pattern=DAY),
                        end: str | None = Query(None, pattern=DAY)):
    """IUU-list history, fishing without a known public authorisation, no-take MPA fishing and AIS-off counts for one ship."""
    try:
        with upstream_budget():
            return sea_service.insights(sea_watch(request).insights(vessel_id, *period(start, end)))
    except LookupError:
        raise NotFound("Vessel", vessel_id) from None


@app.get("/api/sea/closures", response_model=S.ClosuresResponse)
def get_closures(request: Request):
    """Apparent fishing during seasonal fishing bans, against the weeks around them. Built by scripts/ingest_closures.py."""
    return sea_service.closures(sea_watch(request).closures())


@app.get("/api/sea/context/{layer}/{z}/{x}/{y}.pbf", responses={200: {"content": {"application/x-protobuf": {}}}})
def get_context_tile(layer: str, z: int, x: int, y: int, request: Request):
    """Vector tile of sea borders (`eez`, Marine Regions EEZs), offshore platforms (`infra`) or marine protected areas
    (`mpa`, WDPA), proxied from Global Fishing Watch."""
    if layer not in CONTEXT_LAYERS or not (0 <= z <= 9 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
        raise NotFound("Tile", f"{layer}/{z}/{x}/{y}")
    with upstream_budget():
        pbf = sea_watch(request).context_tile(layer, z, x, y)
    if not pbf:
        return Response(status_code=204, headers={"Cache-Control": "public, max-age=86400, s-maxage=2592000"})
    return Response(pbf, media_type="application/x-protobuf",
                    headers={"Cache-Control": "public, max-age=86400, s-maxage=2592000"})


@app.get("/api/sea/effort/{z}/{x}/{y}.png", responses={200: {"content": {"image/png": {}}}})
def get_effort_tile(z: int, x: int, y: int, request: Request, start: str | None = Query(None, pattern=DAY),
                    end: str | None = Query(None, pattern=DAY)):
    """Fishing-effort tile (apparent fishing hours from AIS) for a period, drawn by Global Fishing Watch."""
    if not (0 <= z <= 6 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
        raise NotFound("Tile", f"{z}/{x}/{y}")
    s, e = period(start, end)
    with upstream_budget():
        png = sea_watch(request).effort_tile(z, x, y, s, e)
    return Response(png, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=3600, s-maxage=86400"})


@app.post("/api/refresh", response_model=S.MetaResponse)
def refresh(request: Request, x_refresh_token: str | None = Header(None)):
    """Reload the panel from disk after `backend/scripts/ingest_real.py` has pulled new data. Safe to retry.

    A reload re-runs the scan and blocks analysis requests meanwhile, so it is not open to the public: it needs the
    X-Refresh-Token header to match GHOSTFLEET_REFRESH_TOKEN, or, with no token configured, a call from this machine.
    """
    token = os.getenv("GHOSTFLEET_REFRESH_TOKEN")
    host = request.client.host if request.client else ""
    allowed = (hmac.compare_digest(x_refresh_token or "", token) if token
               else not ON_VERCEL and host in {"127.0.0.1", "::1", "localhost", "testclient"})
    if not allowed:
        return _err(403, "FORBIDDEN", "Refresh needs a valid X-Refresh-Token header.")
    with _load_lock:
        _try_load(request.app)
        request.app.state.loaded = True
    return svc(request).meta()


@app.get("/api/cells/{cell_id}", response_model=S.CellDetailResponse)
def get_cell(cell_id: str, request: Request):
    return svc(request).cell(cell_id)


@app.get("/api/events", response_model=S.EventsResponse)
def list_events(request: Request, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100, alias="pageSize"),
                direction: S.Direction | None = None):
    return svc(request).list_events(page, page_size, direction)


@app.get("/api/events/{event_id}", response_model=S.EventDetailResponse)
def get_event(event_id: str, request: Request):
    return svc(request).event(event_id)


@app.post("/api/events/{event_id}/disproof", response_model=S.DisproofResponse)
def run_disproof(event_id: str, request: Request, body: S.DisproofRequest | None = None):
    """Pure computation, cached, no stored state: safe to retry."""
    return svc(request).disproof(event_id, body.variants if body else None)


@app.get("/api/events/{event_id}/case-file", response_model=S.CaseFile,
         responses={200: {"content": {"application/geo+json": {}}}})
def get_case_file(event_id: str, request: Request, format: S.CaseFileFormat = S.CaseFileFormat.JSON):
    s = svc(request)
    filename = f"ghostfleet-case-{event_id}.{format.value}"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    if format is S.CaseFileFormat.GEOJSON:
        return JSONResponse(s.case_file_geojson(event_id), headers=headers, media_type="application/geo+json")
    cf = s.case_file(event_id)
    return JSONResponse(cf.model_dump(by_alias=True, mode="json"), headers=headers)


# Serve production frontend if built
_dist_dir = Path(__file__).resolve().parents[3] / "frontend" / "dist"
if _dist_dir.is_dir():
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=_dist_dir, html=True), name="frontend")

