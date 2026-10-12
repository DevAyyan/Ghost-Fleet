import json
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime, timezone
from apps.api.config import settings

class LocalStore:
    """Manages local storage for analyst feedback and analysis cache."""
    
    @staticmethod
    def _get_path() -> Path:
        path = Path(settings.feedback_storage_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path
        
    @classmethod
    def get_feedback(cls, event_id: str) -> Optional[Dict[str, Any]]:
        path = cls._get_path()
        if not path.exists():
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get(event_id)
        except Exception:
            return None
            
    @classmethod
    def save_feedback(cls, event_id: str, label: str, analyst_name: str, notes: str) -> Dict[str, Any]:
        path = cls._get_path()
        data = {}
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = {}
                
        record = {
            "event_id": event_id,
            "label": label,
            "analyst_name": analyst_name,
            "notes": notes,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "notice": "Recorded for local investigation review. Not validated ground truth."
        }
        data[event_id] = record
        
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            
        return record
