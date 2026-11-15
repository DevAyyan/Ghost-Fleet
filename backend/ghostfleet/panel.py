"""The cell-month panel: the single data structure every analytics step consumes.

All arrays are shaped (n_cells, n_months). NaN means "not observed", never zero.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Panel:
    cell_ids: list[str]
    months: np.ndarray                 # datetime64[M], shape (T,)
    unmatched: np.ndarray              # SAR detections with no AIS match
    matched: np.ndarray                # SAR detections matched to AIS
    opportunities: np.ndarray          # Sentinel-1 acquisitions covering the cell that month
    ais_reception: np.ndarray          # reception proxy: non-fishing (cargo/tanker) AIS position density
    wind: np.ndarray                   # monthly mean 10 m wind speed, m/s (NASA POWER)
    chl: np.ndarray                    # monthly chlorophyll-a, mg m^-3 (NASA MODIS-Aqua)
    neighbors: dict[str, list[str]] = field(default_factory=dict)
    boundaries: dict[str, list[list[float]]] = field(default_factory=dict)   # cell -> closed ring of [lon, lat]
    is_synthetic: bool = False
    source_note: str = ""

    def __post_init__(self):
        shape = (len(self.cell_ids), self.months.size)
        for name in ("unmatched", "matched", "opportunities", "ais_reception", "wind", "chl"):
            arr = np.asarray(getattr(self, name), dtype=float)
            if arr.shape != shape:
                raise ValueError(f"{name} has shape {arr.shape}, expected {shape}")
            setattr(self, name, arr)

    @property
    def month_of_year(self) -> np.ndarray:
        return (self.months.astype("datetime64[M]").astype(int) % 12) + 1

    def index(self, cell_id: str) -> int:
        return self.cell_ids.index(cell_id)

    def window(self, start: str, end: str) -> "Panel":
        """The same cells over the months start..end ("YYYY-MM", inclusive) only."""
        keep = (self.months >= np.datetime64(start, "M")) & (self.months <= np.datetime64(end, "M"))
        return Panel(cell_ids=self.cell_ids, months=self.months[keep],
                     **{k: getattr(self, k)[:, keep] for k in ("unmatched", "matched", "opportunities", "ais_reception", "wind", "chl")},
                     neighbors=self.neighbors, boundaries=self.boundaries, is_synthetic=self.is_synthetic, source_note=self.source_note)
