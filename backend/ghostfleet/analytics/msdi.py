"""Maritime Signal Drift Index and the correction waterfall.

MSDI (SAR version) = unmatched SAR detections / Sentinel-1 acquisitions over the cell that month.
Cell-months with fewer than `min_opportunities` acquisitions are masked (NaN), never zero-filled.

Waterfall: the same trend test is applied after each successive correction, so a viewer sees how
much of the apparent change each explanation absorbs:
    raw -> coverage -> AIS reception -> season -> environment
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .trend import TrendResult, mann_kendall, monthly_anomaly

STEPS = ("raw", "coverage", "ais_reception", "season", "environment")
STEP_LABELS = {
    "raw": "Raw unmatched detections",
    "coverage": "÷ Sentinel-1 passes (MSDI)",
    "ais_reception": "− AIS reception change",
    "season": "− seasonal cycle",
    "environment": "− wind & chlorophyll",
}


def msdi(unmatched, opportunities, min_opportunities: float = 3) -> np.ndarray:
    u = np.asarray(unmatched, dtype=float)
    o = np.asarray(opportunities, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        out = u / o
    out[~(o >= min_opportunities) | ~np.isfinite(u)] = np.nan
    return out


def residualize(y, *covariates) -> np.ndarray:
    """OLS-remove covariates from y (intercept kept, so the level is preserved).
    Rows with any NaN stay NaN. Covariates with no variance are skipped."""
    y = np.asarray(y, dtype=float)
    cols = [np.asarray(c, dtype=float) for c in covariates]
    ok = np.isfinite(y)
    for c in cols:
        ok &= np.isfinite(c)
    out = np.full_like(y, np.nan)
    if ok.sum() < len(cols) + 3:
        return out
    X = [c[ok] - c[ok].mean() for c in cols if np.nanstd(c[ok]) > 0]
    if not X:
        out[ok] = y[ok]
        return out
    A = np.column_stack([np.ones(ok.sum()), *X])
    beta, *_ = np.linalg.lstsq(A, y[ok], rcond=None)
    out[ok] = y[ok] - A[:, 1:] @ beta[1:]
    return out


@dataclass(frozen=True)
class WaterfallStep:
    step: str
    label: str
    trend: TrendResult
    pct_per_year: float     # Sen's slope x 12 as % of the step's reference level

    def as_dict(self) -> dict:
        t = self.trend
        return {
            "step": self.step, "label": self.label, "pct_per_year": self.pct_per_year,
            "slope_per_month": t.slope, "slope_ci": [t.slope_lo, t.slope_hi],
            "p": t.p, "z": t.z, "n": t.n, "direction": t.direction,
        }


def _fill_zero(x) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    return np.where(np.isfinite(x), x, 0.0)


def _fill_mean(x) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    if not np.isfinite(x).any():
        return x
    return np.where(np.isfinite(x), x, np.nanmean(x))


def correction_series(unmatched, opportunities, ais_reception, wind, chl, month_of_year,
                      min_opportunities: float = 3) -> dict[str, np.ndarray]:
    """The series after each correction step, for one cell."""
    raw = np.asarray(unmatched, dtype=float)
    cov = msdi(unmatched, opportunities, min_opportunities)
    ais = residualize(cov, _fill_mean(ais_reception))
    sea = monthly_anomaly(ais, month_of_year)
    # A missing covariate month is treated as "normal for the season" (anomaly 0) rather than
    # dropping the month: e.g. NASA POWER monthly ends before the current year.
    env = residualize(sea, _fill_zero(monthly_anomaly(wind, month_of_year)),
                      _fill_zero(monthly_anomaly(chl, month_of_year)))
    return {"raw": raw, "coverage": cov, "ais_reception": ais, "season": sea, "environment": env}


def waterfall(series: dict[str, np.ndarray], hamed_rao: bool = True) -> list[WaterfallStep]:
    """Trend test after each step. % per year is relative to the raw mean (raw step) or the MSDI
    mean (all later steps, which share MSDI units), so the bars are directly comparable."""
    ref = {"raw": np.nanmean(series["raw"])}
    msdi_mean = np.nanmean(series["coverage"])
    out = []
    for step in STEPS:
        tr = mann_kendall(series[step], hamed_rao=hamed_rao)
        base = ref.get(step, msdi_mean)
        pct = float(tr.slope * 12 / abs(base) * 100) if base and np.isfinite(base) else float("nan")
        out.append(WaterfallStep(step, STEP_LABELS[step], tr, pct))
    return out
