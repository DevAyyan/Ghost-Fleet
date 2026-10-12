'use client';

import React from 'react';
import { X, Activity, CheckCircle2, AlertTriangle, ShieldCheck, Database, Key, Globe, CloudRain, Satellite } from 'lucide-react';
import { HealthResponse, MetadataResponse } from '@/lib/types';

interface DataStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  health?: HealthResponse | null;
  metadata?: MetadataResponse | null;
}

export const DataStatusModal: React.FC<DataStatusModalProps> = ({
  isOpen,
  onClose,
  health,
  metadata
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-ocean-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-ocean-900 border border-ocean-700 rounded-2xl shadow-2xl my-8 overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ocean-800 bg-ocean-950/70">
          <div className="flex items-center space-x-2.5">
            <div className="h-8 w-8 rounded-lg bg-cyan-600/30 border border-cyan-400/40 flex items-center justify-center">
              <Activity className="h-4 w-4 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide uppercase">
                Data Providers & System Telemetry
              </h2>
              <p className="text-xs text-slate-400">
                NASA Earth Science & Maritime Stream Connectivity Status
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-ocean-800 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-slate-300 text-xs max-h-[80vh] overflow-y-auto">
          
          {/* Security Notice */}
          <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-800/50 flex items-center space-x-3 text-cyan-200">
            <ShieldCheck className="h-5 w-5 text-cyan-400 shrink-0" />
            <div className="text-[11px]">
              <strong className="block font-semibold">Credential Redaction Architecture:</strong>
              API tokens and NASA Earthdata secrets are stored exclusively in backend environment variables and are never transmitted to the browser or logged.
            </div>
          </div>

          {/* Core Service Health */}
          <div className="bg-ocean-950/80 p-4 rounded-xl border border-ocean-800 space-y-2">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Core Backend Service
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Ghost Fleet X FastAPI Analytics Engine</span>
              <span className="flex items-center space-x-1.5 text-xs text-emerald-400 font-mono bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{health?.status?.toUpperCase() ?? 'OPERATIONAL'}</span>
              </span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono">
              Version: {health?.version ?? '1.0.0'} • Service: {health?.service ?? 'Ghost Fleet X API'}
            </div>
          </div>

          {/* Providers List */}
          <div className="space-y-3">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Data Feeds & Integrations
            </div>

            {/* Provider 1: NASA VIIRS */}
            <div className="p-3.5 bg-ocean-950/60 border border-ocean-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Satellite className="h-4 w-4 text-cyan-400" />
                  <span className="font-semibold text-white text-xs">NASA Black Marble / VIIRS Nighttime Lights</span>
                </div>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                  health?.earthdata_configured
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                    : 'bg-amber-950 text-amber-300 border-amber-700'
                }`}>
                  {health?.earthdata_configured ? 'LIVE EARTHDATA STREAM' : 'CALIBRATED DEMO FIXTURE'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Product: NASA VNP46A2 Lunar BRDF-adjusted Radiance (Collection 6.1) via NASA LAADS DAAC. Spatial resolution 0.5°, monthly aggregation.
              </p>
            </div>

            {/* Provider 2: GFW / Maritime Tracking */}
            <div className="p-3.5 bg-ocean-950/60 border border-ocean-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Globe className="h-4 w-4 text-emerald-400" />
                  <span className="font-semibold text-white text-xs">Reported Maritime Tracking Effort</span>
                </div>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                  health?.gfw_configured
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                    : 'bg-amber-950 text-amber-300 border-amber-700'
                }`}>
                  {health?.gfw_configured ? 'LIVE GFW API' : 'CALIBRATED DEMO FIXTURE'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Product: Global Fishing Watch apparent tracking hours / Regional Coastal AIS proxy. Aggregated into matching 0.5° spatial cells.
              </p>
            </div>

            {/* Provider 3: NASA POWER Meteorology */}
            <div className="p-3.5 bg-ocean-950/60 border border-ocean-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <CloudRain className="h-4 w-4 text-purple-400" />
                  <span className="font-semibold text-white text-xs">NASA POWER Meteorological Context</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700">
                  LIVE REST API
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Product: NASA Langley POWER Agroclimatology & Surface Meteorology REST API. Parameters: 10m wind speed (WS10M), precipitation (PRECTOTCORR), surface temperature (TS).
              </p>
            </div>

            {/* Provider 4: NASA GIBS Tile Server */}
            <div className="p-3.5 bg-ocean-950/60 border border-ocean-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Activity className="h-4 w-4 text-blue-400" />
                  <span className="font-semibold text-white text-xs">NASA GIBS EOSDIS Browse Tile Server</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700">
                  LIVE WMTS
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Layer: VIIRS_SNPP_DayNightBand_AtSensor_M15. Rendered browse tiles for visual spatial reference only.
              </p>
            </div>

          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-ocean-950 border-t border-ocean-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-ocean-800 hover:bg-ocean-700 text-white rounded-lg text-xs font-semibold transition"
          >
            Close Telemetry
          </button>
        </div>

      </div>
    </div>
  );
};
