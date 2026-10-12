#!/usr/bin/env python3
"""
Ghost Fleet X — NASA Earth Science Live Fetch Utility
Demonstrates authenticated queries to NASA Earthdata (LAADS DAAC) and
the NASA POWER REST API for Arabian Sea meteorological context.
"""

import os
import sys
import argparse
import asyncio
import httpx
from datetime import datetime

def parse_args():
    parser = argparse.ArgumentParser(description="Fetch live NASA Earth Science observations.")
    parser.add_argument("--source", choices=["power", "laads", "all"], default="power",
                        help="Data source to query: 'power' (NASA POWER API), 'laads' (NASA LAADS DAAC), or 'all'")
    parser.add_argument("--lat", type=float, default=24.5, help="Latitude (default: 24.5°N)")
    parser.add_argument("--lon", type=float, default=66.5, help="Longitude (default: 66.5°E)")
    parser.add_argument("--start", type=str, default="20230101", help="Start date YYYYMMDD")
    parser.add_argument("--end", type=str, default="20231231", help="End date YYYYMMDD")
    return parser.parse_args()

async def fetch_nasa_power(lat: float, lon: float, start: str, end: str):
    """Queries NASA POWER REST API for wind speed, precipitation, and temperature."""
    url = "https://power.larc.nasa.gov/api/temporal/daily/point"
    params = {
        "parameters": "WS10M,PRECTOTCORR,TS",
        "community": "RE",
        "longitude": round(lon, 4),
        "latitude": round(lat, 4),
        "start": start,
        "end": end,
        "format": "JSON"
    }
    print(f"\n[NASA POWER API] Querying {url} for coordinates ({lat}°N, {lon}°E)...")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params)
            if resp.status_code == 200:
                data = resp.json()
                props = data.get("properties", {}).get("parameter", {})
                wind = props.get("WS10M", {})
                precip = props.get("PRECTOTCORR", {})
                print(f"[NASA POWER API] Success! Received {len(wind)} daily observations.")
                dates = sorted(list(wind.keys()))
                if dates:
                    sample_d = dates[-1]
                    print(f"  Sample Date {sample_d}: Wind = {wind[sample_d]} m/s, Precip = {precip.get(sample_d)} mm/day")
                return data
            else:
                print(f"[NASA POWER API] Failed with HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        print(f"[NASA POWER API] Request error: {str(e)}")
    return None

async def query_nasa_laads(token: str, lat: float, lon: float):
    """
    Queries NASA LAADS DAAC for VNP46A2 VIIRS granules using Bearer token.
    Demonstrates bearer token query without leaking secrets.
    """
    print("\n[NASA LAADS DAAC] Verifying Earthdata Bearer Token authentication...")
    if not token:
        print("[NASA LAADS DAAC] No EARTHDATA_BEARER_TOKEN set. Use DEMO fixture or set in environment.")
        return
    
    headers = {"Authorization": f"Bearer {token[:4]}...[REDACTED]"}
    print(f"[NASA LAADS DAAC] Authenticated request configured with masked token: {headers['Authorization']}")
    # CMR search for VNP46A2
    cmr_url = "https://cmr.earthdata.nasa.gov/search/granules.json"
    params = {
        "short_name": "VNP46A2",
        "bounding_box": f"{lon-0.5},{lat-0.5},{lon+0.5},{lat+0.5}",
        "page_size": 5
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(cmr_url, params=params, headers={"Authorization": f"Bearer {token}"})
            print(f"[NASA CMR Search] Response status: {resp.status_code}")
            if resp.status_code == 200:
                feed = resp.json().get("feed", {})
                entries = feed.get("entry", [])
                print(f"[NASA CMR Search] Found {len(entries)} matching VNP46A2 granules in study cell.")
                for entry in entries[:3]:
                    print(f"  Granule: {entry.get('title')} (Size: {entry.get('granule_size')} MB)")
    except Exception as e:
        print(f"[NASA CMR Search] Query error: {str(e)}")

async def main():
    args = parse_args()
    print("=" * 65)
    print("Ghost Fleet X — NASA Earth Science Ingestion Adapter")
    print(f"Study Area: Arabian Sea [{args.lat}°N, {args.lon}°E]")
    print(f"Date Range: {args.start} to {args.end}")
    print("=" * 65)

    if args.source in ("power", "all"):
        await fetch_nasa_power(args.lat, args.lon, args.start, args.end)

    if args.source in ("laads", "all"):
        token = os.environ.get("EARTHDATA_BEARER_TOKEN", "")
        await query_nasa_laads(token, args.lat, args.lon)

if __name__ == "__main__":
    asyncio.run(main())
