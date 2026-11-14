# Ghost Fleet X API contract (v1)

Source of truth: the Pydantic models in `backend/ghostfleet/api/schemas.py`. Live docs at `/docs`.
`docs/openapi.json` is exported from them (`python -m ghostfleet.api.export_openapi`). The frontend
generates TS types from it (`npx openapi-typescript docs/openapi.json -o src/api/types.ts`).

## Conventions
| Rule | Choice |
|---|---|
| Field names | camelCase in JSON (snake_case in Python, aliased) |
| Enums | UPPER_SNAKE (`INCREASING`, `OBSERVATION`, `HIGH`) |
| Months | `"YYYY-MM"` strings |
| Missing values | `null`, never `0` and never `NaN` |
| Geometry | `[lon, lat]` (GeoJSON order) |
| Demo flag | **every** response has a top-level `isDemoData: boolean`. The UI must show the DEMO DATA badge when it's true. |
| Epistemic labels | every human-readable statement is a `{label, text}` with label ∈ `OBSERVATION · INFERENCE · HYPOTHESIS · RECOMMENDATION` |
| Errors | always `{"error": {"code", "message", "details?"}}`. 404 `NOT_FOUND`, 422 `VALIDATION_ERROR`, 503 `DATA_UNAVAILABLE` on analysis endpoints if the real panel isn't built (never falls back to demo data; `/api/meta` and `/api/detections` still work), 502 `UPSTREAM_UNAVAILABLE` (GFW unreachable), 500 `INTERNAL_ERROR` (no internals leaked) |
| Data source | real by default (`meta.fetchedAt` says when it was pulled). Synthetic data exists only for tests |
| Wording | no response ever uses "illegal" or "violator" as a conclusion (enforced by test) |

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/meta` | Dataset info: demo flag, source note, month axis, waterfall step labels, alpha, alert counts per step |
| GET | `/api/cells` | Map layer: every cell with geometry, trend summary and `msdiSeries` aligned to `meta.months` (the time slider indexes locally, so there's no request per slider move) |
| GET | `/api/sea/ais-off?start=&end=` | Vessels that switched AIS off in the period, selected by the day the gap began: `events` (newest first, at most 2,500, each with `vesselId`, entry position `lat/lon`, exit position `onLat/onLon`, and epistemic `statements`), `hotspots` (the 12 places where AIS was switched off most often), `turnOnClusters` (spatio-temporal clusters of coordinated dark operations where vessels entered dark, spent concurrent time together inside, and exited in unison, with `coPresenceStart`, `coPresenceEnd`, and epistemic hypotheses) and `heat` (`[lat, lon]` of every event, for a density layer). Live from the GFW events API; cached 6 h, or for good once the period ended over a week ago. 502 if GFW is down and nothing is cached |
| GET | `/api/sea/slicks?start=&end=` | The 1,000 largest possible oil slicks in the period (SkyTruth Cerulean, machine-detected on Sentinel-1), with `possibleSource` ∈ `VESSEL · INFRASTRUCTURE · DARK_VESSEL · NATURAL · UNKNOWN` and `statements` |
| GET | `/api/sea/protected-fishing?start=&end=` | Apparent fishing inside no-take marine protected areas in the period, with `vesselId` and `statements`. Precomputed a day at a time by `scripts/ingest_sea.py` (`days` lists the days scanned); **503 `DATA_UNAVAILABLE` until that has run** |
| GET | `/api/sea/vessels/search?q=` | Find a ship by name, MMSI, IMO or call sign (`q` ≥ 3 characters). Up to 12 identities |
| GET | `/api/sea/vessels/{vesselId}?start=&end=` | One ship in the period: `identity`, `points` (its recorded events in time order: `fishing · loitering · port_visit · encounter · gap_off · gap_on`; joined up they are its path, and the stretch from a `gap_off` to its `gap_on` was sailed unseen), `gaps` (every time it stopped broadcasting: where, when, how long, where it reappeared, with `statements`; `likelyIntentional` false means probably a reception gap) and `counts`. 404 for an unknown id. **Not raw AIS tracks**: GFW does not offer those on the free API |
| GET | `/api/sea/lanes/{z}/{x}/{y}.png?month=YYYY-MM` | Shipping-lane raster tile (AIS vessel presence for one month, default latest), proxied from GFW because the tiles need the token. `z` ≤ 7; disk-cached; the first request for a tile takes about 10 s |

**Periods.** `start` and `end` are inclusive days (`YYYY-MM-DD`). Give both or neither (neither = the last 30 days). 422 `VALIDATION_ERROR` if `start` is after `end`, `end` is in the future, `start` is before 2020-01-01, or the period is longer than 366 days.

| POST | `/api/refresh` | Reload the panel after `scripts/ingest_real.py` pulled new data. Returns `meta`. Safe to retry |
| GET | `/api/cells/{cellId}` | One cell: monthly series for every correction step, plus its waterfall |
| GET | `/api/events` | Ranked change events (Scan output). Each has `place` (approximate sea name, a reading aid). Paginated: `page`, `pageSize` (≤100), filter `direction` |
| GET | `/api/events/{eventId}` | Event detail: waterfall, series, opposite-trend neighbours, CauseLens, confidence, recommended action |
| POST | `/api/events/{eventId}/disproof` | Try-to-disprove: reruns under alternative settings and returns a survival report. Body optional: `{"variants": [...]}` |
| GET | `/api/events/{eventId}/case-file?format=json\|geojson` | Case File export (`pdf` will be added as a new enum value) |

### Why these choices
- **No `POST /api/scan`.** On a fixed dataset the scan is deterministic, so it runs once at startup and its output *is* the `events` resource. A parameterised rescan can be added later as `POST /api/scans` without breaking anything.
- **`/api/cells` isn't paginated.** It's a map layer bounded by the study box (48 synthetic cells; about 500 at H3 resolution 4), and the map needs all of it at once. A server-side cap (`MAX_MAP_CELLS`) turns a mistake into a 422 instead of a 50 MB response.
- **`disproof` is a POST with no side effects.** It's pure computation, cached, and nothing is stored, so it's safe to retry and no idempotency key is needed.
- **Survival in disproof uses each variant's raw p-value against alpha**, not FDR. It tests the robustness of *one* already-flagged event; multiplicity was already handled when the event was flagged.
- **Confidence is capped at MODERATE while only one sensor (SAR) is used.** HIGH needs a second sensor (VBD) to agree. The response says so in `confidence.reasons`.

## Change policy
Additive only: new optional fields, new endpoints, new enum values at the end. Renaming or removing a field means changing this document and telling the frontend owner first.
