# Decision log

Newest last. Each entry: what we decided, why, and what would change it.

1. **Vessel signal = GFW Sentinel-1 SAR detections, AIS-matched vs unmatched** (not VIIRS Boat Detection vs AIS).
   Radar works through cloud and without moonlight; GFW already does the AIS matching; VBD access was unconfirmed.
   VBD stays an optional second sensor that would allow HIGH confidence.
2. **MSDI = unmatched detections ÷ Sentinel-1 IW passes** per cell-month (passes counted from Planetary Computer footprints).
   Cell-months with < 3 passes are masked.
3. **One statistics path**: monthly anomaly → Mann-Kendall with Hamed-Rao (clamped ≥ 1) → Sen's slope + Gilbert CI →
   Benjamini-Hochberg FDR across cells. Seasonal MK only appears as a Try-to-disprove alternative (not stacked: double
   deseasonalising is indefensible in a 3-minute pitch).
4. **Correction waterfall**: raw → coverage → AIS reception → season → environment (wind + chlorophyll), with the same
   test after each step. Missing covariate months are treated as seasonal normal (anomaly 0) instead of being dropped.
5. **AIS-reception proxy** = cargo/carrier/tanker AIS hours in a fixed Hormuz–Karachi lane box (60–64°E, 22.5–24.5°N),
   applied regionally. Per-cell data was too heavy for the network. Caveat: it also reflects real traffic shifts (e.g. 2024
   Red Sea rerouting), which is listed in the limitations.
6. **Analysis unit = 0.5° cells** (~55 km, 8-neighbour adjacency), not H3: no new dependency, simple to explain.
   **Cells are never drawn.** The user rejected the grid look; the map shows detections and smooth change clusters.
7. **Disproof survival uses each variant's raw p < α**, not FDR: it tests robustness of one already-flagged event.
8. **Confidence is capped at MODERATE with one sensor.** HIGH needs a second independent sensor to agree.
9. **No `POST /api/scan`**: the scan is deterministic for a dataset, so it runs at load and `/api/events` is its output.
   Live updates come from re-running the ingest and then `POST /api/refresh`.
10. **Real data by default; no silent demo fallback** (user requirement). A missing panel gives 503 with the fix in the message.
11. **Frontend without a UI kit**: hand-built SVG charts and CSS tokens (slow network, full control over annotations such
    as the Sentinel-1B band). MapLibre for the map.
12. **Design identity = nautical chart**: bathymetric Esri Ocean basemap, chart magenta for attention, dashed caution-area
    outlines for change clusters, a scale-bar timeline, and the case file written in serif prose with italic margin labels.
    A dark ECDIS palette was rejected as a generic "near-black + one accent" look.
13. **Whole world instead of the Arabian Sea** (user request, 2026-11-14 evening). To make that fast enough for the venue network:
    - **Analysis unit = 1.40625° cells** (the geohash precision-3 grid, 360/256). This replaces item 6's 0.5° cells. The
      grid was chosen because Earth Search can count Sentinel-1 scenes per geohash cell on the server.
    - **Sentinel-1 coverage = IW scenes touching the cell that month**, from Earth Search's `geometry_geohash_grid_frequency`
      aggregation (8 longitude bands per month, a few KB each) instead of downloading ~1.7 million footprints from
      Planetary Computer. This replaces the "covers the cell centre" count in item 2, so the numbers are about 3× larger
      than before; MSDI is only ever compared within a cell over time, so the scale does not matter. Checked against the
      cached Planetary Computer footprints for the Arabian Sea, Jan 2024: the two counts agree closely.
    - **GFW detections: one gzipped request per month and match flag for the whole world** (~250 KB), shared by the map and
      the ingest (`gfw.py`). GFW allows one report at a time per token, so these run one after another.
    - **AIS-reception proxy = AIS-matched radar detections per pass in the surrounding ~11° region (8 × 8 cells)**. This
      replaces item 5's single Hormuz–Karachi lane box, which cannot describe reception worldwide, and needs no extra
      download. Same caveat as before: it also absorbs real traffic changes, so alerts are about unmatched activity
      changing relative to matched activity nearby.
    - **Wind = NASA POWER, only for the 10° tiles that contain analysis cells. No chlorophyll** (too heavy worldwide).
      The weather step is labelled by what the panel contains ("− wind").
    - **Cells need ≥ 150 detections over the window** (`--min-detections`), up from 10, to keep low-count noise out.
    - **Cell ids carry the hemisphere**: `N24.61E66.80`, `S34.45W18.98`. No adjacency across the antimeridian.
    What would change it: a GFW token that allows parallel reports, or a need for finer cells in one region (run the old
    0.5° approach on that box).
