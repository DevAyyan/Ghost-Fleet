# Progress

_Last updated: 2026-11-14 ~22:00 PKT._

## What the app is now
A world map of maritime intelligence and dark vessel activity, built from free public satellite and AIS data. The left rail provides a **period filter** (custom date range or presets), a **vessel search**, and configurable intelligence layers; select any record to inspect the case drawer with empirical observations, analytical inferences, and rule-based hypotheses. Selecting any vessel opens its individual timeline, showing its full journey, port visits, and unmonitored dark transits.

| Layer | Source | State |
|---|---|---|
| Shipping lanes | GFW AIS presence raster tiles | live; worldwide density |
| AIS switched off | GFW gap events classed as likely intentional | live, ~869 events per 30 days |
| Where ships go dark most | Spatial density & top 12 hotspots over 180 days | live, 12 major maritime clusters |
| Simultaneous AIS turn-ons / Joint dark operations | Spatial-temporal clustering of entry, co-presence, and exit | live, 55 joint dark operation clusters |
| Apparent unauthorised fishing | GFW apparent fishing inside Marine Protected Areas | live, filterable by All MPAs vs Strict No-Take |
| Possible oil slicks | SkyTruth Cerulean (Sentinel-1 SAR) | live, largest 1,000 detections |
| Lasting changes since 2020 | Ghost Fleet X multi-year trend scan | 3,315 areas × 82 months |
| Lights at night | NASA VIIRS Day/Night Band via GIBS | live imagery |
| Ocean productivity | NASA MODIS-Aqua chlorophyll via GIBS | live imagery |

## Recent Major Updates
- **Removed Radar Layer**: Removed the radar detections layer, detections feed, and playback scrubber to keep the map lightweight and focused on actionable dark vessel leads.
- **Added Illegal Fishing Filter & Highlights**:
  - Filter toggle in the rail for **All MPAs** vs. **Strict No-Take Only**.
  - Highlighted smoothed convex hull polygon overlays on the map (`#a3271b` dashed outline) with caution badges.
  - Interactive map click-to-focus on protected area zones.
- **Joint Dark Operations (Entry, Concurrent Presence, Exit)**:
  - Spatio-temporal clustering detects vessels that ceased AIS upon entering an area ($\le 2.2^\circ$), operated dark concurrently inside together, and reconnected in unison upon exiting ($\le 2.2^\circ$).
  - Exact UTC timestamps for concurrent unmonitored presence ($\max t_{\text{start}}$ to $\min t_{\text{end}}$) and exact entry/exit time windows.
  - Rule-based epistemic hypotheses identifying **Sister fleet sweeps**, **Transshipment rendezvous**, and **EEZ border incursions**.
  - Synchronized MapLibre circle halos and interactive text badges (`⚡ X ships (Yh dark together)`).
  - Temporally indexed graph clustering reducing calculation time to $< 0.4\text{ s}$ across 13,000+ events.

## Test & Build Status
- **Backend**: 61/61 pytest tests passing in `backend/tests/`.
- **Frontend**: 19/19 Vitest unit tests passing; TypeScript (`tsc --noEmit`) and Vite production build cleanly compiling with 0 errors.

## Repo split into two deployable parts (2026-11-15)
- `backend/` is now self-contained: the API, its data (`backend/data/processed`, `backend/data/seed`, cache in
  `backend/data/raw`), the ingest scripts (`backend/scripts/`) and the Vercel entry point (`backend/api/index.py`,
  `backend/vercel.json`). `frontend/` was already self-contained.
- Deploy as two Vercel projects from this repo (Root Directory `backend` and `frontend`); the frontend finds the API
  through `VITE_API_BASE`. Steps are in the README; traps are in `docs/gotchas.md`.
- The API allows browser requests from any site by default (`GHOSTFLEET_CORS` restricts it).
- Not yet seen running on Vercel: checked locally from an isolated copy of `backend/` with `VERCEL=1`.

