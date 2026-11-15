"""Live "what is happening at sea" layers, all from free sources (stdlib only, disk-cached):

  * AIS switched off      Global Fishing Watch events API, gaps GFW classes as likely intentional, any date range
  * Possible oil slicks   SkyTruth Cerulean (machine-detected on Sentinel-1 radar, any date range, largest first)
  * Shipping lanes        Global Fishing Watch 4Wings PNG tiles of AIS vessel presence, any month (proxied: they need the token)
  * Fishing in no-take    built by backend/scripts/ingest_sea.py from GFW apparent-fishing events (too many to fetch live)
  * One ship              identity plus every recorded event in a date range (fishing, loitering, port calls, encounters,
                          AIS gaps). GFW does not give raw tracks on the free API (403), so a ship's path is drawn
                          through its events.

Every record is a lead. Nothing here establishes wrongdoing.
"""
from __future__ import annotations

import base64
import gzip
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .gfw import CACHE_ROOT, ROOT, UA, GFWError, _token, month_axis

GFW = "https://gateway.api.globalfishingwatch.org/v3"
CERULEAN = "https://api.cerulean.skytruth.org/collections/public.slick_plus/items"
GAP_VESSEL_TYPES = ("FISHING", "CARGO", "CARRIER", "BUNKER", "OTHER")     # leaves out fishing-gear buoys (most gaps)
DEFAULT_DAYS = 30                     # period shown when the caller gives no dates
MAX_SPAN_DAYS = 366
GAP_MAX_PAGES = 15                    # 1,000 events a page
VESSEL_MAX_PAGES = 3
VESSEL_EVENT_DATASETS = ("public-global-fishing-events:latest", "public-global-port-visits-events:latest",
                         "public-global-encounters-events:latest", "public-global-loitering-events:latest",
                         "public-global-gaps-events:latest")
IDENTITY = "public-global-vessel-identity:latest"
SLICK_MIN_AREA_M2 = 5_000_000
SLICK_MIN_CONFIDENCE = 0.9
SLICK_SOURCES = {1: "VESSEL", 2: "INFRASTRUCTURE", 3: "DARK_VESSEL", 4: "NATURAL"}
CERULEAN_SOURCES = "https://api.cerulean.skytruth.org/collections/public.source_plus/items"
SLICK_MAX_CANDIDATES = 3           # Cerulean ranks every candidate source of a slick; the best few are kept
CANDIDATE_TYPE = {"VESSEL": "VESSEL", "DARK": "DARK_VESSEL", "INFRA": "INFRASTRUCTURE"}
LANE_RGB = [19, 38, 59]                                     # chart ink
LANE_RAMP_Z2 = [0, 500, 1200, 3000, 7000, 16000, 40000, 100000, 250000]   # vessel-hours per tile cell at zoom 2
PROTECTED_FISHING = ROOT / "data" / "processed" / "protected_fishing.json"
LANE_SEED = ROOT / "data" / "seed" / "lanes"       # world-view lane tiles shipped with the code, so a fresh host shows lanes at once
CLOSURES = ROOT / "data" / "processed" / "closures.json"
# Meetings at sea that can move catch or fuel between vessels (GFW encounter types; the first vessel is the event's own)
ENCOUNTER_TYPES = ("CARRIER-FISHING", "FISHING-CARRIER", "FISHING-SUPPORT", "SUPPORT-FISHING",
                   "FISHING-BUNKER", "BUNKER-FISHING", "FISHING-TANKER", "TANKER-FISHING")
LOITER_VESSEL_TYPES = ("CARRIER", "BUNKER")
LOITER_MIN_SHORE_KM = 37.0            # 20 nautical miles: leaves out ships waiting at anchorages and off ports
EVENT_MAX_PAGES = 8
# Map layers served as vector tiles straight from GFW (they need the token, so they are proxied)
CONTEXT_LAYERS = {"eez": "public-eez-areas", "infra": "public-fixed-infrastructure-filtered:latest"}
EFFORT_RGB = [196, 92, 0]
EFFORT_RAMP_Z2 = [0, 20, 60, 150, 400, 1000, 2500, 6000, 15000]   # fishing hours per tile cell at zoom 2, for a 30-day period


