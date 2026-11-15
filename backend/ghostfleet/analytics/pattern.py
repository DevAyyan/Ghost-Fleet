"""Pattern check: does an area's recent month break its own seasonal pattern?

For each area's coverage-normalised series (vessels seen on radar but not on AIS, per Sentinel-1 pass), the last
HOLDOUT months are hidden; a simple, explainable forecast is fitted to the rest:

    expected(t) = level + slope * t + season[month of t]

with the slope from Sen's estimator (robust to outliers), the season as the median detrended value of each calendar
month, and a prediction band from the empirical 5th-95th percentiles of the fitted residuals. The hidden months are then
compared with the band. A "break" is two or more of the last three months on the same side outside the band.

Honesty about chance: with a 90% band, one area breaks upward by chance with probability ~0.7% (2+ of 3 months above
the 95th percentile), so across thousands of areas some breaks are expected even with nothing going on. The response
reports that expected count next to the observed one.
"""
from __future__ import annotations

import numpy as np

from .trend import sens_slope

HOLDOUT = 12
RECENT = 3
MIN_HISTORY = 36
BAND = (0.05, 0.95)
P_ONE_SIDE = 3 * BAND[0] ** 2 * (1 - BAND[0]) + BAND[0] ** 3     # P(2+ of 3 months beyond one 5% tail), independent months


def pattern_check(y: np.ndarray, month_of_year: np.ndarray, holdout: int = HOLDOUT) -> dict | None:
    """Forecast band for the last `holdout` months from the earlier ones; None if the history is too thin."""
    y = np.asarray(y, dtype=float)
    n = y.size
    if n <= holdout:
        return None
    t = np.arange(n, dtype=float)
    hist = slice(0, n - holdout)
    hy, ht = y[hist], t[hist]
    ok = np.isfinite(hy)
    if ok.sum() < MIN_HISTORY:
        return None
    slope = sens_slope(hy[ok], ht[ok])[0]
    if not np.isfinite(slope):
        slope = 0.0
    detr = y - slope * t
    season = np.zeros(12)
    for m in range(1, 13):
        sel = (month_of_year[hist] == m) & ok
        if sel.sum() >= 2:
            season[m - 1] = np.median(detr[hist][sel])
    base = season[month_of_year - 1]
    level = float(np.nanmedian((detr - base)[hist][ok]))
    expected = level + slope * t + base
    resid = (hy - expected[hist])[ok]
    lo_q, hi_q = np.quantile(resid, BAND)
    lo, hi = np.maximum(expected + lo_q, 0.0), expected + hi_q
    spread = max(float(hi_q - lo_q), 1e-9)

    test = slice(n - holdout, n)
    flags = []
    for v, a, b in zip(y[test], lo[test], hi[test]):
        flags.append(None if not np.isfinite(v) else (1 if v > b else -1 if v < a else 0))
    recent = [f for f in flags[-RECENT:] if f is not None]
    direction = "UP" if sum(f == 1 for f in recent) >= 2 else "DOWN" if sum(f == -1 for f in recent) >= 2 else None
    rv, re = y[test][-RECENT:], expected[test][-RECENT:]
    good = np.isfinite(rv)
    excess = float(np.mean((rv[good] - re[good]) / (spread / 2))) if good.any() else 0.0
    return {"expected": expected, "lo": lo, "hi": hi, "flags": flags, "direction": direction, "excess": excess,
            "outside": sum(1 for f in flags if f), "holdout": holdout, "slopePerMonth": float(slope)}
