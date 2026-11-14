# Ghost Fleet X — Refined Direction (Space Apps 2026, Karachi)

## Problem Statement
How might we tell whether a change in the gap between what satellites *see* at sea and what ships *report* is real, significant, and behavioral, rather than an artifact of sensors, coverage, or the ocean itself changing?

## Recommended Direction: one engine, two sensors, NASA explainers
A blend of four options, arranged in layers so they don't compete for build time:

1. **Trend Detective engine (general).** The pipeline (grid → monthly anomaly → Mann-Kendall with Hamed-Rao → Sen's slope → FDR → opposite-trend radar → Try-to-disprove) works on *any* gridded layer. Ghost Fleet is the flagship case. The same engine also runs on a pure Earth-science layer (chlorophyll), which makes the challenge fit literal: "the same variable trends up here and down next door."
2. **Hero signal: the observed-vs-reported gap, measured by two sensors.**
   - *Primary:* **GFW Sentinel-1 SAR vessel detections, AIS-matched vs. unmatched.** SAR works in any weather and without moonlight, and GFW already does the matching. No custom detector is needed.
   - *Secondary:* **VIIRS Boat Detection vs. AIS** (lit night fleet), only if VBD access lands.
   - When both sensors agree, that feeds the **confidence** score. When they disagree, the case shows it.
3. **NASA data explains and corrects.** MODIS chlorophyll, MUR SST, NASA POWER wind, cloud and rain, and Black Marble coastal and port lights drive CauseLens ("activity moved offshore *with* the chlorophyll front → probably environmental"). Wind is also a *correction*, because high sea state hides small SAR targets.
4. **The hero UX is "Is this real?"** The correction waterfall and Try-to-disprove get the most polish of anything in the app.

**MSDI (SAR version)** = unmatched SAR detections ÷ Sentinel-1 acquisitions over that cell in that month (the valid-opportunity count, computed from Planetary Computer's STAC catalog).

**Waterfall:** raw → coverage (number of S1 passes) → AIS reception (total AIS density as a proxy) → season (monthly climatology) → environment (wind, chlorophyll).

**Demo moment:** Sentinel-1B failed in December 2021, which halved revisits through 2022; Sentinel-1C restored them in 2025. The raw series shows a dramatic "fleet change" that **disappears after the coverage correction**. That's the tool catching a false alarm live, which is the whole pitch.

## Key Assumptions to Validate (first 3 event hours)
- [ ] GFW 4Wings API returns SAR presence for 20–26°N, 56–70°E, split by matched/unmatched → one test query using the team token.
- [ ] Sentinel-1 images the study cells often enough → count S1 GRD scenes per cell-month from Planetary Computer STAC (no auth).
- [ ] Monthly cells at H3 resolution 4 have enough non-zero months for Mann-Kendall → histogram of non-zero months per cell; fall back to coarser cells or quarterly bins.
- [ ] The AIS-reception proxy (total AIS-tracked vessel hours per cell-month from GFW) is obtainable.
- [ ] *(Optional)* VBD records for the box are downloadable, and Black Marble VNP46A3 covers the coastal tiles (Earthdata/GEE).

## MVP Scope
**Tier 0 — must work by hour ~20 (critical path)**
- Ingestion and cache: GFW SAR and AIS effort, S1 footprints, NASA chlorophyll, SST and POWER, EEZ polygons.
- H3 resolution-4 monthly cell table, opportunity counts, SAR-MSDI.
- Statistics engine (one path): monthly anomaly → MK with Hamed-Rao → Sen's slope with CI → BH-FDR; unit-tested on planted synthetic trends.
- Scan → ranked events; map with hex layer and time slider; event drawer with trend chart and correction waterfall.

**Tier 1 — by hour ~32**
- Try-to-disprove: alternate resolution (r4/r5), baseline window, Seasonal MK instead of anomaly-MK, threshold, and a neighbor comparison → survival report.
- Opposite-trend radar (on MSDI *and* chlorophyll).
- CauseLens with 3–4 transparent rules (coverage, AIS reception, season, environment shift) plus Low/Moderate/High confidence.
- Case File (PDF + JSON) with epistemic labels, data sources and timestamps. "DEMO DATA" badge on anything synthetic.

**Tier 2 — only if Tier 1 is green**
- VBD as a second sensor, plus a sensor-agreement view.
- Black Marble port-lights layer.
- Hosting on a GoDaddy domain (static frontend) with a sponsor-credits line; processing notebook on Planetary Computer/GEE.

## Not Doing (and Why)
- **Custom vessel detector on SAR or VIIRS imagery.** GFW already does it better; we add the statistics, not the detection.
- **C++ kernel.** Mann-Kendall over a few thousand cells runs in seconds in Python; there's no demo payoff.
- **Weekly bins and H3 resolution 6.** Zero-inflated series make the trend tests meaningless.
- **STL + regression + pre-whitening + bootstrap all together.** Removes seasonality twice and can't be defended in 3 minutes. Use one path, with the alternates living inside Try-to-disprove.
- **False-alarm lab sliders, change-point detection, MPA overlap, analyst feedback.** They spread the demo thin. Try-to-disprove already *is* the false-alarm lab.
- **Vessel identification and illegality labels.** Ethics, plus the acceptance criteria.
- **Real-time and 3D globe.** No value for a trend question.

## Open Questions
- Who has the GFW API token, and does it have SAR-presence access? (This blocks the critical path. Check in hour 0.)
- Earthdata login for Black Marble / VBD account: worth spending time on, or skip to Tier 2?
- Frontend: Vite+React as the blueprint says (fresh start). Confirm the team agrees.
- Do the local judges include maritime or fisheries people? If so, open the pitch with the 1.5M-livelihoods line.

## Data Already Fetched (credential-free)
Run `scripts/fetch_open_data.sh` → `data/raw/` (gitignored):
- MODIS-Aqua chlorophyll-a, monthly 4 km, 2020→ (NASA OBPG via NOAA ERDDAP)
- MUR SST v4.1, monthly 0.05°, 2020→ (NASA JPL via ERDDAP)
- NASA POWER monthly wind, cloud, precipitation, temperature and humidity, 2020–2025
- Marine Regions EEZ polygons for the box
- Sentinel-1 GRD scene footprints (Planetary Computer STAC) → opportunity counts
