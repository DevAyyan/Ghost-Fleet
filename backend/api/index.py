"""Vercel entry point: serves the FastAPI app as one Python function. Every request is rewritten here (vercel.json).
Deploy with the Vercel project's Root Directory set to `backend`.

Locally the API is started with uvicorn instead (see README); this file is only used on Vercel.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ghostfleet.api.main import app  # noqa: E402,F401  (Vercel looks for `app`)
