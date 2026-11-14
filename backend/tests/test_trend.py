import math

import numpy as np
import pytest

from ghostfleet.analytics.trend import (bh_fdr, mann_kendall, monthly_anomaly, rankdata,
                                        seasonal_mann_kendall, sens_slope)


def test_known_values_small_series():
    # x = 1..5: S = 10, Var = 5*4*15/18, Z = (10-1)/sqrt(Var), p = 0.0275 (textbook)
    r = mann_kendall([1, 2, 3, 4, 5], hamed_rao=False, min_n=3)
    assert r.s == 10
    assert r.var_s == pytest.approx(5 * 4 * 15 / 18)
    assert r.z == pytest.approx(9 / math.sqrt(50 / 3))
    assert r.p == pytest.approx(0.0275, abs=1e-3)
    assert r.slope == 1.0


def test_tie_correction_and_constant_series():
    r = mann_kendall([3.0] * 20, min_n=3)
    assert r.s == 0 and r.p == 1.0 and r.slope == 0.0 and r.direction == "none"
    tied = mann_kendall([1, 1, 2, 2, 3, 3], hamed_rao=False, min_n=3)
    assert tied.var_s == pytest.approx((6 * 5 * 17 - 3 * (2 * 1 * 9)) / 18)


def test_rankdata_matches_average_ranks():
    np.testing.assert_allclose(rankdata([10, 20, 20, 5]), [2, 3.5, 3.5, 1])


def test_detects_planted_trends_and_recovers_slope():
    rng = np.random.default_rng(0)
    t = np.arange(84)
    up = mann_kendall(0.05 * t + rng.normal(0, 1, 84))
    down = mann_kendall(-0.05 * t + rng.normal(0, 1, 84))
    assert up.p < 0.01 and up.direction == "increasing"
    assert down.p < 0.01 and down.direction == "decreasing"
    assert up.slope_lo <= 0.05 <= up.slope_hi
    assert up.slope == pytest.approx(0.05, abs=0.015)


def test_nan_gaps_are_dropped_not_zeroed():
    x = np.arange(40, dtype=float)
    x[[3, 10, 11, 30]] = np.nan
    r = mann_kendall(x)
    assert r.n == 36 and r.slope == pytest.approx(1.0)


def test_too_short_returns_nan():
    assert math.isnan(mann_kendall([1, 2, 3]).p)


def _false_positive_rate(gen, hamed_rao, trials=300):
    rng = np.random.default_rng(42)
    return np.mean([mann_kendall(gen(rng), hamed_rao=hamed_rao).p < 0.05 for _ in range(trials)])


def test_false_positive_rate_white_noise_near_nominal():
    fpr = _false_positive_rate(lambda r: r.normal(size=84), hamed_rao=True)
    assert 0.01 <= fpr <= 0.10


def test_hamed_rao_controls_autocorrelated_false_positives():
    def ar1(rng, phi=0.7, n=84):
        e = rng.normal(size=n)
        x = np.empty(n)
        x[0] = e[0]
        for i in range(1, n):
            x[i] = phi * x[i - 1] + e[i]
        return x
    plain = _false_positive_rate(ar1, hamed_rao=False)
    corrected = _false_positive_rate(ar1, hamed_rao=True)
    assert plain > 0.15                     # naive MK over-alarms on persistent series
    assert corrected < plain * 0.6          # the correction materially reduces false alarms


def test_seasonal_mk_ignores_pure_seasonality_but_finds_trend():
    t = np.arange(84)
    moy = t % 12 + 1
    rng = np.random.default_rng(3)
    season = 5 * np.sin(2 * np.pi * t / 12)
    assert seasonal_mann_kendall(season + rng.normal(0, 0.3, 84), moy).p > 0.05
    assert seasonal_mann_kendall(season + 0.03 * t + rng.normal(0, 0.3, 84), moy).p < 0.01


def test_monthly_anomaly_removes_climatology():
    t = np.arange(48)
    moy = t % 12 + 1
    a = monthly_anomaly(10 + 3 * np.cos(2 * np.pi * t / 12), moy)
    np.testing.assert_allclose(a, 0, atol=1e-12)


def test_bh_fdr_known_example_and_nan_passthrough():
    np.testing.assert_allclose(bh_fdr([0.01, 0.04, 0.03, 0.005]), [0.02, 0.04, 0.04, 0.02])
    q = bh_fdr([0.01, np.nan, 0.02])
    assert math.isnan(q[1]) and q[0] == pytest.approx(0.02) and q[2] == pytest.approx(0.02)


def test_sens_slope_respects_uneven_time():
    s, lo, hi = sens_slope([0, 2, 4, 6], t=[0, 1, 2, 3])
    assert s == 2.0
    s2, _, _ = sens_slope([0, 2, 4, 6], t=[0, 2, 4, 6])
    assert s2 == 1.0