class SeaSourceError(GFWError):
    """An upstream source could not be reached."""
    status: int | None = None


# What GFW answers 404 "Tile empty" for (polar and empty-ocean tiles): a 1x1 fully transparent PNG.
EMPTY_PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgYGBgAAAABQABeqhXUAAAAABJRU5ErkJggg==")


def slim_identity(d: dict) -> dict:
    """GFW vessel identity (registry + self-reported AIS records) -> the fields the app shows."""
    reg = (d.get("registryInfo") or [{}])[0]
    selfs = d.get("selfReportedInfo") or []
    sr = selfs[0] if selfs else {}
    gear = reg.get("geartypes") or ((d.get("combinedSourcesInfo") or [{}])[0].get("geartypes") or [{}])
    gear = [g.get("name") if isinstance(g, dict) else g for g in gear]
    return {"vesselId": sr.get("id") or (selfs[0].get("id") if selfs else None),
            "name": reg.get("shipname") or sr.get("shipname"), "flag": reg.get("flag") or sr.get("flag"),
            "mmsi": reg.get("ssvid") or sr.get("ssvid"), "imo": reg.get("imo") or sr.get("imo"),
            "callsign": reg.get("callsign") or sr.get("callsign"), "gear": [g for g in gear if g][:3],
            "lengthM": reg.get("lengthM"), "tonnageGt": reg.get("tonnageGt"),
            "transmitsFrom": sr.get("transmissionDateFrom") or reg.get("transmissionDateFrom"),
            "transmitsTo": sr.get("transmissionDateTo") or reg.get("transmissionDateTo")}


class LayerNotBuilt(RuntimeError):
    """A layer that is precomputed by a script has not been built yet."""


def _get(url: str, token: bool = False, method: str | None = None, timeout: float = 60, tries: int = 3,
         body: dict | None = None) -> bytes:
    h = {"User-Agent": UA, "Accept-Encoding": "gzip"}
    if token:
        h["Authorization"] = f"Bearer {_token()}"
    data = None
    if body is not None:
        data, h["Content-Type"] = json.dumps(body).encode(), "application/json"
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=h, method=method, data=data)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                return gzip.decompress(raw) if r.headers.get("Content-Encoding") == "gzip" else raw
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403, 404, 422):
                err = SeaSourceError(f"{url.split('/')[2]} refused the request (HTTP {e.code})")
                err.status = e.code
                raise err from e
            last = e
        except Exception as e:  # network hiccup
            last = e
        time.sleep(2 * (attempt + 1))
    raise SeaSourceError(f"{url.split('/')[2]} unreachable: {type(last).__name__}")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def slim_gap(e: dict) -> dict:
    """One GFW gap event -> the fields the app uses."""
    g, v, reg, dist = e.get("gap") or {}, e.get("vessel") or {}, e.get("regions") or {}, e.get("distances") or {}
    pos = g.get("offPosition") or e.get("position") or {}

    def num(x):
        try:
            return round(float(x), 2)
        except (TypeError, ValueError):
            return None
    on = g.get("onPosition") or {}
    return {"id": e["id"], "lat": pos.get("lat"), "lon": pos.get("lon"), "start": e.get("start"), "end": e.get("end"),
            "durationHours": num(g.get("durationHours")), "distanceKm": num(g.get("distanceKm")),
            "onLat": on.get("lat"), "onLon": on.get("lon"), "vesselId": v.get("id"), "mmsi": v.get("ssvid"),
            "vesselName": v.get("name"), "flag": v.get("flag"), "vesselType": v.get("type"),
            "shoreKm": num(dist.get("startDistanceFromShoreKm")), "positionsBefore": num(g.get("positions12HoursBeforeSat")),
            "intentional": bool(g.get("intentionalDisabling")),
            "inMpa": bool(reg.get("mpa")), "inNoTake": bool(reg.get("mpaNoTake") or reg.get("mpaNoTakePartial")),
            "highSeas": bool(reg.get("highSeas"))}


