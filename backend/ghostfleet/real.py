"""Load the real panel built by scripts/ingest_real.py (live GFW / Sentinel-1 coverage / NASA data)."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .panel import Panel

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "processed" / "panel_real.json"


class DataUnavailable(RuntimeError):
    """The real panel has not been built yet (or is unreadable)."""


@dataclass
class RealExtras:
    fetched_at: str
    cell_size_deg: float
    sources: list[dict]
    detections: dict[str, list[list[float]]] = field(default_factory=dict)   # month -> [[lat, lon, unmatched, matched]]


def _arr(rows: list[list | None], T: int) -> np.ndarray:
    """(cells, months) array; a missing row (None) or value means "not observed" -> NaN."""
    return np.array([[np.nan] * T if r is None else [np.nan if v is None else float(v) for v in r] for r in rows],
                    dtype=float).reshape(len(rows), T)


def _ais_reception(d: dict, cells: list[dict], T: int) -> np.ndarray:
    """Per-cell AIS-reception proxy: the cell's region series (global build) or one regional series (older panels)."""
    by_region = d.get("aisReceptionByRegion")
    if by_region:
        return _arr([by_region.get(c.get("aisRegion")) for c in cells], T)
    return np.tile(_arr([d["aisReceptionRegional"]], T), (len(cells), 1))


def load_real_panel(path: str | os.PathLike | None = None) -> tuple[Panel, RealExtras]:
    p = Path(path or os.getenv("GHOSTFLEET_PANEL", DEFAULT_PATH))
    if not p.exists():
        raise DataUnavailable(f"Real data panel not found at {p}. Run: python3 -I scripts/ingest_real.py")
    try:
        d = json.loads(p.read_text())
    except (OSError, json.JSONDecodeError) as e:
        raise DataUnavailable(f"Real data panel at {p} is unreadable: {e}") from e
    if d.get("schema") != 1 or not d.get("cells"):
        raise DataUnavailable(f"Real data panel at {p} has an unexpected format or no cells")

    months = np.array(d["months"], dtype="datetime64[M]")
    T = months.size
    cells = d["cells"]
    panel = Panel(
        cell_ids=[c["id"] for c in cells],
        months=months,
        unmatched=_arr([c["unmatched"] for c in cells], T),
        matched=_arr([c["matched"] for c in cells], T),
        opportunities=_arr([c["opportunities"] for c in cells], T),
        ais_reception=_ais_reception(d, cells, T),
        wind=_arr([c.get("wind") for c in cells], T),
        chl=_arr([c.get("chl") for c in cells], T),
        neighbors=d.get("neighbors", {}),
        boundaries={c["id"]: c["boundary"] for c in cells},
        is_synthetic=False,
        source_note="Live data: " + "; ".join(s["name"] for s in d.get("sources", [])) + f". Fetched {d['fetchedAt']}."
        if d.get("sources") else f"Live data: Global Fishing Watch SAR, Sentinel-1 coverage, NASA POWER. Fetched {d['fetchedAt']}.",
    )
    extras = RealExtras(fetched_at=d["fetchedAt"], cell_size_deg=float(d["grid"]["resolutionDeg"]),
                        sources=d.get("sources", []), detections=d.get("detections", {}))
    return panel, extras
