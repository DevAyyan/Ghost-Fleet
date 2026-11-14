"""Real-data path: loader contract, isDemoData=false, detections endpoint, and no silent demo fallback."""
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from ghostfleet.api.main import app
from ghostfleet.real import DataUnavailable, load_real_panel


def _fixture(path, n_months=36):
    rng = np.random.default_rng(1)
    months = [f"{2023 + k // 12}-{k % 12 + 1:02d}" for k in range(n_months)]
    cells = []
    for i, (lat, lon) in enumerate([(24.25, 66.25), (24.25, 66.75), (24.75, 66.25)]):
        trend = 1 + (0.8 * np.linspace(0, 1, n_months) if i == 0 else np.zeros(n_months))
        cells.append({
            "id": f"N{lat:.2f}E{lon:.2f}", "center": [lon, lat],
            "boundary": [[lon - .25, lat - .25], [lon + .25, lat - .25], [lon + .25, lat + .25], [lon - .25, lat + .25], [lon - .25, lat - .25]],
            "unmatched": [float(x) for x in rng.poisson(40 * trend)], "matched": [float(x) for x in rng.poisson(20, n_months)],
            "opportunities": [10] * n_months, "wind": [6.0] * 24 + [None] * (n_months - 24), "chl": [0.5] * n_months,
        })
    ids = [c["id"] for c in cells]
    path.write_text(json.dumps({
        "schema": 1, "fetchedAt": "2026-11-14T08:00:00+00:00", "months": months,
        "grid": {"resolutionDeg": 0.5, "bbox": [56, 20, 70, 26]}, "cells": cells,
        "neighbors": {a: [b for b in ids if b != a] for a in ids},
        "aisReceptionRegional": [1000.0] * n_months,
        "detections": {months[-1]: [[24.31, 66.12, 3, 1], [24.4, 66.6, 0, 2]]},
        "sources": [{"name": "Global Fishing Watch SAR", "role": "detections", "url": "https://globalfishingwatch.org/"}],
    }))
    return months


def test_loader_builds_panel(tmp_path):
    p = tmp_path / "panel.json"
    months = _fixture(p)
    panel, extras = load_real_panel(p)
    assert not panel.is_synthetic and len(panel.cell_ids) == 3 and panel.months.size == len(months)
    assert np.isnan(panel.wind[0, -1])                       # missing stays NaN, not 0
    assert extras.fetched_at.startswith("2026-11-14") and "Fetched" in panel.source_note


def test_missing_panel_raises(tmp_path):
    with pytest.raises(DataUnavailable):
        load_real_panel(tmp_path / "nope.json")


def test_api_serves_real_panel(tmp_path, monkeypatch):
    p = tmp_path / "panel.json"
    _fixture(p)
    monkeypatch.setenv("GHOSTFLEET_DATA", "real")
    monkeypatch.setenv("GHOSTFLEET_PANEL", str(p))
    with TestClient(app) as c:
        meta = c.get("/api/meta").json()
        assert meta["isDemoData"] is False and meta["fetchedAt"].startswith("2026-11-14") and meta["cellSizeDeg"] == 0.5
        events = c.get("/api/events").json()["data"]
        if events:
            cf = c.get(f"/api/events/{events[0]['eventId']}/case-file").json()
            assert cf["isDemoData"] is False and "Global Fishing Watch" in cf["dataSources"][0]["name"]


def test_missing_panel_analysis_is_503_but_live_map_works(tmp_path, monkeypatch):
    monkeypatch.setenv("GHOSTFLEET_DATA", "real")
    monkeypatch.setenv("GHOSTFLEET_PANEL", str(tmp_path / "missing.json"))
    with TestClient(app) as c:
        meta = c.get("/api/meta").json()
        assert meta["isDemoData"] is False and meta["eventCount"] == 0 and meta["months"][0] == "2020-01"
        r = c.get("/api/events")
        assert r.status_code == 503                       # never falls back to demo analysis
        assert r.json()["error"]["code"] == "DATA_UNAVAILABLE" and "ingest_real.py" in r.json()["error"]["message"]


class FakeGFW:
    """Stands in for the live GFW client so tests never touch the network."""
    def __init__(self, fail=False):
        self.fail, self.calls = fail, []

    def detections(self, month):
        from ghostfleet.gfw import GFWError
        self.calls.append(month)
        if self.fail:
            raise GFWError("GFW unreachable: TimeoutError")
        return {"month": month, "fetchedAt": "2026-11-14T08:00:00+00:00", "points": [[24.31, 66.12, 3, 1], [24.4, 66.6, 0, 2]]}


