"""Trend and significance statistics (numpy + stdlib only).

One analysis path, kept deliberately small so it can be defended in a pitch:
    monthly anomaly -> Mann-Kendall (Hamed-Rao autocorrelation correction) -> Sen's slope + CI -> BH-FDR
Seasonal Mann-Kendall is provided as an *alternative* used by Try-to-disprove, not stacked on top.

References: Mann (1945); Kendall (1975); Sen (1968); Hamed & Rao (1998) J. Hydrology 204;
Gilbert (1987) for the Sen's slope confidence interval; Benjamini & Hochberg (1995).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import NormalDist

import numpy as np

_N = NormalDist()


@dataclass(frozen=True)
class TrendResult:
    n: int                 # number of valid (non-NaN) observations used
    s: float               # Mann-Kendall S statistic
    var_s: float           # variance of S actually used (after any correction)
    z: float
    p: float               # two-sided p-value
    slope: float           # Sen's slope, units per time step
    slope_lo: float        # CI lower bound (NaN if not computable)
    slope_hi: float
    correction: float      # Hamed-Rao variance inflation factor n/n* (1.0 = none)
    method: str

    @property
    def direction(self) -> str:
        if not np.isfinite(self.slope) or self.slope == 0:
            return "none"
        return "increasing" if self.slope > 0 else "decreasing"


def _empty(n: int, method: str) -> TrendResult:
    nan = float("nan")
    return TrendResult(n, nan, nan, nan, nan, nan, nan, nan, nan, method)


def rankdata(a: np.ndarray) -> np.ndarray:
    """Average ranks (1-based), ties share the mean rank. Same algorithm as scipy.stats.rankdata."""
    a = np.asarray(a, dtype=float)
    sorter = np.argsort(a, kind="mergesort")
    inv = np.empty(sorter.size, dtype=np.intp)
    inv[sorter] = np.arange(sorter.size)
    a_sorted = a[sorter]
    obs = np.r_[True, a_sorted[1:] != a_sorted[:-1]]
    dense = obs.cumsum()[inv]
    count = np.r_[np.nonzero(obs)[0], obs.size]
    return 0.5 * (count[dense] + count[dense - 1] + 1)


def _clean(x, t=None):
    x = np.asarray(x, dtype=float)
    t = np.arange(x.size, dtype=float) if t is None else np.asarray(t, dtype=float)
    ok = np.isfinite(x) & np.isfinite(t)
    return x[ok], t[ok]


def _mk_s_var(x: np.ndarray) -> tuple[float, float]:
    n = x.size
    diff = x[None, :] - x[:, None]                     # diff[i, j] = x_j - x_i
    s = float(np.sign(diff[np.triu_indices(n, k=1)]).sum())
    _, ties = np.unique(x, return_counts=True)
    var_s = (n * (n - 1) * (2 * n + 5) - np.sum(ties * (ties - 1) * (2 * ties + 5))) / 18.0
    return s, float(var_s)


def _z_p(s: float, var_s: float) -> tuple[float, float]:
    if var_s <= 0:
        return 0.0, 1.0
    z = (s - np.sign(s)) / math.sqrt(var_s)            # continuity correction
    return float(z), float(math.erfc(abs(z) / math.sqrt(2)))


def sens_slope(x, t=None, var_s: float | None = None, alpha: float = 0.05):
    """Sen's slope with Gilbert (1987) rank-based CI. Returns (slope, lo, hi)."""
    x, t = _clean(x, t)
    n = x.size
    if n < 2:
        return float("nan"), float("nan"), float("nan")
    i, j = np.triu_indices(n, k=1)
    dt = t[j] - t[i]
    slopes = np.sort((x[j] - x[i])[dt != 0] / dt[dt != 0])
    slope = float(np.median(slopes))
    if var_s is None:
        _, var_s = _mk_s_var(x)
    c = _N.inv_cdf(1 - alpha / 2) * math.sqrt(max(var_s, 0.0))
    m = slopes.size
    lo_i, hi_i = int(round((m - c) / 2)) - 1, int(round((m + c) / 2))
    lo = float(slopes[lo_i]) if 0 <= lo_i < m else float("nan")
    hi = float(slopes[hi_i]) if 0 <= hi_i < m else float("nan")
    return slope, lo, hi


def _acf(x: np.ndarray, nlags: int) -> np.ndarray:
    x = x - x.mean()
    denom = float(np.dot(x, x))
    if denom == 0:
        return np.zeros(nlags + 1)
    return np.array([np.dot(x[: x.size - k], x[k:]) / denom for k in range(nlags + 1)])


