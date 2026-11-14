"""Scan for emerging changes: no preselected vessel or area.

For every cell: correction waterfall -> trend test on the fully corrected series -> BH-FDR across
cells. Significant cells with the same direction that touch are merged into one event.
Opposite-trend radar: neighbouring significant cells whose trends point in opposite directions.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ..panel import Panel
from .msdi import STEPS, correction_series, waterfall
from .trend import bh_fdr


@dataclass
class CellResult:
    cell_id: str
    steps: list            # list[WaterfallStep]
    q: float = float("nan")
    q_by_step: dict = field(default_factory=dict)

    @property
    def final(self):
        return self.steps[-1].trend

    @property
    def significant(self) -> bool:
        return bool(np.isfinite(self.q) and self.q < self._alpha)

    _alpha: float = 0.05


@dataclass
class ScanResult:
    cells: dict[str, CellResult]
    events: list[dict]
    opposite_pairs: list[dict]
    alerts_by_step: dict[str, int]     # how many cells each step would flag (FDR-adjusted)
    alpha: float
    is_synthetic: bool


def scan(panel: Panel, alpha: float = 0.05, min_opportunities: float = 3, hamed_rao: bool = True) -> ScanResult:
    moy = panel.month_of_year
    cells: dict[str, CellResult] = {}
    for i, cid in enumerate(panel.cell_ids):
        series = correction_series(panel.unmatched[i], panel.opportunities[i], panel.ais_reception[i],
                                   panel.wind[i], panel.chl[i], moy, min_opportunities)
        cells[cid] = CellResult(cid, waterfall(series, hamed_rao=hamed_rao), _alpha=alpha)

    ids = list(cells)
    alerts_by_step = {}
    for k, step in enumerate(STEPS):
        q = bh_fdr([cells[c].steps[k].trend.p for c in ids])
        for c, qv in zip(ids, q):
            cells[c].q_by_step[step] = float(qv)
        alerts_by_step[step] = int(np.sum(q < alpha))
    for c in ids:
        cells[c].q = cells[c].q_by_step[STEPS[-1]]

    events = _cluster_events(cells, panel.neighbors)
    pairs = _opposite_pairs(cells, panel.neighbors)
    return ScanResult(cells, events, pairs, alerts_by_step, alpha, panel.is_synthetic)


def _cluster_events(cells: dict[str, CellResult], neighbors: dict[str, list[str]]) -> list[dict]:
    sig = {c for c, r in cells.items() if r.significant}
    seen, events = set(), []
    for start in sorted(sig):
        if start in seen:
            continue
        direction = cells[start].final.direction
        comp, stack = [], [start]
        seen.add(start)
        while stack:
            c = stack.pop()
            comp.append(c)
            for nb in neighbors.get(c, []):
                if nb in sig and nb not in seen and cells[nb].final.direction == direction:
                    seen.add(nb)
                    stack.append(nb)
        lead = max(comp, key=lambda c: abs(cells[c].final.z))
        events.append({
            "cells": sorted(comp),
            "lead_cell": lead,
            "direction": direction,
            "max_abs_z": float(abs(cells[lead].final.z)),
            "pct_per_year": cells[lead].steps[-1].pct_per_year,
            "q": cells[lead].q,
        })
    events.sort(key=lambda e: e["max_abs_z"], reverse=True)
    for rank, e in enumerate(events, 1):
        e["id"] = f"EVT-{rank:03d}"
        e["rank"] = rank
    return events


def _opposite_pairs(cells: dict[str, CellResult], neighbors: dict[str, list[str]]) -> list[dict]:
    pairs = []
    for a, nbs in neighbors.items():
        for b in nbs:
            if a < b and a in cells and b in cells:
                ra, rb = cells[a], cells[b]
                if ra.significant and rb.significant and ra.final.direction != rb.final.direction:
                    up, down = (a, b) if ra.final.direction == "increasing" else (b, a)
                    pairs.append({"increasing": up, "decreasing": down,
                                  "q": [cells[up].q, cells[down].q]})
    return pairs
