import pytest
import numpy as np

from apps.api.analytics.normalization import normalize_series_minmax
from apps.api.analytics.msdi import compute_msdi_series
from apps.api.analytics.quality import evaluate_observation_quality
from apps.api.analytics.trend import compute_trend, benjamini_hochberg_fdr
from apps.api.analytics.ranking import compute_investigation_priority

def test_normalization():
    # Regular values
    raw = [10.0, 20.0, 30.0, 40.0, 50.0]
    norm = normalize_series_minmax(raw, min_val=10.0, max_val=50.0)
    assert norm == [0.0, 0.25, 0.5, 0.75, 1.0]

    # With None
    raw_with_none = [10.0, None, 50.0]
    norm_none = normalize_series_minmax(raw_with_none, min_val=10.0, max_val=50.0)
    assert norm_none[1] is None
    assert norm_none[0] == 0.0
    assert norm_none[2] == 1.0

    # Constant series (zero variance)
    const_raw = [5.0, 5.0, 5.0]
    norm_const = normalize_series_minmax(const_raw)
    assert all(v == 0.5 for v in norm_const)

def test_msdi_computation():
    sat = [0.8, 0.5, None, 0.9]
    trk = [0.3, 0.5, 0.2, None]
    msdi = compute_msdi_series(sat, trk)
    
    assert msdi[0] == 0.5      # 0.8 - 0.3
    assert msdi[1] == 0.0      # 0.5 - 0.5
    assert msdi[2] is None     # sat is None
    assert msdi[3] is None     # trk is None

def test_quality_mask():
    good_pt = {
        "cloud_free_coverage": 0.85,
        "radiance_valid_obs_count": 24,
        "tracking_coverage_ratio": 0.95
    }
    is_valid, score, reason = evaluate_observation_quality(good_pt, "strict", 15)
    assert is_valid is True
    assert score > 0.7
    assert reason == "good_quality"

    # Cloud degraded point
    cloud_pt = {
        "cloud_free_coverage": 0.25,
        "radiance_valid_obs_count": 20,
        "tracking_coverage_ratio": 0.95
    }
    is_valid_c, score_c, reason_c = evaluate_observation_quality(cloud_pt, "strict", 15)
    assert is_valid_c is False
    assert reason_c == "cloud_cover_obscuration"

    # Insufficient observation days
    sparse_pt = {
        "cloud_free_coverage": 0.90,
        "radiance_valid_obs_count": 8,
        "tracking_coverage_ratio": 0.95
    }
    is_valid_s, score_s, reason_s = evaluate_observation_quality(sparse_pt, "strict", 15)
    assert is_valid_s is False
    assert reason_s == "insufficient_valid_days"

def test_trend_small_sample_insufficient_data():
    # Only 10 points - must flag as insufficient data
    short_series = [0.1 * i for i in range(10)]
    dates = [f"2023-{i+1:02d}" for i in range(10)]
    res = compute_trend(short_series, dates, min_obs_threshold=24)
    assert res["significance_class"] == "insufficient_data"
    assert res["is_significant"] is False

def test_trend_robust_slope():
    # 36 months of steadily rising signal
    rising = [0.02 * i for i in range(36)]
    dates = [f"2021-{i%12+1:02d}" for i in range(36)]
    res = compute_trend(rising, dates, seasonal_adjustment=False, min_obs_threshold=24)
    assert res["slope"] > 0
    assert res["is_significant"] is True
    assert res["significance_class"] == "significant"

def test_benjamini_hochberg_fdr():
    p_vals = [0.001, 0.008, 0.04, 0.12, 0.45]
    adj_p, sig_flags = benjamini_hochberg_fdr(p_vals, alpha=0.05)
    
    # Monotonicity check
    assert adj_p[0] <= adj_p[1] <= adj_p[2]
    # Smallest p-value remains significant
    assert sig_flags[0] is True
    # Highest p-value remains non-significant
    assert sig_flags[-1] is False

def test_investigation_priority_bounds():
    p1 = compute_investigation_priority(
        abs_slope=0.015,
        max_regional_slope=0.015,
        p_adj=0.002,
        valid_count=48,
        total_months=48,
        quality_score=0.95
    )
    assert 0.8 <= p1 <= 1.0

    p_low = compute_investigation_priority(
        abs_slope=0.0001,
        max_regional_slope=0.015,
        p_adj=0.85,
        valid_count=10,
        total_months=48,
        quality_score=0.25
    )
    assert 0.0 <= p_low <= 0.4
