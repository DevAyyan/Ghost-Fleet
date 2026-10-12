# Ghost Fleet X — Analytical & Statistical Methodology

## 1. Executive Summary & Purpose

Ghost Fleet X addresses a critical gap in maritime domain awareness: identifying regional changes in maritime illumination without requiring prior vessel tracking identity, and testing whether that divergence represents genuine operational shifts or environmental/data-quality artifacts.

The system is designed strictly as a **decision-support and research platform**, not an automated enforcement tool or guilt detector.

---

## 2. Mathematical Pipeline

```mermaid
graph LR
    A[Raw VIIRS & Tracking] --> B[Quality Masking]
    B --> C[Separate [0,1] Normalization]
    C --> D[MSDI Computation]
    D --> E[Seasonal Mann-Kendall Test]
    E --> F[Sen's Slope Magnitude]
    F --> G[Benjamini-Hochberg FDR Adjustment]
    G --> H[Transparent Priority Ranking]
    H --> I[Disproof Sensitivity Testing]
```

### 2.1 Step 1: Quality Masking & Valid Observation Criteria
Satellite observations in the Arabian Sea are heavily confounded by the summer southwest monsoon (June through August), during which thick cloud cover obscures sensor view.
- Let $d_t$ be the count of valid cloud-free days for month $t$.
- Under **Strict Mode**: Observation is marked valid if $d_t \ge 15$ and cloud-free fraction $c_t \ge 0.60$.
- Under **Relaxed Mode**: Observation is marked valid if $d_t \ge 8$ and $c_t \ge 0.20$.
- **Rule of Integrity**: If an observation fails the quality mask, it is set to `null` (`None`). **Missing values are never converted to zero.** Converting missing satellite observations to zero would artificially fabricate false negative trends.

### 2.2 Step 2: Separate Component Normalization
Because nighttime radiance ($nW/(cm^2 \cdot sr)$) and vessel tracking hours have completely different physical dimensions and scales, they cannot be directly subtracted:
$$\text{rad\_norm}_t = \frac{\text{rad}_t - \min(\mathbf{rad})}{\max(\mathbf{rad}) - \min(\mathbf{rad}) + \epsilon}$$
$$\text{trk\_norm}_t = \frac{\text{trk}_t - \min(\mathbf{trk})}{\max(\mathbf{trk}) - \min(\mathbf{trk}) + \epsilon}$$
where $\epsilon = 10^{-6}$ prevents division by zero in near-zero baseline open ocean cells.

### 2.3 Step 3: Maritime Signal Drift Index (MSDI)
$$\mathbf{MSDI}_t = \text{rad\_norm}_t - \text{trk\_norm}_t$$
The index ranges between $[-1.0, +1.0]$. Both component rates are retained and displayed alongside MSDI.

### 2.4 Step 4: Sen’s Slope Estimator (Trend Magnitude)
For time series $\mathbf{x} = (x_1, x_2, \dots, x_N)$ of valid monthly MSDI observations, Sen's slope calculates the median of all pairwise rate of changes:
$$Q = \text{median}\left\{ \frac{x_j - x_i}{j - i} \quad \Big| \quad 1 \le i < j \le N \right\}$$
- **Rationale**: Standard ordinary least squares (OLS) regression is heavily biased by skewed residuals and sensor noise. Sen's slope provides an asymptotically normal, non-parametric estimator with a high breakdown point.

### 2.5 Step 5: Seasonal Mann-Kendall Test
The Arabian Sea features severe annual meteorological cyclicity. The Seasonal Mann-Kendall test accounts for $m = 12$ monthly seasons:
$$S_g = \sum_{i=1}^{n_g - 1} \sum_{j=i+1}^{n_g} \text{sgn}(x_{j,g} - x_{i,g})$$
where $g \in \{1, 2, \dots, 12\}$ indexes the calendar month, and $S = \sum_{g=1}^{12} S_g$. The test statistic $Z$ is calculated with variance corrected for tied values:
$$\text{Var}(S) = \sum_{g=1}^{12} \frac{n_g(n_g - 1)(2n_g + 5) - \sum t(t-1)(2t+5)}{18}$$

### 2.6 Step 6: Benjamini-Hochberg False Discovery Rate (FDR)
Simultaneous testing across 25 spatial cells creates a severe multi-comparison problem. Standard $\alpha = 0.05$ thresholds would produce false positives by pure chance. Ghost Fleet X ranks all $m$ raw p-values $p_{(1)} \le p_{(2)} \le \dots \le p_{(m)}$ and finds:
$$k = \max \left\{ i \quad \Big| \quad p_{(i)} \le \frac{i}{m} \alpha \right\}$$
Adjusted p-values are computed as:
$$p^{\text{adj}}_{(i)} = \min \left\{ 1.0, \min_{j \ge i} \left( \frac{m}{j} p_{(j)} \right) \right\}$$

### 2.7 Step 7: Transparent Investigation Priority Score
The composite priority score is computed from normalized, interpretable components:
$$\text{Priority} = 0.40 \left(\frac{|\text{Slope}|}{\text{Max Regional Slope}}\right) + 0.25 (1 - p^{\text{adj}}) + 0.20 \left(\frac{N_{\text{valid}}}{N_{\text{total}}}\right) + 0.15 (\text{Quality Score})$$
The composite score is labeled **`investigation_priority`**, never "probability of crime".

---

## 3. Disproof Lab: Sensitivity & Stress-Testing

To avoid cherry-picked conclusions, the Disproof Lab allows users to challenge any result by re-running the entire pipeline with:
1. **Alternate date windows** (e.g. truncated 2022–2024 window).
2. **Alternate observation threshold** (requiring 20 valid days vs 8 days).
3. **Alternate quality modes** (strict vs relaxed cloud filtering).
4. **Non-seasonal Mann-Kendall comparison**.
5. **Spatial neighbor comparison**: Evaluates whether the target cell's slope deviates by $> 0.004$ from adjacent spatial neighbors (verifying localized divergence vs regional oceanographic trend).

The verdict is classified as:
- **`ROBUST`**: Trend direction and significance class survive parameter challenge without material shift.
- **`SENSITIVE`**: Significance class or trend direction changes, signaling that the finding is conditional upon windowing assumptions.

---

## 4. Ethical Safeguards & Non-Claims Standard

1. **Non-Accusatory Principle**: Unmatched nighttime light radiance is **never** termed "illegal fishing", "dark vessels", or "smuggling".
2. **Alternative Hypotheses**: The app evaluates and presents plausible explanations (artisanal fishing without transponders, gas flares on oil platforms, heavy cloud artifacts, transshipment hubs).
3. **Decision Support**: Next steps are framed as decision support (optical/SAR tasking request, port state record inspection), never enforcement actions.
