"""Vercel entry point: serves the FastAPI app as one Python function. Every /api/* request is rewritten here (vercel.json).

Locally the API is started with uvicorn instead (see README); this file is only used on Vercel.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from ghostfleet.api.main import app  # noqa: E402,F401  (Vercel looks for `app`)
