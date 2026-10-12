'use client';

import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Layers, Eye, Compass, Shield, Maximize2, AlertCircle } from 'lucide-react';
import { CellGridResult, ChangeEvent } from '@/lib/types';

interface MapViewProps {
  gridResults: CellGridResult[];
  selectedEvent: ChangeEvent | null;
  onSelectCell: (cellId: string) => void;
  isLoading: boolean;
}

export const MapView: React.FC<MapViewProps> = ({
  gridResults,
  selectedEvent,
  onSelectCell,
  isLoading
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [showGibs, setShowGibs] = useState<boolean>(false);
  const [showEez, setShowEez] = useState<boolean>(true);

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    // Use free CartoDB Dark Matter tiles (no API key required)
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'carto-dark': {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
              'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
              'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors, © CARTO',
          },
          'nasa-gibs-viirs': {
            type: 'raster',
            tiles: [
              'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_DayNightBand_AtSensor_M15/default/2023-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg'
            ],
            tileSize: 256,
            attribution: 'NASA GIBS EOSDIS',
          }
        },
        layers: [
          {
            id: 'carto-dark-layer',
            type: 'raster',
            source: 'carto-dark',
            minzoom: 0,
            maxzoom: 18,
          },
          {
            id: 'nasa-gibs-layer',
            type: 'raster',
            source: 'nasa-gibs-viirs',
            minzoom: 0,
            maxzoom: 8,
            layout: {
              visibility: 'none'
            },
            paint: {
              'raster-opacity': 0.65
            }
          }
        ],
      },
      center: [66.75, 24.25], // Arabian Sea / Karachi EEZ Focus
      zoom: 7.2,
      maxZoom: 12,
      minZoom: 4,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Toggle NASA GIBS Layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    if (map.getLayer('nasa-gibs-layer')) {
      map.setLayoutProperty('nasa-gibs-layer', 'visibility', showGibs ? 'visible' : 'none');
    }
  }, [showGibs]);

  // Update Grid GeoJSON Source and Layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateGridData = () => {
      // Build GeoJSON FeatureCollection for 0.5 deg grid cells
      const features = gridResults.map((c) => {
        const [minLon, minLat, maxLon, maxLat] = c.cell_bbox;
        const coordinates = [
          [
            [minLon, minLat],
            [maxLon, minLat],
            [maxLon, maxLat],
            [minLon, maxLat],
            [minLon, minLat],
          ],
        ];

        return {
          type: 'Feature' as const,
          id: c.cell_id,
          properties: {
            cell_id: c.cell_id,
            priority: c.investigation_priority,
            slope: c.trend_slope,
            msdi_mean: c.msdi_mean ?? 0,
            p_val: c.p_value_adjusted,
            is_sig: c.is_significant,
            sig_class: c.significance_class,
            quality: c.quality_score,
            is_selected: selectedEvent?.cell_id === c.cell_id,
          },
          geometry: {
            type: 'Polygon' as const,
            coordinates,
          },
        };
      });

      const geojsonData: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features,
      };

      if (map.getSource('grid-cells')) {
        (map.getSource('grid-cells') as maplibregl.GeoJSONSource).setData(geojsonData);
      } else {
        map.addSource('grid-cells', {
          type: 'geojson',
          data: geojsonData,
        });

        // 1. Grid Polygon Fill Layer with Strict Visual Semantics:
        // - Significant Positive: Red/Amber
        // - Significant Negative: Cyan/Emerald
        // - Non-Significant: Muted Slate Gray (NOT colored like significant)
        // - Quality Limited / Insufficient: Subdued Dark Pattern
        map.addLayer({
          id: 'grid-fill',
          type: 'fill',
          source: 'grid-cells',
          paint: {
            'fill-color': [
              'case',
              // Insufficient data or quality limited -> dark neutral
              ['==', ['get', 'sig_class'], 'insufficient_data'], '#1e293b',
              ['==', ['get', 'sig_class'], 'quality_limited'], '#334155',
              // Non-significant -> slate neutral (never encode as significant color!)
              ['!', ['get', 'is_sig']], '#475569',
              // Significant Positive drift -> warm red/orange
              ['>', ['get', 'slope'], 0], '#ef4444',
              // Significant Negative drift -> cyan
              '#06b6d4',
            ],
            'fill-opacity': [
              'case',
              ['get', 'is_selected'], 0.75,
              ['!', ['get', 'is_sig']], 0.25,
              0.55
            ],
          },
        });

        // 2. Grid Outline
        map.addLayer({
          id: 'grid-border',
          type: 'line',
          source: 'grid-cells',
          paint: {
            'line-color': [
              'case',
              ['get', 'is_selected'], '#38bdf8',
              ['!', ['get', 'is_sig']], '#64748b',
              '#0284c7'
            ],
            'line-width': [
              'case',
              ['get', 'is_selected'], 3.0,
              1.2
            ],
          },
        });

        // Click handler on cells
        map.on('click', 'grid-fill', (e) => {
          if (e.features && e.features[0]) {
            const cellId = e.features[0].properties?.cell_id;
            if (cellId) {
              onSelectCell(cellId);
            }
          }
        });

        map.on('mouseenter', 'grid-fill', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'grid-fill', () => {
          map.getCanvas().style.cursor = '';
        });
      }
    };

    if (map.isStyleLoaded()) {
      updateGridData();
    } else {
      map.once('load', updateGridData);
    }
  }, [gridResults, selectedEvent, onSelectCell]);

  return (
    <div className="relative w-full h-full flex-1 min-h-[420px] bg-ocean-950">
      
      {/* MapLibre DOM Container */}
      <div ref={mapContainer} className="w-full h-full" />

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-ocean-950/60 backdrop-blur-sm flex items-center justify-center z-20">
          <div className="glass-panel px-6 py-4 rounded-xl flex items-center space-x-3 text-cyan-300 font-medium">
            <div className="h-5 w-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <span>Recalculating Regional Spatial Grid...</span>
          </div>
        </div>
      )}

      {/* Layer Controls Floating Card */}
      <div className="absolute top-4 left-4 z-10 glass-panel p-2.5 rounded-xl shadow-xl flex flex-col space-y-2 text-xs">
        <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5 pb-1 border-b border-ocean-700/60">
          <Layers className="h-3.5 w-3.5 text-cyan-400" />
          <span>Layer Overlay</span>
        </div>
        
        <label className="flex items-center space-x-2 text-slate-300 hover:text-white cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showGibs}
            onChange={(e) => setShowGibs(e.target.checked)}
            className="h-3.5 w-3.5 accent-cyan-500 rounded"
          />
          <span>NASA GIBS Day/Night Browse</span>
        </label>

        <div className="text-[10px] text-cyan-400/70 pt-0.5 border-t border-ocean-800">
          Resolution: 0.5° Analytical Hex/Grid
        </div>
      </div>

      {/* Visual Semantics & Legend Floating Card */}
      <div className="absolute bottom-6 left-4 z-10 glass-panel p-3 rounded-xl shadow-xl max-w-xs text-xs space-y-2">
        <div className="font-semibold text-slate-200 flex items-center justify-between">
          <span>Map Visual Semantics</span>
          <span className="text-[10px] text-slate-400 font-normal">FDR Adjusted (p &lt; 0.05)</span>
        </div>

        <div className="space-y-1.5 text-[11px]">
          <div className="flex items-center space-x-2">
            <span className="h-3.5 w-5 rounded bg-red-500/80 border border-red-400 shrink-0" />
            <span className="text-slate-200">
              Significant Positive Drift <span className="text-red-400 font-mono">(+MSDI)</span>
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <span className="h-3.5 w-5 rounded bg-cyan-500/80 border border-cyan-400 shrink-0" />
            <span className="text-slate-200">
              Significant Negative Drift <span className="text-cyan-400 font-mono">(-MSDI)</span>
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <span className="h-3.5 w-5 rounded bg-slate-600/50 border border-slate-500 shrink-0" />
            <span className="text-slate-400">
              Non-Significant <span className="font-mono text-slate-400">(Neutral Slate)</span>
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <span className="h-3.5 w-5 rounded bg-slate-800/80 border border-slate-700 shrink-0" />
            <span className="text-slate-400">
              Insufficient Data / Cloud Masked
            </span>
          </div>
        </div>

        <div className="text-[10px] text-slate-400 pt-1.5 border-t border-ocean-700/60 leading-tight">
          Non-significant cells are styled in neutral slate. Color does not imply illegality.
        </div>
      </div>

      {/* Selected Coordinates Banner */}
      {selectedEvent && (
        <div className="absolute top-4 right-14 z-10 glass-panel px-3 py-1.5 rounded-lg text-xs flex items-center space-x-2 border border-cyan-500/40 shadow-lg">
          <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
          <span className="text-cyan-200 font-medium">Selected:</span>
          <span className="text-white font-mono">{selectedEvent.area_name}</span>
          <span className="text-slate-400 text-[10px]">
            [{selectedEvent.coordinates[1]}°N, {selectedEvent.coordinates[0]}°E]
          </span>
        </div>
      )}

    </div>
  );
};
