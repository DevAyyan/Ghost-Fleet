# Ghost Fleet X

> **Discover maritime change. Test the evidence. Decide what to do next.**

Ghost Fleet X is a NASA-data-powered maritime change-intelligence decision-support prototype. It combines satellite-observed nighttime radiance proxies (NASA Black Marble / VIIRS) and meteorological observation context (NASA POWER REST API) with maritime tracking data (Global Fishing Watch proxy) to identify regional changes in observed-versus-reported maritime activity across the Northern Arabian Sea (Karachi Coast and Pakistan EEZ).

Crucially, Ghost Fleet X tests whether apparent anomalies survive rigorous quality controls and parameter sensitivity checks in a transparent **Disproof Lab**, displaying statistical uncertainty and generating auditable investigation case dossiers.

---

## 1. What Ghost Fleet X Does and Does NOT Do

### What It Does:
- **Discovers area-level change** without requiring the user to select or know of a specific vessel in advance.
- **Normalizes disparate sensors** onto standardized $[0.0, 1.0]$ scales to compute the **Maritime Signal Drift Index (MSDI)**.
- **Filters observation quality** using product cloud masks and valid observation day thresholds; missing observations are never silently converted to zero.
- **Estimates non-parametric trend magnitude** using Sen's slope and 12-month Seasonal Mann-Kendall tests.
- **Corrects for multiple testing** across regional grid cells using the Benjamini-Hochberg False Discovery Rate (FDR) procedure ($\alpha = 0.05$).
- **Challenges findings in the Disproof Lab**: Stress-tests results against alternate temporal windows, baseline windows, quality thresholds, and spatial neighbor checks.
- **Generates auditable case reports** in printable HTML/PDF format with complete data provenance and non-accusatory language.
- **Works out-of-the-box without credentials** using an included, calibrated Arabian Sea regional demo fixture.

### What It Does NOT Do (Ethical Safeguards & Non-Claims):
- **Does NOT claim illegal activity or vessel guilt**: An unmatched proxy signal is an investigation lead, never legal proof of crime.
- **Does NOT perform global real-time surveillance**: It is a regional prototype focused on the Arabian Sea.
- **Does NOT infer individual vessel counts from raw nightlight radiance**.
- **Does NOT automate enforcement dispatch**: All outputs are decision support for marine scientists and analysts.

> [!IMPORTANT]
> **Ethical Notice**: An unmatched signal or statistically significant trend is an investigation lead, not proof of illegal activity. Results depend on dataset coverage, sensor limitations, and analysis choices. Human review is required.

---

## 2. Architecture & Repository Layout

```text
GhostFleet/
├── apps/
│   ├── api/                        # FastAPI analytics backend (Python 3.11+)
│   │   ├── analytics/              # Statistical pipeline, Sen's slope, Mann-Kendall, FDR, MSDI
│   │   ├── models/                 # Pydantic schemas and contracts
│   │   ├── providers/              # Adapters for NASA VIIRS, NASA POWER, GFW, and Demo Fixture
│   │   ├── storage/                # LocalStore for analyst review feedback
│   │   ├── config.py               # Settings and environment configuration
│   │   ├── Dockerfile              # Backend container definition
│   │   └── main.py                 # FastAPI application endpoints
│   └── web/                        # Next.js 14 frontend (TypeScript, Tailwind, MapLibre, ECharts)
│       ├── src/
│       │   ├── app/                # Next.js App Router (layout.tsx, page.tsx, globals.css)
│       │   ├── components/         # MapView, ControlRail, Header, EventList, TimeSeriesChart,
│       │   │                       # EventDetailDrawer, DisproofLab, CaseReportModal, Modals
│       │   └── lib/                # API client functions and TypeScript types
│       ├── Dockerfile              # Frontend container definition
│       └── package.json            # Node.js dependencies
├── data/
│   ├── demo/                       # Clearly labelled calibrated Arabian Sea fixture (25 cells × 48 mo)
│   └── processed/                  # LocalStore derived data (analyst reviews)
├── docs/
│   ├── architecture.md             # System architecture and Mermaid sequence flow
│   ├── data-dictionary.md          # Complete data product, field, and metric specifications
│   ├── methodology.md              # Mathematical formulations, Sen's slope, FDR proofs
│   └── demo-script.md              # 3-minute hackathon judge walkthrough script
├── scripts/
│   ├── build_demo_dataset.py       # Generates calibrated regional Arabian Sea fixture
│   ├── fetch_nasa_data.py          # CLI for querying live NASA Earthdata / POWER APIs
│   └── run_analysis.py             # CLI batch regional change analysis runner
├── tests/
│   ├── unit/                       # Unit tests for MSDI, normalization, Sen's slope, FDR, quality
│   └── integration/                # API endpoint integration tests (Health, Metadata, Run, Challenge)
├── docker-compose.yml              # Local Docker deployment stack
├── requirements.txt                # Pinned Python dependencies
├── .env.example                    # Template environment variables (no secrets)
└── README.md                       # Product documentation and setup guide
```

