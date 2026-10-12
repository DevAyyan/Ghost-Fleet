from typing import Dict, Any, Tuple

def evaluate_observation_quality(
    point: Dict[str, Any],
    quality_mode: str = "strict",
    min_valid_obs: int = 15
) -> Tuple[bool, float, str]:
    """
    Evaluates whether an observation passes quality thresholds.
    
    Returns:
        (is_valid: bool, quality_score: float, flag_reason: str)
    """
    cloud_free_cov = point.get("cloud_free_coverage", 0.0)
    valid_obs_count = point.get("radiance_valid_obs_count", 0)
    tracking_coverage = point.get("tracking_coverage_ratio", 1.0)
    
    # Base quality score is composite of cloud-free coverage and valid count
    valid_count_score = min(1.0, valid_obs_count / 28.0)
    quality_score = round(0.5 * cloud_free_cov + 0.3 * valid_count_score + 0.2 * tracking_coverage, 3)
    
    if quality_mode == "strict":
        if valid_obs_count < min_valid_obs:
            return False, quality_score, "insufficient_valid_days"
        if cloud_free_cov < 0.40:
            return False, quality_score, "cloud_cover_obscuration"
        if tracking_coverage < 0.30:
            return False, quality_score, "tracking_receiver_gap"
    else:  # relaxed mode
        if valid_obs_count < max(5, min_valid_obs // 2):
            return False, quality_score, "insufficient_valid_days"
        if cloud_free_cov < 0.20:
            return False, quality_score, "severe_cloud_obscuration"
            
    return True, quality_score, "good_quality"
