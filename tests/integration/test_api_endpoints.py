import pytest
from fastapi.testclient import TestClient
from apps.api.main import app

client = TestClient(app)

def test_health_endpoint():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert data["demo_fixture_available"] is True

def test_metadata_endpoint():
    resp = client.get("/api/metadata")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["study_regions"]) > 0
    assert data["study_regions"][0]["id"] == "arabian-sea-demo"
    assert len(data["layers"]) >= 3
    assert "ethical_notice" in data

def test_analysis_and_challenge_workflow():
    # 1. Run analysis
    run_payload = {
        "region_id": "arabian-sea-demo",
        "start_date": "2021-01-01",
        "end_date": "2024-12-31",
        "cadence": "monthly",
        "grid_degrees": 0.5,
        "quality_mode": "strict",
        "min_valid_obs": 15,
        "seasonal_adjustment": True,
        "significance_method": "seasonal_mann_kendall"
    }
    run_resp = client.post("/api/analysis/run", json=run_payload)
    assert run_resp.status_code == 200
    analysis = run_resp.json()
    
    assert "analysis_id" in analysis
    analysis_id = analysis["analysis_id"]
    assert len(analysis["events"]) > 0
    assert len(analysis["grid_results"]) == 25
    
    # Check that events have priority, slope, and caveats
    top_event = analysis["events"][0]
    event_id = top_event["event_id"]
    assert top_event["investigation_priority"] > 0
    assert "caveat" in top_event

    # 2. Get event detail
    detail_resp = client.get(f"/api/events/{event_id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert len(detail["time_series"]) == 48
    assert len(detail["explanations"]) > 0
    assert len(detail["suggested_actions"]) > 0

    # 3. Challenge event in Disproof Lab
    challenge_payload = {
        "analysis_id": analysis_id,
        "event_id": event_id,
        "alternate_quality_mode": "relaxed",
        "alternate_min_valid_obs": 8,
        "alternate_start_date": "2022-01-01",
        "compare_with_neighbors": True
    }
    chal_resp = client.post(f"/api/analysis/{analysis_id}/challenge", json=challenge_payload)
    assert chal_resp.status_code == 200
    challenge = chal_resp.json()
    assert "summary_verdict" in challenge
    assert len(challenge["metric_comparisons"]) > 0
    assert challenge["neighbor_comparison"] is not None

    # 4. Submit feedback
    feedback_payload = {
        "label": "confirmed",
        "analyst_name": "Senior Maritime Reviewer",
        "notes": "Verified against Sentinel-1 SAR imagery archive. Priority confirmed."
    }
    fb_resp = client.post(f"/api/events/{event_id}/feedback", json=feedback_payload)
    assert fb_resp.status_code == 200
    fb_data = fb_resp.json()
    assert fb_data["status"] == "success"
    assert "Not validated ground truth" in fb_data["notice"]

    # Re-fetch event detail to ensure feedback is saved
    detail_resp2 = client.get(f"/api/events/{event_id}")
    assert detail_resp2.status_code == 200
    assert detail_resp2.json()["review_feedback"] is not None
