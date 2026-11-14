# Environment and API gotchas

Each of these cost time on 2026-11-14. Check here before debugging something that "should work".

## Process and shell
- **`pkill -f <pattern>` kills your own shell** when the pattern appears in the command line (exit 144). Find the PID with
  `pgrep -af` and then `kill <pid>`, or stop background tasks with TaskStop.
- `python3 -I` hides user site-packages, and numpy lives there. Use plain `python3` for project code.
- System Python is 3.14 with numpy, fastapi, uvicorn, pydantic, httpx, pytest. No scipy, pandas, xarray, h3 or netCDF4.

## Network (venue Wi-Fi: often ~25–30 KB/s, drops connections)
- Prefer small requests: STAC `fields` include/exclude, ERDDAP strides, per-year chunks. Always retry with backoff.
- npm: install with `--prefer-offline` (~5 GB cache). `vitest@4` breaks npm's resolver (`Cannot read properties of null
  (reading 'edgesOut')`), so `frontend/.npmrc` sets `legacy-peer-deps=true`. Add all deps to package.json and install once.
- Google Fonts are slow; fonts are self-hosted in `frontend/public/fonts`.

## Data APIs
- **Global Fishing Watch**: Cloudflare returns `403 error code: 1010` for the default Python-urllib User-Agent. Send
  `User-Agent: ghostfleet-x/0.1` (generic; no personal info). 4Wings `report` date-range end is exclusive; request per year.
  `spatial-aggregation=true` on `public-global-presence` returns one row per vessel (huge), so don't use it. Per-cell presence
  over the whole box is ~340 KB/month, which is why the AIS-reception proxy uses a small shipping-lane box.
- **SAR dataset** `public-global-sar-presence:latest`: rows `{date, detections, lat, lon, vesselIDs}` at 0.1°; filter
  `matched='true'|'false'`. Data runs to the previous month.
- **GFW allows one report at a time per token** (HTTP 429 "not currently enabled to perform more than one concurrent
  report"). The ingest and the API's live map share the token, so `gfw.py` serialises and retries. Send
  `Accept-Encoding: gzip`: a worldwide month drops from ~3 MB to ~250 KB.
- **GFW events API** (`/v3/events`): `limit` up to 1000, `sort=-start`, `vessel-types[i]=FISHING|CARGO|CARRIER|BUNKER|OTHER`.
  Unfiltered AIS gaps are ~90% fishing-gear buoys (`vessel.type = gear`). A date window returns every event that
  *overlaps* it, including gaps that began years ago. There is no filter for protected areas; each event carries
  `regions.mpaNoTake` / `mpaNoTakePartial` instead.
- **GFW vessel tracks are not on the free API**: `/v3/vessels/{id}/tracks` answers 403. Per-ship events work
  (`/v3/events?vessels[0]=<id>` with all five event datasets at once) and identity/search work
  (`/v3/vessels/{id}?dataset=public-global-vessel-identity:latest`, `/v3/vessels/search?query=`). The event `vessel.id`
  is the id to use; one real ship can have several ids over time.
- **GFW PNG tiles** (`/v3/4wings/tile/heatmap/{z}/{x}/{y}?format=PNG&style=...`): `style` is just base64 JSON
  `{"color":[r,g,b],"ramp":[9 thresholds]}`, so `generate-png` is not needed (its URL points at
  `gateway.api.prod.globalfishingwatch.org`, which fails TLS from here, and its default ramp only colours ports).
  Thresholds must shrink ~4× per zoom level. Tiles need the token (so the backend proxies them), take up to ~10 s
  each the first time, and return 502 if more than a few are requested at once.
- **GFW detections lag the Sentinel-1 fleet**: see decisions item 14 before trusting any detections-per-scene number.
- **SkyTruth Cerulean** (`api.cerulean.skytruth.org`, no key): ask for `bbox-only=true` and a `properties=` list, or each
  slick comes with ~12 KB of outline plus centre lines. `source_type_N_ids`: 1 vessel, 2 infrastructure, 3 dark vessel, 4 natural seep.
- **NASA GIBS tiles** are `{z}/{y}/{x}` (row before column) and daily layers are often missing for the last day or two.
- **Earth Search aggregation** (`earth-search.aws.element84.com/v1/aggregate`, no auth): `geometry_geohash_grid_frequency`
  works for `sentinel-1-grd` although the collection's aggregation list doesn't show it. Answers are **capped at 10,000
  buckets with `overflow: 0`** (the least-covered cells are silently dropped), so query in 45° longitude bands.
- **Planetary Computer STAC** (no auth): full items are ~7 KB each; with `fields` they're ~0.3 KB. Filter `sar:instrument_mode = IW`.
- **NASA POWER** regional endpoint: **one parameter per request**, span ≤ 10°, monthly runs only to the last full year
  (2026 months are missing, so the analysis treats them as seasonal normal).
- **ERDDAP** chlorophyll: `erdMH1chlamday_R2022SQ` (science quality, ends ~Apr 2026), `erdMH1chlamday_R2022NRT` (from 2022-03).
- **Earthdata token** works for LAADS (Black Marble VNP46A3), but each tile is ~85 MB per month: too heavy for the venue network.
- **CARTO basemaps now return "API KEY REQUIRED" tiles.** Use Esri: `Ocean/World_Ocean_Base` + `World_Ocean_Reference` (keyless).

## Frontend
- **MapLibre `load` and `isStyleLoaded()` wait for raster tiles.** On slow networks they never fire, so layers never appear.
  Add layers on `style.load` (see MapView). Dev builds expose `window.__gfxMap` for debugging.
- An SVG with a fixed viewBox scales its text with width; charts are capped at `max-width: 30rem`.
- Playwright route `**/api/**` also matches Vite's `/src/api/*.ts` modules. Use `/localhost:5173\/api\//`.
- `.table th` outranks a bare class on a `th`; scope overrides as `.table th.x`.

## Statistics
- The standard Hamed-Rao factor can fall far below 1 on white noise (7.6% false positives at α=0.05 in simulation). It's
  clamped to ≥ 1 in `trend.py`. Keep it that way.
- On synthetic data the raw-count step flags 0 cells: the fishing-ban/monsoon cycle swamps the Sentinel-1B dip. Show the
  coverage effect as a chart, not as a significance flip.

## Vercel (the API runs as one Python function, `api/index.py`)
- **Read-only filesystem**: only `/tmp` is writable, and it is per instance. `gfw.py` switches the cache there when the
  `VERCEL` env var is set (`GHOSTFLEET_CACHE` overrides the location anywhere). Never write next to the code.
- **4.5 MB response cap**: `/api/detections` is over 5 MB as objects (use `?compact=true`) and `/api/cells` is ~4.5 MB
  (use `?only=events`). Check the raw size of any new endpoint, not the gzipped size.
- **The startup hook may not run**, so `app.state.gfw` / `.sea` are created on first use (`gfw_live()`, `sea_watch()`)
  and the scan is lazy (`_ensure_loaded`). Don't read `request.app.state.*` directly in a route.
- **CDN caching**: every successful GET under `/api/` gets `s-maxage=3600` unless the route sets its own header. A route
  whose answer must never be shared between users needs an explicit `Cache-Control: no-store`.
- `.vercelignore` and the function's `excludeFiles` keep `brag-output/`, `docs/`, `data/raw/` and tests out of the bundle
  (limit 250 MB unzipped). `.env` is not deployed: set `GLOBAL_FISHING_WATCH` in the Vercel dashboard.

