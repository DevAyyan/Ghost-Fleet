"""Synthetic cell-month panel with planted, known effects.

Used for (a) unit/end-to-end tests with known answers and (b) the clearly badged DEMO DATA fallback.
Every effect below is something the correction waterfall must either keep or remove:

  EVT_UP    real behavioural increase in unmatched activity (+100% over the period)   -> must survive
  EVT_DOWN  neighbour of EVT_UP with a real decrease (-50%)                          -> opposite-trend pair
  AIS_GAIN  no behaviour change; AIS reception improves (new receivers)             -> removed at AIS step
  CHL_FOLLOW activity rises because chlorophyll rises (fish follow productivity)    -> removed at environment step
  all cells Sentinel-1B loss Dec-2021 halves passes until S1C (2025-04)             -> removed at coverage step
  all cells Pakistan fishing ban Jun-Jul + SW monsoon winds Jun-Aug                 -> removed at season step
"""
from __future__ import annotations

import numpy as np

from .panel import Panel

AXIAL_DIRS = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]
START, END = np.datetime64("2020-01", "M"), np.datetime64("2026-09", "M")
S1B_LOST, S1C_ONLINE = np.datetime64("2022-01", "M"), np.datetime64("2025-04", "M")


def _cid(q: int, r: int) -> str:
    return f"syn_{q}_{r}"


PLANTED = {
    "EVT_UP": _cid(2, 2),
    "EVT_DOWN": _cid(3, 2),     # axial neighbour of EVT_UP
    "AIS_GAIN": _cid(6, 1),
    "CHL_FOLLOW": _cid(1, 4),
}


# Synthetic lattice is placed offshore of the Makran coast so the map looks plausible.
# It is NOT an H3 grid; real panels use H3 boundaries (h3.cell_to_boundary).
ORIGIN_LON, ORIGIN_LAT, HEX_SIZE_DEG = 61.6, 22.2, 0.28


def hex_boundary(q: int, r: int, size: float = HEX_SIZE_DEG) -> list[list[float]]:
    """Pointy-top hexagon ring [lon, lat] (closed) for axial coords."""
    cx = ORIGIN_LON + size * np.sqrt(3) * (q + r / 2)
    cy = ORIGIN_LAT + size * 1.5 * r
    ring = [[round(cx + size * np.cos(np.radians(60 * k - 30)), 5),
             round(cy + size * np.sin(np.radians(60 * k - 30)), 5)] for k in range(6)]
    return ring + [ring[0]]


def make_panel(width: int = 8, height: int = 6, seed: int = 7) -> Panel:
    rng = np.random.default_rng(seed)
    months = np.arange(START, END + np.timedelta64(1, "M"))
    T = months.size
    tt = np.linspace(0, 1, T)
    moy = (months.astype(int) % 12) + 1

    coords = [(q, r) for r in range(height) for q in range(width)]
    ids = [_cid(q, r) for q, r in coords]
    idset = set(ids)
    neighbors = {_cid(q, r): [_cid(q + dq, r + dr) for dq, dr in AXIAL_DIRS if _cid(q + dq, r + dr) in idset]
                 for q, r in coords}
    C = len(ids)

    # --- observation opportunities: Sentinel-1 constellation history
    base_passes = rng.uniform(8, 12, size=(C, 1))
    constellation = np.where((months >= S1B_LOST) & (months < S1C_ONLINE), 0.5, 1.0)
    opportunities = rng.poisson(base_passes * constellation).astype(float)

    # --- environment (NASA-like): monsoon wind, chlorophyll bloom in winter/late summer
    wind = 5 + 5 * np.isin(moy, [6, 7, 8]) + rng.normal(0, 0.6, (C, T))
    chl_season = 1 + 0.6 * np.cos(2 * np.pi * (moy - 2) / 12)
    chl = np.broadcast_to(chl_season, (C, T)) * rng.uniform(0.6, 1.4, (C, 1)) * np.exp(rng.normal(0, 0.08, (C, T)))

    # --- true vessel activity per pass
    season_activity = np.where(np.isin(moy, [6, 7]), 0.3, 1.0)          # fishing ban Jun-Jul
    lam = rng.uniform(2.0, 4.0, size=(C, 1)) * season_activity * np.ones((C, T))
    ais_frac = np.full((C, T), 0.45)                                       # share of vessels with AIS on
    reception = np.full((C, T), 0.8)                                       # share of AIS actually received

    i_up, i_dn = ids.index(PLANTED["EVT_UP"]), ids.index(PLANTED["EVT_DOWN"])
    i_ais, i_chl = ids.index(PLANTED["AIS_GAIN"]), ids.index(PLANTED["CHL_FOLLOW"])
    lam[i_up] *= 1 + 1.0 * tt
    lam[i_dn] *= 1 - 0.5 * tt
    reception[i_ais] = 0.35 + 0.6 * tt
    chl[i_chl] = chl[i_chl] * (1 + 1.5 * tt)
    lam[i_chl] *= chl[i_chl] / chl[i_chl].mean()

    p_detect = 1 / (1 + np.exp((wind - 9.5) / 1.0))                       # rough seas hide small targets
    expected = opportunities * lam * p_detect
    matched_share = ais_frac * reception
    unmatched = rng.poisson(expected * (1 - matched_share)).astype(float)
    matched = rng.poisson(expected * matched_share).astype(float)

    # reception proxy: transiting cargo/tanker AIS density scales with reception, not with fishing
    ais_reception = 100 * reception * rng.uniform(0.7, 1.3, (C, 1)) * np.exp(rng.normal(0, 0.05, (C, T)))

    # a few missing months (cloud-free does not matter for SAR, but acquisitions can be absent)
    missing = rng.random((C, T)) < 0.02
    opportunities[missing] = 0
    unmatched[missing] = np.nan
    matched[missing] = np.nan

    return Panel(ids, months, unmatched, matched, opportunities, ais_reception, wind, np.asarray(chl),
                 neighbors=neighbors, boundaries={_cid(q, r): hex_boundary(q, r) for q, r in coords},
                 is_synthetic=True,
                 source_note="DEMO DATA: synthetic panel with planted effects (ghostfleet.synthetic)")
