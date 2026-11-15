"""The saved scan must reproduce the live scan exactly, and must never be used for a different panel."""
from ghostfleet.analytics.scan import scan
from ghostfleet.analytics.scan_io import load_scan, save_scan
from ghostfleet.api.service import GhostFleetService
from ghostfleet.synthetic import make_panel


def test_saved_scan_round_trips_and_is_keyed_to_the_panel(tmp_path):
    panel = make_panel(seed=7)
    result = scan(panel)
    out = tmp_path / "scan.json.gz"
    save_scan(result, out, digest="abc")

    assert load_scan(out, "other-panel", 0.05) is None          # different panel: ignored
    assert load_scan(out, "abc", 0.01) is None                  # different alpha: ignored
    cached = load_scan(out, "abc", 0.05)
    assert cached is not None

    live, warm = GhostFleetService(panel, result=result), GhostFleetService(panel, result=cached)
    assert warm.meta() == live.meta()
    assert warm.list_events(1, 100, None) == live.list_events(1, 100, None)
    for eid in list(live.events)[:5]:
        assert warm.event(eid) == live.event(eid)
    for cid in panel.cell_ids[:20]:
        assert warm.cell(cid) == live.cell(cid)


def test_missing_or_corrupt_cache_falls_back_to_scanning(tmp_path):
    assert load_scan(tmp_path / "none.json.gz", "abc", 0.05) is None
    bad = tmp_path / "bad.json.gz"
    bad.write_bytes(b"not gzip")
    assert load_scan(bad, "abc", 0.05) is None
