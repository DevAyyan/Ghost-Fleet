# Ghost Fleet X

**Where what satellites see and what ships report stop agreeing.**

Ghost Fleet X is a maritime change-intelligence map built exclusively from free public data. It was made for the
NASA Space Apps Challenge 2026 (Karachi local event), challenge **"Be An Earth System Trend Detective"**.

It does two things:

1. **Trend detection.** It scans the world ocean for places where satellite-observed vessel activity and
   AIS-reported activity are drifting apart over 2020 to the present. It corrects for observation conditions, tests
   whether each change is statistically significant, then tries to disprove its own alerts.
2. **Situational awareness.** It maps AIS gaps, coordinated gaps, apparent fishing in protected areas and possible
   oil slicks, so each trend can be read against what else is happening at sea.

> **Guiding principle: investigation leads, never accusations.** Nothing in the app declares a vessel illegal.
> Every statement is labelled **Observation**, **Inference**, **Hypothesis** or **Recommendation**, and every
> hypothesis includes innocent explanations.

Live app: <https://ghostfleet.earth>

---

## Contents

- [What it shows](#what-it-shows)
- [How the trend analysis works](#how-the-trend-analysis-works)
- [Architecture](#architecture)
- [Quickstart](#quickstart)
- [Configuration](#configuration)
- [API](#api)
- [Tests](#tests)
- [Deployment](#deployment)
- [Data sources and attributions](#data-sources-and-attributions)
- [Limitations](#limitations)
- [Documentation](#documentation)

---

## What it shows

| Layer | Source | Notes |
|---|---|---|
| Shipping lanes | GFW AIS vessel-presence raster tiles | Worldwide density, proxied by the API because tiles need a token |
| AIS switched off | GFW AIS-gap events classed as likely intentional | Filtered by the period selector; gear buoys excluded |
| Where ships go dark most | Spatial density of AIS-gap events | Top 12 hotspots in the period |
| Simultaneous AIS gaps | Spatio-temporal clustering of GFW gap events | Vessels that went dark entering an area, were dark together inside it, and reappeared together (entry and exit within 2.2°, at least 30 min of overlap) |
| Apparent fishing in protected areas | GFW apparent-fishing events inside WDPA marine protected areas | Filter: all MPAs or strict no-take only. Precomputed by `backend/scripts/ingest_sea.py` |
| Possible oil slicks | SkyTruth Cerulean (machine-learning detection on Sentinel-1 radar) | The 1,000 largest in the period; not checked by a person |
| **Lasting changes since 2020** | **Ghost Fleet X trend scan** | See below. 3,315 cells x 82 months |
| Lights at night | NASA VIIRS Day/Night Band (NOAA-20) via GIBS | Imagery layer |
| Ocean productivity | NASA MODIS-Aqua chlorophyll-a via GIBS | Imagery layer |

Select any record to open its **case drawer**: what was seen, what it might mean, and a next step. Select a ship
(or search by name, MMSI or IMO) to see its timeline of recorded events, port visits and AIS gaps. Ship paths are
drawn through GFW's recorded events, **not** raw AIS tracks, which GFW does not offer on the free API.

---

## How the trend analysis works

The **Lasting changes** layer is the core of the project. It is deterministic, small enough to explain in a few
sentences, and implemented in `backend/ghostfleet/analytics/` with NumPy and the standard library only.

### Maritime Signal Drift Index (MSDI)

```
MSDI = unmatched SAR vessel detections / Sentinel-1 passes over the cell that month
```

- Analysis unit: **1.40625° cells** (the geohash precision-3 grid, about 150 km at the equator), per calendar month.
- "Unmatched" means a radar vessel detection that GFW could not match to an AIS broadcast. It does not mean illegal.
- Cell-months with fewer than 3 passes are **masked**, never zero-filled.
- Only cells with at least 150 detections over the window are analysed, to keep low-count noise out.
- Sentinel-1C/1D scenes count as observation opportunities only from 2026-07, because GFW's detections evidently did
  not use them before then. Counting them earlier produced a false worldwide decline (see decision 14 in
  `docs/decisions.md`).

### Correction waterfall

The same trend test is applied after each successive correction, so you can see how much of the apparent change each
explanation absorbs:

```
raw  ->  coverage (÷ passes)  ->  AIS reception  ->  season  ->  environment (wind)
```

| Step | What it removes |
|---|---|
| Coverage | Changes in how often Sentinel-1 imaged the cell (this is the MSDI division) |
| AIS reception | Regional change in how well AIS is received, proxied by AIS-matched detections per pass in the surrounding ~11° region |
| Season | Each calendar month's climatological mean |
| Environment | Monthly wind anomaly from NASA POWER (WS10M), removed by regression |

### Significance

1. **Mann-Kendall** trend test with a **Hamed-Rao** autocorrelation correction (variance is only ever inflated, never
   reduced, which keeps the false-alarm rate at or below nominal).
2. **Sen's slope** with a Gilbert (1987) confidence interval, reported as percent change per year.
3. **Benjamini-Hochberg FDR** across all cells (alpha = 0.05).
4. Significant neighbouring cells with the same direction are merged into one **event**. Neighbouring significant
   cells with opposite directions are reported as **opposite-trend pairs**.

### Try to disprove

For one flagged event, the analysis is rerun under seven alternative but defensible choices. An alert "survives" a
variant if that variant's own test is significant in the same direction.

`SEASONAL_MK` · `TRIM_START` · `TRIM_END` · `STRICT_COVERAGE` · `COARSER_CELLS` · `NEIGHBOR_CONTROL` · `STRICT_ALPHA`

### CauseLens, confidence and next step

- **CauseLens** ranks explanations by the share of the apparent change each correction step absorbed. Whatever
  survives every correction is labelled `UNEXPLAINED_CHANGE` (a hypothesis: possibly a real change in activity or in
  AIS use, requiring verification).
- **Confidence** (Low / Moderate / High) combines disproof survival, data completeness and the number of independent
  sensors. With a single sensor it is **capped at Moderate**; a second sensor (for example VIIRS Boat Detection) would
  be needed for High.
- **Recommended action** is rule-based. Low confidence means "monitor only".

### Case File

Each event can be exported as a **JSON** case file (summary, what changed, evidence, alternative explanations,
recommended action, limitations) or as **GeoJSON** of the affected area.

### Result on the committed data snapshot

The repository ships `backend/data/processed/panel_real.json` (pulled 14 Nov 2026, 82 months from 2020-01). Running the scan
on it gives 230 events (173 decreasing, 57 increasing) and 50 opposite-trend pairs in about 10 seconds. Most
surviving changes are declines, and part of that may reflect better AIS adoption and matching, which is not
corrected for (decision 14).

---

## Architecture

```
backend/                     Python 3.11+ / FastAPI
  ghostfleet/
    analytics/
      msdi.py                MSDI, covariate regression, correction waterfall
      trend.py               Mann-Kendall (+Hamed-Rao), Seasonal MK, Sen's slope, BH-FDR
      scan.py                Scan across all cells, event clustering, opposite-trend pairs
      disprove.py            Try-to-disprove variants
      causelens.py           Ranked explanations, confidence, recommended action
    api/
      main.py                FastAPI app, routes, error handling, caching headers
      service.py             Trend analysis service (events, cells, case files)
      sea_service.py         Live awareness layers, simultaneous-gap clustering, rule-based hypotheses
      schemas.py             Pydantic contract (camelCase aliases)
    gfw.py                   Global Fishing Watch client with on-disk cache
    sea.py                   AIS gaps, oil slicks, presence tiles, vessel paths
    real.py / panel.py       Load and represent the precomputed cell x month panel
    places.py                Hand-made sea-name table (a reading aid, not a boundary dataset)
    synthetic.py             Synthetic data for tests only; never served by default
  tests/                     63 pytest tests
  scripts/
    ingest_real.py           Build data/processed/panel_real.json (GFW + Earth Search + NASA POWER)
    build_scan.py            Precompute the trend scan -> data/processed/scan_real.json.gz
    ingest_sea.py            Build data/processed/protected_fishing.json (apparent fishing in MPAs)
    ingest_closures.py       Build data/processed/closures.json (fishing during seasonal bans)
    fetch_s1_footprints.py   Sentinel-1 footprint helper
    fetch_open_data.sh       Older regional (20-26N, 56-70E) fetch of open NASA/NOAA grids
    probe_gfw.py             Check what the GFW token can query
  api/index.py               Vercel serverless entry point (backend deploys alone, Root Directory `backend`)
  data/processed/            Precomputed analysis inputs (committed)
  data/seed/lanes/           Latest-month shipping-lane tiles for the world view (committed)
frontend/                    React 19 + TypeScript + Vite + MapLibre GL
  src/
    components/              Map, layer rail, case drawers, vessel drawer, header and limits dialog
    charts/                  Hand-built SVG time-series and waterfall charts
    lib/                     Layers, geometry, formatting; Vitest unit tests
docs/                        API contract, decision log, gotchas, OpenAPI spec
```

Design decision: heavy analysis is **precomputed** into `panel_real.json` by the ingest scripts. The API loads it at
start, runs the scan once (about 10 s), and serves cached results. Only small recomputations (Try to disprove) run
on request.

---

## Quickstart

### Requirements

- Python 3.11+ and Node.js 20+
- A free [Global Fishing Watch API token](https://globalfishingwatch.org/our-apis/) for live layers and ingestion

### 1. Add your token

Copy `backend/.env.example` to `backend/.env` (it is git-ignored and the token is never logged; a `.env` in the repo
root also works):

```
GLOBAL_FISHING_WATCH=your-token-here
```

### 2. (Optional) Refresh the data

The repository already contains a snapshot, so you can skip this step to run the app immediately.

```bash
# Rebuild the global trend panel (cached under backend/data/raw/; --refresh-all ignores caches)
python3 -I backend/scripts/ingest_real.py [--start 2020-01] [--min-detections 150] [--skip-wind]

# Precompute the trend scan so the API (and every serverless cold start) skips it; commit the output
python3 backend/scripts/build_scan.py

# Precompute apparent fishing inside marine protected areas (about 3 min per day scanned)
python3 -I backend/scripts/ingest_sea.py --days 3

# Fishing during seasonal bans (re-check the ban dates in the script each season)
python3 backend/scripts/ingest_closures.py
```

### 3. Run the API (<http://localhost:8000>)

```bash
cd backend
pip install -e ".[api,dev]"
python3 -m uvicorn ghostfleet.api.main:app --port 8000 --reload
```

Interactive docs at <http://localhost:8000/docs>. After a new ingest, call `POST /api/refresh` to reload the panel.

### 4. Run the frontend (<http://localhost:5173>)

```bash
cd frontend
npm install
npm run dev
```

The dev server proxies `/api` to `http://127.0.0.1:8000`.

Before a demo, open **Lasting changes** once: the first trend request after a cold start takes 10 to 20 seconds
because the worldwide scan runs then.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `GLOBAL_FISHING_WATCH` | none (required for live layers) | GFW API token; read from the environment or `.env` |
| `GHOSTFLEET_DATA` | `real` | `real` or `synthetic` (synthetic is for tests only) |
| `GHOSTFLEET_PANEL` | `backend/data/processed/panel_real.json` | Path to the trend panel |
| `GHOSTFLEET_CACHE` | `backend/data/raw` (`/tmp/ghostfleet` on Vercel) | Where fetched data is cached |
| `GHOSTFLEET_CORS` | `*` (any site; the API is public and read-only) | Comma-separated allowed origins |
| `GHOSTFLEET_MAX_MAP_CELLS` | `20000` | Cap on cells returned by `/api/cells` |
| `GHOSTFLEET_SEED` | `7` | Seed for synthetic data |
| `VITE_API_BASE` | empty (same origin) | Frontend: API base URL when hosted separately |

A missing panel returns `503 DATA_UNAVAILABLE` with the fix in the message. There is no silent fallback to demo data.

---

## API

Full contract: [`docs/api.md`](docs/api.md) · OpenAPI: [`docs/openapi.json`](docs/openapi.json).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health`, `/api/meta` | Health; dataset info, month axis, waterfall labels, alert counts per step |
| GET | `/api/cells`, `/api/cells/{cellId}` | Map cells with trend summary; one cell's series and waterfall |
| GET | `/api/events`, `/api/events/{eventId}` | Ranked change events (Scan output); event detail with waterfall, CauseLens, confidence, action |
| POST | `/api/events/{eventId}/disproof` | Try-to-disprove survival report |
| GET | `/api/events/{eventId}/case-file?format=json\|geojson` | Case File export |
| GET | `/api/sea/ais-off`, `/slicks`, `/protected-fishing` | Awareness layers for a period (`start`, `end`) |
| GET | `/api/sea/vessels/search`, `/api/sea/vessels/{vesselId}` | Ship search and single-ship timeline |
| GET | `/api/sea/lanes/{z}/{x}/{y}.png` | Shipping-lane tiles |
| POST | `/api/refresh` | Reload the panel after a new ingest |

Conventions: camelCase JSON, `null` for missing values (never `0` or `NaN`), `[lon, lat]` geometry, a top-level
`isDemoData` flag on every response, and every human-readable statement as `{label, text}`. A test enforces that no
response uses "illegal" or "violator" as a conclusion.

---

## Tests

```bash
# Backend (63 tests: known statistics values, planted-trend recovery, false-positive rate,
# Hamed-Rao behaviour, scan on synthetic data, API contract, wording)
cd backend && pip install -e ".[api,dev]" && pytest

# Frontend
cd frontend && npm test && npx tsc --noEmit && npm run build
```

---

## Deployment

`frontend/` and `backend/` are self-contained and deploy separately. `docs/`, `CLAUDE.md` and `PROGRESS.md` at the
top level describe both.

**Vercel (two projects from this one repo).** Create two Vercel projects that import this repo, with different
**Root Directory** settings:

1. **Backend** (Root Directory `backend`). `backend/vercel.json` runs the API as one Python function
   (`backend/api/index.py`); leave build settings alone. Set `GLOBAL_FISHING_WATCH` (the token value only), then check
   `https://<backend>.vercel.app/api/health` and note that address.
2. **Frontend** (Root Directory `frontend`, framework Vite). Set `VITE_API_BASE` to the backend's address, e.g.
   `https://<backend>.vercel.app` (no trailing slash). It is compiled in at build time, so redeploy after changing it.

The API accepts browser requests from any site by default. To restrict it, set `GHOSTFLEET_CORS` on the backend to the
frontend's address. Examples of every variable are in `backend/.env.example` and `frontend/.env.example`.

On Vercel:

- The code directory is read-only, so fetched data is cached in `/tmp` and lasts only as long as one instance. To
  compensate, successful GETs are marked CDN-cacheable for an hour (lane tiles for a month), and the latest month of
  world-view lane tiles ships in `backend/data/seed/`.
- The first trend request after a cold start takes 10 to 20 s.
- Functions are limited to 60 s and 4.5 MB per response. A full year of AIS-off events fetched for the first time
  can exceed 60 s; shorter periods are fine.

**Render (alternative).** `render.yaml` deploys the same backend to Render, with none of those limits. Point the
frontend at it with `VITE_API_BASE`.

---

## Data sources and attributions

| Source | Used for |
|---|---|
| [Global Fishing Watch](https://globalfishingwatch.org/) | SAR vessel detections (AIS-matched and unmatched), AIS-gap and apparent-fishing events, vessel identity, presence tiles |
| [SkyTruth Cerulean](https://cerulean.skytruth.org/) | Machine-detected oil slicks on Sentinel-1 radar |
| Element 84 Earth Search (STAC) | Counts of Sentinel-1 IW scenes per cell and month (the "observation opportunities") |
| **NASA POWER** | Monthly 10 m wind speed (WS10M), the environment correction |
| **NASA GIBS** | VIIRS Day/Night Band (NOAA-20) night lights and MODIS-Aqua chlorophyll-a imagery layers |
| WDPA / Protected Planet | Marine protected area and no-take boundaries |
| Esri Ocean basemap, GEBCO, NOAA, Garmin | Basemap |

Sentinel-1 is operated by ESA/Copernicus. Only NASA POWER wind enters the statistics quantitatively; NASA night
lights and chlorophyll are imagery layers for context.

---

## Limitations

- **Radar is not everything at sea.** Small unlit boats are largely invisible to Sentinel-1 at this resolution, and
  AIS covers only part of the world's vessels.
- **"Unmatched" never means "illegal".** It can mean a vessel without AIS, a reception gap, a matching failure or a
  non-vessel object.
- **No live positions.** No free source gives real-time positions of ships that are not broadcasting. Events lag
  by about four days; radar data is per month.
- **AIS-reception proxy** is regional and also absorbs real traffic changes (for example Red Sea rerouting), so
  alerts mean "unmatched activity changing relative to matched activity nearby".
- **Most detected changes are declines**, and part of that may be improved AIS adoption and matching. This is not
  corrected for.
- **Single sensor.** Confidence is capped at Moderate until a second independent sensor agrees.
- **Chlorophyll is not in the global statistics** (too heavy worldwide); only NASA POWER wind is.
- **Ship paths** connect GFW's recorded events and are not full AIS tracks.
- **Sea names** come from a hand-made table of boxes and are a reading aid only.
- **Machine-learning outputs** (oil slicks) are not checked by a person.

The in-app **Method & limits** dialog repeats these.

---

## Documentation

- [`docs/api.md`](docs/api.md): API contract and conventions
- [`docs/decisions.md`](docs/decisions.md): numbered decision log with reasons and what would change each
- [`docs/gotchas.md`](docs/gotchas.md): environment and data pitfalls
- [`docs/ideas/ghost-fleet-x.md`](docs/ideas/ghost-fleet-x.md): original concept
- [`PROGRESS.md`](PROGRESS.md): current status and recent changes

## Roadmap

- PDF case file (JSON and GeoJSON exist today)
- A second independent sensor (VIIRS Boat Detection) to allow High confidence
- NASA chlorophyll and other NASA covariates in regional reruns, for example the Arabian Sea
- Validation pilot with a university or marine NGO
- SAR confirmation of alerts (Sentinel-1 and NISAR where applicable)
