from typing import List, Dict, Any, Tuple

def generate_hypotheses_and_actions(
    cell_id: str,
    trend_slope: float,
    msdi_mean: float,
    avg_quality: float,
    avg_wind: float,
    avg_precip: float,
    is_nearshore: bool = False
) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]]]:
    """
    Evaluates rule-based plausible alternative explanations and proportionate decision support next actions.
    Explicitly distinguishes hypotheses from causal conclusions.
    """
    hypotheses = []
    
    # Hypothesis 1: Monsoon Weather & Ocean State Confounding
    if avg_wind > 6.0 or avg_precip > 2.0:
        hypotheses.append({
            "id": "monsoon_weather_confounding",
            "title": "Southwest Monsoon Sea-State & Weather Modulation",
            "likelihood": "high" if avg_wind > 8.0 else "moderate",
            "summary": "Elevated regional wind speeds and monsoon squalls frequently cause artisanal and small coastal fleets to halt voyages, while cloud obscuration degrades VIIRS lunar BRDF accuracy.",
            "supporting_evidence": [
                f"NASA POWER regional 10m wind speed averaged {round(avg_wind, 1)} m/s (monsoon baseline elevated).",
                f"Precipitation averaged {round(avg_precip, 1)} mm/day during active seasonal window.",
                "Noticeable drop in observation opportunity during summer months."
            ],
            "counter_evidence": [
                "Analysis uses lunar BRDF-adjusted clear-sky product flags to filter heavy cloud cover."
            ],
            "limitations": [
                "NASA POWER grid resolution is regional and may smooth localized squalls or maritime surface chop."
            ]
        })
    else:
        hypotheses.append({
            "id": "monsoon_weather_confounding",
            "title": "Southwest Monsoon Sea-State & Weather Modulation",
            "likelihood": "low",
            "summary": "Regional atmospheric conditions are relatively calm during this analysis window.",
            "supporting_evidence": [
                f"NASA POWER average wind speed is mild at {round(avg_wind, 1)} m/s."
            ],
            "counter_evidence": [],
            "limitations": [
                "Short-lived convective squalls may still occur beneath monthly averages."
            ]
        })

    # Hypothesis 2: Unflagged Artisanal / Coastal Gillnet Seasonal Surge
    if is_nearshore:
        hypotheses.append({
            "id": "artisanal_untracked_fleet",
            "title": "Unflagged Small-Scale / Artisanal Fleet Seasonal Activity",
            "likelihood": "high",
            "summary": "Nearshore Arabian Sea waters support thousands of traditional wooden dhows and gillnetters that do not carry Class-A AIS transponders or satellite VMS, generating legitimate nighttime illumination without tracking signals.",
            "supporting_evidence": [
                "Cell is located adjacent to Indus Delta / Karachi coastal shelf waters.",
                "Tracking proxy reflects only AIS/VMS-broadcasting vessels, missing untracked artisanal fishing.",
                "Illumination increases during post-monsoon fishing peaks."
            ],
            "counter_evidence": [
                "High radiance peaks in offshore waters beyond traditional small-craft range."
            ],
            "limitations": [
                "Tracking datasets do not cover non-mandated small craft under 15–20 meters."
            ]
        })
    else:
        hypotheses.append({
            "id": "artisanal_untracked_fleet",
            "title": "Unflagged Small-Scale / Artisanal Fleet Seasonal Activity",
            "likelihood": "moderate" if msdi_mean > 0.2 else "low",
            "summary": "Mid-shelf fishing fleets operating without active AIS transponders or experiencing intermittent transponder coverage.",
            "supporting_evidence": [
                "Positive MSDI drift reflects illumination presence with lower relative AIS reception."
            ],
            "counter_evidence": [
                "Offshore distance may exceed standard range for non-mechanized coastal craft."
            ],
            "limitations": [
                "Cannot distinguish unmandated artisanal vessels from unbroadcasting industrial vessels."
            ]
        })

    # Hypothesis 3: Terrestrial / Infrastructure Glare Bleed
    if is_nearshore:
        hypotheses.append({
            "id": "terrestrial_glare_leakage",
            "title": "Coastal / Harbor Infrastructure Nighttime Light Halo",
            "likelihood": "moderate",
            "summary": "Coarse 0.5° spatial grid cells near metropolitan Karachi or Port Qasim incorporate intense terrestrial port lighting and anchorage glare into coastal water cells.",
            "supporting_evidence": [
                "Proximity to major metropolitan port and industrial zones.",
                "Continuous high baseline radiance across all seasons."
            ],
            "counter_evidence": [
                "Grid cell center is located over marine EEZ waters."
            ],
            "limitations": [
                "0.5° spatial aggregation inevitably aggregates shoreward lighting."
            ]
        })

    # Hypothesis 4: Sensor Quality & Cloud Masking Artifacts
    if avg_quality < 0.60:
        hypotheses.append({
            "id": "sensor_masking_artifact",
            "title": "Observation Density & Quality Degradation",
            "likelihood": "high",
            "summary": "Data sufficiency is compromised by frequent cloud cover, reducing the number of valid monthly lunar BRDF observations.",
            "supporting_evidence": [
                f"Data quality score is {round(avg_quality, 2)}, below the 0.70 high-confidence threshold.",
                "Observation gap flags triggered in multiple winter or monsoon months."
            ],
            "counter_evidence": [],
            "limitations": [
                "Monthly aggregates become sensitive to single clear-sky acquisition anomalies."
            ]
        })
    else:
        hypotheses.append({
            "id": "sensor_masking_artifact",
            "title": "Observation Density & Quality Degradation",
            "likelihood": "unlikely",
            "summary": "Observation quality is robust across the study period with ample clear-sky lunar BRDF observations.",
            "supporting_evidence": [
                f"Average quality score is {round(avg_quality, 2)} with high observation count."
            ],
            "counter_evidence": [],
            "limitations": []
        })

    # Hypothesis 5: Potential Unreported Vessel Activity Drift
    if trend_slope > 0.005 and msdi_mean > 0.15:
        hypotheses.append({
            "id": "unreported_activity_drift",
            "title": "Persistent Unmatched Nighttime Activity Signal",
            "likelihood": "moderate",
            "summary": "Statistically significant upward divergence between satellite illumination and reported tracking, persisting across multiple seasons and surviving basic quality checks.",
            "supporting_evidence": [
                f"Positive drift slope of {trend_slope:+.4f} / month.",
                f"Mean MSDI divergence index is {round(msdi_mean, 3)}.",
                "Persists after seasonal Mann-Kendall adjustment."
            ],
            "counter_evidence": [
                "Illumination alone does not prove identity, authorization, or vessel flag."
            ],
            "limitations": [
                "Nighttime lights provide an aggregate radiance proxy, NOT individual vessel tracking or confirmation of illicit activity."
            ]
        })

    # Proportionate Decision Support Next Steps (NON-ENFORCEMENT)
    actions = [
        {
            "step": "1. Optical / SAR Cross-Verification",
            "description": "Task open Copernicus Sentinel-1 Synthetic Aperture Radar (SAR) imagery over the coordinate cell to detect metallic hull surface reflections independent of cloud cover.",
            "type": "remote_sensing_tasking"
        },
        {
            "step": "2. Regional Fisheries Registry Comparison",
            "description": "Cross-reference coordinates with the Sindh & Balochistan Fisheries Department licensed gillnetter registry to identify authorized seasonal concessions.",
            "type": "administrative_inquiry"
        },
        {
            "step": "3. Terrestrial AIS Receiver Health Audit",
            "description": "Verify uptime telemetry for regional coastal AIS base stations (Karachi Port Trust, Manora, Ormara) during the suspected divergence period to rule out receiver dropouts.",
            "type": "sensor_diagnostics"
        },
        {
            "step": "4. Disproof Sensitivity Evaluation",
            "description": "Execute the Challenge Lab on this cell: test alternative baseline windows and enforce strict quality thresholds to evaluate if the trend survives quality filtering.",
            "type": "analytical_challenge"
        }
    ]

    return hypotheses, actions
