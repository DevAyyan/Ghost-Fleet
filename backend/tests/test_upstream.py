"""Upstream plumbing: the per-request time budget, parallel fetches, wave pagination, the shared cache, compact statements.
Nothing here touches the network."""
import json
import threading
import time
import urllib.error

import pytest
from fastapi.testclient import TestClient

import ghostfleet.sea as sea
from ghostfleet.api.main import app
from ghostfleet.gfw import BudgetExceeded, parallel, time_left, upstream_budget

from test_sea import FakeSea


def _no_network(monkeypatch, calls=None, error=None):
    def urlopen(req, timeout=None):
        if calls is not None:
            calls.append(timeout)
        raise error or AssertionError("the network must not be touched")
    monkeypatch.setattr(sea.urllib.request, "urlopen", urlopen)


def test_a_spent_budget_fails_fast_without_calling_upstream(monkeypatch):
    _no_network(monkeypatch)
    with upstream_budget(0.5), pytest.raises(BudgetExceeded):
        sea._get("https://example.org/x")


def test_timeouts_are_cut_to_the_budget_and_there_is_no_pause_after_the_last_try(monkeypatch):
    calls, sleeps = [], []
    _no_network(monkeypatch, calls, urllib.error.URLError("down"))
    monkeypatch.setattr(sea.time, "sleep", sleeps.append)
    with pytest.raises(sea.SeaSourceError) as e:               # no budget: the call's own timeout, three tries, two pauses
        sea._get("https://example.org/x", timeout=20, tries=3)
    assert not isinstance(e.value, BudgetExceeded) and calls == [20, 20, 20] and sleeps == [1.5, 3.0]
    calls.clear(), sleeps.clear()
    with upstream_budget(10), pytest.raises(sea.SeaSourceError):
        sea._get("https://example.org/x", timeout=20, tries=3)
    assert calls and all(t <= 10 for t in calls)


def test_budget_exceeded_is_a_clear_504(monkeypatch):
    class Slow(FakeSea):
        def encounters(self, start=None, end=None):
            raise BudgetExceeded("upstream sources did not answer within the 40 s allowed per request")
    with TestClient(app) as c:
        app.state.sea = Slow()
        r = c.get("/api/sea/encounters")
        assert r.status_code == 504 and r.json()["error"]["code"] == "UPSTREAM_TIMEOUT"
        assert "cache-control" not in r.headers                                             # never cached by the CDN


def test_parallel_runs_at_once_keeps_order_and_carries_the_budget():
    barrier = threading.Barrier(3, timeout=5)                   # only passes if all three run at the same time

    def job(i):
        barrier.wait()
        return i, time_left()
    with upstream_budget(30):
        out = parallel(*[(lambda i=i: job(i)) for i in range(3)])
    assert [i for i, _ in out] == [0, 1, 2] and all(left is not None and 0 < left <= 30 for _, left in out)
    with pytest.raises(ValueError):
        parallel(lambda: 1, lambda: (_ for _ in ()).throw(ValueError("x")))


def _pages(n_pages, start_day="2026-11-01", step=None):
    """Fake GFW events API: n_pages pages of 1,000, newest first; the last page reaches back before the period."""
    def get(url, **kw):
        off = int(url.split("offset=")[1].split("&")[0])
        k = off // 1000
        day = start_day if k < n_pages - 1 else "2026-09-01"
        nxt = (off + (step or 1000)) if k < n_pages - 1 else None
        return json.dumps({"entries": [{"id": f"{k}-{i}", "start": f"{day}T00:00:00Z"} for i in range(3)], "nextOffset": nxt}).encode()
    return get


def test_events_are_paged_in_waves_and_stop_at_the_period(monkeypatch, tmp_path):
    seen = []
    get = _pages(4)
    monkeypatch.setattr(sea, "_get", lambda url, **kw: (seen.append(url.split("offset=")[1].split("&")[0]), get(url))[1])
    slim = lambda e: {"id": e["id"], "start": e["start"], "lat": 0, "lon": 0}               # noqa: E731
    d = sea.SeaWatch(cache_dir=tmp_path, shared=False)._fetch_events({}, "2026-10-01", "2026-11-14", slim, first_wave=2, wave=3)
    # waves of 2 then 3: the fifth page (offset 4000) is fetched alongside but dropped, since page 4 already ended the period
    assert sorted(seen, key=int) == ["0", "1000", "2000", "3000", "4000"]
    assert [e["id"][0] for e in d["events"]] == ["0"] * 3 + ["1"] * 3 + ["2"] * 3 and d["truncated"] is False
    d = sea.SeaWatch(cache_dir=tmp_path, shared=False)._fetch_events({}, "2026-10-01", "2026-11-14", slim, max_pages=2)
    assert d["truncated"] is True and len(d["events"]) == 6


class FakeShared:
    def __init__(self, stored=None):
        self.stored, self.puts = stored, []

    def get(self, key):
        return self.stored

    def put(self, key, value, ttl_s):
        self.puts.append((key, value, ttl_s))


def test_shared_cache_is_read_before_upstream_and_stands_in_when_upstream_fails(tmp_path):
    fresh = FakeShared((time.time(), {"from": "shared"}))
    w = sea.SeaWatch(cache_dir=tmp_path / "a", shared=fresh)
    assert w._cached("k", lambda: pytest.fail("upstream must not be called")) == {"from": "shared"}
    assert json.loads((tmp_path / "a" / "k.json").read_text()) == {"from": "shared"}           # copied to this instance's disk

    stale = FakeShared((time.time() - 30 * 86400, {"from": "old"}))
    w = sea.SeaWatch(cache_dir=tmp_path / "b", shared=stale)
    assert w._cached("k", lambda: {"from": "upstream"}) == {"from": "upstream"} and stale.puts[0][:2] == ("sea/k", {"from": "upstream"})

    def down():
        raise sea.SeaSourceError("down")
    w = sea.SeaWatch(cache_dir=tmp_path / "c", shared=stale)
    assert w._cached("k", down) == {"from": "old"}                                             # last good copy, not an error


def test_compact_lists_send_each_statement_once_and_expand_back_exactly():
    with TestClient(app) as c:
        app.state.sea = FakeSea()
        for path, key in (("ais-off", "events"), ("slicks", "slicks")):
            full, compact = c.get(f"/api/sea/{path}").json(), c.get(f"/api/sea/{path}?compact=true").json()
            assert "statementTable" not in full and all("statementIds" not in r for r in full[key])
            table = compact.pop("statementTable")
            assert len({(s["label"], s["text"]) for s in table}) == len(table)                     # no statement sent twice
            for r in compact[key]:
                assert r["statements"] == []
                r["statements"] = [table[i] for i in r.pop("statementIds")]
            assert compact == full
