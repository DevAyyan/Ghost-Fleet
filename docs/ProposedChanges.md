# 1. Remove “illegal” from the UI (about 10 minutes)

This breaks your own acceptance criterion. The backend test only checks API responses, so these strings slipped through.

frontend/src/components/LayerRail.tsx line 191: change “Highlight illegal fishing zones on map” to “Highlight no-take zone activity”.
frontend/src/lib/layers.ts line 19: change the layer name “Possible unauthorised fishing” to “Apparent fishing in protected areas”.
Rename the identifiers too (highlightIllegalZones, onToggleIllegalZones, illegalFishingZones, illegal-zone-*, the illegalFilter radio name) across LayerRail.tsx, MapView.tsx and App.tsx. A find-and-replace to noTakeZones or protectedZones works. Also rename the CSS class illegal-zone-label.
backend/ghostfleet/api/sea_service.py line 445 says “Possible unauthorised fishing” in the hypothesis text. It is hedged, but I’d lead with “Apparent fishing inside a no-take area” and keep the innocent explanations.

Add a guard test so it can’t come back: a Vitest or pytest test that scans frontend/src for user-visible strings containing “illegal” or “violator”. Without it, the next feature will reintroduce them.

# 2. Open the app on the Gulf of Oman and link to EVT-001 (about 30 minutes)

Right now it opens on the whole world, which loses the Pakistan story.

Set the initial MapLibre view in MapView.tsx to roughly 20–26°N, 56–70°E.
Turn Lasting changes on by default, or make the demo link do it. The README already says it must be opened once before a demo, so this also warms the 10–20 s cold start.
Add a “Start here” shortcut that opens the top event, N24.61E59.77, in the Gulf of Oman. Your demo then begins on the strongest result instead of a cluttered world map.
# 3. Silence the empty-slice warnings (about 10 minutes)

backend/ghostfleet/analytics/disprove.py lines 47–49 call np.nanmean on cells where wind or chlorophyll is all-NaN. It is harmless but noisy. Add a small helper that returns NaN for all-NaN input (or wrap with warnings.catch_warnings()) and use it for ais, wind and chl. Do the same check in scan.py if it shows up there.

# 4. Decide on the PDF case file (30 minutes to build, or 5 minutes to cut)

The blueprint promised JSON and PDF; the code delivers JSON and GeoJSON.

Fastest build: render the existing CaseFile model to HTML with Jinja2 and convert it with WeasyPrint (your blueprint’s choice), exposed as format=pdf. docs/api.md already says “pdf will be added as a new enum value”.
Watch out: WeasyPrint needs system libraries and may not fit the Vercel function’s size limit, so test it before committing. If it doesn’t fit, a print-styled HTML page with a “Print / Save as PDF” button is a good fallback.
Cutting it is fine too. Just don’t mention PDF in the pitch.
# 5. Add NASA chlorophyll to a regional rerun (1–2 hours)

This is the highest-value change for the challenge, because NASA is currently thin. Decision 13 already says a regional run with the older approach is possible. Rerun the 20–26°N, 56–70°E box with MODIS chlorophyll (the old scripts/fetch_open_data.sh already fetches it) so the environment step uses both wind and chlorophyll, then show EVT-001’s waterfall with that. You can then say honestly that NASA wind and ocean color were used in the correction for the featured event.

# 6. Smaller polish items
Explain the waterfall non-monotonicity in the UI. Alerts go 465 at the AIS step and 629 at the season step. A one-line note in the waterfall panel (“removing the seasonal cycle can reveal trends it was hiding”) pre-empts a judge’s question.
Surface the declines caveat. Add the “most surviving changes are declines; may reflect better AIS matching” note to the Method & limits dialog and the event drawer, not just the decision log.
Check the label overlap and truncation from your screenshots (“fish evs”, the clipped search placeholder, overlapping “went dark” badges at world zoom). Cluster or hide badges below a zoom threshold.
Run the frontend tests and typecheck (npm test && npx tsc --noEmit). I couldn’t run these, so confirm they pass after the renames in item 1.

# Data Changes: How the offered resources map to changes
Giovanni:	Download monthly MODIS-Aqua chlorophyll, GPM IMERG rain and MERRA-2 time series for specific boxes or points	(Low effort)
AppEEARS:	Point/area time series from NASA archives. Check whether it covers the Black Marble product you want before relying on it.	(Low to medium effort)
SeaWiFS: chlorophyll time-series paper	Cite it in your method as precedent for time-series significance testing with ocean color	(Very low effort)

Changes, in order:

1. Make NASA visible in the output (about 30 minutes). Add a “NASA data used” block to the case file and the event drawer: dataset name, version, access date and DOI or URL for each NASA source that fed that event. Name the correction step by what it contains (for example “− wind, rain, chlorophyll”). Show the “50 explained away / 28 newly revealed” numbers in the Method & limits dialog.

2. Fill chlorophyll for the Gulf of Oman box (1 to 2 hours). Decision 13 dropped chlorophyll as too heavy worldwide, but a regional or per-event pull is small. Use Giovanni to export monthly MODIS-Aqua chlorophyll for the cells of your top ~10 events plus the 20–26°N, 56–70°E region. Write a small scripts/ingest_nasa_covariates.py that loads the CSVs into the chl array of panel_real.json. correction_series, the waterfall and disprove already accept chl, so no analytics code needs to change. Missing months are treated as seasonally normal, but the step label must say which cells actually have chlorophyll, as decision 13 requires.

3. Add IMERG rain as a covariate (half a day). Rain and wind both degrade radar vessel detection, so this has a physical justification. It needs a new rain array in panel.py, real.py, the ingest, correction_series, the step labels and disprove._series, plus tests. Globally for 3,315 cells it’s heavy, so start with event cells and the regional box.

4. Add a second, NASA-based sensor (the biggest upgrade, 3 to 5 hours). Pull Black Marble (VNP46A3 monthly, or VNP46A2 daily) for the top events’ cells through Earthdata. Test whether offshore night-light radiance trends in the same direction as the radar MSDI trend. If they agree, call confidence(..., n_sensors=2), which is what unlocks HIGH in causelens.py. Be careful in three places:

Mask offshore platforms and gas flares.
Treat “lights don’t agree” as “no confirmation”, never as a refutation, because most vessels are unlit.
Label it clearly as supporting evidence, since this is not a vessel detector.

# Judging Criterion:
Score against the judging guide (1–5 each)
Criterion	Score	Why
- Impact	3.5	A real problem, with a strong local angle in Pakistan and a working public app. There is no named user or pilot yet, so a partner would raise this.
- Creativity	4	MSDI, the disprove engine, the correction waterfall and the epistemic labels are distinctive. Satellite-versus-AIS comparison is not new on its own.
- Validity	4.5	Tested statistics, a design that catches its own artifacts, real data and a deployed app. Held back by single-sensor confidence and the uncorrected declines.
- Relevance	3	The trend-detective theme fits well, but NASA is a small part: only POWER wind is in the statistics, and night lights and chlorophyll are imagery. This is your weakest score.
- Presentation	3.5 now, 4.5 possible	The story and the live app are strong. The deck is text-first with no images, and the slides are untested.

Overall: about 3.7 out of 5. The cheapest way to raise Relevance is to say clearly, as slide 4 does, what NASA does and does not contribute. Adding NASA chlorophyll for the Gulf of Oman would help most, and a recorded screen demo helps Presentation
