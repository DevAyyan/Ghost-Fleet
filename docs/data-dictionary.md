# Ghost Fleet X — Data Dictionary & Metric Catalog

This document specifies all raw data products, environmental context fields, derived analytical metrics, and quality flags used in the Ghost Fleet X maritime change-intelligence application.

---

## 1. Input Datasets & Observation Products

| Dataset Identifier | Full Name | Provider / Source | Nominal Resolution | Analytical Resolution | Native Units | Quality Flags Evaluated | Official Citation |
|---|---|---|---|---|---|---|---|
| **VNP46A2** | NASA Black Marble Lunar BRDF-adjusted Nighttime Lights | NASA LAADS DAAC / Suomi-NPP VIIRS | 500 m daily | 0.5° spatial cell, monthly cadence | $nW/(cm^2 \cdot sr)$ (nanowatts per sq cm per steradian) | `Mandatory_Quality_Flag` (0=high), `Cloud_Mask` (0=clear), `Moon_Illumination_Fraction` | Román et al. (2018), NASA Black Marble VNP46A2 Suite |
| **GFW-TRACKING** | Apparent Fishing Effort & Vessel Presence Proxy | Global Fishing Watch API v3 / Regional Coastal Tracking | 0.01° daily | 0.5° spatial cell, monthly cadence | Apparent tracking hours / presence | `Receiver_Coverage_Ratio`, `Transponder_Uptime` | Global Fishing Watch Public Data Platform |
| **NASA-POWER** | NASA Prediction of Worldwide Energy Resources | NASA Langley Research Center REST API | 0.5° daily | 0.5° spatial cell, monthly context | Wind speed: $m/s$; Precipitation: $mm/day$; Temperature: $^\circ C$ | `Climatology_Confidence`, `Interpolation_Flag` | NASA POWER Agroclimatology & Surface Meteorology Project |
| **NASA-GIBS** | Global Imagery Browse Services Day/Night Band | NASA EOSDIS GIBS Tile Server | 250 m browse tiles | Web Mercator dynamic tiles | RGB browse imagery (visual only) | N/A (Rendered browse layer only) | NASA GIBS EOSDIS |

> [!IMPORTANT]
> **Quantitative vs Visualization Separation**: NASA GIBS tiles are rendered solely for visual browse imagery in the MapLibre map. GIBS tiles are **never** used as numeric inputs for quantitative statistical calculations.

---

## 2. Derived Analytical Variables

### 2.1 Component Normalization
- **`radiance_raw`**: Mean monthly radiance observed in cell from unmasked days. Range: $[0, \infty) \text{ nW}/(cm^2 \cdot sr)$.
- **`radiance_normalized`**: Min-max standardized satellite radiance rate:
  $$\text{rad\_norm}_t = \frac{\text{rad}_t - \min(\text{rad})}{\max(\text{rad}) - \min(\text{rad}) + \epsilon} \in [0.0, 1.0]$$
- **`tracking_raw`**: Total monthly recorded transponder tracking hours in cell from unmasked days.
- **`tracking_normalized`**: Min-max standardized tracking activity rate:
  $$\text{trk\_norm}_t = \frac{\text{trk}_t - \min(\text{trk})}{\max(\text{trk}) - \min(\text{trk}) + \epsilon} \in [0.0, 1.0]$$

### 2.2 Maritime Signal Drift Index (MSDI)
$$\mathbf{MSDI}_t = \text{radiance\_normalized}_t - \text{tracking\_normalized}_t$$
- **Range**: $[-1.0, +1.0]$
- **Units**: Standardized dimensionless divergence score.
- **Interpretation**:
  - $\mathbf{MSDI} \approx 0.0$: Signal balance. Satellite radiance matches reported tracking activity.
  - $\mathbf{MSDI} > 0.0$: Positive signal drift. Nighttime illumination exceeds reported transponder tracking effort.
  - $\mathbf{MSDI} < 0.0$: Negative signal drift. Reported vessel presence exceeds nighttime illumination (common for non-illuminated daytime cargo traffic).

---

## 3. Statistical Testing & Significance Fields

| Variable | Type | Range | Description |
|---|---|---|---|
| `trend_slope` | Float | $(-\infty, +\infty)$ | Non-parametric Sen's slope of MSDI over time ($MSDI / \text{month}$). |
| `p_value` | Float | $[0.0, 1.0]$ | Two-tailed p-value from Mann-Kendall or Seasonal Mann-Kendall monotonic trend test. |
| `p_value_fdr_adjusted` | Float | $[0.0, 1.0]$ | False Discovery Rate adjusted p-value calculated via the Benjamini-Hochberg procedure across all regional cells ($\alpha = 0.05$). |
| `is_significant` | Boolean | `true` / `false` | `true` when `p_value_fdr_adjusted < 0.05` and valid sample count $\ge 24$ months. |
| `significance_class` | String | Categorical | One of: `significant`, `not_significant`, `insufficient_data`, `quality_limited`. |
| `valid_sample_count` | Integer | $[0, 48]$ | Number of monthly observations meeting cloud and sensor quality thresholds. |
| `missing_ratio` | Float | $[0.0, 1.0]$ | Ratio of masked/unusable months to total study months. |
| `quality_score` | Float | $[0.0, 1.0]$ | Mean observation opportunity score (fraction of cloud-free days). |
| `investigation_priority` | Float | $[0.0, 1.0]$ | Composite transparent lead priority ranking score: $0.40 \cdot \text{Normalized Slope} + 0.25 \cdot \text{Significance Evidence} + 0.20 \cdot \text{Observation Count} + 0.15 \cdot \text{Quality Score}$. |

---

## 4. Quality Filtering Modes

- **Strict Mode** (Default):
  - Valid observation requires $\ge 15$ cloud-free days per month.
  - Cloud-free coverage fraction $\ge 0.60$.
  - Moon illumination fraction filtered when lunar glint degrades detection.
- **Relaxed Mode**:
  - Valid observation requires $\ge 8$ cloud-free days per month.
  - Cloud-free coverage fraction $\ge 0.20$.
