'use client';

import React from 'react';
import { Play, RotateCcw, Filter, Calendar, Grid, Sparkles, AlertCircle, Compass } from 'lucide-react';
import { AnalysisRequest } from '@/lib/types';

interface ControlRailProps {
  request: AnalysisRequest;
  onChangeRequest: (req: AnalysisRequest) => void;
  onRunScan: () => void;
  isLoading: boolean;
  onResetDefaults: () => void;
}

export const ControlRail: React.FC<ControlRailProps> = ({
  request,
  onChangeRequest,
  onRunScan,
  isLoading,
  onResetDefaults
}) => {
  return (
    <aside className="w-full lg:w-80 flex flex-col space-y-4 bg-ocean-900/90 border-r border-ocean-800 p-4 shrink-0 overflow-y-auto">
      
      {/* Region Card */}
      <div className="glass-panel-subtle rounded-xl p-3.5 space-y-2 border border-cyan-900/30">
        <div className="flex items-center justify-between text-xs font-semibold text-cyan-300 uppercase tracking-wider">
          <span className="flex items-center space-x-1.5">
            <Compass className="h-4 w-4 text-cyan-400" />
            <span>Study Region</span>
          </span>
          <span className="text-[10px] bg-cyan-950 text-cyan-300 px-2 py-0.5 rounded border border-cyan-800">
            0.5° Grid
          </span>
        </div>
        <div className="text-sm font-medium text-white">
          Arabian Sea (Karachi Coast & EEZ)
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Covers Karachi approaches, Indus Delta mangrove shelf, and transboundary marine waters [23.0°N–25.5°N, 65.5°E–68.0°E].
        </p>
      </div>

      {/* Primary Temporal Controls */}
      <div className="glass-panel-subtle rounded-xl p-3.5 space-y-3">
        <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider">
          <Calendar className="h-4 w-4 text-cyan-400" />
          <span>Observation Time Window</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Start Date</label>
            <input
              type="date"
              value={request.start_date}
              min="2021-01-01"
              max="2024-11-01"
              onChange={(e) => onChangeRequest({ ...request, start_date: e.target.value })}
              className="w-full bg-ocean-950 border border-ocean-700 rounded-lg px-2 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">End Date</label>
            <input
              type="date"
              value={request.end_date}
              min="2021-02-01"
              max="2024-12-31"
              onChange={(e) => onChangeRequest({ ...request, end_date: e.target.value })}
              className="w-full bg-ocean-950 border border-ocean-700 rounded-lg px-2 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="text-[11px] text-cyan-300/80 bg-cyan-950/40 p-2 rounded-lg border border-cyan-900/50 flex items-center justify-between">
          <span>Aggregation Cadence:</span>
          <span className="font-semibold text-cyan-200 uppercase font-mono">Monthly (48 Periods)</span>
        </div>
      </div>

      {/* Quality Masks & Methodology Parameters */}
      <div className="glass-panel-subtle rounded-xl p-3.5 space-y-3">
        <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider">
          <Filter className="h-4 w-4 text-cyan-400" />
          <span>Quality Filters & Controls</span>
        </div>

        {/* Quality Mode Toggle */}
        <div>
          <label className="text-[11px] text-slate-400 block mb-1.5">Observation Quality Filter</label>
          <div className="grid grid-cols-2 gap-1.5 bg-ocean-950 p-1 rounded-lg border border-ocean-800">
            <button
              type="button"
              onClick={() => onChangeRequest({ ...request, quality_mode: 'strict', min_valid_obs: 15 })}
              className={`py-1 px-2 rounded-md text-xs font-medium transition ${
                request.quality_mode === 'strict'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Strict (≥15d, &lt;40% cloud)
            </button>
            <button
              type="button"
              onClick={() => onChangeRequest({ ...request, quality_mode: 'relaxed', min_valid_obs: 8 })}
              className={`py-1 px-2 rounded-md text-xs font-medium transition ${
                request.quality_mode === 'relaxed'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Relaxed (≥8d, &lt;80% cloud)
            </button>
          </div>
        </div>

        {/* Seasonal Adjustment Toggle */}
        <div className="flex items-center justify-between pt-1 border-t border-ocean-800 text-xs">
          <div>
            <div className="text-slate-300 font-medium">Seasonal Adjustment</div>
            <div className="text-[10px] text-slate-400">Seasonal Mann-Kendall (12-mo)</div>
          </div>
          <input
            type="checkbox"
            checked={request.seasonal_adjustment}
            onChange={(e) => onChangeRequest({ ...request, seasonal_adjustment: e.target.checked })}
            className="h-4 w-4 accent-cyan-500 rounded cursor-pointer"
          />
        </div>

        {/* Multiple Testing Note */}
        <div className="text-[10px] text-slate-400 leading-normal pt-1 border-t border-ocean-800">
          <span className="text-cyan-400 font-medium">FDR Correction:</span> Benjamini-Hochberg applied across all grid cells to limit false discoveries.
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 pt-2">
        <button
          onClick={onRunScan}
          disabled={isLoading}
          className={`w-full py-3 px-4 rounded-xl font-semibold text-sm flex items-center justify-center space-x-2 transition shadow-lg ${
            isLoading
              ? 'bg-cyan-900 text-cyan-300 cursor-not-allowed border border-cyan-700/50'
              : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-cyan-500/25 border border-cyan-400/40 active:scale-[0.98]'
          }`}
        >
          {isLoading ? (
            <>
              <div className="h-4 w-4 border-2 border-cyan-300 border-t-transparent rounded-full animate-spin" />
              <span>Evaluating Statistical Drift...</span>
            </>
          ) : (
            <>
              <Play className="h-4 w-4 fill-white" />
              <span>Scan for Changes</span>
            </>
          )}
        </button>

        <button
          onClick={onResetDefaults}
          disabled={isLoading}
          className="w-full py-2 px-3 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-ocean-800/60 border border-ocean-800 flex items-center justify-center space-x-1.5 transition"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Reset Demo Parameters</span>
        </button>
      </div>

      {/* Safeguard Disclaimer Footer */}
      <div className="mt-auto pt-3 border-t border-ocean-800/80">
        <p className="text-[10px] text-slate-400 leading-relaxed text-center">
          Ghost Fleet X is a research decision-support tool. An unmatched signal is never proof of illegal activity.
        </p>
      </div>

    </aside>
  );
};
