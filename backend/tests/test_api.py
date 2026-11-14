"""API contract tests: envelope, error shape, naming, pagination, wording safeguards."""
import json
import re

import pytest
from fastapi.testclient import TestClient

from ghostfleet.api.main import app
from ghostfleet.synthetic import PLANTED


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _keys(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _keys(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _keys(v)


@pytest.fixture(scope="module")
def top_event(client):
    return client.get("/api/events").json()["data"][0]


def test_meta_declares_demo_data_and_naive_vs_corrected(client):
    r = client.get("/api/meta").json()
    assert r["isDemoData"] is True
    assert "DEMO DATA" in r["sourceNote"]
    assert r["months"][0] == "2020-01" and len(r["months"]) == 81
    assert [s["step"] for s in r["steps"]] == ["RAW", "COVERAGE", "AIS_RECEPTION", "SEASON", "ENVIRONMENT"]
    assert set(r["alertsByStep"]) == {"RAW", "COVERAGE", "AIS_RECEPTION", "SEASON", "ENVIRONMENT"}


def test_every_success_response_has_demo_flag_and_camel_case(client, top_event):
    eid = top_event["eventId"]
    responses = [client.get("/api/meta"), client.get("/api/cells"), client.get(f"/api/cells/{top_event['leadCellId']}"),
                 client.get("/api/events"), client.get(f"/api/events/{eid}"),
                 client.post(f"/api/events/{eid}/disproof"), client.get(f"/api/events/{eid}/case-file")]
    for r in responses:
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["isDemoData"] is True
        snake = [k for k in _keys(body) if "_" in k and not re.fullmatch(r"[A-Z_]+", k)]
        assert not snake, f"{r.request.url}: snake_case keys {snake[:5]}"


def test_no_nan_in_json(client):
    # Starlette would emit NaN tokens, which are invalid JSON for browsers
    raw = client.get("/api/cells").text
    assert "NaN" not in raw and "Infinity" not in raw
    json.loads(raw)


def test_cells_map_layer_shape(client):
    r = client.get("/api/cells").json()
    assert len(r["cells"]) == 48
    c = r["cells"][0]
    assert len(c["msdiSeries"]) == len(r["months"])
    assert c["boundary"][0] == c["boundary"][-1]                  # closed ring
    lon, lat = c["center"]
    assert 55 < lon < 72 and 18 < lat < 28                        # Arabian Sea, [lon, lat] order


def test_events_ranked_paginated_and_filterable(client):
    r = client.get("/api/events", params={"page": 1, "pageSize": 1}).json()
    assert len(r["data"]) == 1 and r["pagination"]["pageSize"] == 1
    assert r["pagination"]["totalItems"] >= 2
    allev = client.get("/api/events").json()["data"]
    assert [e["rank"] for e in allev] == sorted(e["rank"] for e in allev)
    up = client.get("/api/events", params={"direction": "INCREASING"}).json()["data"]
    assert up and all(e["direction"] == "INCREASING" for e in up)
    assert {PLANTED["EVT_UP"], PLANTED["EVT_DOWN"]} <= {e["leadCellId"] for e in allev}


def test_event_detail_has_full_investigation(client):
    allev = client.get("/api/events").json()["data"]
    eid = next(e["eventId"] for e in allev if e["leadCellId"] == PLANTED["EVT_UP"])
    d = client.get(f"/api/events/{eid}").json()
    assert len(d["waterfall"]) == 5 and len(d["series"]) == 81
    assert d["oppositeNeighbors"][0]["cellId"] == PLANTED["EVT_DOWN"]
    assert d["explanations"][0]["code"] == "UNEXPLAINED_CHANGE"
    assert abs(sum(x["share"] for x in d["explanations"]) - 1) < 1e-6
    assert d["confidence"]["level"] == "MODERATE"                 # capped: single sensor
    assert d["recommendedAction"]["label"] == "RECOMMENDATION"
    assert {s["label"] for s in d["statements"]} <= {"OBSERVATION", "INFERENCE", "HYPOTHESIS", "RECOMMENDATION"}


def test_disproof_subset_and_repeatable(client, top_event):
    eid = top_event["eventId"]
    a = client.post(f"/api/events/{eid}/disproof", json={"variants": ["TRIM_START", "STRICT_ALPHA"]}).json()
    assert a["total"] == 2
    assert {v["variant"] for v in a["variants"]} == {"TRIM_START", "STRICT_ALPHA"}
    b = client.post(f"/api/events/{eid}/disproof", json={"variants": ["TRIM_START", "STRICT_ALPHA"]}).json()
    assert a == b
    full = client.post(f"/api/events/{eid}/disproof").json()
    assert full["total"] == 7 and full["verdict"]["label"] == "INFERENCE"


def test_case_file_json_and_geojson(client, top_event):
    eid = top_event["eventId"]
    r = client.get(f"/api/events/{eid}/case-file")
    assert "attachment" in r.headers["content-disposition"]
    cf = r.json()
    for k in ("summary", "whatChanged", "evidence", "alternativeExplanations", "recommendedAction",
              "limitations", "dataSources", "generatedAt"):
        assert k in cf
    g = client.get(f"/api/events/{eid}/case-file", params={"format": "geojson"})
    assert g.headers["content-type"].startswith("application/geo+json")
    assert g.json()["type"] == "FeatureCollection" and g.json()["features"]


def test_never_accusatory(client, top_event):
    eid = top_event["eventId"]
    texts = [client.get(f"/api/events/{eid}").text, client.get(f"/api/events/{eid}/case-file").text,
             client.post(f"/api/events/{eid}/disproof").text]
    for t in texts:
        # "illegal" may appear only in a negated disclaimer, never as a conclusion
        for m in re.finditer(r"[^.]*\b(illegal|violator)\w*[^.]*", t, re.I):
            assert re.search(r"\b(not|never|no)\b", m.group(0), re.I), m.group(0)


@pytest.mark.parametrize("method,path,body,status,code", [
    ("get", "/api/events/EVT-999", None, 404, "NOT_FOUND"),
    ("get", "/api/cells/nope", None, 404, "NOT_FOUND"),
    ("post", "/api/events/EVT-999/disproof", None, 404, "NOT_FOUND"),
    ("get", "/api/events?pageSize=1000", None, 422, "VALIDATION_ERROR"),
    ("get", "/api/events/EVT-001/case-file?format=pdf", None, 422, "VALIDATION_ERROR"),
    ("post", "/api/events/EVT-001/disproof", {"variants": ["MAKE_IT_SIGNIFICANT"]}, 422, "VALIDATION_ERROR"),
    ("get", "/api/nowhere", None, 404, "NOT_FOUND"),
])
def test_errors_have_one_shape(client, method, path, body, status, code):
    r = getattr(client, method)(path, **({"json": body} if body is not None else {}))
    assert r.status_code == status
    err = r.json()["error"]
    assert err["code"] == code and isinstance(err["message"], str)