def slim_fishing(e: dict) -> dict:
    v, reg, dist = e.get("vessel") or {}, e.get("regions") or {}, e.get("distances") or {}
    pos = e.get("position") or {}
    try:
        hours = round((datetime.fromisoformat(e["end"].replace("Z", "+00:00"))
                       - datetime.fromisoformat(e["start"].replace("Z", "+00:00"))).total_seconds() / 3600, 1)
    except (KeyError, ValueError, AttributeError):
        hours = None
    return {"id": e["id"], "lat": pos.get("lat"), "lon": pos.get("lon"), "start": e.get("start"), "end": e.get("end"),
            "durationHours": hours, "vesselId": v.get("id"), "vesselName": v.get("name"), "flag": v.get("flag"), "vesselType": v.get("type"),
            "shoreKm": dist.get("startDistanceFromShoreKm"), "fullNoTake": bool(reg.get("mpaNoTake")),
            "areaIds": [str(x) for x in (reg.get("mpaNoTake") or reg.get("mpaNoTakePartial") or [])][:4]}


def _hours(start: str | None, end: str | None) -> float | None:
    try:
        return round((datetime.fromisoformat(end.replace("Z", "+00:00"))
                      - datetime.fromisoformat(start.replace("Z", "+00:00"))).total_seconds() / 3600, 1)
    except (AttributeError, ValueError):
        return None


def auth_word(status: str | None) -> str:
    """GFW's public-authorisation status of a vessel at an encounter -> AUTHORISED / PARTLY / NOT_FOUND / UNKNOWN.
    Seen values include "publicly_authorized" and "not_matching_relevant_public_authorization"."""
    s = (status or "").lower()
    if not s or "pending" in s or "unknown" in s:
        return "UNKNOWN"
    if s.startswith("not_") or "unauthori" in s or "no_" in s:
        return "NOT_FOUND"
    if "partial" in s:
        return "PARTLY"
    return "AUTHORISED" if "authori" in s or "matching" in s else "UNKNOWN"


def _party(v: dict, auth: str | None = None) -> dict:
    """One vessel of an encounter."""
    return {"vesselId": v.get("id"), "name": v.get("name"), "flag": v.get("flag"), "vesselType": v.get("type"),
            "mmsi": v.get("ssvid"), "authorisation": auth_word(auth)}


def slim_encounter(e: dict) -> dict:
    enc, pos, dist, reg = e.get("encounter") or {}, e.get("position") or {}, e.get("distances") or {}, e.get("regions") or {}
    return {"id": e["id"], "lat": pos.get("lat"), "lon": pos.get("lon"), "start": e.get("start"), "end": e.get("end"),
            "durationHours": _hours(e.get("start"), e.get("end")), "type": enc.get("type"),
            "medianDistanceKm": enc.get("medianDistanceKilometers"), "medianSpeedKnots": enc.get("medianSpeedKnots"),
            "potentialRisk": bool(enc.get("potentialRisk")), "shoreKm": dist.get("startDistanceFromShoreKm"),
            "highSeas": bool(reg.get("highSeas")), "inMpa": bool(reg.get("mpa")), "eez": [str(x) for x in reg.get("eez") or []][:2],
            "rfmo": list(reg.get("rfmo") or [])[:6],
            "vessels": [_party(e.get("vessel") or {}, enc.get("mainVesselPublicAuthorizationStatus")),
                        _party(enc.get("vessel") or {}, enc.get("encounteredVesselPublicAuthorizationStatus"))]}


