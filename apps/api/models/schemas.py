from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field

class HealthResponse(BaseModel):
    status: str = "healthy"
    version: str = "1.0.0"
    service: str = "Ghost Fleet X API"
    earthdata_configured: bool
    gfw_configured: bool
    demo_fixture_available: bool

class LayerMetadata(BaseModel):
    id: str
    name: str
    product_identifier: str
    provider: str
    mode: Literal["live", "cached", "demo_fixture", "live_wmts"]
    units: str
    resolution: str
    temporal_coverage: str
    quality_fields: List[str]
    citation: str
    disclaimer: str

class StudyRegion(BaseModel):
    id: str
    name: str
    description: str
    bbox: List[float] = Field(..., description="[min_lon, min_lat, max_lon, max_lat]")
    center: List[float] = Field(..., description="[lon, lat]")
    default_zoom: float = 7.0

class MetadataResponse(BaseModel):
    product_name: str = "Ghost Fleet X"
    tagline: str = "Discover maritime change. Test the evidence. Decide what to do next."
    study_regions: List[StudyRegion]
    layers: List[LayerMetadata]
    available_cadences: List[str] = ["monthly"]
    available_grid_sizes: List[float] = [0.5, 0.25]
    date_coverage: Dict[str, str] = {
        "start": "2021-01-01",
        "end": "2024-12-31"
    }
    ethical_notice: str = (
        "Ghost Fleet X is a maritime change-intelligence decision-support prototype. "
        "An unmatched signal or statistically significant trend is an investigation lead, "
        "not proof of illegal conduct. Human verification is required."
    )

class AnalysisRequest(BaseModel):
    region_id: str = "arabian-sea-demo"
    start_date: str = "2021-01-01"
    end_date: str = "2024-12-31"
    cadence: Literal["monthly"] = "monthly"
    grid_degrees: float = 0.5
    quality_mode: Literal["strict", "relaxed"] = "strict"
    min_valid_obs: int = 15
    seasonal_adjustment: bool = True
    significance_method: Literal["seasonal_mann_kendall", "mann_kendall"] = "seasonal_mann_kendall"

class TimeSeriesPoint(BaseModel):
    date: str
    radiance_raw: Optional[float]
    radiance_normalized: Optional[float]
    tracking_raw: Optional[float]
    tracking_normalized: Optional[float]
    msdi: Optional[float]
    valid_observation: bool
    quality_flag: str
    cloud_free_coverage: float
    weather_wind_speed: Optional[float] = None
    weather_precipitation: Optional[float] = None
    weather_sst: Optional[float] = None

class ExplanationHypothesis(BaseModel):
    id: str
    title: str
    likelihood: Literal["high", "moderate", "low", "unlikely"]
    summary: str
    supporting_evidence: List[str]
    counter_evidence: List[str]
    limitations: List[str]

class ChangeEvent(BaseModel):
    event_id: str
    cell_id: str
    coordinates: List[float]  # [lon, lat]
    cell_bbox: List[float]     # [min_lon, min_lat, max_lon, max_lat]
    area_name: str
    investigation_priority: float  # [0, 1]
    trend_slope: float             # Sen's slope
    slope_unit: str
    p_value: float
    p_value_fdr_adjusted: float
    is_significant: bool
    significance_class: Literal["significant", "not_significant", "insufficient_data", "quality_limited"]
    valid_sample_count: int
    missing_ratio: float
    quality_score: float
    msdi_latest: Optional[float]
    msdi_mean: Optional[float]
    satellite_trend_slope: float
    tracking_trend_slope: float
    top_explanation: str
    suggested_action: str
    caveat: str

class CellGridResult(BaseModel):
    cell_id: str
    coordinates: List[float]  # [lon, lat]
    cell_bbox: List[float]
    investigation_priority: float
    msdi_mean: Optional[float]
    trend_slope: float
    p_value_adjusted: float
    is_significant: bool
    significance_class: str
    quality_score: float

class AnalysisResponse(BaseModel):
    analysis_id: str
    created_at: str
    data_mode: Literal["live", "cached", "demo"]
    region_id: str
    start_date: str
    end_date: str
    grid_degrees: float
    quality_mode: str
    significance_method: str
    seasonal_adjustment: bool
    fdr_correction_applied: bool = True
    total_cells_analyzed: int
    significant_cells_count: int
    events: List[ChangeEvent]
    grid_results: List[CellGridResult]
    warnings: List[str]
    sources: List[Dict[str, str]]

class ChallengeRequest(BaseModel):
    analysis_id: str
    event_id: str
    alternate_start_date: Optional[str] = None
    alternate_end_date: Optional[str] = None
    alternate_baseline: Optional[str] = None  # e.g., "2021-2022" vs "full"
    alternate_min_valid_obs: Optional[int] = None
    alternate_quality_mode: Optional[Literal["strict", "relaxed"]] = None
    alternate_seasonal_adjustment: Optional[bool] = None
    compare_with_neighbors: Optional[bool] = False

class ChallengeMetricComparison(BaseModel):
    metric_name: str
    original_value: Any
    challenged_value: Any
    unit: str
    delta: Optional[float] = None
    changed_materially: bool

class ChallengeResponse(BaseModel):
    analysis_id: str
    event_id: str
    original_slope: float
    challenged_slope: float
    original_significance: str
    challenged_significance: str
    original_sample_count: int
    challenged_sample_count: int
    conclusion_changed: bool
    summary_verdict: str
    metric_comparisons: List[ChallengeMetricComparison]
    neighbor_comparison: Optional[Dict[str, Any]] = None
    caveats: List[str]

class EventDetailResponse(BaseModel):
    event: ChangeEvent
    time_series: List[TimeSeriesPoint]
    explanations: List[ExplanationHypothesis]
    suggested_actions: List[Dict[str, str]]
    data_provenance: Dict[str, Any]
    review_feedback: Optional[Dict[str, Any]] = None

class FeedbackRequest(BaseModel):
    label: Literal["confirmed", "likely_artifact", "seasonal_normal", "inconclusive", "needs_followup"]
    analyst_name: Optional[str] = "Anonymous Analyst"
    notes: Optional[str] = ""

class FeedbackResponse(BaseModel):
    status: str = "success"
    event_id: str
    saved_feedback: Dict[str, Any]
    notice: str = "Recorded for local investigation review. Not validated ground truth."