def mann_kendall(x, t=None, alpha: float = 0.05, hamed_rao: bool = True, min_n: int = 10) -> TrendResult:
    """Mann-Kendall trend test; NaNs are dropped (t keeps real spacing for Sen's slope).

    hamed_rao=True inflates Var(S) by the effective-sample-size factor from significant
    autocorrelation of the ranks of the Sen-detrended series (Hamed & Rao 1998), which keeps the
    false-positive rate honest for persistent monthly series.
    """
    method = "mk-hamed-rao" if hamed_rao else "mk"
    x, t = _clean(x, t)
    n = x.size
    if n < min_n:
        return _empty(n, method)
    s, var_s = _mk_s_var(x)
    factor = 1.0
    if hamed_rao and n > 3:
        slope0, _, _ = sens_slope(x, t, var_s=var_s, alpha=alpha)
        ranks = rankdata(x - slope0 * t)
        r = _acf(ranks, n - 1)
        bound = _N.inv_cdf(1 - alpha / 2) / math.sqrt(n)
        k = np.arange(1, n)
        sig = np.abs(r[1:]) > bound
        acc = np.sum(((n - k) * (n - k - 1) * (n - k - 2) * r[1:])[sig])
        f = 1 + 2.0 / (n * (n - 1) * (n - 2)) * acc
        # Only ever inflate the variance. On white noise, spurious "significant" high-lag ACF
        # values can push f far below 1 and make the test anti-conservative (~7.6% FPR at
        # alpha=0.05 in our simulation); clamping keeps the false-alarm rate at or below nominal.
        factor = max(1.0, float(f))
    var_used = var_s * factor
    z, p = _z_p(s, var_used)
    slope, lo, hi = sens_slope(x, t, var_s=var_used, alpha=alpha)
    return TrendResult(n, s, var_used, z, p, slope, lo, hi, factor, method)


def seasonal_mann_kendall(x, month_of_year, t=None, alpha: float = 0.05, min_n: int = 10) -> TrendResult:
    """Seasonal MK (Hirsch et al. 1982): S and Var(S) summed over calendar-month subseries.
    Slope = median of within-season pairwise slopes."""
    x = np.asarray(x, dtype=float)
    moy = np.asarray(month_of_year)
    t = np.arange(x.size, dtype=float) if t is None else np.asarray(t, dtype=float)
    ok = np.isfinite(x)
    if ok.sum() < min_n:
        return _empty(int(ok.sum()), "seasonal-mk")
    s_tot = var_tot = 0.0
    all_slopes = []
    for m in np.unique(moy):
        xs, ts = _clean(x[moy == m], t[moy == m])
        if xs.size < 2:
            continue
        s, v = _mk_s_var(xs)
        s_tot += s
        var_tot += v
        i, j = np.triu_indices(xs.size, k=1)
        all_slopes.append((xs[j] - xs[i]) / (ts[j] - ts[i]))
    z, p = _z_p(s_tot, var_tot)
    slopes = np.sort(np.concatenate(all_slopes)) if all_slopes else np.array([])
    if slopes.size == 0:
        return _empty(int(ok.sum()), "seasonal-mk")
    c = _N.inv_cdf(1 - alpha / 2) * math.sqrt(var_tot)
    m = slopes.size
    lo_i, hi_i = int(round((m - c) / 2)) - 1, int(round((m + c) / 2))
    lo = float(slopes[lo_i]) if 0 <= lo_i < m else float("nan")
    hi = float(slopes[hi_i]) if 0 <= hi_i < m else float("nan")
    return TrendResult(int(ok.sum()), s_tot, var_tot, z, p, float(np.median(slopes)), lo, hi, 1.0, "seasonal-mk")


def monthly_anomaly(x, month_of_year, min_per_month: int = 2) -> np.ndarray:
    """Subtract each calendar month's climatological mean. Months with < min_per_month values -> NaN."""
    x = np.asarray(x, dtype=float)
    moy = np.asarray(month_of_year)
    out = np.full_like(x, np.nan)
    for m in np.unique(moy):
        sel = moy == m
        vals = x[sel]
        if np.isfinite(vals).sum() >= min_per_month:
            out[sel] = vals - np.nanmean(vals)
    return out


def bh_fdr(p) -> np.ndarray:
    """Benjamini-Hochberg q-values. NaN p-values stay NaN and are excluded from the count m."""
    p = np.asarray(p, dtype=float)
    q = np.full_like(p, np.nan)
    ok = np.isfinite(p)
    pv = p[ok]
    m = pv.size
    if m == 0:
        return q
    order = np.argsort(pv)
    ranked = pv[order] * m / np.arange(1, m + 1)
    ranked = np.minimum.accumulate(ranked[::-1])[::-1]
    qv = np.empty(m)
    qv[order] = np.minimum(ranked, 1.0)
    q[ok] = qv
    return q
