"""Live awareness layers: record shaping, hypothesis rules, endpoints (sources faked: tests never touch the network)."""
import re

from fastapi.testclient import TestClient

from ghostfleet.api import sea_service
from ghostfleet.api.main import app
from ghostfleet.places import high_risk_area, sea_name
from ghostfleet.sea import LayerNotBuilt, slim_fishing, slim_gap, slim_vessel_event

RAW_GAP = {
    "id": "g1", "start": "2026-11-01T00:00:00.000Z", "end": "2026-11-03T00:00:00.000Z", "position": {"lat": 1.0, "lon": 2.0},
    "regions": {"mpa": ["1"], "mpaNoTake": ["9"], "highSeas": []},
    "distances": {"startDistanceFromShoreKm": 120},
    "vessel": {"name": "TEST BOAT", "flag": "ESP", "type": "fishing"},
    "gap": {"intentionalDisabling": True, "distanceKm": "55.5", "durationHours": 48.0, "positions12HoursBeforeSat": "30",
            "offPosition": {"lat": -46.0, "lon": -60.5}},
}


def _gap(**over):
    return {**slim_gap(RAW_GAP), **over}


def test_slim_gap_uses_the_switch_off_position_and_parses_numbers():
    g = slim_gap(RAW_GAP)
    assert (g["lat"], g["lon"]) == (-46.0, -60.5) and g["distanceKm"] == 55.5 and g["positionsBefore"] == 30.0
    assert g["inNoTake"] and g["inMpa"] and not g["highSeas"]


def test_slim_fishing_marks_partial_no_take():
    e = slim_fishing({"id": "f1", "start": "2026-11-01T00:00:00Z", "end": "2026-11-01T06:00:00Z", "position": {"lat": 0, "lon": 0},
                      "regions": {"mpaNoTakePartial": ["7"]}, "vessel": {"name": "X", "flag": "KOR", "type": "fishing"}})
    assert e["durationHours"] == 6.0 and e["fullNoTake"] is False and e["areaIds"] == ["7"]


def test_places():
    assert sea_name(24.6, 58.5) == "Gulf of Oman" and sea_name(-46.0, -60.5) == "Patagonian Shelf"
    assert high_risk_area(12.0, 48.0) and high_risk_area(50.0, 0.0) is None


def test_gap_statements_are_labelled_and_follow_the_context():
    ev = sea_service.ais_off_event(_gap())
    labels = [s.label.value for s in ev.statements]
    assert labels[0] == "OBSERVATION" and "HYPOTHESIS" in labels and ev.place == "Patagonian Shelf"
    assert "no-take protected area" in " ".join(s.text for s in ev.statements)
    # a cargo ship in a piracy-risk area gets the legitimate safety reason, not a transfer hypothesis
    risk = sea_service.ais_off_event(_gap(lat=12.0, lon=48.0, vesselType="cargo", inNoTake=False, inMpa=False))
    text = " ".join(s.text for s in risk.statements)
    assert "legitimate safety reason" in text and "ship-to-ship" not in text


def test_hotspots_rank_busy_places_and_skip_their_neighbours():
    evs = [_gap(id=f"a{k}", lat=-46.0 + (k % 3) * 0.1, lon=-60.5) for k in range(30)]
    evs += [_gap(id=f"b{k}", lat=-45.0, lon=-58.9) for k in range(12)]          # touching square: folded into the first
    evs += [_gap(id=f"c{k}", lat=44.0, lon=174.0, highSeas=True, inNoTake=False, inMpa=False) for k in range(15)]
    hs = sea_service.hotspots(evs, "between 7 May 2026 and 9 Jul 2026")
    assert [h.count for h in hs] == [42, 15] and hs[0].id == "HOT-01" and hs[0].top_flags == ["ESP"]
    assert hs[1].statements[0].label.value == "OBSERVATION" and "high seas" in hs[1].statements[1].text


