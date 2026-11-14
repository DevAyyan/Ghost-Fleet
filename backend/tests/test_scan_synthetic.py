"""End-to-end: the scan must keep real planted effects and remove planted artifacts."""
import numpy as np
import pytest

from ghostfleet.analytics.msdi import msdi, residualize
from ghostfleet.analytics.scan import scan
from ghostfleet.synthetic import PLANTED, S1B_LOST, S1C_ONLINE, make_panel


@pytest.fixture(scope="module")
def result():
    return scan(make_panel(seed=7))


def test_msdi_masks_low_opportunity_months():
    out = msdi([4, 4, 4], [8, 2, 0], min_opportunities=3)
    assert out[0] == 0.5 and np.isnan(out[1]) and np.isnan(out[2])


def test_residualize_removes_covariate_keeps_level():
    rng = np.random.default_rng(0)
    c = rng.normal(size=200)
    y = 5 + 2 * c + rng.normal(0, 0.1, 200)
    r = residualize(y, c)
    assert abs(np.corrcoef(r, c)[0, 1]) < 0.05
    assert r.mean() == pytest.approx(5, abs=0.05)


def test_real_increase_and_decrease_survive_as_opposite_pair(result):
    up, down = result.cells[PLANTED["EVT_UP"]], result.cells[PLANTED["EVT_DOWN"]]
    assert up.significant and up.final.direction == "increasing"
    assert down.significant and down.final.direction == "decreasing"
    assert {"increasing": PLANTED["EVT_UP"], "decreasing": PLANTED["EVT_DOWN"]}.items() <= \
        next(iter(result.opposite_pairs)).items()
    leads = {e["lead_cell"] for e in result.events}
    assert {PLANTED["EVT_UP"], PLANTED["EVT_DOWN"]} <= leads


def test_ais_reception_artifact_removed_at_ais_step(result):
    steps = {s.step: s for s in result.cells[PLANTED["AIS_GAIN"]].steps}
    assert steps["coverage"].pct_per_year < -5                       # looks like a decline...
    assert abs(steps["ais_reception"].pct_per_year) < 0.3 * abs(steps["coverage"].pct_per_year)
    assert not result.cells[PLANTED["AIS_GAIN"]].significant          # ...that is not flagged


def test_environment_driven_change_removed_at_environment_step(result):
    cell = result.cells[PLANTED["CHL_FOLLOW"]]
    assert cell.q_by_step["season"] < 0.05                            # real-looking until environment
    assert not cell.significant


def test_coverage_normalisation_removes_sentinel1b_level_shift():
    p = make_panel(seed=7)
    gap = (p.months >= S1B_LOST) & (p.months < S1C_ONLINE)
    null = [i for i, c in enumerate(p.cell_ids) if c not in PLANTED.values()]
    raw, m = p.unmatched[null], msdi(p.unmatched[null], p.opportunities[null])
    raw_ratio = np.nanmean(raw[:, gap]) / np.nanmean(raw[:, ~gap])
    msdi_ratio = np.nanmean(m[:, gap]) / np.nanmean(m[:, ~gap])
    assert raw_ratio < 0.65
    assert 0.85 < msdi_ratio < 1.15


@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5])
def test_few_false_alarms_on_null_cells(seed):
    r = scan(make_panel(seed=seed))
    false_alarms = [c for c, cr in r.cells.items() if cr.significant and c not in PLANTED.values()]
    assert len(false_alarms) <= 2
