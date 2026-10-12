from abc import ABC, abstractmethod
from typing import Dict, Any, List

class BaseDataProvider(ABC):
    """Abstract interface for satellite and maritime data providers."""
    
    @abstractmethod
    def get_provider_status(self) -> Dict[str, Any]:
        """Returns provider connectivity and configuration status."""
        pass
        
    @abstractmethod
    async def fetch_series(
        self,
        region_id: str,
        start_date: str,
        end_date: str,
        cadence: str = "monthly"
    ) -> Dict[str, Any]:
        """Fetches raw observations or returns structured fixture."""
        pass