class FakeSea:
    def __init__(self):
        self.calls = []

    def ais_off(self, start=None, end=None):
        self.calls.append(("ais_off", start, end))
        return {"fetchedAt": "2026-11-14T10:00:00+00:00", "start": start, "end": end, "truncated": False,
                "events": [_gap(), _gap(id="g2")]}

    def slicks(self, start=None, end=None):
        self.calls.append(("slicks", start, end))
        return {"fetchedAt": "2026-11-14T10:00:00+00:00", "start": start, "end": end, "matched": 5, "slicks": [
            {"id": "1", "lat": 10.6, "lon": -58.6, "time": "2026-10-15T22:09:05", "areaKm2": 319.0, "lengthKm": 98.9,
             "confidence": 0.997, "possibleSource": "DARK_VESSEL", "url": "https://example.org/1"}]}

    def protected_fishing(self):
        raise LayerNotBuilt("Fishing in no-take areas has not been built yet. Run: python3 -I scripts/ingest_sea.py")

    def lanes_tile(self, z, x, y, month=None):
        self.calls.append(("lanes", month))
        return b"\x89PNG fake"

    def vessel(self, vessel_id, start=None, end=None):
        if vessel_id == "nope":
            raise LookupError(vessel_id)
        gap = {**RAW_GAP, "type": "gap", "id": "g1"}
        gap["gap"] = {**RAW_GAP["gap"], "onPosition": {"lat": -45.0, "lon": -59.0}}
        events = [slim_vessel_event(e) for e in (
            {"id": "p1", "type": "port_visit", "start": "2026-10-28T00:00:00.000Z", "end": "2026-10-29T00:00:00.000Z",
             "position": {"lat": -38.0, "lon": -57.5}, "port_visit": {"startAnchorage": {"name": "MAR DEL PLATA"}}},
            gap,
            {"id": "f1", "type": "fishing", "start": "2026-11-04T00:00:00.000Z", "end": "2026-11-04T08:00:00.000Z",
             "position": {"lat": -44.5, "lon": -59.5}})]
        return {"fetchedAt": "2026-11-14T10:00:00+00:00", "vesselId": vessel_id, "start": start, "end": end, "truncated": False,
                "identity": {"vesselId": vessel_id, "name": "TEST BOAT", "flag": "ESP", "mmsi": "224000000", "imo": None,
                             "callsign": "EA1", "gear": ["TRAWLERS"], "lengthM": 40, "tonnageGt": 300,
                             "transmitsFrom": None, "transmitsTo": None},
                "events": events}

    def search(self, query):
        return [{"vesselId": "v1", "name": "TEST BOAT", "flag": "ESP", "mmsi": "224000000", "gear": []}]


def test_sea_endpoints(monkeypatch):
    with TestClient(app) as c:
        app.state.sea = FakeSea()
        off = c.get("/api/sea/ais-off").json()
        assert off["total"] == 2 and len(off["events"]) == 2 and len(off["heat"]) == 2 and off["windowDays"] == 31
        assert off["events"][0]["vesselName"] == "TEST BOAT" and off["events"][0]["inNoTake"] is True
        sl = c.get("/api/sea/slicks").json()["slicks"][0]
        assert sl["possibleSource"] == "DARK_VESSEL" and "not broadcasting AIS" in sl["statements"][-1]["text"]
        r = c.get("/api/sea/protected-fishing")
        assert r.status_code == 503 and "ingest_sea.py" in r.json()["error"]["message"]
        t = c.get("/api/sea/lanes/2/1/1.png")
        assert t.status_code == 200 and t.headers["content-type"] == "image/png"
        assert c.get("/api/sea/lanes/2/9/1.png").status_code == 404                        # outside the tile pyramid
        # leads, never accusations
        blob = c.get("/api/sea/ais-off").text + c.get("/api/sea/slicks").text
        assert not re.search(r"\b(illegal|violator)", blob, re.I)


def test_protected_fishing_statements_never_accuse():
    r = sea_service.protected_fishing({"fetchedAt": "2026-11-14T10:00:00+00:00", "days": ["2026-11-10"], "scanned": 50000, "events": [
        slim_fishing({"id": "f1", "start": "2026-11-10T00:00:00Z", "end": "2026-11-10T06:00:00Z", "position": {"lat": -1.0, "lon": -90.5},
                      "regions": {"mpaNoTake": ["7"]}, "vessel": {"name": "X", "flag": "ECU", "type": "fishing"}})]})
    text = " ".join(s.text for s in r.events[0].statements)
    assert "Possible unauthorised fishing" in text and "permit list" in text and not re.search(r"\billegal", text, re.I)


def test_empty_lane_tiles_become_transparent_pngs(tmp_path, monkeypatch):
    import ghostfleet.sea as sea

    def refuse(url, **kw):
        err = sea.SeaSourceError("gateway refused the request (HTTP 404)")
        err.status = 404
        raise err
    monkeypatch.setattr(sea, "_get", refuse)
    monkeypatch.setattr(sea, "LANE_SEED", tmp_path / "no-seed")
    w = sea.SeaWatch(cache_dir=tmp_path)
    png = w.lanes_tile(3, 3, 0)
    assert png == sea.EMPTY_PNG and png[:4] == b"\x89PNG"
    assert len(list(tmp_path.rglob("0.png"))) == 1          # cached, so GFW is not asked again


