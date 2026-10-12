from typing import List, Optional
import numpy as np

def normalize_series_minmax(
    values: List[Optional[float]],
    min_val: Optional[float] = None,
    max_val: Optional[float] = None
) -> List[Optional[float]]:
    """
    Normalizes a numerical list to a documented [0, 1] scale.
    If min_val and max_val are not provided, uses 5th and 95th percentiles
    of valid values to be robust against single-frame transient flashes.
    Clamps output to [0.0, 1.0].
    Preserves None for invalid/missing observations.
    """
    valid_nums = [v for v in values if v is not None and not np.isnan(v)]
    if not valid_nums:
        return [None for _ in values]
    
    if min_val is None:
        min_val = float(np.percentile(valid_nums, 5))
    if max_val is None:
        max_val = float(np.percentile(valid_nums, 95))
        
    range_span = max_val - min_val
    if range_span <= 1e-6:
        # Constant series or zero variance
        return [0.5 if (v is not None and not np.isnan(v)) else None for v in values]
        
    normalized = []
    for v in values:
        if v is None or np.isnan(v):
            normalized.append(None)
        else:
            scaled = (v - min_val) / range_span
            clamped = float(np.clip(scaled, 0.0, 1.0))
            normalized.append(round(clamped, 4))
            
    return normalized
