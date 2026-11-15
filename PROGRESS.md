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

## Chart symbols and ship drawer visuals (2026-11-15)
- **One symbol set** (`frontend/src/lib/icons.ts`, drawn by `components/Glyph.tsx`): the map, the rail legend, the lists, the hover card and the drawers all use the same vector drawings. Shape says what a record is; a ring or a larger size marks a stronger lead.
- **Ships are 3D models** (`frontend/src/lib/ship3d.ts`): each kind of vessel (fishing vessel, cargo ship, refrigerated carrier, bunker tanker, plain ship) is a handful of prisms, turned to its heading, lit, and written out as SVG. They are vector drawings placed over the map (`syncShips` in `MapView.tsx`), so they are sharp on any screen. From zoom 4.4 inward the ships in view are drawn this way, up to 170 at once, nearest the middle first. A ship that switched AIS off is an empty white hull with broken magenta edges, bow turned to where it reappeared; a meeting is a carrier or tanker with a fishing vessel alongside; fishing in a protected area is a red fishing vessel.
- **From far out, ships are small marks**: a short hull for fishing vessels, a long one for the rest, two alongside for a meeting. These are distance-field images (`lib/sdf.ts`), the one kind of map symbol that stays sharp at any size and rotation. No extra library is involved.
- **The same ships elsewhere**: the hover card, the legend keys in the rail, and a figure at the top of each ship's drawer (all drawn to one scale, with the recorded length marked). Each figure says it is the typical outline of the type, not a drawing of that ship.
- **Nothing on the chart is a stretched picture**: the symbols that are not ships (slick, fleet, platform, turbine, anchor, the sights on the open record) are distance fields too, the "where ships go dark most" heat wash is now a flat disc with a clean edge per hotspot, and shipping lanes are gone by zoom 5.4, before their coarse tiles smear.
- **Navy panels** (`styles/tokens.css`): the header, the layer rail and the drawer title use `.theme-navy`, which recolours the same token names (`--paper`, `--ink`, `--magenta`, ...), so components need no dark-mode rules of their own. The chart, the case-file body and the method dialog stay paper (`.theme-light`).
- **Room for the chart**: panel widths shrink on small screens, and "Hide layers" on the map puts the rail away.
- **Rail**: layers are grouped under headings (`LAYER_GROUPS` in `lib/layers.ts`), rows show an arrow that turns when open, and layers that are switched off are greyed. Each layer explains its symbol's variants.
- **Drawers**: a record's symbol sits beside its title. The ship drawer has a figure of the vessel type with its recorded length (`ShipProfile.tsx`) and a timeline of the period showing dark stretches against fishing, port calls and meetings (`VesselTimeline.tsx`, `lib/timeline.ts`). On the map the open ship is drawn heading the way it last sailed, port calls are anchors, and every other record fades back.
- Map labels are in plain words (no emoji); the "illegal fishing zones" toggle now reads "Outline the protected areas fished in", in line with leads-not-accusations.

## Faster cold loads (2026-11-15)
- Upstream calls an endpoint needs now run at once, and GFW event pages are fetched in waves: cold loitering 11.1 s → 1.6 s,
  encounters 7.3 s → 1.7 s, slicks 13.6 s → ~6 s (Cerulean-bound). Measured locally from Karachi with an empty cache.
- Each request has a 40 s upstream budget: a slow source now gives a stale copy or a clear 504 `UPSTREAM_TIMEOUT`,
  never a killed function.
- The list layers are fetched with `?compact=true` (each statement once): loitering 2.2 MB → 1.25 MB.
- `.github/workflows/warm-cdn.yml` requests the default layers every 30 minutes.
- Optional shared cache across instances: set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` on Vercel (not set yet).
- Details and the region decision: `docs/decisions.md` §18.

## Working on the frontend without the backend
- `frontend/.env.local` with `GHOSTFLEET_API=https://ghostfleet.earth` makes `npm run dev` forward `/api` to the live site, so no local backend or Global Fishing Watch token is needed. Leave `VITE_API_BASE` unset locally: the live API refuses browser requests from another address.

## Test & Build Status
- **Backend**: 81/81 pytest tests passing in `backend/tests/`.
- **Frontend**: 37/37 Vitest unit tests passing; TypeScript (`tsc --noEmit`) and Vite production build cleanly compiling with 0 errors.

## Repo split into two deployable parts (2026-11-15)
- `backend/` is now self-contained: the API, its data (`backend/data/processed`, `backend/data/seed`, cache in
  `backend/data/raw`), the ingest scripts (`backend/scripts/`) and the Vercel entry point (`backend/api/index.py`,
  `backend/vercel.json`). `frontend/` was already self-contained.
- Deploy as two Vercel projects from this repo (Root Directory `backend` and `frontend`); the frontend finds the API
  through `VITE_API_BASE`. Steps are in the README; traps are in `docs/gotchas.md`.
- The API allows browser requests from any site by default (`GHOSTFLEET_CORS` restricts it).
- Not yet seen running on Vercel: checked locally from an isolated copy of `backend/` with `VERCEL=1`.