def test_period_filter_reaches_the_sources_and_is_validated():
    with TestClient(app) as c:
        fake = app.state.sea = FakeSea()
        off = c.get("/api/sea/ais-off?start=2026-05-07&end=2026-07-09").json()
        assert (off["start"], off["end"], off["windowDays"]) == ("2026-05-07", "2026-07-09", 64)
        assert "between 7 May 2026 and 9 Jul 2026" not in off["events"][0]["statements"][0]["text"]     # events say their own date
        c.get("/api/sea/slicks?start=2026-05-07&end=2026-07-09")
        c.get("/api/sea/lanes/1/0/0.png?month=2026-06")
        assert ("ais_off", "2026-05-07", "2026-07-09") in fake.calls and ("slicks", "2026-05-07", "2026-07-09") in fake.calls
        assert ("lanes", "2026-06") in fake.calls
        for bad in ("start=2026-07-09&end=2026-05-07", "start=2026-05-07", "start=2019-01-01&end=2019-02-01",
                    "start=2020-01-01&end=2022-01-01", "start=2026-02-30&end=2026-03-01", "start=2999-01-01&end=2999-01-02"):
            r = c.get(f"/api/sea/ais-off?{bad}")
            assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR", bad
        assert c.get("/api/sea/lanes/1/0/0.png?month=1999-01").status_code == 404


def test_vessel_path_marks_where_and_when_it_went_dark():
    with TestClient(app) as c:
        app.state.sea = FakeSea()
        v = c.get("/api/sea/vessels/v1?start=2026-10-15&end=2026-11-14").json()
        assert v["identity"]["name"] == "TEST BOAT" and v["counts"] == {"port_visit": 1, "gap": 1, "fishing": 1}
        assert [p["kind"] for p in v["points"]] == ["port_visit", "gap_off", "gap_on", "fishing"]      # time order
        off, on = v["points"][1], v["points"][2]
        assert (off["lat"], off["lon"], off["time"][:10]) == (-46.0, -60.5, "2026-11-01")
        assert (on["lat"], on["lon"], on["time"][:10]) == (-45.0, -59.0, "2026-11-03")
        assert v["points"][0]["label"] == "MAR DEL PLATA"
        g = v["gaps"][0]
        assert g["onLat"] == -45.0 and g["durationHours"] == 48.0 and g["vesselId"] == "v1"
        assert "stopped broadcasting AIS 1 time" in v["statements"][0]["text"] and "not the ship's full track" in v["statements"][1]["text"]
        assert c.get("/api/sea/vessels/nope").status_code == 404
        found = c.get("/api/sea/vessels/search?q=test").json()
        assert found["results"][0]["vesselId"] == "v1" and c.get("/api/sea/vessels/search?q=a").status_code == 422


def test_unintentional_gaps_are_said_to_be_possible_reception_gaps():
    ev = sea_service.ais_off_event(_gap(intentional=False))
    assert ev.likely_intentional is False and "reception" in ev.statements[1].text


def test_protected_fishing_is_filtered_by_period():
    d = {"fetchedAt": "2026-11-14T10:00:00+00:00", "days": ["2026-11-08", "2026-11-10"], "scanned": 10, "events": [
        slim_fishing({"id": k, "start": f"2026-11-{day}T00:00:00Z", "end": f"2026-11-{day}T06:00:00Z", "position": {"lat": 0, "lon": 0},
                      "regions": {"mpaNoTake": ["7"]}, "vessel": {"id": "v9", "name": "X", "flag": "KOR", "type": "fishing"}})
        for k, day in (("a", "08"), ("b", "10"))]}
    r = sea_service.protected_fishing(d, "2026-11-09", "2026-11-12")
    assert [e.id for e in r.events] == ["b"] and r.events[0].vessel_id == "v9" and r.days == ["2026-11-08", "2026-11-10"]


def test_coordinated_turn_ons_detects_simultaneous_reconnections():
    evs = [
        {"id": "e1", "vesselName": "BOAT 1", "vesselType": "fishing", "flag": "TWN",
         "lat": 9.8, "lon": 19.8, "start": "2026-11-04T12:00:00Z",
         "onLat": 10.0, "onLon": 20.0, "end": "2026-11-05T12:00:00Z", "durationHours": 24.0, "highSeas": True},
        {"id": "e2", "vesselName": "BOAT 2", "vesselType": "fishing", "flag": "TWN",
         "lat": 9.9, "lon": 19.9, "start": "2026-11-04T11:00:00Z",
         "onLat": 10.1, "onLon": 20.2, "end": "2026-11-05T12:45:00Z", "durationHours": 25.75, "highSeas": True},
        {"id": "e3", "vesselName": "SOLITARY", "vesselType": "cargo", "flag": "PAN",
         "lat": -30.5, "lon": 49.5, "start": "2026-11-05T02:00:00Z",
         "onLat": -30.0, "onLon": 50.0, "end": "2026-11-05T12:00:00Z", "durationHours": 10.0, "highSeas": True},
    ]
    clusters = sea_service.coordinated_turn_ons(evs, "in Nov 2026")
    assert len(clusters) == 1
    c = clusters[0]
    assert c.count == 2 and c.top_flags == ["TWN"] and c.span_hours <= 1.0
    assert c.shared_hours >= 23.0
    assert c.co_presence_start == "2026-11-04T12:00:00.000Z"
    assert c.co_presence_end == "2026-11-05T12:00:00.000Z"
    assert any("Sister fleet sweep" in s.text for s in c.statements)
    assert any("4 Nov 2026, 12:00 UTC" in s.text for s in c.statements)
    assert any("5 Nov 2026, 12:00 UTC" in s.text for s in c.statements)


