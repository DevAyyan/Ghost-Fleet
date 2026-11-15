"""Vercel entry point for the single-project deployment (Root Directory = the repo root): the frontend is built as
static files and every /api/* request is rewritten to this one Python function (see /vercel.json).

The code lives in backend/; this file only puts it on the path. For a separate backend project, use Root Directory
`backend` instead (backend/vercel.json, backend/api/index.py). Locally the API runs with uvicorn (see README).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from ghostfleet.api.main import app  # noqa: E402,F401  (Vercel looks for `app`)
