# Ghost Fleet X — 3-Minute Demo Walkthrough Script

**Audience**: Hackathon Judges, Marine Conservation Analysts, Fisheries Scientists  
**Goal**: Demonstrate discovery of maritime change, stress-test the evidence in the Disproof Lab, and export an auditable case dossier in under 3 minutes without requiring credentials.

---

## [0:00 – 0:45] Minute 1: The Core Differentiator & Regional Map

> *"Hello judges. Existing maritime surveillance platforms show vessel tracks or raw satellite dots, but they force you to manually track individual ships, and they often make unsupported claims about vessel guilt.*
>
> *Ghost Fleet X takes an entirely different approach: **Discover maritime change. Test the evidence. Decide what to do next.***
>
> *Here on the dashboard, we are looking at the Northern Arabian Sea along the coast of Pakistan and the Karachi EEZ. Ghost Fleet X is combining NASA VIIRS Black Marble nighttime lights as an illuminated activity proxy with Global Fishing Watch tracking data and NASA POWER meteorological context.*
>
> *Rather than guessing vessel counts, we compute the **Maritime Signal Drift Index (MSDI)**—the standardized difference between satellite-observed radiance and reported tracking effort.*
>
> *Notice our visual semantics: only cells that survive Benjamini-Hochberg False Discovery Rate correction at p < 0.05 are highlighted in red for positive drift or cyan for negative drift. Non-significant cells are styled in neutral slate gray to prevent false discoveries.*
>
> *And notice our banner: we are running on a calibrated Arabian Sea demo fixture, so the application runs immediately without requiring judges to configure NASA Earthdata tokens."*

---

## [0:45 – 1:45] Minute 2: Investigating a Lead & Alternative Hypotheses

> *"Let's click on our #1 ranked investigation lead: **Karachi Inner Shelf Fishery Grounds [24.5°N, 66.0°E]**.*
>
> *The lower drawer opens immediately:*
> 1. *In the **Timeline & Signal** tab, we see the 48-month time series from 2021 to 2024. In cyan scatter dots is NASA VIIRS nighttime light radiance. In green is reported vessel tracking effort. In amber is the MSDI drift index, and in red dashed line is Sen's slope trendline.*
> 2. *Notice that our Sen's slope is +0.3574 msdi/month with an FDR-adjusted p-value < 0.001. That indicates a statistically significant positive divergence—radiance is climbing while reported transponder effort is flat.*
> 3. *Crucially, we do **not** claim illegal fishing.*
> 4. *Let's switch to the **Alternative Hypotheses** tab: Ghost Fleet X transparently evaluates four competing explanations:*
>    - *Could it be unmonitored artisanal squid-jiggers using generator lights without AIS? Likelihood: Moderate.*
>    - *Could it be summer monsoon cloud reflection artifact? We evaluate NASA POWER winds and precipitation to check.*
>    - *Could it be offshore transshipment or AIS dark activity?*
> 5. *In the **Decision Support** tab, we recommend proportionate next steps: cross-referencing regional port state records or requesting high-resolution optical/SAR tasking verification—never automated enforcement dispatch."*

---

## [1:45 – 2:45] Minute 3: Disproof Lab & Auditable Case Report

> *"Now comes our core differentiator: the **Disproof Lab**.*
>
> *Science requires disproof. In the Disproof Lab, an analyst can challenge the result. Let's alter the parameters:*
> - *Let's truncate the window to 2022–2024.*
> - *Let's increase the observation threshold to 20 valid days per month.*
> - *Let's run the Spatial Neighbor Outlier Test.*
>
> *We click **Challenge Result**.*
>
> *The engine recomputes the entire pipeline in real time. We see our verdict banner: **ROBUST RESULT**. The Sen's slope remains positive (+0.3120), p-value stays significant, and the spatial neighbor test confirms the target cell is a localized outlier compared to surrounding waters.*
>
> *Now, let's export our findings. We click **Case Report**.*
>
> *An auditable, publication-grade investigation dossier opens immediately. It contains our case ID, exact geographic bounds, complete quantitative evidence table, all data source citations (NASA VNP46A2, GFW, NASA POWER), evaluated hypotheses, and our mandatory ethical disclaimer.*
>
> *We click **Print / PDF**, and the browser print dialog formats a clean, non-accusatory PDF report ready for conservation authorities or fisheries research boards."*

---

## [2:45 – 3:00] Closing

> *"In summary: Ghost Fleet X discovered an area-level change, normalized disparate NASA and maritime proxies, tested the evidence through the Disproof Lab, and generated an auditable case report—all with strict non-accusatory ethics and zero credential bottlenecks.*
>
> *Thank you. We welcome your questions."*
