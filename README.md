# Ghost Fleet X

A world map of maritime activity and dark vessel operations, built exclusively from free public data (NASA Space Apps 2026, Karachi):
- **Coordinated Dark Operations**: Areas where multiple vessels switched off AIS upon entering, operated dark concurrently inside the area, and restored AIS upon exiting, complete with exact UTC co-presence time intervals and epistemic inferences.
- **Unauthorised Fishing in Protected Areas**: Machine-classified apparent fishing inside marine reserves, filterable by All MPAs vs. Strict No-Take zones with highlighted boundary polygons.
- **AIS Disconnections & Hotspots**: Global tracking of intentional AIS switch-offs and persistent evasion hotspots.
- **Machine-detected Oil Slicks**: Sentinel-1 SAR radar oil slick analysis via SkyTruth Cerulean.
- **Global Shipping Lanes**: AIS vessel presence density tiles across the world ocean.
- **Satellite Earth Observation**: NASA VIIRS night-time light radiance (identifying offshore fleets using lights) and MODIS-Aqua chlorophyll concentration.
- **Long-term Trend Detection**: Multi-year statistical trend detection (MSDI) correcting for satellite pass density, AIS reception variations, seasonality, and weather.

Every record carries epistemic statements (`OBSERVATION`, `INFERENCE`, `HYPOTHESIS`, `RECOMMENDATION`) designed to provide **investigation leads, never accusations**.

---

## Architecture

* **`backend/`**: Python 3.12+ / FastAPI API service, geospatial analytics, GFW and Copernicus clients, and automated verification suites.
* **`frontend/`**: React 19 + TypeScript + Vite + MapLibre GL. Hand-crafted nautical chart aesthetic using pure CSS and SVG without UI framework bloat.
* **`scripts/`**: Real data ingestion pipelines pulling from Global Fishing Watch, Copernicus Sentinel-1 STAC, and NASA POWER.
* **`docs/`**: API contract ([`docs/api.md`](docs/api.md)), architecture decisions ([`docs/decisions.md`](docs/decisions.md)), and OpenAPI specification ([`docs/openapi.json`](docs/openapi.json)).

---

## Quickstart

### 1. Ingest Data
```bash
# Ingest global data (requires GLOBAL_FISHING_WATCH token in .env)
python3 -I scripts/ingest_real.py

# Ingest apparent fishing in marine protected areas
python3 -I scripts/ingest_sea.py --days 3
```

### 2. Run the Backend API (`http://localhost:8000`)
```bash
cd backend
python3 -m uvicorn ghostfleet.api.main:app --port 8000 --reload
```
Interactive OpenAPI documentation is available at `http://localhost:8000/docs`.

### 3. Run the Frontend (`http://localhost:5173`)
```bash
cd frontend
npm install
npm run dev
```
The frontend dev server automatically proxies API requests to `http://127.0.0.1:8000`.

---

## Deploy (frontend on Vercel, API on Render)
The API needs an always-on host: it caches to disk and takes about 10 s to start, which does not suit serverless functions.

1. **API on Render**: New → Blueprint → this repo (`render.yaml`). Set `GLOBAL_FISHING_WATCH` in the dashboard.
   Check that `https://<service>.onrender.com/api/meta` answers.
2. **Frontend on Vercel**: import this repo with **Root Directory = `frontend`**. `frontend/vercel.json` forwards `/api/*`
   to the API, so the browser only talks to the Vercel address and no CORS or `VITE_API_BASE` setting is needed.
   **Edit the `destination` in `frontend/vercel.json` if your Render address is not `ghost-fleet.onrender.com`.**

On Render's free plan the service sleeps when idle and its disk cache is wiped on restart, so open the site and click
through each layer before a demo.

## Verification & Tests

```bash
# Run backend tests (61 tests)
cd backend && pytest

# Run frontend tests & production build
cd frontend && npm test && npx tsc --noEmit && npm run build
```

---

## Data Sources & Attributions

* **Global Fishing Watch (GFW)**: AIS gap events, apparent fishing events, vessel identity registry, and presence raster tiles.
* **SkyTruth Cerulean**: Machine-learning oil slick detections from Sentinel-1 SAR imagery.
* **NASA GIBS**: VIIRS Day/Night Band (NOAA-20) and MODIS-Aqua Chlorophyll-a imagery.
* **Element 84 Earth Search**: STAC aggregation of Sentinel-1 Synthetic Aperture Radar scene passes.
* **NASA POWER**: Monthly ocean surface wind speeds (WS10M).
* **WDPA / Protected Planet**: Marine Protected Area (MPA) and strict no-take reserve boundaries.
