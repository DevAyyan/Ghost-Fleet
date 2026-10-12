#!/usr/bin/env python3
"""
Ghost Fleet X — Batch Regional Analysis CLI
Executes the change-intelligence pipeline across the study region,
calculates MSDI, applies Sen's slope, Seasonal Mann-Kendall, and FDR corrections,
and outputs ranked investigation leads.
"""

import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
from apps.api.models.schemas import AnalysisRequest
from apps.api.analytics.pipeline import AnalysisPipeline

async def main():
    print("=" * 75)
    print("GHOST FLEET X — ARABIAN SEA CHANGE INTELLIGENCE ENGINE")
    print("Running Batch Regional Scan...")
    print("=" * 75)

    req = AnalysisRequest(
        region_id="arabian-sea-demo",
        start_date="2021-01-01",
        end_date="2024-12-31",
        cadence="monthly",
        grid_degrees=0.5,
        quality_mode="strict",
        min_valid_obs=15,
        seasonal_adjustment=True,
        significance_method="seasonal_mann_kendall"
    )

    resp = await AnalysisPipeline.run(req)

    print(f"\nAnalysis ID: {resp.analysis_id}")
    print(f"Data Mode:   {resp.data_mode.upper()}")
    print(f"Grid Cells:  {resp.total_cells_analyzed} cells evaluated")
    print(f"Significant: {resp.significant_cells_count} cells with FDR p < 0.05")
    print("\nRANKED INVESTIGATION LEADS (TOP 5):")
    print("-" * 75)
    print(f"{'Rank':<5} {'Area / Cell':<35} {'Slope':<10} {'FDR p':<10} {'Priority':<10} {'Top Hypothesis'}")
    print("-" * 75)

    for i, ev in enumerate(resp.events[:5]):
        slope_str = f"{ev.trend_slope:+.4f}"
        p_str = f"{ev.p_value_fdr_adjusted:.4f}"
        prio_str = f"{(ev.investigation_priority * 100):.0f}%"
        print(f"#{i+1:<4} {ev.area_name[:34]:<35} {slope_str:<10} {p_str:<10} {prio_str:<10} {ev.top_explanation[:30]}")

    print("-" * 75)
    print("\nEthical Safeguard Notice:")
    print("All detections represent statistical signal drift between satellite-observed")
    print("nighttime radiance and recorded vessel tracking. Signal divergence is NOT")
    print("definitive proof of illegal activity or vessel culpability.")
    print("=" * 75)

if __name__ == "__main__":
    asyncio.run(main())
