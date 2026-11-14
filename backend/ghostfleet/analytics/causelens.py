"""CauseLens: rank competing explanations, score confidence, recommend a next step.

Deliberately simple, transparent rules (no black box): each correction step's explanation gets the
share of the apparent change that step absorbed; whatever survives every correction is the
"unexplained change" hypothesis. Wording never asserts wrongdoing.
"""
from __future__ import annotations

import numpy as np

EXPLANATIONS = {
    "coverage": ("COVERAGE", "Changes in how often Sentinel-1 imaged the area"),
    "ais_reception": ("AIS_RECEPTION", "Changes in how well AIS signals are received (e.g. new receivers)"),
    "season": ("SEASONAL", "The normal seasonal cycle (fishing seasons, closed seasons, weather)"),
    "environment": ("ENVIRONMENT", "Wind and ocean-condition changes"),
}
UNEXPLAINED = ("UNEXPLAINED_CHANGE",
               "Change not explained by coverage, AIS reception, season or environment — possibly a real "
               "change in activity or in AIS use. Requires verification.")


def rank_explanations(steps) -> list[dict]:
    """steps: list[WaterfallStep] in STEPS order. Shares are of the total absolute movement."""
    pct = [abs(s.pct_per_year) if np.isfinite(s.pct_per_year) else 0.0 for s in steps]
    moves = {}
    for k in range(1, len(steps)):
        moves[steps[k].step] = abs(pct[k - 1] - pct[k])
    residual = pct[-1]
    total = sum(moves.values()) + residual
    out = []
    for step, delta in moves.items():
        code, text = EXPLANATIONS[step]
        out.append({"code": code, "text": text, "share": delta / total if total else 0.0, "label": "INFERENCE"})
    out.append({"code": UNEXPLAINED[0], "text": UNEXPLAINED[1],
                "share": residual / total if total else 0.0, "label": "HYPOTHESIS"})
    out.sort(key=lambda e: e["share"], reverse=True)
    return out


def confidence(survival_rate: float, completeness: float, n_sensors: int = 1) -> dict:
    reasons = [f"Survived {survival_rate:.0%} of disproof tests",
               f"{completeness:.0%} of months had usable observations",
               f"{n_sensors} independent sensor{'s' if n_sensors != 1 else ''}"]
    if survival_rate >= 0.8 and completeness >= 0.8 and n_sensors >= 2:
        level = "HIGH"
    elif survival_rate >= 0.6 and completeness >= 0.6:
        level = "MODERATE"
    else:
        level = "LOW"
    if n_sensors < 2 and level != "LOW":
        reasons.append("Capped at MODERATE: a second sensor (VIIRS boat detections) would be needed for HIGH")
    return {"level": level, "reasons": reasons}


def recommended_action(level: str, direction: str, months: tuple[str, str]) -> str:
    if level == "LOW":
        return ("Monitor only: re-run next month and do not escalate. "
                "The signal is not yet robust enough to justify follow-up.")
    trend = "increase" if direction == "increasing" else "decrease"
    return (f"Prioritise this area for review: request targeted satellite imagery (SAR or optical) and "
            f"compare against local fisheries or port records for {months[0]}–{months[1]} to explain the {trend}.")
