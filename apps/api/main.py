import os
import sys
from pathlib import Path

# Ensure workspace root is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import logging
from fastapi import FastAPI, HTTPException, Path as FastApiPath
from fastapi.middleware.cors import CORSMiddleware

from apps.api.config import settings
from apps.api.models.schemas import (
    HealthResponse,
    MetadataResponse,
    StudyRegion,
    LayerMetadata,
    AnalysisRequest,
    AnalysisResponse,
    ChallengeRequest,
    ChallengeResponse,
    EventDetailResponse,
    FeedbackRequest,
    FeedbackResponse
)
from apps.api.analytics.pipeline import AnalysisPipeline
from apps.api.storage.local_store import LocalStore
from apps.api.providers.fixture_loader import FixtureLoader

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("ghostfleet.api")

app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description="Ghost Fleet X Maritime Change-Intelligence API — NASA Earth Science & Maritime Activity Analytics"
)

# Enable CORS for local Next.js frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins for local hackathon development & Docker
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.get("/api/health", response_model=HealthResponse)
def get_health():
    """Health check endpoint. Never leaks secret credentials."""
    fixture_ok = False
    try:
        FixtureLoader.load()
        fixture_ok = True
    except Exception:
        pass
        
    return HealthResponse(
        status="healthy",
        version=settings.version,
        service=settings.app_name,
        earthdata_configured=bool(settings.earthdata_bearer_token or settings.earthdata_username),
        gfw_configured=bool(settings.gfw_api_key),
        demo_fixture_available=fixture_ok
    )

@app.get("/api/metadata", response_model=MetadataResponse)
def get_metadata():
    """Metadata detailing study region, available layers, units, citations, and caveats."""
    study_regions = [
        StudyRegion(
            id="arabian-sea-demo",
            name="Arabian Sea (Karachi Coast & Pakistan EEZ)",
            description="Northern Arabian Sea study zone covering Karachi shelf fisheries, Indus Delta mangroves, and transboundary shelf zones.",
            bbox=[65.5, 23.0, 68.0, 25.5],
            center=[66.75, 24.25],
            default_zoom=7.0
        )
    ]
    
    layers = [
        LayerMetadata(
            id="viirs_nightlights",
            name="Nighttime Radiance Activity Proxy",
            product_identifier="NASA VNP46A2 Lunar BRDF-adjusted Nighttime Lights",
            provider="NASA LAADS DAAC",
            mode="live" if (settings.earthdata_bearer_token or settings.earthdata_username) else "demo_fixture",
            units="nW/(cm^2*sr)",
            resolution="0.5° spatial aggregate, monthly cadence",
            temporal_coverage="2021-01 to 2024-12",
            quality_fields=["Mandatory_Quality_Flag", "Cloud_Mask", "Moon_Illumination_Fraction"],
            citation="Román et al. (2018), NASA Black Marble VNP46A2",
            disclaimer="Proxy for illuminated maritime activity. Does NOT represent definitive vessel detections or confirmation of illegality."
        ),
        LayerMetadata(
            id="maritime_tracking",
            name="Reported Maritime Tracking Effort",
            product_identifier="Global Fishing Watch Apparent Tracking / Regional AIS Proxy",
            provider="Global Fishing Watch / Regional Tracking",
            mode="live" if bool(settings.gfw_api_key) else "demo_fixture",
            units="apparent presence / tracking hours",
            resolution="0.5° spatial aggregate, monthly cadence",
            temporal_coverage="2021-01 to 2024-12",
            quality_fields=["Receiver_Coverage_Ratio", "Transponder_Uptime"],
            citation="Global Fishing Watch API v3",
            disclaimer="Monitors vessels equipped with broadcasting transponders. Does not mandate small non-AIS artisanal crafts."
        ),
        LayerMetadata(
            id="nasa_power_weather",
            name="NASA POWER Meteorological Context",
            product_identifier="NASA POWER Agroclimatology & Surface Meteorology",
            provider="NASA Langley Research Center",
            mode="live",
            units="wind speed (m/s), precipitation (mm/day), sea surface temp (°C)",
            resolution="Point / Grid monthly context",
            temporal_coverage="2021-01 to 2024-12",
            quality_fields=["Climatology_Confidence", "Spatial_Interpolation"],
            citation="NASA Prediction of Worldwide Energy Resources (POWER) Project",
            disclaimer="Contextual environmental observations. Not a substitute for satellite cloud quality flags."
        ),
        LayerMetadata(
            id="nasa_gibs_wmts",
            name="NASA GIBS Day/Night & Satellite Imagery",
            product_identifier="VIIRS_SNPP_DayNightBand_AtSensor_M15",
            provider="NASA GIBS / EOSDIS",
            mode="live_wmts",
            units="visual browse imagery",
            resolution="Dynamic web tile resolution",
            temporal_coverage="Daily continuous",
            quality_fields=[],
            citation="NASA GIBS EOSDIS",
            disclaimer="Rendered visualization tiles for visual reference only. Not used for quantitative statistical calculations."
        )
    ]
    
    return MetadataResponse(
        study_regions=study_regions,
        layers=layers
    )

@app.post("/api/analysis/run", response_model=AnalysisResponse)
async def run_analysis(request: AnalysisRequest):
    """Executes the change intelligence pipeline across the study region."""
    try:
        response = await AnalysisPipeline.run(request)
        return response
    except Exception as e:
        logger.error(f"Analysis failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis pipeline error: {str(e)}")

@app.get("/api/analysis/{analysis_id}", response_model=AnalysisResponse)
def get_analysis_state(analysis_id: str):
    """Retrieves cached analysis results."""
    res = AnalysisPipeline.get_analysis(analysis_id)
    if not res:
        raise HTTPException(status_code=404, detail=f"Analysis {analysis_id} not found.")
    return res

@app.post("/api/analysis/{analysis_id}/challenge", response_model=ChallengeResponse)
async def challenge_analysis(analysis_id: str, challenge_req: ChallengeRequest):
    """Disproof Lab: Re-evaluates sensitivity parameters to test if results survive challenge."""
    if challenge_req.analysis_id != analysis_id:
        challenge_req.analysis_id = analysis_id
    try:
        res = await AnalysisPipeline.run_challenge(challenge_req)
        return res
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Challenge execution failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Disproof execution error: {str(e)}")

@app.get("/api/events/{event_id}", response_model=EventDetailResponse)
def get_event_detail(event_id: str):
    """Retrieves detailed event evidence, time series, hypotheses, and proportionate actions."""
    detail = AnalysisPipeline.get_event_detail(event_id)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Event {event_id} not found.")
    return detail

@app.post("/api/events/{event_id}/feedback", response_model=FeedbackResponse)
def submit_feedback(event_id: str, feedback: FeedbackRequest):
    """Stores analyst review feedback in local development storage."""
    record = LocalStore.save_feedback(
        event_id=event_id,
        label=feedback.label,
        analyst_name=feedback.analyst_name or "Anonymous Analyst",
        notes=feedback.notes or ""
    )
    return FeedbackResponse(
        status="success",
        event_id=event_id,
        saved_feedback=record
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("apps.api.main:app", host=settings.host, port=settings.port, reload=settings.debug)