def slim_loitering(e: dict) -> dict:
    lo, pos, v, reg = e.get("loitering") or {}, e.get("position") or {}, e.get("vessel") or {}, e.get("regions") or {}
    return {"id": e["id"], "lat": pos.get("lat"), "lon": pos.get("lon"), "start": e.get("start"), "end": e.get("end"),
            "durationHours": lo.get("totalTimeHours"), "distanceKm": lo.get("totalDistanceKm"),
            "speedKnots": lo.get("averageSpeedKnots"), "shoreKm": lo.get("averageDistanceFromShoreKm"),
            "highSeas": bool(reg.get("highSeas")), "eez": [str(x) for x in reg.get("eez") or []][:2],
            "vesselId": v.get("id"), "vesselName": v.get("name"), "flag": v.get("flag"), "vesselType": v.get("type"),
            "mmsi": v.get("ssvid")}


def default_period() -> tuple[str, str]:
    today = date.today()
    return (today - timedelta(days=DEFAULT_DAYS)).isoformat(), today.isoformat()


def slim_vessel_event(e: dict) -> dict:
    """One event of a ship's history -> time, place and what it was."""
    pos, kind = e.get("position") or {}, e.get("type")
    out = {"id": e.get("id"), "kind": kind, "start": e.get("start"), "end": e.get("end"), "lat": pos.get("lat"), "lon": pos.get("lon"),
           "label": None}
    if kind == "port_visit":
        out["label"] = ((e.get("port_visit") or {}).get("startAnchorage") or {}).get("name")
    elif kind == "encounter":
        other = (e.get("encounter") or {}).get("vessel") or {}
        out["label"] = other.get("name")
    elif kind == "gap":
        out["gap"] = slim_gap(e)
    return out


