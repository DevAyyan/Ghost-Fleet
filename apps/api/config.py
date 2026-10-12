import os
from pydantic import BaseModel

class Settings(BaseModel):
    app_name: str = "Ghost Fleet X API"
    version: str = "1.0.0"
    environment: str = os.getenv("ENVIRONMENT", "development")
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://0.0.0.0:3000",
        "http://localhost:8000"
    ]
    
    # NASA Credentials (configured only through backend environment variables)
    earthdata_username: str = os.getenv("EARTHDATA_USERNAME", "")
    earthdata_bearer_token: str = os.getenv("EARTHDATA_BEARER_TOKEN", "")
    
    # NASA POWER & GIBS Endpoints
    nasa_power_api_url: str = os.getenv(
        "NASA_POWER_API_URL",
        "https://power.larc.nasa.gov/api/temporal/daily/point"
    )
    nasa_gibs_wmts_url: str = os.getenv(
        "NASA_GIBS_WMTS_URL",
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"
    )
    
    # Maritime Activity Provider (e.g. Global Fishing Watch)
    gfw_api_key: str = os.getenv("GFW_API_KEY", "")
    gfw_api_url: str = os.getenv("GFW_API_URL", "https://gateway.api.globalfishingwatch.org/v3")
    
    # Storage Paths
    demo_data_path: str = os.getenv("DEMO_DATA_PATH", "data/demo/arabian_sea_fixture.json")
    feedback_storage_path: str = os.getenv("FEEDBACK_STORAGE_PATH", "data/processed/analyst_feedback.json")
    cache_dir: str = os.getenv("CACHE_DIR", "data/processed/cache")
    
    def get_public_metadata_status(self) -> dict:
        """Returns safe provider connection statuses without exposing credentials."""
        return {
            "nasa_earthdata": {
                "configured": bool(self.earthdata_bearer_token or self.earthdata_username),
                "mode": "live" if (self.earthdata_bearer_token or self.earthdata_username) else "demo_fixture",
                "product": "NASA VNP46A2 VIIRS Nighttime Radiance Proxy (LAADS DAAC)",
                "resolution": "0.5° spatial, monthly aggregation",
                "units": "nW/(cm^2*sr)"
            },
            "nasa_power": {
                "configured": True,  # Free public REST endpoint
                "mode": "live_or_cached",
                "product": "NASA POWER Meteorological & Ocean Surface Context",
                "resolution": "Point/Grid daily context aggregated to monthly",
                "units": "wind speed (m/s), precip (mm/day), sst (°C)"
            },
            "nasa_gibs": {
                "configured": True,
                "mode": "live_wmts",
                "product": "NASA GIBS Global Imagery Browse Services",
                "role": "visual_context_only"
            },
            "maritime_tracking": {
                "configured": bool(self.gfw_api_key),
                "mode": "live" if bool(self.gfw_api_key) else "demo_fixture",
                "provider": "Global Fishing Watch / Regional Tracking Proxy",
                "resolution": "0.5° spatial, monthly aggregation",
                "units": "apparent tracking effort / presence hours"
            }
        }

settings = Settings()
