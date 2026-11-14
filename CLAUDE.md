# Ghost Fleet X: Guide for Claude

NASA Space Apps 2026 (Karachi), challenge "Be An Earth System Trend Detective".
Ghost Fleet X is a global maritime intelligence platform built exclusively from free public data: shipping lanes, vessels switching AIS off, evasion hotspots, joint dark operations (flotillas entering, operating dark concurrently, and exiting together), apparent unauthorised fishing in marine protected areas, machine-detected oil slicks, NASA VIIRS night lights, MODIS chlorophyll, and long-term statistical trend detection.

Every record produces **investigation leads, never accusations**, structured by formal epistemic labels: `OBSERVATION`, `INFERENCE`, `HYPOTHESIS`, `RECOMMENDATION`.

Read first: `PROGRESS.md` (status and updates) · `docs/decisions.md` (architectural decisions) · `docs/api.md` (API contract).

## Architecture Layout
```
backend/ghostfleet/
  panel.py                  Panel dataclass: array structures (cells, months); NaN = unobserved
  real.py                   Loads data/processed/panel_real.json for trend scan
  gfw.py                    Global Fishing Watch client: disk-cached under data/raw/gfw/
  sea.py                    Live awareness layers: AIS gaps, oil slicks (Cerulean), presence tiles, vessel pathing
  places.py                 Geographical sea names & piracy risk regions
  api/schemas.py            Contract models (Pydantic, camelCase aliases)
  api/service.py            Change analysis service
  api/sea_service.py        Live awareness service, joint dark operations clustering, rule-based hypotheses
  api/main.py               FastAPI application entrypoint
frontend/src/               React 19 + TypeScript + Vite 8 + MapLibre GL 4.7
  api/types.ts              TypeScript interfaces mirroring backend schemas
  lib/layers.ts             Layer definitions, defaults, period utilities
  components/LayerRail.tsx  Left navigation rail: period filter, ship search, layer list
  components/SeaDrawer.tsx  Case drawer for events, hotspots, slicks, fishing, and joint dark operations
  components/VesselDrawer.tsx  Single ship timeline, path visualization, and dark gaps
  components/MapView.tsx    MapLibre map: bathymetric ocean basemap, hull polygons, badges, track pathing
scripts/
  ingest_real.py            Ingests live global SAR and environmental data -> panel_real.json
  ingest_sea.py             Ingests apparent fishing events inside no-take MPAs -> protected_fishing.json
```

## Essential Commands
```bash
# Backend pytest suite (61 tests)
cd backend && pytest

# Run backend API server
cd backend && python3 -m uvicorn ghostfleet.api.main:app --port 8000 --reload

# Frontend typecheck, tests, and production build
cd frontend && npx tsc --noEmit && npm test && npm run build

# Run frontend dev server
cd frontend && npm run dev -- --port 5173

# Export updated OpenAPI schema
cd backend && python3 -m ghostfleet.api.export_openapi
```