class SeaWatch:
    def __init__(self, cache_dir: Path | None = None, fresh_hours: float = 6.0):
        self.cache_dir = cache_dir or CACHE_ROOT / "sea"
        self.fresh_s = fresh_hours * 3600
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    def _cached(self, name: str, build, settled: bool = False) -> dict:
        """Disk cache. `settled` = the period ended more than a week ago, so the answer no longer changes."""
        path = self.cache_dir / f"{name}.json"
        with self._guard:
            lock = self._locks.setdefault(name, threading.Lock())
        with lock:
            if path.exists() and (settled or time.time() - path.stat().st_mtime < self.fresh_s):
                return json.loads(path.read_text())
            try:
                out = build()
            except GFWError:
                if path.exists():          # upstream down: serve the last good copy, still stamped with its fetch time
                    return json.loads(path.read_text())
                raise
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(f".{os.getpid()}.tmp")
            tmp.write_text(json.dumps(out, separators=(",", ":")))
            tmp.replace(path)
            return out

    @staticmethod
    def _settled(end: str) -> bool:
        return end < (date.today() - timedelta(days=7)).isoformat()

    # ---------- AIS switched off ----------
    def _fetch_gaps(self, start: str, end: str) -> dict:
        q = {"datasets[0]": "public-global-gaps-events:latest", "start-date": start,
             "end-date": (date.fromisoformat(end) + timedelta(days=1)).isoformat(), "gap-intentional-disabling": "true",
             "sort": "-start", "limit": "1000"}
        q.update({f"vessel-types[{i}]": t for i, t in enumerate(GAP_VESSEL_TYPES)})
        events, offset, truncated = [], 0, False
        for page_no in range(GAP_MAX_PAGES):                  # newest first; stop once a page starts before the period
            d = json.loads(_get(f"{GFW}/events?{urllib.parse.urlencode({**q, 'offset': str(offset)})}", token=True, timeout=90))
            page = d.get("entries") or []
            events += [slim_gap(e) for e in page if (e.get("start") or "")[:10] >= start]
            offset = d.get("nextOffset")
            if not page or not offset or (page[-1].get("start") or "")[:10] < start:
                break
            truncated = page_no == GAP_MAX_PAGES - 1
        events = [e for e in events if e["lat"] is not None and e["lon"] is not None]
        return {"fetchedAt": _now(), "start": start, "end": end, "truncated": truncated, "events": events}

    def _fetch_events(self, query: dict, start: str, end: str, slim) -> dict:
        """Newest-first events of one GFW dataset that began in start..end (inclusive), up to EVENT_MAX_PAGES pages."""
        q = {**query, "start-date": start, "end-date": (date.fromisoformat(end) + timedelta(days=1)).isoformat(),
             "sort": "-start", "limit": "1000"}
        events, offset, truncated = [], 0, False
        for page_no in range(EVENT_MAX_PAGES):
            d = json.loads(_get(f"{GFW}/events?{urllib.parse.urlencode({**q, 'offset': str(offset)})}", token=True, timeout=90))
            page = d.get("entries") or []
            events += [slim(e) for e in page if (e.get("start") or "")[:10] >= start]   # GFW also returns events that only overlap
            offset = d.get("nextOffset")
            if not page or not offset or (page[-1].get("start") or "")[:10] < start:
                break
            truncated = page_no == EVENT_MAX_PAGES - 1
        events = [e for e in events if e["lat"] is not None and e["lon"] is not None]
        return {"fetchedAt": _now(), "start": start, "end": end, "truncated": truncated, "events": events}

    def encounters(self, start: str | None = None, end: str | None = None) -> dict:
        """Fishing vessels meeting carriers, support vessels, bunkers or tankers at sea (possible transshipment)."""
        if not (start and end):
            start, end = default_period()
        q = {"datasets[0]": "public-global-encounters-events:latest"}
        q.update({f"encounter-types[{i}]": t for i, t in enumerate(ENCOUNTER_TYPES)})

        def build():
            d = self._fetch_events(q, start, end, slim_encounter)
            # GFW lists every meeting once from each side (fishing-carrier and carrier-fishing): keep the one led by the
            # carrier, bunker, support vessel or tanker
            seen, keep = set(), []
            for e in sorted(d["events"], key=lambda e: e["type"] is not None and e["type"].startswith("fishing-")):
                key = (frozenset(v["vesselId"] for v in e["vessels"]), (e["start"] or "")[:16])
                if key not in seen:
                    seen.add(key)
                    keep.append(e)
            d["events"] = sorted(keep, key=lambda e: e["start"] or "", reverse=True)
            return d
        return self._cached(f"encounters_v2_{start}_{end}", build, self._settled(end))

    def loitering(self, start: str | None = None, end: str | None = None) -> dict:
        """Carriers and bunker vessels loitering far from shore: the wait before a possible transshipment."""
        if not (start and end):
            start, end = default_period()
        q = {"datasets[0]": "public-global-loitering-events:latest"}
        q.update({f"vessel-types[{i}]": t for i, t in enumerate(LOITER_VESSEL_TYPES)})

        def build():
            d = self._fetch_events(q, start, end, slim_loitering)
            d["events"] = [e for e in d["events"] if (e["shoreKm"] or 0) >= LOITER_MIN_SHORE_KM]
            return d
        return self._cached(f"loitering_{start}_{end}", build, self._settled(end))

    def insights(self, vessel_id: str, start: str | None = None, end: str | None = None) -> dict:
        """GFW vessel insights: IUU-list history, fishing in RFMO areas without a known authorisation, no-take MPA fishing,
        AIS switched off, and how much of the period the vessel was seen."""
        if not (start and end):
            start, end = default_period()
        body = {"includes": ["FISHING", "GAP", "COVERAGE", "VESSEL-IDENTITY-IUU-VESSEL-LIST"], "startDate": start, "endDate": end,
                "vessels": [{"datasetId": IDENTITY, "vesselId": vessel_id}]}

        def build():
            try:
                d = json.loads(_get(f"{GFW}/insights/vessels", token=True, method="POST", body=body, timeout=90))
            except SeaSourceError as e:
                if e.status in (404, 422):
                    raise LookupError(vessel_id) from e
                raise
            return {"fetchedAt": _now(), "vesselId": vessel_id, "start": start, "end": end, "raw": d}
        safe = "".join(c for c in vessel_id if c.isalnum() or c == "-")[:80]
        return self._cached(f"insights/{safe}_{start}_{end}", build, self._settled(end))

    # ---------- vector context layers and fishing effort tiles ----------
    def context_tile(self, layer: str, z: int, x: int, y: int) -> bytes:
        """A Mapbox vector tile of a GFW context layer (sea borders, offshore infrastructure). Empty tiles come back as b""."""
        path = self.cache_dir / "context" / layer / str(z) / str(x) / f"{y}.pbf"
        if path.exists() and time.time() - path.stat().st_mtime < 30 * 86400:
            return path.read_bytes()
        try:
            pbf = _get(f"{GFW}/datasets/{CONTEXT_LAYERS[layer]}/context-layers/{z}/{x}/{y}", token=True, timeout=60)
        except SeaSourceError as e:
            if e.status != 404:
                raise
            pbf = b""
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_bytes(pbf)
        tmp.replace(path)
        return pbf

    def effort_tile(self, z: int, x: int, y: int, start: str, end: str) -> bytes:
        """PNG tile of apparent fishing effort (AIS) in start..end, coloured with steps scaled to the period's length."""
        path = self.cache_dir / "effort" / f"{start}_{end}" / str(z) / str(x) / f"{y}.png"
        if path.exists() and (self._settled(end) or time.time() - path.stat().st_mtime < self.fresh_s):
            return path.read_bytes()
        days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
        ramp = [round(v * 4.0 ** (2 - z) * days / 30, 2) for v in EFFORT_RAMP_Z2]
        style = base64.b64encode(json.dumps({"color": EFFORT_RGB, "ramp": ramp}, separators=(",", ":")).encode()).decode()
        until = (date.fromisoformat(end) + timedelta(days=1)).isoformat()
        q = {"format": "PNG", "interval": "DAY" if days <= 31 else "MONTH", "datasets[0]": "public-global-fishing-effort:latest",
             "date-range": f"{start},{until}", "style": style}
        try:
            png = _get(f"{GFW}/4wings/tile/heatmap/{z}/{x}/{y}?{urllib.parse.urlencode(q)}", token=True, timeout=60, tries=3)
        except SeaSourceError as e:
            if e.status != 404:
                raise
            png = EMPTY_PNG
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_bytes(png)
        tmp.replace(path)
        return png

    # ---------- seasonal fishing closures (precomputed) ----------
    def closures(self) -> dict:
        if not CLOSURES.exists():
            raise LayerNotBuilt("Seasonal closures have not been built yet. Run: python3 backend/scripts/ingest_closures.py")
        return json.loads(CLOSURES.read_text())

    def ais_off(self, start: str | None = None, end: str | None = None) -> dict:
        """Vessels that went dark, by the date the gap began (start..end inclusive; default: the last 30 days)."""
        if not (start and end):
            start, end = default_period()
        return self._cached(f"gaps_{start}_{end}", lambda: self._fetch_gaps(start, end), self._settled(end))

    # ---------- possible oil slicks ----------
    def _fetch_slicks(self, start: str, end: str) -> dict:
        until = (date.fromisoformat(end) + timedelta(days=1)).isoformat()
        q = {"f": "geojson", "limit": "1000", "bbox-only": "true", "sortby": "-area", "filter-lang": "cql2-text",
             "datetime": f"{start}T00:00:00Z/{until}T00:00:00Z",
             "filter": f"machine_confidence > {SLICK_MIN_CONFIDENCE} AND area > {SLICK_MIN_AREA_M2}",
             "properties": "id,slick_timestamp,machine_confidence,area,length,source_type_1_ids,source_type_2_ids,"
                           "source_type_3_ids,slick_url"}
        d = json.loads(_get(f"{CERULEAN}?{urllib.parse.urlencode(q)}", timeout=90))
        slicks = []
        for f in d.get("features", []):
            p = f.get("properties") or {}
            ring = ((f.get("geometry") or {}).get("coordinates") or [[]])[0]
            if len(ring) < 4:
                continue
            lons, lats = [c[0] for c in ring], [c[1] for c in ring]
            source = next((SLICK_SOURCES[k] for k in (1, 2, 3) if p.get(f"source_type_{k}_ids")), "UNKNOWN")
            slicks.append({"id": str(p.get("id")), "lat": round((min(lats) + max(lats)) / 2, 4),
                           "lon": round((min(lons) + max(lons)) / 2, 4), "time": p.get("slick_timestamp"),
                           "areaKm2": round((p.get("area") or 0) / 1e6, 1), "lengthKm": round((p.get("length") or 0) / 1e3, 1),
                           "confidence": round(p.get("machine_confidence") or 0, 3), "possibleSource": source,
                           "url": p.get("slick_url")})
        sources_ok = True
        try:
            by_slick = self._fetch_slick_sources([s["id"] for s in slicks])
        except SeaSourceError:
            by_slick, sources_ok = {}, False         # said in the response, never silently: the slicks themselves are fine
        for s in slicks:
            s["candidates"] = by_slick.get(s["id"], [])
        return {"fetchedAt": _now(), "start": start, "end": end, "matched": d.get("numberMatched"), "slicks": slicks,
                "candidatesAvailable": sources_ok}

    def _fetch_slick_sources(self, slick_ids: list[str]) -> dict[str, list[dict]]:
        """Cerulean's ranked candidate sources (AIS vessels, radar-only 'dark' vessels, offshore structures) per slick."""
        out: dict[str, list[dict]] = {}
        for i in range(0, len(slick_ids), 500):                  # keeps each URL a sane length
            chunk = [x for x in slick_ids[i:i + 500] if x.isdigit()]
            if not chunk:
                continue
            q = {"f": "geojson", "limit": "2000", "bbox-only": "true", "filter-lang": "cql2-text",
                 "filter": f"source_rank <= {SLICK_MAX_CANDIDATES} AND slick_id IN ({','.join(chunk)})",
                 "properties": "slick_id,mmsi_or_structure_id,source_type,source_collated_score,source_rank,source_url"}
            d = json.loads(_get(f"{CERULEAN_SOURCES}?{urllib.parse.urlencode(q)}", timeout=90))
            for f in d.get("features", []):
                p = f.get("properties") or {}
                out.setdefault(str(p.get("slick_id")), []).append({
                    "rank": int(p.get("source_rank") or 0), "type": CANDIDATE_TYPE.get(p.get("source_type"), "UNKNOWN"),
                    "ref": str(p.get("mmsi_or_structure_id") or ""), "score": p.get("source_collated_score"),
                    "url": p.get("source_url")})
        for v in out.values():
            v.sort(key=lambda c: c["rank"])
        return out

    def slicks(self, start: str | None = None, end: str | None = None) -> dict:
        if not (start and end):
            start, end = default_period()
        return self._cached(f"slicks_v2_{start}_{end}", lambda: self._fetch_slicks(start, end), self._settled(end))

    # ---------- one ship ----------
    def _fetch_vessel(self, vessel_id: str, start: str, end: str) -> dict:
        vid = urllib.parse.quote(vessel_id, safe="")
        try:
            ident = json.loads(_get(f"{GFW}/vessels/{vid}?{urllib.parse.urlencode({'dataset': IDENTITY})}", token=True))
        except SeaSourceError as e:
            if e.status == 404:
                raise LookupError(vessel_id) from e
            raise
        q = {"vessels[0]": vessel_id, "start-date": start, "end-date": (date.fromisoformat(end) + timedelta(days=1)).isoformat(),
             "sort": "+start", "limit": "1000"}
        q.update({f"datasets[{i}]": ds for i, ds in enumerate(VESSEL_EVENT_DATASETS)})
        events, offset, truncated = [], 0, False
        for page_no in range(VESSEL_MAX_PAGES):
            d = json.loads(_get(f"{GFW}/events?{urllib.parse.urlencode({**q, 'offset': str(offset)})}", token=True, timeout=90))
            page = d.get("entries") or []
            events += [slim_vessel_event(e) for e in page]
            offset = d.get("nextOffset")
            if not page or not offset:
                break
            truncated = page_no == VESSEL_MAX_PAGES - 1
        return {"fetchedAt": _now(), "vesselId": vessel_id, "start": start, "end": end, "truncated": truncated,
                "identity": slim_identity(ident), "events": [e for e in events if e["lat"] is not None and e["lon"] is not None]}

    def vessel(self, vessel_id: str, start: str | None = None, end: str | None = None) -> dict:
        if not (start and end):
            start, end = default_period()
        safe = "".join(c for c in vessel_id if c.isalnum() or c == "-")[:80]
        return self._cached(f"vessels/{safe}_{start}_{end}", lambda: self._fetch_vessel(vessel_id, start, end), self._settled(end))

    def search(self, query: str) -> list[dict]:
        q = {"query": query, "datasets[0]": IDENTITY, "limit": "12"}
        d = json.loads(_get(f"{GFW}/vessels/search?{urllib.parse.urlencode(q)}", token=True, timeout=45))
        out = []
        for e in d.get("entries") or []:
            ident = slim_identity(e)
            if ident["vesselId"]:
                out.append(ident)
        return out

    # ---------- shipping lanes (AIS presence tiles) ----------
    def lanes_tile(self, z: int, x: int, y: int, month: str | None = None) -> bytes:
        """One PNG tile of AIS vessel presence for one month (default: the latest), drawn by GFW with our own colour steps.

        GFW's default steps only colour the very busiest water (ports and straits), so open-ocean routes vanish.
        These steps start far lower and are roughly geometric, which is what makes the lanes show as threads.
        Cell values shrink about fourfold per zoom level (smaller cells), so the steps are scaled to match.
        """
        month = month or month_axis()[-1]
        path = self.cache_dir / "lanes" / f"{month}-v2" / str(z) / str(x) / f"{y}.png"
        if path.exists():
            return path.read_bytes()
        seed = LANE_SEED / f"{month}-v2" / str(z) / str(x) / f"{y}.png"
        if seed.exists():
            return seed.read_bytes()
        yy, mm = map(int, month.split("-"))
        end = f"{yy + 1}-01-01" if mm == 12 else f"{yy}-{mm + 1:02d}-01"
        ramp = [round(v * 4.0 ** (2 - z), 2) for v in LANE_RAMP_Z2]
        style = base64.b64encode(json.dumps({"color": LANE_RGB, "ramp": ramp}, separators=(",", ":")).encode()).decode()
        q = {"format": "PNG", "interval": "MONTH", "datasets[0]": "public-global-presence:latest",
             "date-range": f"{month}-01,{end}", "style": style}
        try:
            png = _get(f"{GFW}/4wings/tile/heatmap/{z}/{x}/{y}?{urllib.parse.urlencode(q)}", token=True, timeout=60, tries=4)
        except SeaSourceError as e:
            if e.status != 404:
                raise
            png = EMPTY_PNG
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_bytes(png)
        tmp.replace(path)
        return png

    def lanes_month(self) -> str:
        return month_axis()[-1]

    # ---------- apparent fishing inside no-take areas (precomputed) ----------
    def protected_fishing(self) -> dict:
        if not PROTECTED_FISHING.exists():
            raise LayerNotBuilt("Fishing in no-take areas has not been built yet. Run: python3 -I backend/scripts/ingest_sea.py")
        return json.loads(PROTECTED_FISHING.read_text())
