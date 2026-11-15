# Ghost Fleet X: Guide for Claude

NASA Space Apps 2026 (Karachi), challenge "Be An Earth System Trend Detective".
Ghost Fleet X is a global maritime intelligence platform built exclusively from free public data: shipping lanes, vessels switching AIS off, evasion hotspots, joint dark operations (flotillas entering, operating dark concurrently, and exiting together), apparent unauthorised fishing in marine protected areas, machine-detected oil slicks, NASA VIIRS night lights, MODIS chlorophyll, and long-term statistical trend detection.

Every record produces **investigation leads, never accusations**, structured by formal epistemic labels: `OBSERVATION`, `INFERENCE`, `HYPOTHESIS`, `RECOMMENDATION`.

Read first: `PROGRESS.md` (status and updates) · `docs/decisions.md` (architectural decisions) · `docs/api.md` (API contract).

## Architecture Layout
```
backend/ghostfleet/
  panel.py                  Panel dataclass: array structures (cells, months); NaN = unobserved
  real.py                   Loads backend/data/processed/panel_real.json for trend scan
  gfw.py                    Global Fishing Watch client: disk-cached under backend/data/raw/gfw/
  sea.py                    Live awareness layers: AIS gaps, oil slicks (Cerulean), presence tiles, vessel pathing
  places.py                 Geographical sea names & piracy risk regions
  api/schemas.py            Contract models (Pydantic, camelCase aliases)
  api/service.py            Change analysis service
  api/sea_service.py        Live awareness service, joint dark operations clustering, rule-based hypotheses
  api/main.py               FastAPI application entrypoint
frontend/src/               React 19 + TypeScript + Vite 8 + MapLibre GL 4.7
  api/types.ts              TypeScript interfaces mirroring backend schemas
  lib/layers.ts             Layer definitions, defaults, period utilities
  lib/icons.ts              Chart symbols (hulls, ghost hull, slick, anchor, ...) shared by the map, legend and lists
  lib/ship3d.ts             Ships as small 3D models written out as SVG (by kind, heading, look); used on the map and in cards
  lib/sdf.ts                Distance-field images: the small ship marks of a wide view, sharp at any size and rotation
  lib/vessel.ts             Vessel class from GFW type or gear -> which hull silhouette to draw
  components/Glyph.tsx      A chart symbol as inline SVG
  components/LayerRail.tsx  Left navigation rail: period filter, ship search, layer list
  components/SeaDrawer.tsx  Case drawer for events, hotspots, slicks, fishing, and joint dark operations
  components/VesselDrawer.tsx  Single ship timeline, path visualization, and dark gaps
  components/ShipProfile.tsx   Figure of the vessel type as a 3D model, with its recorded length
  components/VesselTimeline.tsx  The period on one line: dark stretches against fishing, port calls, meetings
  components/MapView.tsx    MapLibre map: ocean basemap, ship marks far out and 3D ship models close in, hover cards, track pathing
backend/scripts/
  ingest_real.py            Ingests live global SAR and environmental data -> panel_real.json
  build_scan.py             Precomputes the trend scan -> scan_real.json.gz (keyed to the panel's SHA-256)
  ingest_sea.py             Ingests apparent fishing events inside no-take MPAs -> protected_fishing.json
  ingest_closures.py        Fishing effort during seasonal bans (India, Bangladesh, Pakistan) -> closures.json
```

## Essential Commands
```bash
# Backend pytest suite (85 tests)
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
