"""Try to disprove: rerun one cell's trend test under alternative, defensible analysis choices.

An alert "survives" a variant if the variant's own test is significant (raw p < its alpha) in the
same direction as the baseline. Multiplicity was already handled (FDR) when the event was flagged;
here we test robustness of a single flagged event.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..panel import Panel
from .msdi import correction_series
from .trend import TrendResult, mann_kendall, seasonal_mann_kendall

VARIANTS: dict[str, str] = {
    "SEASONAL_MK": "Use Seasonal Mann-Kendall instead of monthly anomalies + Mann-Kendall",
    "TRIM_START": "Drop the first 12 months (different baseline)",
    "TRIM_END": "Drop the last 12 months (is the trend driven by recent months only?)",
    "STRICT_COVERAGE": "Require ≥6 Sentinel-1 passes per month instead of ≥3",
    "COARSER_CELLS": "Merge the cell with its neighbours (coarser spatial resolution)",
    "NEIGHBOR_CONTROL": "Subtract the neighbours' average (is the change local, not regional?)",
    "STRICT_ALPHA": "Require p < 0.01 instead of p < 0.05",
}


@dataclass(frozen=True)
class VariantResult:
    variant: str
    description: str
    trend: TrendResult
    alpha: float
    survived: bool


def _series(panel: Panel, i, min_opp=3.0, rows=None):
    """Correction series for cell index i (or the sum over `rows` for coarser cells)."""
    moy = panel.month_of_year
    if rows is None:
        rows = [i]
    u = np.nansum(panel.unmatched[rows], axis=0) if len(rows) > 1 else panel.unmatched[i]
    o = np.nansum(panel.opportunities[rows], axis=0) if len(rows) > 1 else panel.opportunities[i]
    if len(rows) > 1:   # a month is missing if every member is missing
        u = np.where(np.all(np.isnan(panel.unmatched[rows]), axis=0), np.nan, u)
    ais = np.nanmean(panel.ais_reception[rows], axis=0)
    wind = np.nanmean(panel.wind[rows], axis=0)
    chl = np.nanmean(panel.chl[rows], axis=0)
    return correction_series(u, o, ais, wind, chl, moy, min_opp)


def disprove(panel: Panel, cell_id: str, alpha: float = 0.05, variants: list[str] | None = None) -> dict:
    i = panel.index(cell_id)
    nb_rows = [panel.index(n) for n in panel.neighbors.get(cell_id, [])]
    base_series = _series(panel, i)
    baseline = mann_kendall(base_series["environment"])
    T = panel.months.size
    results: list[VariantResult] = []

    for name in variants or list(VARIANTS):
        a = alpha
        if name == "SEASONAL_MK":
            tr = seasonal_mann_kendall(base_series["ais_reception"], panel.month_of_year)
        elif name == "TRIM_START":
            tr = mann_kendall(base_series["environment"][12:], t=np.arange(12, T))
        elif name == "TRIM_END":
            tr = mann_kendall(base_series["environment"][: T - 12])
        elif name == "STRICT_COVERAGE":
            tr = mann_kendall(_series(panel, i, min_opp=6)["environment"])
        elif name == "COARSER_CELLS":
            tr = mann_kendall(_series(panel, i, rows=[i, *nb_rows])["environment"])
        elif name == "NEIGHBOR_CONTROL":
            if not nb_rows:
                continue
            nb = np.nanmean(np.vstack([_series(panel, j)["environment"] for j in nb_rows]), axis=0)
            tr = mann_kendall(base_series["environment"] - nb)
        elif name == "STRICT_ALPHA":
            tr, a = baseline, 0.01
        else:
            raise ValueError(f"unknown variant {name}")
        survived = bool(np.isfinite(tr.p) and tr.p < a and tr.direction == baseline.direction)
        results.append(VariantResult(name, VARIANTS[name], tr, a, survived))

    n_ok = sum(r.survived for r in results)
    return {
        "baseline": baseline,
        "variants": results,
        "survived": n_ok,
        "total": len(results),
        "survival_rate": n_ok / len(results) if results else float("nan"),
    }
