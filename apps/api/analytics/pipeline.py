import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
import numpy as np

from apps.api.models.schemas import (
    AnalysisRequest,
    AnalysisResponse,
    ChangeEvent,
    CellGridResult,
    TimeSeriesPoint,
    ChallengeRequest,
    ChallengeResponse,
    ChallengeMetricComparison,
    EventDetailResponse
)
from apps.api.providers.nasa_viirs import NasaViirsProvider
from apps.api.providers.maritime_tracking import MaritimeTrackingProvider
from apps.api.providers.fixture_loader import FixtureLoader
from apps.api.analytics.quality import evaluate_observation_quality
from apps.api.analytics.normalization import normalize_series_minmax
from apps.api.analytics.msdi import compute_msdi_series
from apps.api.analytics.trend import compute_trend, benjamini_hochberg_fdr
from apps.api.analytics.ranking import compute_investigation_priority
from apps.api.analytics.explanations import generate_hypotheses_and_actions
from apps.api.storage.local_store import LocalStore

class AnalysisPipeline:
    """End-to-end analytical pipeline for regional change intelligence."""
    
    _analysis_cache: Dict[str, Dict[str, Any]] = {}
    
    @classmethod
    async def run(cls, req: AnalysisRequest) -> AnalysisResponse:
        analysis_id = str(uuid.uuid4())[:8]
        created_at = datetime.now(timezone.utc).isoformat()
        
        # Load cells from data provider
        viirs_provider = NasaViirsProvider()
        trk_provider = MaritimeTrackingProvider()
        
        viirs_data = await viirs_provider.fetch_series(req.region_id, req.start_date, req.end_date, req.cadence)
        data_mode = viirs_data.get("data_mode", "demo")
        cells_raw = viirs_data.get("cells", [])
        
        # Determine active date subset
        start_m = req.start_date[:7]
        end_m = req.end_date[:7]
        
        analyzed_cells = []
        raw_p_values = []
        cell_trends = []
        
        # First pass: Filter dates, evaluate quality masks, normalize components
        for cell in cells_raw:
            cell_id = cell["cell_id"]
            obs_list = [o for o in cell["observations"] if start_m <= o["date"] <= end_m]
            
            if not obs_list:
                continue
                
            dates = [o["date"] for o in obs_list]
            
            # Evaluate quality flags per point
            quality_results = [
                evaluate_observation_quality(o, quality_mode=req.quality_mode, min_valid_obs=req.min_valid_obs)
                for o in obs_list
            ]
            
            valid_masks = [q[0] for q in quality_results]
            quality_scores = [q[1] for q in quality_results]
            avg_quality = float(np.mean(quality_scores)) if quality_scores else 0.0
            
            # Extract raw values (masking invalid points as None for trend/MSDI calculation)
            rad_raw = [o["radiance_raw"] if valid_masks[i] else None for i, o in enumerate(obs_list)]
            trk_raw = [o["tracking_raw"] if valid_masks[i] else None for i, o in enumerate(obs_list)]
            
            # Normalize components separately to [0, 1]
            rad_norm = normalize_series_minmax(rad_raw)
            trk_norm = normalize_series_minmax(trk_raw)
            
            # Compute MSDI
            msdi_series = compute_msdi_series(rad_norm, trk_norm)
            
            # Weather aggregates
            winds = [o.get("weather_wind_speed", 0.0) for o in obs_list]
            precips = [o.get("weather_precipitation", 0.0) for o in obs_list]
            avg_wind = float(np.mean(winds)) if winds else 0.0
            avg_precip = float(np.mean(precips)) if precips else 0.0
            
            # Compute trend on MSDI series
            trend_res = compute_trend(
                series=msdi_series,
                dates=dates,
                seasonal_adjustment=req.seasonal_adjustment,
                period=12,
                min_obs_threshold=24 if req.cadence == "monthly" else 12,
                avg_quality=avg_quality
            )
            
            # Also compute individual trends for satellite and tracking
            sat_trend = compute_trend(rad_norm, dates, seasonal_adjustment=req.seasonal_adjustment, min_obs_threshold=24, avg_quality=avg_quality)
            trk_trend = compute_trend(trk_norm, dates, seasonal_adjustment=req.seasonal_adjustment, min_obs_threshold=24, avg_quality=avg_quality)
            
            analyzed_cells.append({
                "cell": cell,
                "obs_list": obs_list,
                "dates": dates,
                "valid_masks": valid_masks,
                "quality_scores": quality_scores,
                "avg_quality": avg_quality,
                "rad_raw": rad_raw,
                "rad_norm": rad_norm,
                "trk_raw": trk_raw,
                "trk_norm": trk_norm,
                "msdi_series": msdi_series,
                "trend_res": trend_res,
                "sat_slope": sat_trend["slope"],
                "trk_slope": trk_trend["slope"],
                "avg_wind": avg_wind,
                "avg_precip": avg_precip
            })
            raw_p_values.append(trend_res["p_value"])

        # Multiple comparisons correction: Benjamini-Hochberg FDR
        adj_p_values, sig_flags = benjamini_hochberg_fdr(raw_p_values, alpha=0.05)
        
        # Max regional slope for normalization
        all_slopes = [abs(c["trend_res"]["slope"]) for c in analyzed_cells]
        max_slope = max(all_slopes) if all_slopes else 0.01

        events: List[ChangeEvent] = []
        grid_results: List[CellGridResult] = []
        total_months = len(analyzed_cells[0]["dates"]) if analyzed_cells else 0

        for i, c in enumerate(analyzed_cells):
            cell = c["cell"]
            cell_id = cell["cell_id"]
            p_adj = adj_p_values[i]
            is_sig = sig_flags[i]
            trend = c["trend_res"]
            
            # Determine final significance class
            if trend["significance_class"] in ["insufficient_data", "quality_limited"]:
                sig_class = trend["significance_class"]
            else:
                sig_class = "significant" if is_sig else "not_significant"
                
            priority = compute_investigation_priority(
                abs_slope=abs(trend["slope"]),
                max_regional_slope=max_slope,
                p_adj=p_adj,
                valid_count=trend["valid_sample_count"],
                total_months=total_months,
                quality_score=c["avg_quality"]
            )
            
            # Mean valid MSDI
            valid_msdi = [m for m in c["msdi_series"] if m is not None]
            msdi_mean = round(float(np.mean(valid_msdi)), 4) if valid_msdi else None
            msdi_latest = valid_msdi[-1] if valid_msdi else None

            # Generate hypotheses and actions
            hyps, actions = generate_hypotheses_and_actions(
                cell_id=cell_id,
                trend_slope=trend["slope"],
                msdi_mean=msdi_mean if msdi_mean is not None else 0.0,
                avg_quality=c["avg_quality"],
                avg_wind=c["avg_wind"],
                avg_precip=c["avg_precip"],
                is_nearshore=cell.get("is_nearshore", False)
            )

            # Build ChangeEvent
            top_hyp = hyps[0]["title"] if hyps else "Baseline regional pattern"
            suggested_action = actions[0]["step"] if actions else "Routine monitoring"

            event = ChangeEvent(
                event_id=f"evt_{cell_id}_{analysis_id}",
                cell_id=cell_id,
                coordinates=cell["coordinates"],
                cell_bbox=cell["cell_bbox"],
                area_name=cell.get("area_name", cell_id),
                investigation_priority=priority,
                trend_slope=trend["slope"],
                slope_unit="msdi_units/month",
                p_value=trend["p_value"],
                p_value_fdr_adjusted=p_adj,
                is_significant=is_sig,
                significance_class=sig_class,
                valid_sample_count=trend["valid_sample_count"],
                missing_ratio=trend["missing_ratio"],
                quality_score=round(c["avg_quality"], 3),
                msdi_latest=msdi_latest,
                msdi_mean=msdi_mean,
                satellite_trend_slope=c["sat_slope"],
                tracking_trend_slope=c["trk_slope"],
                top_explanation=top_hyp,
                suggested_action=suggested_action,
                caveat=trend["caveat"]
            )
            events.append(event)

            grid_results.append(CellGridResult(
                cell_id=cell_id,
                coordinates=cell["coordinates"],
                cell_bbox=cell["cell_bbox"],
                investigation_priority=priority,
                msdi_mean=msdi_mean,
                trend_slope=trend["slope"],
                p_value_adjusted=p_adj,
                is_significant=is_sig,
                significance_class=sig_class,
                quality_score=round(c["avg_quality"], 3)
            ))

        # Sort events by investigation priority descending
        events.sort(key=lambda e: e.investigation_priority, reverse=True)

        sig_count = sum(1 for e in events if e.is_significant)
        warnings = []
        if total_months < 24:
            warnings.append(
                f"Selected temporal window contains only {total_months} months (< 24). "
                "Trends must be interpreted with caution as short-term fluctuations."
            )
        if any(e.significance_class == "quality_limited" for e in events):
            warnings.append("Some cells exhibit heavy monsoon cloud obscuration, triggering quality-limited status.")

        sources = [
            {
                "name": "NASA VIIRS Lunar BRDF Nighttime Radiance",
                "product": "VNP46A2 Collection 6.1 (LAADS DAAC)",
                "units": "nW/(cm^2*sr)",
                "provenance": viirs_data.get("provenance", "DEMO FIXTURE")
            },
            {
                "name": "Maritime Activity Tracking Proxy",
                "product": "Global Fishing Watch Activity / Regional Coastal AIS Proxy",
                "units": "apparent presence / tracking hours",
                "provenance": "Calibrated Regional Demo Fixture"
            },
            {
                "name": "NASA POWER Meteorological Context",
                "product": "POWER Hourly/Daily Agroclimatology & Surface Meteorology",
                "units": "wind (m/s), precip (mm/day), SST (°C)",
                "provenance": "NASA Langley Research Center"
            }
        ]

        response = AnalysisResponse(
            analysis_id=analysis_id,
            created_at=created_at,
            data_mode=data_mode,
            region_id=req.region_id,
            start_date=req.start_date,
            end_date=req.end_date,
            grid_degrees=req.grid_degrees,
            quality_mode=req.quality_mode,
            significance_method=req.significance_method,
            seasonal_adjustment=req.seasonal_adjustment,
            fdr_correction_applied=True,
            total_cells_analyzed=len(analyzed_cells),
            significant_cells_count=sig_count,
            events=events,
            grid_results=grid_results,
            warnings=warnings,
            sources=sources
        )

        # Cache in memory for detail / challenge retrieval
        cls._analysis_cache[analysis_id] = {
            "request": req,
            "response": response,
            "analyzed_cells": analyzed_cells
        }

        return response

    @classmethod
    def get_analysis(cls, analysis_id: str) -> Optional[AnalysisResponse]:
        cached = cls._analysis_cache.get(analysis_id)
        return cached["response"] if cached else None

    @classmethod
    def get_event_detail(cls, event_id: str) -> Optional[EventDetailResponse]:
        # Locate across cached analyses
        for aid, item in cls._analysis_cache.items():
            resp: AnalysisResponse = item["response"]
            for ev in resp.events:
                if ev.event_id == event_id:
                    # Found event. Find matching cell in analyzed_cells
                    matching = next((c for c in item["analyzed_cells"] if c["cell"]["cell_id"] == ev.cell_id), None)
                    if not matching:
                        return None
                        
                    # Build time series
                    obs_list = matching["obs_list"]
                    ts_points: List[TimeSeriesPoint] = []
                    for i, o in enumerate(obs_list):
                        ts_points.append(TimeSeriesPoint(
                            date=o["date"],
                            radiance_raw=o["radiance_raw"],
                            radiance_normalized=matching["rad_norm"][i],
                            tracking_raw=o["tracking_raw"],
                            tracking_normalized=matching["trk_norm"][i],
                            msdi=matching["msdi_series"][i],
                            valid_observation=matching["valid_masks"][i],
                            quality_flag=o["quality_flag"],
                            cloud_free_coverage=o["cloud_free_coverage"],
                            weather_wind_speed=o.get("weather_wind_speed"),
                            weather_precipitation=o.get("weather_precipitation"),
                            weather_sst=o.get("weather_sst")
                        ))

                    # Regenerate detailed hypotheses and actions
                    hyps, actions = generate_hypotheses_and_actions(
                        cell_id=ev.cell_id,
                        trend_slope=ev.trend_slope,
                        msdi_mean=ev.msdi_mean or 0.0,
                        avg_quality=ev.quality_score,
                        avg_wind=matching["avg_wind"],
                        avg_precip=matching["avg_precip"],
                        is_nearshore=matching["cell"].get("is_nearshore", False)
                    )

                    provenance = {
                        "analysis_id": aid,
                        "data_mode": resp.data_mode,
                        "sources": resp.sources,
                        "methodology": "Seasonal Mann-Kendall with Benjamini-Hochberg FDR",
                        "caveat": (
                            "All detections represent statistical signal drift between satellite-observed "
                            "nighttime radiance and recorded vessel tracking. Signal divergence is NOT "
                            "definitive proof of illegal activity or vessel culpability."
                        )
                    }

                    feedback = LocalStore.get_feedback(event_id)

                    return EventDetailResponse(
                        event=ev,
                        time_series=ts_points,
                        explanations=hyps,
                        suggested_actions=actions,
                        data_provenance=provenance,
                        review_feedback=feedback
                    )
        return None

    @classmethod
    async def run_challenge(cls, req: ChallengeRequest) -> ChallengeResponse:
        """
        Disproof Lab: Recomputes sensitivity variants when parameters are challenged.
        """
        cached = cls._analysis_cache.get(req.analysis_id)
        if not cached:
            raise ValueError(f"Analysis {req.analysis_id} not found in memory.")
            
        orig_req: AnalysisRequest = cached["request"]
        orig_resp: AnalysisResponse = cached["response"]
        
        orig_event = next((e for e in orig_resp.events if e.event_id == req.event_id), None)
        if not orig_event:
            raise ValueError(f"Event {req.event_id} not found.")

        # Construct challenged parameters
        chal_start = req.alternate_start_date or orig_req.start_date
        chal_end = req.alternate_end_date or orig_req.end_date
        chal_min_obs = req.alternate_min_valid_obs if req.alternate_min_valid_obs is not None else orig_req.min_valid_obs
        chal_qual_mode = req.alternate_quality_mode or orig_req.quality_mode
        chal_season = req.alternate_seasonal_adjustment if req.alternate_seasonal_adjustment is not None else orig_req.seasonal_adjustment
        
        # Run challenged analysis
        chal_req = AnalysisRequest(
            region_id=orig_req.region_id,
            start_date=chal_start,
            end_date=chal_end,
            cadence=orig_req.cadence,
            grid_degrees=orig_req.grid_degrees,
            quality_mode=chal_qual_mode,
            min_valid_obs=chal_min_obs,
            seasonal_adjustment=chal_season,
            significance_method=orig_req.significance_method
        )
        chal_resp = await cls.run(chal_req)
        
        # Locate matching cell in challenged analysis
        chal_event = next((e for e in chal_resp.events if e.cell_id == orig_event.cell_id), None)
        if not chal_event:
            raise ValueError(f"Cell {orig_event.cell_id} not found in challenged run.")

        conclusion_changed = (orig_event.is_significant != chal_event.is_significant) or (
            orig_event.significance_class != chal_event.significance_class
        )
        
        # Determine summary verdict
        if not conclusion_changed:
            verdict = "ROBUST: Trend direction and significance survived parameter challenge without material shift."
        else:
            verdict = f"SENSITIVE: Conclusion changed from '{orig_event.significance_class}' to '{chal_event.significance_class}'. Result depends on selected windowing/filtering assumptions."

        # Metric comparisons
        comparisons = [
            ChallengeMetricComparison(
                metric_name="Sen's Slope Magnitude",
                original_value=orig_event.trend_slope,
                challenged_value=chal_event.trend_slope,
                unit="drift/month",
                delta=round(chal_event.trend_slope - orig_event.trend_slope, 5),
                changed_materially=abs(chal_event.trend_slope - orig_event.trend_slope) > 0.002
            ),
            ChallengeMetricComparison(
                metric_name="Statistical Significance Status",
                original_value=orig_event.significance_class,
                challenged_value=chal_event.significance_class,
                unit="status",
                delta=None,
                changed_materially=(orig_event.significance_class != chal_event.significance_class)
            ),
            ChallengeMetricComparison(
                metric_name="Valid Observation Count",
                original_value=orig_event.valid_sample_count,
                challenged_value=chal_event.valid_sample_count,
                unit="months",
                delta=float(chal_event.valid_sample_count - orig_event.valid_sample_count),
                changed_materially=abs(chal_event.valid_sample_count - orig_event.valid_sample_count) >= 6
            ),
            ChallengeMetricComparison(
                metric_name="FDR Adjusted p-value",
                original_value=orig_event.p_value_fdr_adjusted,
                challenged_value=chal_event.p_value_fdr_adjusted,
                unit="p-value",
                delta=round(chal_event.p_value_fdr_adjusted - orig_event.p_value_fdr_adjusted, 4),
                changed_materially=abs(chal_event.p_value_fdr_adjusted - orig_event.p_value_fdr_adjusted) > 0.05
            )
        ]

        # Neighbor comparison if requested
        neighbor_comp = None
        if req.compare_with_neighbors:
            target_lon, target_lat = orig_event.coordinates
            neighbor_events = [
                e for e in orig_resp.events
                if e.cell_id != orig_event.cell_id and
                abs(e.coordinates[0] - target_lon) <= 0.55 and
                abs(e.coordinates[1] - target_lat) <= 0.55
            ]
            if neighbor_events:
                neighbor_slopes = [e.trend_slope for e in neighbor_events]
                avg_neighbor_slope = round(float(np.mean(neighbor_slopes)), 5)
                neighbor_comp = {
                    "neighbor_count": len(neighbor_events),
                    "target_cell_slope": orig_event.trend_slope,
                    "average_neighbor_slope": avg_neighbor_slope,
                    "target_is_outlier": abs(orig_event.trend_slope - avg_neighbor_slope) > 0.004,
                    "interpretation": (
                        "Target cell slope significantly exceeds adjacent spatial grid cells, indicating localized activity."
                        if abs(orig_event.trend_slope - avg_neighbor_slope) > 0.004
                        else "Neighboring cells exhibit similar trend directions, indicating broad regional environmental or fishing trends."
                    )
                }

        caveats = [
            "Sensitivity testing re-runs the entire pipeline with modified filters and recalculates FDR corrections.",
            "Changes in baseline period or minimum observations reduce statistical power when sample size drops below 24 months."
        ]

        return ChallengeResponse(
            analysis_id=req.analysis_id,
            event_id=req.event_id,
            original_slope=orig_event.trend_slope,
            challenged_slope=chal_event.trend_slope,
            original_significance=orig_event.significance_class,
            challenged_significance=chal_event.significance_class,
            original_sample_count=orig_event.valid_sample_count,
            challenged_sample_count=chal_event.valid_sample_count,
            conclusion_changed=conclusion_changed,
            summary_verdict=verdict,
            metric_comparisons=comparisons,
            neighbor_comparison=neighbor_comp,
            caveats=caveats
        )
