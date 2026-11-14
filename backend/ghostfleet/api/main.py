"""FastAPI app. Run: uvicorn ghostfleet.api.main:app --reload  (from backend/)

Data source: GHOSTFLEET_DATA=real (default; live data built by scripts/ingest_real.py) or synthetic (tests only).
There is deliberately no silent fallback: if the real panel is missing, data endpoints return 503.
"""
from __future__ import annotations

import logging
import os
from datetime import date
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from ..gfw import GFWError, GFWLive, month_axis
from ..real import DataUnavailable, load_real_panel
from ..sea import MAX_SPAN_DAYS, LayerNotBuilt, SeaWatch, default_period
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
        panel, extras = load_real_panel()
        return GhostFleetService(panel, extras=extras)
    raise RuntimeError(f"Unknown GHOSTFLEET_DATA={source!r} (use 'real' or 'synthetic')")


def _try_load(app: FastAPI) -> None:
    try:
        app.state.svc, app.state.load_error = load_service(), None
    except DataUnavailable as e:
        log.error("data unavailable: %s", e)
        app.state.svc, app.state.load_error = None, str(e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.gfw = GFWLive()
    app.state.sea = SeaWatch()
    _try_load(app)
    yield


app = FastAPI(title="Ghost Fleet X API", version="1.0.0", lifespan=lifespan,
              description="Maritime change intelligence: investigation leads, never accusations.",
              responses={404: {"model": S.ErrorResponse}, 422: {"model": S.ErrorResponse},
                         500: {"model": S.ErrorResponse}, 503: {"model": S.ErrorResponse}})
app.add_middleware(CORSMiddleware,
                   allow_origins=os.getenv("GHOSTFLEET_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
                   allow_methods=["GET", "POST"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=2000)   # a global month of detections is several MB of JSON


# ---------- one error shape everywhere ----------
def _err(status: int, code: str, message: str, details=None) -> JSONResponse:
    body = S.ErrorResponse(error=S.ErrorBody(code=code, message=message, details=details))
    return JSONResponse(status_code=status, content=body.model_dump(by_alias=True, exclude_none=True))


@app.exception_handler(DataUnavailable)
async def _unavailable(_: Request, exc: DataUnavailable):
    return _err(503, "DATA_UNAVAILABLE", str(exc))


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
    s = getattr(request.app.state, "svc", None)
    if s is None:
        raise DataUnavailable(getattr(request.app.state, "load_error", None) or "Data not loaded")
    return s


# ---------- endpoints ----------
@app.get("/api/meta", response_model=S.MetaResponse)
def get_meta(request: Request):
    s = getattr(request.app.state, "svc", None)
    if s is not None:
        return s.meta()
    # No analysis panel yet: the live map still works straight from GFW.
    return S.MetaResponse(
        is_demo_data=False, source_note="Live Global Fishing Watch SAR detections. Change analysis not built yet.",
        months=month_axis(), alpha=0.05, steps=[], alerts_by_step={}, cell_count=0, event_count=0,
        sensors=["Sentinel-1 SAR (via Global Fishing Watch)"], disclaimer="Investigation leads, never accusations.")


@app.get("/api/cells", response_model=S.CellsResponse)
def get_cells(request: Request):
    s = svc(request)
    if len(s.panel.cell_ids) > MAX_MAP_CELLS:
        return _err(422, "TOO_MANY_CELLS", f"Map layer has {len(s.panel.cell_ids)} cells (max {MAX_MAP_CELLS})")
    return s.cells()


@app.get("/api/detections", response_model=S.DetectionsResponse)
def get_detections(request: Request, month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$")):
    """Vessel detections for one month (default: latest), fetched live from Global Fishing Watch (cached on disk)."""
    if os.getenv("GHOSTFLEET_DATA", "real") == "synthetic":
        return svc(request).detections(month)
    months = month_axis()
    m = month or months[-1]
    if m not in months:
        raise NotFound("Month", m)
    d = request.app.state.gfw.detections(m)
    pts = [S.DetectionPoint(lat=p[0], lon=p[1], unmatched=int(p[2]), matched=int(p[3])) for p in d["points"]]
    return S.DetectionsResponse(is_demo_data=False, month=m, points=pts, fetched_at=d["fetchedAt"],
                                total_unmatched=sum(p.unmatched for p in pts), total_matched=sum(p.matched for p in pts))


# ---------- live awareness layers (free sources; see ghostfleet/sea.py) ----------
DAY = r"^\d{4}-\d{2}-\d{2}$"


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


@app.exception_handler(BadPeriod)
async def _bad_period(_: Request, exc: BadPeriod):
    return _err(422, "VALIDATION_ERROR", str(exc))


@app.get("/api/sea/ais-off", response_model=S.AisOffResponse)
def get_ais_off(request: Request, start: str | None = Query(None, pattern=DAY), end: str | None = Query(None, pattern=DAY)):
    """Vessels that switched AIS off in a period (default: the last 30 days), where it happened most, and labelled hypotheses."""
    return sea_service.ais_off(request.app.state.sea.ais_off(*period(start, end)))


@app.get("/api/sea/slicks", response_model=S.SlicksResponse)
def get_slicks(request: Request, start: str | None = Query(None, pattern=DAY), end: str | None = Query(None, pattern=DAY)):
    """Largest possible oil slicks in a period (default: the last 30 days), machine-detected on Sentinel-1 radar (SkyTruth Cerulean)."""
    return sea_service.slicks(request.app.state.sea.slicks(*period(start, end)))


@app.get("/api/sea/protected-fishing", response_model=S.ProtectedFishingResponse)
def get_protected_fishing(request: Request, start: str | None = Query(None, pattern=DAY), end: str | None = Query(None, pattern=DAY)):
    """Apparent fishing inside no-take protected areas in a period. Built by scripts/ingest_sea.py; 503 until that has run."""
    s, e = period(start, end) if (start or end) else (None, None)
    return sea_service.protected_fishing(request.app.state.sea.protected_fishing(), s, e)


@app.get("/api/sea/vessels/search", response_model=S.VesselSearchResponse)
def search_vessels(request: Request, q: str = Query(..., min_length=3, max_length=60)):
    """Find a ship by name, MMSI, IMO or call sign (Global Fishing Watch vessel identity)."""
    return S.VesselSearchResponse(is_demo_data=False, query=q,
                                  results=[sea_service.identity(i) for i in request.app.state.sea.search(q.strip())])


@app.get("/api/sea/vessels/{vessel_id}", response_model=S.VesselResponse)
def get_vessel(vessel_id: str, request: Request, start: str | None = Query(None, pattern=DAY), end: str | None = Query(None, pattern=DAY)):
    """One ship in a period: its path through its recorded events, and where and when it stopped broadcasting."""
    try:
        return sea_service.vessel(request.app.state.sea.vessel(vessel_id, *period(start, end)))
    except LookupError:
        raise NotFound("Vessel", vessel_id) from None


@app.get("/api/sea/lanes/{z}/{x}/{y}.png", responses={200: {"content": {"image/png": {}}}})
def get_lane_tile(z: int, x: int, y: int, request: Request, month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$")):
    """Shipping-lane tile: AIS vessel presence for one month (default latest), drawn by Global Fishing Watch (disk-cached)."""
    if not (0 <= z <= 7 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
        raise NotFound("Tile", f"{z}/{x}/{y}")
    if month and month not in month_axis():
        raise NotFound("Month", month)
    return Response(request.app.state.sea.lanes_tile(z, x, y, month), media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400"})


@app.post("/api/refresh", response_model=S.MetaResponse)
def refresh(request: Request):
    """Reload the panel from disk after `scripts/ingest_real.py` has pulled new data. Safe to retry."""
    _try_load(request.app)
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
