"""Save and load a ScanResult, so a serverless cold start does not re-run the scan (~35 s on the global panel).

The file is keyed by the panel's SHA-256, the scan settings and SCAN_VERSION: if any of them differ the cache is
ignored and the scan runs as before, so a stale cache can never be served for a different panel.
Plain JSON (gzipped), not pickle: it loads under any numpy version the host installs.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
from pathlib import Path

from .msdi import WaterfallStep
from .scan import CellResult, ScanResult
from .trend import TrendResult

SCAN_VERSION = 1   # bump whenever scan(), waterfall() or the trend test change their output
_TREND_FIELDS = ("n", "s", "var_s", "z", "p", "slope", "slope_lo", "slope_hi", "correction", "method")
log = logging.getLogger("ghostfleet.scan_io")


def panel_digest(path: str | os.PathLike) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cache_path(panel_path: str | os.PathLike) -> Path:
    p = Path(panel_path)
    return p.with_name(p.stem.replace("panel", "scan", 1) + ".json.gz")


def _key(digest: str, alpha: float) -> dict:
    return {"version": SCAN_VERSION, "panelSha256": digest, "alpha": alpha}


def _num(v):
    return float(v) if not isinstance(v, (str, bool, int)) and v is not None else v


def _plain(o):
    """Events and pairs hold numpy scalars: make them JSON-native."""
    if isinstance(o, dict):
        return {k: _plain(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_plain(v) for v in o]
    return _num(o)


def save_scan(result: ScanResult, out: str | os.PathLike, digest: str) -> None:
    cells = {
        cid: {"q": float(c.q), "qByStep": {k: float(v) for k, v in c.q_by_step.items()},
              "steps": [[s.step, s.label, float(s.pct_per_year), [_num(getattr(s.trend, f)) for f in _TREND_FIELDS]]
                        for s in c.steps]}
        for cid, c in result.cells.items()
    }
    doc = {"key": _key(digest, result.alpha), "cells": cells, "events": _plain(result.events),
           "oppositePairs": _plain(result.opposite_pairs), "alertsByStep": result.alerts_by_step,
           "isSynthetic": result.is_synthetic}
    out = Path(out)
    tmp = out.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    tmp.replace(out)


def load_scan(path: str | os.PathLike, digest: str, alpha: float) -> ScanResult | None:
    """The cached scan, or None if there is none or it was made for another panel, version or alpha."""
    p = Path(path)
    if not p.exists():
        return None
    try:
        with gzip.open(p, "rt", encoding="utf-8") as fh:
            doc = json.load(fh)
        if doc.get("key") != _key(digest, alpha):
            log.warning("scan cache %s does not match this panel; running the scan", p)
            return None
        cells = {}
        for cid, c in doc["cells"].items():
            steps = [WaterfallStep(step, label, TrendResult(**dict(zip(_TREND_FIELDS, t))), pct)
                     for step, label, pct, t in c["steps"]]
            cells[cid] = CellResult(cid, steps, q=c["q"], q_by_step=c["qByStep"], _alpha=alpha)
        return ScanResult(cells, doc["events"], doc["oppositePairs"], doc["alertsByStep"], alpha, doc["isSynthetic"])
    except (OSError, ValueError, KeyError, TypeError) as e:
        log.warning("scan cache %s unreadable (%s); running the scan", p, e)
        return None
