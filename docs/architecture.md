# Ghost Fleet X — System Architecture

Ghost Fleet X is a NASA-data-powered maritime change-intelligence decision-support prototype. It detects standardized statistical divergence between satellite-observed nighttime radiance proxies and recorded transponder tracking efforts across the Northern Arabian Sea (Karachi Coast and Pakistan EEZ).

```mermaid
flowchart TD
    subgraph DataSources["Data Ingestion & Adapters"]
        NASA_VIIRS["NASA VNP46A2 VIIRS Nighttime Lights<br/>(LAADS DAAC / Earthdata)"]
        NASA_POWER["NASA POWER Meteorology API<br/>(Wind, Precip, SST)"]
        GFW_AIS["Global Fishing Watch / Regional Tracking<br/>(Apparent Tracking Proxy)"]
        NASA_GIBS["NASA GIBS EOSDIS Tile Server<br/>(Browse WMTS)"]
        DEMO_FIXTURE["Calibrated Regional Demo Fixture<br/>(25 Cells × 48 Months)"]
    end

    subgraph BackendEngine["FastAPI Analytics Engine (Python 3.11+)"]
        ADAPTERS["Provider Adapters<br/>(NasaViirs, NasaPower, Tracking)"]
        QUALITY["Quality Evaluator<br/>(Cloud masks, Moon fraction, Valid Days)"]
        NORM["Min-Max Normalization Engine<br/>(Standardized [0.0, 1.0] Rates)"]
        MSDI_CALC["MSDI Engine<br/>(satellite_proxy - tracking_proxy)"]
        STAT_TREND["Non-Parametric Trend Analyzer<br/>(Sen's Slope, Seasonal Mann-Kendall)"]
        FDR_CORR["Multiple Comparisons Corrector<br/>(Benjamini-Hochberg FDR α=0.05)"]
        HYP_ENGINE["Alternative Hypothesis Evaluator<br/>(Artisanal, Cloud artifact, Platform flare)"]
        PRIORITY["Investigation Priority Ranker<br/>(Slope, Persistence, FDR, Quality)"]
        DISPROOF["Disproof Lab Sensitivity Engine<br/>(Stress-test windows, baselines, filters)"]
        LOCAL_STORE["Local Store<br/>(Analyst Review Labels & Notes)"]
    end

    subgraph FrontendApp["Next.js Web Dashboard (TypeScript & Tailwind)"]
        HEADER["Header<br/>(Branding, Data Mode, Telemetry Status)"]
        CONTROL_RAIL["Control Rail<br/>(Region, Temporal Window, Quality Filters)"]
        MAP_VIEW["MapLibre GL JS Map<br/>(0.5° Grid, Visual Semantics, GIBS Overlay)"]
        EVENT_LIST["Event List<br/>(Ranked Leads, Priority Badges, FDR Status)"]
        DRAWER["Event Detail Drawer<br/>(ECharts Timeline, Hypotheses, Follow-ups)"]
        CHALLENGE_UI["Disproof Lab Panel<br/>(Interactive Parameter Sensitivity)"]
        CASE_REPORT["Auditable Case Dossier Modal<br/>(Printable / Browser PDF Export)"]
    end

    NASA_VIIRS --> ADAPTERS
    NASA_POWER --> ADAPTERS
    GFW_AIS --> ADAPTERS
    DEMO_FIXTURE --> ADAPTERS
    NASA_GIBS --> MAP_VIEW

    ADAPTERS --> QUALITY
    QUALITY --> NORM
    NORM --> MSDI_CALC
    MSDI_CALC --> STAT_TREND
    STAT_TREND --> FDR_CORR
    FDR_CORR --> PRIORITY
    STAT_TREND --> HYP_ENGINE
    PRIORITY --> BackendEngine
    DISPROOF --> STAT_TREND

    BackendEngine -->|REST API / JSON| FrontendApp
    CONTROL_RAIL -->|POST /api/analysis/run| BackendEngine
    CHALLENGE_UI -->|POST /api/analysis/{id}/challenge| DISPROOF
    DRAWER -->|POST /api/events/{id}/feedback| LOCAL_STORE
```

---

## 1. Core Subsystems

### 1.1 Ingestion & Adapter Layer (`apps/api/providers`)
- **`NasaViirsProvider`**: Queries NASA LAADS DAAC for VNP46A2 lunar BRDF-adjusted radiance granules using bearer tokens when configured. Falls back gracefully to the calibrated regional demo fixture when credentials are not supplied.
- **`NasaPowerProvider`**: Asynchronously calls the NASA POWER REST API for 10m surface winds (`WS10M`), precipitation (`PRECTOTCORR`), and surface temperatures (`TS`) to provide physical maritime operational context.
- **`MaritimeTrackingProvider`**: Interfaces with Global Fishing Watch API or preprocessed regional AIS effort proxies.
- **`FixtureLoader`**: Reads the offline calibrated fixture for the 25 study cells in the Arabian Sea, ensuring immediate reproducibility for hackathon judges without API key bottlenecks.

### 1.2 Statistical Analytics Core (`apps/api/analytics`)
- **`evaluate_observation_quality`**: Implements cloud filtering rules. Under strict mode, months require $\ge 15$ valid days and cloud-free coverage $\ge 60\%$. Degraded observations are masked (`None`), never zero-filled.
- **`normalize_series_minmax`**: Normalizes satellite radiance and tracking effort onto separate $[0.0, 1.0]$ scales.
- **`compute_msdi_series`**: Computes Maritime Signal Drift Index ($MSDI = \text{sat\_norm} - \text{trk\_norm}$).
- **`compute_trend`**: Evaluates monotonic trend direction and magnitude using Sen's slope and 12-month Seasonal Mann-Kendall test.
- **`benjamini_hochberg_fdr`**: Corrects for spatial multiple-testing across the 25 cells to limit False Discovery Rate to $\alpha = 0.05$.
- **`generate_hypotheses_and_actions`**: Rules-based alternative hypothesis generator and proportionate decision-support action mapper.

### 1.3 Disproof Lab Sensitivity Engine
- Re-executes the analytical pipeline with altered user-specified parameters (modified date window, baseline period, observation threshold, filter mode, or seasonal adjustments).
- Compares original vs. challenged Sen's slope, p-value, and significance class.
- Conducts spatial neighbor comparison to verify whether the target cell is a localized spatial outlier or part of regional autocorrelation.

### 1.4 Frontend Presentation Layer (`apps/web`)
- Built with **Next.js 14 (App Router)**, **TypeScript (Strict Mode)**, and **Tailwind CSS**.
- **MapLibre GL JS**: Renders CartoDB dark basemap, 0.5° analytical grid cells with visual semantics (red for positive drift, cyan for negative, neutral slate for non-significant), and NASA GIBS Day/Night browse imagery.
- **Apache ECharts**: Renders multi-axis time series with raw observation scatter, tracking effort, MSDI drift index, Sen's slope trendline, and NASA POWER surface winds.
- **Case Report Generator**: Produces an exportable, printable audit dossier with print-optimized CSS.

---

## 2. Security & Redaction Boundaries

1. **Zero Credential Exposure**: NASA Earthdata tokens and API keys are stored strictly in backend environment variables (`.env`).
2. **Log Redaction**: All API logs mask authorization tokens (e.g. `Bearer eyJ...[REDACTED]`).
3. **Frontend Isolation**: No secrets are baked into Next.js client bundles.
4. **Local Review Storage**: Analyst feedback and review labels are written only to local disk storage (`data/processed/analyst_feedback.json`) without third-party leaks.
