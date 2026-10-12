from typing import List, Optional

def compute_msdi_series(
    normalized_satellite: List[Optional[float]],
    normalized_tracking: List[Optional[float]]
) -> List[Optional[float]]:
    """
    Computes the Maritime Signal Drift Index (MSDI):
    MSDI = normalized_satellite_rate - normalized_tracking_rate
    
    Output range: [-1.0, 1.0].
    Positive MSDI indicates satellite-observed light exceeds tracking-reported presence.
    Negative MSDI indicates tracking activity exceeds satellite radiance signal.
    Returns None if either component is missing, invalid, or uncalibrated.
    """
    if len(normalized_satellite) != len(normalized_tracking):
        raise ValueError("Satellite and tracking series must have identical length.")
        
    msdi_series = []
    for sat, trk in zip(normalized_satellite, normalized_tracking):
        if sat is None or trk is None:
            msdi_series.append(None)
        else:
            diff = sat - trk
            msdi_series.append(round(diff, 4))
            
    return msdi_series