---

## 3. Quickstart & Local Setup

### Option A: Running with Docker Compose (Recommended)

Start the entire stack (FastAPI backend + Next.js frontend) with one command:

```bash
docker compose up --build
```

- **Web Dashboard**: Open [http://localhost:3000](http://localhost:3000)
- **FastAPI API Docs**: Open [http://localhost:8000/docs](http://localhost:8000/docs)
- **Health Check**: Open [http://localhost:8000/api/health](http://localhost:8000/api/health)

No credentials are required; the system defaults to the calibrated Arabian Sea regional fixture.

---

### Option B: Running Bare Metal (Local Dev)

#### 1. Backend (Python 3.11+)

```bash
# In project root:
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Start FastAPI server:
uvicorn apps.api.main:app --host 0.0.0.0 --port 8000 --reload
```

#### 2. Frontend (Node.js 20+)

```bash
# In a second terminal:
cd apps/web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 4. Running Tests

### Unit & Integration Tests

```bash
# In project root with active .venv:
pytest
```

The test suite validates:
- Sen's slope accuracy and monotonic trend detection.
- Seasonal Mann-Kendall 12-month cyclic stability.
- Benjamini-Hochberg False Discovery Rate multiple testing corrections.
- Strict and relaxed observation quality masks (cloud filtering).
- Min-Max normalization and MSDI divergence bounds ($[-1.0, +1.0]$).
- All FastAPI endpoints: `/api/health`, `/api/metadata`, `/api/analysis/run`, `/api/analysis/{id}/challenge`, `/api/events/{id}`, `/api/events/{id}/feedback`.

### Running the Batch Analysis CLI

```bash
python scripts/run_analysis.py
```

Outputs ranked change events, Sen's slope, FDR-adjusted p-values, and top hypotheses directly to your terminal.

---

## 5. NASA Earth Science & Maritime Data Configuration

### 5.1 NASA Earthdata Setup (Optional for Live Access)
The app runs completely offline using the calibrated regional demo fixture. To connect live NASA Earthdata:
1. Create a free account at [NASA Earthdata Login](https://urs.earthdata.nasa.gov/).
2. Generate an Earthdata Bearer Token from your profile.
3. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
4. Configure your token in `.env`:
   ```bash
   EARTHDATA_BEARER_TOKEN=your_token_here
   ```

### 5.2 NASA Products Used
- **NASA VNP46A2 VIIRS Nighttime Lights**: Collection 6.1 (LAADS DAAC). Lunar BRDF-adjusted radiance ($nW/(cm^2 \cdot sr)$). Quality flags: `Mandatory_Quality_Flag`, `Cloud_Mask`, `Moon_Illumination_Fraction`.
- **NASA POWER REST API**: Daily and monthly 10m wind speed (`WS10M`), precipitation (`PRECTOTCORR`), and surface temperature (`TS`) for physical maritime context.
- **NASA GIBS EOSDIS**: Live WMTS tiles (`VIIRS_SNPP_DayNightBand_AtSensor_M15`) for visual browse imagery. Rendered tiles are **never** used as quantitative inputs.

### 5.3 Maritime Tracking Data
- **Global Fishing Watch API v3**: Apparent fishing effort / regional coastal AIS proxy. Aggregated into matching 0.5° spatial cells.

---

## 6. Statistical Methodology Overview

1. **Maritime Signal Drift Index (MSDI)**:
   $$MSDI = \text{satellite\_proxy\_norm} - \text{tracking\_proxy\_norm}$$
   where both rates are min-max standardized $[0.0, 1.0]$ over the study period.
2. **Sen's Slope**: Robust median slope of all pairwise observations $\frac{x_j - x_i}{j - i}$.
3. **Seasonal Mann-Kendall**: Accounts for 12-month annual monsoon cycles without distorting baseline trends.
4. **Benjamini-Hochberg FDR**: Multi-comparison correction across all spatial cells ($\alpha = 0.05$).
5. **Visual Semantics**: Only statistically significant cells are rendered with divergent colors (red for positive drift, cyan for negative). Non-significant cells are strictly styled in neutral slate gray.

For complete mathematical details, see [docs/methodology.md](docs/methodology.md).

---

## 7. Known Limitations & Caveats

- **Coarse Regional Grid (0.5°)**: Grid cells are approximately 55 km × 55 km. The tool does not provide 30-meter precision or pin individual vessel positions.
- **Cloud Obscuration**: Thick clouds during the summer southwest monsoon (July–August) reduce valid observation days. The tool flags affected cells as `quality_limited`.
- **Artisanal Vessels**: Traditional coastal fishing dhows and skiffs often do not carry AIS transponders. An unmatched signal in nearshore shelf waters often reflects unmonitored artisanal craft, not illegal conduct.

---

## 8. License

Open source prototype built for public-interest maritime conservation and hackathon evaluation. Built with free and open-source libraries (FastAPI, Next.js, MapLibre GL JS, Apache ECharts, SciPy, statsmodels, pyMannKendall).
