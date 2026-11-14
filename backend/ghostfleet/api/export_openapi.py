"""Write docs/openapi.json from the live app definition (for frontend type generation)."""
import json
from pathlib import Path

from .main import app

out = Path(__file__).resolve().parents[3] / "docs" / "openapi.json"
out.write_text(json.dumps(app.openapi(), indent=2) + "\n")
print(f"wrote {out}")
