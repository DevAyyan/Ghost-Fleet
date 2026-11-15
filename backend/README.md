# Ghost Fleet X backend

```bash
cd backend
python3 -m pytest -q                                   # stats + scan + API contract tests
python3 -m uvicorn ghostfleet.api.main:app --reload    # http://localhost:8000/docs
python3 -m ghostfleet.api.export_openapi               # refresh docs/openapi.json after schema changes
```

Needs only `numpy`, `fastapi`, `uvicorn` and `pytest` for now. The ingestion layer will add `pandas`, `xarray` and `h3`
(`uv pip install -e ".[data,api,dev]"`).

| Env var | Default | Meaning |
|---|---|---|
| `GHOSTFLEET_DATA` | `real` | `real` = live panel from `backend/scripts/ingest_real.py` (503 if missing); `synthetic` = test data |
| `GHOSTFLEET_PANEL` | `backend/data/processed/panel_real.json` | Path to the real panel |
| `GHOSTFLEET_SEED` | `7` | Synthetic panel seed |
| `GHOSTFLEET_REFRESH_TOKEN` | unset | Token for `POST /api/refresh` (header `X-Refresh-Token`). Unset: only calls from localhost, never on Vercel |
| `GHOSTFLEET_CORS` | `http://localhost:5173,…` | Allowed frontend origins (Vite dev server) |

API contract: [`../docs/api.md`](../docs/api.md) · Layout: `analytics/` (trend, msdi, scan, disprove, causelens),
`api/` (schemas = contract, service, main), `synthetic.py`, `panel.py`.