def test_detections_come_live_from_gfw(tmp_path, monkeypatch):
    from ghostfleet.gfw import month_axis
    monkeypatch.setenv("GHOSTFLEET_DATA", "real")
    monkeypatch.setenv("GHOSTFLEET_PANEL", str(tmp_path / "missing.json"))
    with TestClient(app) as c:
        fake = FakeGFW()
        app.state.gfw = fake
        det = c.get("/api/detections").json()
        assert det["month"] == month_axis()[-1] and fake.calls == [month_axis()[-1]]
        assert det["totalUnmatched"] == 3 and det["totalMatched"] == 3 and det["isDemoData"] is False
        assert det["fetchedAt"].startswith("2026-11-14") and "Global Fishing Watch" in det["source"]
        assert c.get("/api/detections", params={"month": "2021-06"}).json()["month"] == "2021-06"
        assert c.get("/api/detections", params={"month": "1999-01"}).status_code == 404
        assert c.get("/api/detections", params={"month": "bad"}).status_code == 422
        app.state.gfw = FakeGFW(fail=True)
        r = c.get("/api/detections")
        assert r.status_code == 502 and r.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"


# ---------- global build: per-region AIS reception, no chlorophyll, cells in every hemisphere ----------
def _global_fixture(path, n_months=36):
    rng = np.random.default_rng(2)
    months = [f"{2023 + k // 12}-{k % 12 + 1:02d}" for k in range(n_months)]
    spec = [("N24.61E66.80", 66.80, 24.61, "R10_21", [6.0] * n_months), ("S34.45W18.98", -18.98, -34.45, "R04_14", None)]
    cells = [{
        "id": cid, "center": [lon, lat],
        "boundary": [[lon - .7, lat - .7], [lon + .7, lat - .7], [lon + .7, lat + .7], [lon - .7, lat + .7], [lon - .7, lat - .7]],
        "unmatched": [int(x) for x in rng.poisson(40, n_months)], "matched": [int(x) for x in rng.poisson(20, n_months)],
        "opportunities": [10] * n_months, "wind": wind, "chl": None, "aisRegion": region,
    } for cid, lon, lat, region, wind in spec]
    path.write_text(json.dumps({
        "schema": 1, "fetchedAt": "2026-11-14T08:00:00+00:00", "months": months,
        "grid": {"resolutionDeg": 1.40625, "bbox": [-180, -90, 180, 90]}, "cells": cells, "neighbors": {},
        "aisReceptionByRegion": {"R10_21": [2.0] * n_months, "R04_14": [None] + [5.0] * (n_months - 1)},
        "sources": [{"name": "Global Fishing Watch SAR", "role": "detections", "url": "https://globalfishingwatch.org/"}],
    }))


def test_loader_reads_global_panel(tmp_path):
    p = tmp_path / "panel.json"
    _global_fixture(p)
    panel, extras = load_real_panel(p)
    assert panel.cell_ids == ["N24.61E66.80", "S34.45W18.98"] and extras.cell_size_deg == 1.40625
    assert panel.ais_reception[0, 0] == 2.0 and panel.ais_reception[1, 5] == 5.0     # each cell gets its own region
    assert np.isnan(panel.ais_reception[1, 0])                                          # null stays NaN
    assert np.isnan(panel.chl).all() and np.isnan(panel.wind[1]).all() and panel.wind[0, 0] == 6.0


def test_weather_step_is_labelled_by_what_the_panel_contains(tmp_path, monkeypatch):
    p = tmp_path / "panel.json"
    _global_fixture(p)
    monkeypatch.setenv("GHOSTFLEET_DATA", "real")
    monkeypatch.setenv("GHOSTFLEET_PANEL", str(p))
    with TestClient(app) as c:
        steps = {s["step"]: s["label"] for s in c.get("/api/meta").json()["steps"]}
        assert steps["ENVIRONMENT"] == "− wind"                      # no chlorophyll in the global build
        assert len(c.get("/api/cells").json()["cells"]) == 2


def test_cell_labels_cover_every_hemisphere():
    from ghostfleet.api.service import cell_label
    assert cell_label("N24.61E66.80") == "24.61°N 66.80°E"
    assert cell_label("S34.45W18.98") == "34.45°S 18.98°W"
    assert cell_label("syn_2_2") == "syn_2_2"


def test_ingest_grid_matches_geohash_cells():
    import importlib.util
    from pathlib import Path
    spec = importlib.util.spec_from_file_location("ingest_real", Path(__file__).resolve().parents[2] / "scripts" / "ingest_real.py")
    ing = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ing)
    # precision-3 geohashes of Karachi, Cape Town and London fall in the cells that contain those points
    for h, lat, lon in (("tkr", 24.6, 66.8), ("k3v", -33.9, 18.4), ("gcp", 51.5, -0.1), ("000", -89.9, -179.9), ("zzz", 89.9, 179.9)):
        assert ing.geohash_cell(h) == ing.cell_of(lat, lon)
    assert ing.cell_id(*ing.cell_of(-33.9, 18.4)) == "S34.45E18.98" and ing.cell_id(*ing.cell_of(51.5, -0.1)) == "N51.33W0.70"
    lat, lon = ing.cell_center(*ing.cell_of(24.6, 66.8))
    assert abs(lat - 24.6) <= ing.RES / 2 and abs(lon - 66.8) <= ing.RES / 2
