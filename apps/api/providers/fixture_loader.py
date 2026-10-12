import json
from pathlib import Path
from typing import Dict, Any
from apps.api.config import settings

class FixtureLoader:
    """Loads and caches the Arabian Sea calibrated demo fixture."""
    
    _cached_data: Dict[str, Any] = None
    
    @classmethod
    def load(cls) -> Dict[str, Any]:
        if cls._cached_data is not None:
            return cls._cached_data
            
        path = Path(settings.demo_data_path)
        if not path.exists():
            # If relative to repo root
            root_path = Path(__file__).resolve().parents[3] / "data" / "demo" / "arabian_sea_fixture.json"
            if root_path.exists():
                path = root_path
            else:
                raise FileNotFoundError(f"Fixture file not found at {path} or {root_path}")
                
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            cls._cached_data = data
            return data
