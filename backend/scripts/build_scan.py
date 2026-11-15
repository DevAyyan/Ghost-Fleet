"""Run the trend scan once and save it next to the panel, so the API (and every serverless cold start) skips it.

Run after ingest_real.py:  python3 backend/scripts/build_scan.py
Writes backend/data/processed/scan_real.json.gz, keyed to the panel's SHA-256: a stale file is ignored, never served.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))          # ROOT is the backend folder
from ghostfleet.analytics.scan import scan  # noqa: E402
from ghostfleet.analytics.scan_io import cache_path, load_scan, panel_digest, save_scan  # noqa: E402
from ghostfleet.real import load_real_panel, panel_path  # noqa: E402

ALPHA = 0.05


def main() -> None:
    path = panel_path(sys.argv[1] if len(sys.argv) > 1 else None)
    panel, _ = load_real_panel(path)
    t = time.time()
    result = scan(panel, alpha=ALPHA)
    out, digest = cache_path(path), panel_digest(path)
    save_scan(result, out, digest)
    assert load_scan(out, digest, ALPHA) is not None
    print(f"scanned {len(result.cells)} cells in {time.time() - t:.1f} s, {len(result.events)} events -> "
          f"{out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