14. **Sentinel-1C/1D scenes count as observation opportunities only from 2026-07** (`GFW_USES_S1CD_FROM` in the ingest).
    Evidence: with every platform counted, worldwide detections per scene fell from ~5.5 (2020–2024) to 4.1 → 2.8 across
    2025-01…2026-06, exactly when Sentinel-1C scenes appear in the catalogue, while the detection counts themselves stayed
    flat; then in 2026-07 detections nearly doubled. Counting only 1A/1B before 2026-07 gives a flat 5.2–6.1 for all seven
    years. So GFW's detections evidently did not use 1C/1D before then. This is an inference from the data, not something
    GFW documents; if GFW publishes which scenes it processed, use that instead. Without this fix the scan reported a false
    worldwide decline.
    Still true after the fix: the unmatched share fell worldwide from ~45% (2020) to ~33% (2024), so most surviving
    changes are declines. That may be real (more vessels on AIS, better matching) and is not corrected for.
15. **The product is now a map of everything happening at sea, not only the trend scan** (user request, 2026-11-14 evening).
    Layers, all free: radar ships (GFW SAR), shipping lanes (GFW AIS presence tiles), AIS switched off and where that
    happens most (GFW gap events classed as likely intentional; gear buoys excluded), possible unauthorised fishing (GFW
    apparent-fishing events inside no-take MPAs), possible oil slicks (SkyTruth Cerulean), lasting changes (our scan),
    and two NASA GIBS image layers (VIIRS night lights, MODIS-Aqua chlorophyll).
    - **"What might have happened" is rule-based** (`api/sea_service.py`): hypotheses from each record's own context
      (vessel type, protected area, distance from shore, known piracy-risk waters). Explainable, no model, always
      labelled HYPOTHESIS. The never-accuse rule stands: the fishing layer is "possible unauthorised fishing", and the
      wording test covers the new endpoints.
    - **No live positions.** No free source gives real-time positions of ships that are not broadcasting. The radar layer
      is the latest complete month; events lag about four days. The UI says so.
    - **Fishing in no-take areas is precomputed** (`backend/scripts/ingest_sea.py`): GFW has ~30,000–50,000 apparent-fishing
      events a day and no protected-area filter, so whole days are paged and filtered locally (about 3 minutes a day).
    - **Sea names come from a hand-made table of boxes** (`places.py`), a reading aid, not a boundary dataset.
    - **Trend geometry loads only when its layer is switched on** (it is several MB); the layer is off by default.
16. **Period filter and single ships** (user request, 2026-11-14 night).
    - **One period (inclusive days, at most 366) filters every dated layer**: AIS-off events and hot spots, oil slicks and
      the fishing layer by day; radar and shipping lanes by the months the period touches (they only exist per month);
      NASA images by the period's last day. Lasting changes are always 2020 → now. If radar for the period is not
      published yet, the newest month is shown and the rail says so.
    - **A ship's path is drawn through its recorded events**, not raw AIS positions: GFW's tracks endpoint answers 403 on
      the free API. Fishing ships have many events (one test ship: 208 in 3.5 months), so the path is detailed for them
      and sparse for cargo ships. Each AIS gap is drawn as a dashed magenta stretch from the last position before the
      signal stopped to the first one after, with the date written on the map. The drawer says plainly that this is not
      the full track.
    - **Ships can be reached three ways**: from an AIS-off event, from a fishing record, or by search (name, MMSI, IMO).
      Radar detections cannot be tied to a ship: GFW publishes them only as counts per 0.1° square.
    - **A ship's own history shows every gap**, including ones GFW does not class as intentional; those are labelled as
      probable reception gaps. The map-wide AIS-off layer still shows only the likely-intentional ones.
17. **Refined dark operations, illegal fishing zones, and radar removal** (user request, 2026-11-14 late evening).
    - **Radar detections layer removed**: The global 100k-point radar layer and monthly scrubber were removed to keep the application lightweight, responsive, and focused strictly on identifiable dark operations and intelligence leads.
    - **Illegal fishing zones filter & highlighted polygons**: Added an interactive toggle in the rail to filter between "All MPAs" and "Strict No-Take Only", rendering smoothed convex hull polygon caution zones around clusters of unauthorized fishing in marine reserves.
    - **Coordinated dark operations (Simultaneous AIS turn-ons)**: Redesigned the simultaneous turn-on layer into a comprehensive joint dark operation detector:
      - Groups vessels entering the same perimeter ($\le 2.2^\circ$), operating dark concurrently inside the area ($\min t_{\text{end}} - \max t_{\text{start}} \ge 30\text{ min}$), and restoring AIS transmissions in unison upon exiting ($\le 2.2^\circ$ within 24 hours).
      - Outputs the exact UTC dates and times down to the minute for entry, exit, and the concurrent unmonitored window across both `OBSERVATION` and `INFERENCE` statements, drawer cards, rail items, and map tooltips.
      - Uses a temporally sorted and windowed graph builder that executes across 13,000+ gap events in $< 0.4\text{ seconds}$.