def test_serverless_friendly_responses(monkeypatch, tmp_path):
    """What a Vercel deployment relies on: CDN cache headers, a compact radar payload, event-only cells, seeded lane tiles."""
    import ghostfleet.sea as sea
    with TestClient(app) as c:
        app.state.sea = FakeSea()
        r = c.get("/api/sea/slicks")
        assert "s-maxage=3600" in r.headers["cache-control"] and "max-age=0" in r.headers["cache-control"]
        assert "s-maxage=2592000" in c.get("/api/sea/lanes/1/0/0.png").headers["cache-control"]
        assert "cache-control" not in c.get("/api/sea/vessels/nope").headers                     # errors are never cached
        every, some = c.get("/api/cells").json()["cells"], c.get("/api/cells?only=events").json()["cells"]
        assert 0 < len(some) < len(every) and all(x["eventId"] for x in some)

        class Radar:
            def detections(self, month, refresh=False):
                return {"month": month, "fetchedAt": "2026-11-14T10:00:00+00:00", "points": [[24.3, 66.1, 3, 1], [-34.4, 18.9, 0, 2]]}
        app.state.gfw = Radar()
        monkeypatch.setenv("GHOSTFLEET_DATA", "real")           # the live radar path (the synthetic panel has no detections)
        full, packed = c.get("/api/detections").json(), c.get("/api/detections?compact=true").json()
        assert packed["points"] == [] and packed["packed"] == [[24.3, 66.1, 3, 1], [-34.4, 18.9, 0, 2]]
        assert full["packed"] is None and full["points"][1] == {"lat": -34.4, "lon": 18.9, "unmatched": 0, "matched": 2}
        assert packed["totalUnmatched"] == full["totalUnmatched"] == 3 and packed["totalMatched"] == 3
        monkeypatch.setenv("GHOSTFLEET_DATA", "synthetic")
    # a lane tile shipped in data/seed is served without asking GFW or writing anything
    monkeypatch.setattr(sea, "LANE_SEED", tmp_path / "seed")
    monkeypatch.setattr(sea, "_get", lambda *a, **k: (_ for _ in ()).throw(AssertionError("GFW must not be called")))
    month = sea.month_axis()[-1]
    tile = tmp_path / "seed" / f"{month}-v2" / "1" / "0" / "0.png"
    tile.parent.mkdir(parents=True)
    tile.write_bytes(b"\x89PNG seeded")
    assert sea.SeaWatch(cache_dir=tmp_path / "cache").lanes_tile(1, 0, 0) == b"\x89PNG seeded"


def test_app_works_without_the_startup_hook(monkeypatch):
    """Serverless hosts may never run lifespan: state must build itself on first use, and the scan must run once."""
    from ghostfleet.api import main
    for name in ("gfw", "sea", "svc", "loaded", "load_error"):
        if hasattr(app.state, name):
            delattr(app.state, name)
    calls = []
    real = main._try_load
    monkeypatch.setattr(main, "_try_load", lambda a: (calls.append(1), real(a))[1])
    c = TestClient(app)                      # no "with": lifespan does not run
    assert c.get("/api/meta").json()["eventCount"] >= 0 and c.get("/api/events").status_code == 200
    assert len(calls) == 1
    assert isinstance(main.sea_watch(type("R", (), {"app": app})()), main.SeaWatch)


def test_coordinated_turn_ons_tolerate_a_missing_shore_distance():
    # slim_gap stores shoreKm=None when GFW has no distance: the border-zone rule must not crash on it
    base = {"vesselType": "cargo", "start": "2026-11-04T12:00:00Z", "end": "2026-11-05T12:00:00Z", "durationHours": 24.0}
    evs = [
        {**base, "id": "a", "vesselName": "A", "flag": "PAN", "lat": 9.8, "lon": 19.8, "onLat": 10.0, "onLon": 20.0,
         "highSeas": True, "shoreKm": None},
        {**base, "id": "b", "vesselName": "B", "flag": "LBR", "lat": 9.9, "lon": 19.9, "onLat": 10.1, "onLon": 20.1,
         "highSeas": False, "shoreKm": 120.0},
    ]
    clusters = sea_service.coordinated_turn_ons(evs, "in Nov 2026")
    assert len(clusters) == 1
    assert any("Border zone" in s.text for s in clusters[0].statements)
