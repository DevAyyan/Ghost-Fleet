#!/usr/bin/env bash
# Fetch credential-free open datasets for the Ghost Fleet X study area.
# Study area: 20-26N, 56-70E (Pakistan EEZ, Gulf of Oman, Karachi coast).
# Output: data/raw/<source>/...   (gitignored; re-run to reproduce)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=data/raw
mkdir -p "$OUT"/{chlorophyll,sst,power,boundaries}
ERDDAP=https://coastwatch.pfeg.noaa.gov/erddap/griddap
LAT="(20):2:(26)"; LON="(56):2:(70)"   # stride 2 on 4 km grid -> ~8 km

fetch() { # url dest
  if [[ -s "$2" ]]; then echo "skip  $2"; return; fi
  echo "fetch $2"
  curl -sSfL --retry 3 -m 3600 -o "$2.part" "$1" && mv "$2.part" "$2"
}

# NASA MODIS-Aqua L3 chlorophyll-a, monthly, 4 km strided to ~8 km (OBPG R2022 science quality), via NOAA ERDDAP
fetch "$ERDDAP/erdMH1chlamday_R2022SQ.nc?chlor_a%5B(2020-01-16):1:(last)%5D%5B$LAT%5D%5B$LON%5D" \
      "$OUT/chlorophyll/modis_aqua_chla_monthly_8km_2020-.nc"
# Near-real-time continuation (covers months after the science-quality series ends)
fetch "$ERDDAP/erdMH1chlamday_R2022NRT.nc?chlorophyll%5B(2025-01-16):1:(last)%5D%5B$LAT%5D%5B$LON%5D" \
      "$OUT/chlorophyll/modis_aqua_chla_monthly_8km_nrt_2025-.nc"

# NASA JPL MUR SST v4.1, monthly; strided 10 -> 0.1 deg (~11 km)
fetch "$ERDDAP/jplMURSST41mday.nc?sst%5B(2020-01-16):1:(last)%5D%5B(20):10:(26)%5D%5B(56):10:(70)%5D" \
      "$OUT/sst/mur_sst_monthly_0p1_2020-.nc"

# NASA POWER monthly meteorology (MERRA-2/CERES based, ~0.5 deg).
# The regional endpoint takes ONE parameter per request and spans of at most 10 deg -> loop both.
for param in WS10M CLOUD_AMT PRECTOTCORR T2M; do
  for tile in "56 63" "63 70"; do
    set -- $tile
    fetch "https://power.larc.nasa.gov/api/temporal/monthly/regional?parameters=$param&community=RE&latitude-min=20&latitude-max=26&longitude-min=$1&longitude-max=$2&start=2020&end=2025&format=CSV" \
          "$OUT/power/power_${param}_monthly_${1}E-${2}E_2020-2025.csv"
  done
done

# EEZ boundaries intersecting the study box (Marine Regions WFS)
fetch "https://geo.vliz.be/geoserver/MarineRegions/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=MarineRegions:eez&bbox=56,20,70,26&outputFormat=application/json" \
      "$OUT/boundaries/eez_arabian_sea.geojson"

echo "done"; du -sh "$OUT"/*
