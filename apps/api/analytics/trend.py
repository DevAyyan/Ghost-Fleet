from typing import List, Optional, Dict, Any, Tuple
import numpy as np
import pymannkendall as mk

def compute_trend(
    series: List[Optional[float]],
    dates: List[str],
    seasonal_adjustment: bool = True,
    period: int = 12,
    min_obs_threshold: int = 24,
    avg_quality: float = 1.0
) -> Dict[str, Any]:
    """
    Computes robust Sen's slope and Mann-Kendall / Seasonal Mann-Kendall monotonic test.
    Handles missing values and provides clear statistical classification.
    """
    # Extract valid paired points
    indexed_vals = [(i, v) for i, v in enumerate(series) if v is not None and not np.isnan(v)]
    valid_count = len(indexed_vals)
    total_count = len(series)
    missing_ratio = round(1.0 - (valid_count / max(1, total_count)), 3)
    
    # Check minimum observation requirement
    if valid_count < min_obs_threshold:
        return {
            "slope": 0.0,
            "slope_unit": "index_drift/month",
            "p_value": 1.0,
            "is_significant": False,
            "significance_class": "insufficient_data",
            "valid_sample_count": valid_count,
            "missing_ratio": missing_ratio,
            "trend_direction": "no_trend",
            "caveat": f"Insufficient valid records ({valid_count} < required {min_obs_threshold}) for robust trend inference."
        }
        
    if avg_quality < 0.35:
        return {
            "slope": 0.0,
            "slope_unit": "index_drift/month",
            "p_value": 1.0,
            "is_significant": False,
            "significance_class": "quality_limited",
            "valid_sample_count": valid_count,
            "missing_ratio": missing_ratio,
            "trend_direction": "no_trend",
            "caveat": "Persistent sensor noise or cloud cover severely limits observational confidence."
        }

    # Extract non-null array for test
    y = np.array([v for _, v in indexed_vals], dtype=float)
    
    # Handle zero variance
    if np.all(y == y[0]):
        return {
            "slope": 0.0,
            "slope_unit": "index_drift/month",
            "p_value": 1.0,
            "is_significant": False,
            "significance_class": "not_significant",
            "valid_sample_count": valid_count,
            "missing_ratio": missing_ratio,
            "trend_direction": "no_trend",
            "caveat": "Stationary invariant series."
        }

    try:
        if seasonal_adjustment and valid_count >= period * 2:
            # Full series with period requires seasonal alignment; if gaps exist, impute via forward fill or fall back to standard MK
            # Construct complete series with linear interpolation for seasonal MK if small gaps exist
            full_y = []
            last_val = indexed_vals[0][1]
            idx_dict = dict(indexed_vals)
            for i in range(total_count):
                if i in idx_dict:
                    last_val = idx_dict[i]
                full_y.append(last_val)
                
            res = mk.seasonal_test(np.array(full_y), period=period)
        else:
            res = mk.original_test(y)
            
        slope = float(res.slope)
        p_val = float(res.p)
        trend_dir = str(res.trend)
        is_sig = p_val < 0.05
        
        return {
            "slope": round(slope, 6),
            "slope_unit": "index_drift/month",
            "p_value": round(p_val, 5),
            "is_significant": is_sig,
            "significance_class": "significant" if is_sig else "not_significant",
            "valid_sample_count": valid_count,
            "missing_ratio": missing_ratio,
            "trend_direction": trend_dir,
            "caveat": "Standardized non-parametric trend test. Significance does not imply causality."
        }
    except Exception as e:
        return {
            "slope": 0.0,
            "slope_unit": "index_drift/month",
            "p_value": 1.0,
            "is_significant": False,
            "significance_class": "insufficient_data",
            "valid_sample_count": valid_count,
            "missing_ratio": missing_ratio,
            "trend_direction": "error",
            "caveat": f"Computation failure in trend test: {str(e)}"
        }

def benjamini_hochberg_fdr(p_values: List[float], alpha: float = 0.05) -> Tuple[List[float], List[bool]]:
    """
    Benjamini-Hochberg False Discovery Rate (FDR) procedure for multiple testing correction.
    Returns:
        (adjusted_p_values, significant_flags)
    """
    m = len(p_values)
    if m == 0:
        return [], []
        
    # Sort indices by p-value
    sorted_indices = sorted(range(m), key=lambda i: p_values[i])
    sorted_p = [p_values[i] for i in sorted_indices]
    
    # Calculate adjusted p-values: p_adj = min(1.0, p * m / rank)
    adj_p_sorted = [0.0] * m
    for rank_idx, p in enumerate(sorted_p):
        rank = rank_idx + 1
        adj_p_sorted[rank_idx] = min(1.0, p * m / rank)
        
    # Ensure monotonicity from right to left: adj_p[i] = min(adj_p[i], adj_p[i+1])
    for i in range(m - 2, -1, -1):
        adj_p_sorted[i] = min(adj_p_sorted[i], adj_p_sorted[i + 1])
        
    # Map back to original order
    adj_p = [0.0] * m
    for sorted_pos, orig_idx in enumerate(sorted_indices):
        adj_p[orig_idx] = round(adj_p_sorted[sorted_pos], 5)
        
    sig_flags = [p <= alpha for p in adj_p]
    return adj_p, sig_flags
