import logging
import httpx
from typing import Dict, Any, Optional
from apps.api.config import settings

logger = logging.getLogger("ghostfleet.providers.power")

class NasaPowerProvider:
    """
    Client for the NASA POWER REST API (Prediction Of Worldwide Energy Resources).
    Fetches real-time or historical meteorological context (wind speed, precipitation, surface temperature)
    for Arabian Sea coordinates.
    """
    
    def __init__(self):
        self.base_url = settings.nasa_power_api_url
        self._cache: Dict[str, Any] = {}
        
    async def fetch_point_climatology(
        self,
        lat: float,
        lon: float,
        start_year: int = 2021,
        end_year: int = 2024
    ) -> Optional[Dict[str, Any]]:
        cache_key = f"{lat:.2f}_{lon:.2f}_{start_year}_{end_year}"
        if cache_key in self._cache:
            return self._cache[cache_key]
            
        params = {
            "parameters": "WS10M,PRECTOTCORR,TS",
            "community": "RE",
            "longitude": round(lon, 4),
            "latitude": round(lat, 4),
            "start": f"{start_year}0101",
            "end": f"{end_year}1231",
            "format": "JSON"
        }
        
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(self.base_url, params=params)
                if resp.status_code == 200:
                    data = resp.json()
                    self._cache[cache_key] = data
                    logger.info(f"Successfully fetched live NASA POWER data for ({lat}, {lon})")
                    return data
                else:
                    logger.warning(f"NASA POWER API returned status {resp.status_code}")
                    return None
        except Exception as e:
            logger.warning(f"NASA POWER request timed out or failed: {str(e)}. Using cached climatology.")
            return None
