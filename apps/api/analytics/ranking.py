from typing import Dict, Any

def compute_investigation_priority(
    abs_slope: float,
    max_regional_slope: float,
    p_adj: float,
    valid_count: int,
    total_months: int,
    quality_score: float
) -> float:
    """
    Computes an interpretable, transparent investigation priority score [0.0, 1.0].
    
    Components:
    - Trend magnitude (35%): relative to maximum observed slope in regional cohort
    - Persistence (25%): fraction of valid months observed
    - Statistical evidence (25%): 1 - adjusted p-value (clamped to 0 if not significant)
    - Data quality score (15%): composite cloud & observation flag reliability
    
    CRITICAL ETHICAL SAFEGUARD:
    This score indicates priority for human analyst investigation,
    NEVER probability of guilt or confirmed illegal conduct.
    """
    # 1. Magnitude component (0 to 1)
    norm_mag = min(1.0, abs_slope / max(1e-5, max_regional_slope))
    
    # 2. Persistence component (0 to 1)
    persistence = min(1.0, valid_count / max(1, total_months))
    
    # 3. Statistical evidence component (0 to 1)
    # If p_adj < 0.05, scales from 0.5 to 1.0; if >= 0.05, remains low
    if p_adj <= 0.05:
        stat_evidence = 1.0 - (p_adj * 10)  # p=0.001 -> ~0.99, p=0.05 -> 0.50
    else:
        stat_evidence = max(0.0, 0.5 - (p_adj * 0.5))
    stat_evidence = max(0.0, min(1.0, stat_evidence))
    
    # 4. Data quality score component (0 to 1)
    qual = max(0.0, min(1.0, quality_score))
    
    # Composite priority
    priority = (
        0.35 * norm_mag +
        0.25 * persistence +
        0.25 * stat_evidence +
        0.15 * qual
    )
    
    return round(float(priority), 3)
