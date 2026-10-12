'use client';

import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle, ArrowRight, RefreshCw, Layers, CheckCircle2, XCircle, Info, Sparkles } from 'lucide-react';
import { ChangeEvent, ChallengeResponse } from '@/lib/types';
import { challengeEvent } from '@/lib/api';

interface DisproofLabProps {
  analysisId: string;
  event: ChangeEvent;
  onChallengeSuccess?: (res: ChallengeResponse) => void;
}

export const DisproofLab: React.FC<DisproofLabProps> = ({
  analysisId,
  event,
  onChallengeSuccess
}) => {
  const [altStartDate, setAltStartDate] = useState<string>('2022-01-01');
  const [altEndDate, setAltEndDate] = useState<string>('2024-12-31');
  const [altMinObs, setAltMinObs] = useState<number>(20);
  const [altQualityMode, setAltQualityMode] = useState<'strict' | 'relaxed'>('strict');
  const [altSeasonal, setAltSeasonal] = useState<boolean>(false);
  const [compareNeighbors, setCompareNeighbors] = useState<boolean>(true);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [challengeResult, setChallengeResult] = useState<ChallengeResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRunChallenge = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await challengeEvent({
        analysis_id: analysisId,
        event_id: event.event_id,
        alternate_start_date: altStartDate,
        alternate_end_date: altEndDate,
        alternate_min_valid_obs: altMinObs,
        alternate_quality_mode: altQualityMode,
        alternate_seasonal_adjustment: altSeasonal,
        compare_with_neighbors: compareNeighbors
      });
      setChallengeResult(res);
      if (onChallengeSuccess) {
        onChallengeSuccess(res);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Disproof lab execution failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Introduction Banner */}
      <div className="bg-ocean-950/80 border border-ocean-800 rounded-xl p-3 flex items-start space-x-3">
        <div className="p-2 rounded-lg bg-cyan-950 border border-cyan-800/60 text-cyan-400 shrink-0 mt-0.5">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="text-xs space-y-1">
          <div className="font-semibold text-white flex items-center space-x-2">
            <span>Disproof Lab • Sensitivity & Stress Testing</span>
            <span className="text-[10px] bg-cyan-900/60 text-cyan-300 px-2 py-0.5 rounded border border-cyan-700/50">
              Hypothesis Stress-Test
            </span>
          </div>
          <p className="text-slate-300 leading-relaxed">
            Test whether this observed drift is genuine or an artifact of temporal windowing, cloud filtering thresholds, or regional autocorrelation. Alter the parameters below to challenge the conclusion.
          </p>
        </div>
      </div>

      {/* Control Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        
        {/* Param 1: Alternate Date Window */}
        <div className="bg-ocean-950/60 border border-ocean-800/80 rounded-xl p-3 space-y-2">
          <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider block">
            Alternate Window
          </label>
          <div className="space-y-1.5 text-xs">
            <div>
              <span className="text-[10px] text-slate-400 block">Start Window</span>
              <input
                type="date"
                value={altStartDate}
                onChange={(e) => setAltStartDate(e.target.value)}
                className="w-full bg-ocean-900 border border-ocean-700 rounded-lg px-2 py-1 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block">End Window</span>
              <input
                type="date"
                value={altEndDate}
                onChange={(e) => setAltEndDate(e.target.value)}
                className="w-full bg-ocean-900 border border-ocean-700 rounded-lg px-2 py-1 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>
        </div>

        {/* Param 2: Quality & Obs Threshold */}
        <div className="bg-ocean-950/60 border border-ocean-800/80 rounded-xl p-3 space-y-2">
          <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider block">
            Quality Strictness & Threshold
          </label>
          <div className="space-y-2 text-xs">
            <div>
              <span className="text-[10px] text-slate-400 block mb-1">Min Valid Days/Mo: {altMinObs}d</span>
              <input
                type="range"
                min="8"
                max="24"
                step="2"
                value={altMinObs}
                onChange={(e) => setAltMinObs(Number(e.target.value))}
                className="w-full accent-cyan-500 cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-slate-400">
                <span>8d (relaxed)</span>
                <span>16d</span>
                <span>24d (strict)</span>
              </div>
            </div>

            <div className="flex items-center space-x-2 pt-1">
              <span className="text-[10px] text-slate-400">Filter Mode:</span>
              <button
                type="button"
                onClick={() => setAltQualityMode(altQualityMode === 'strict' ? 'relaxed' : 'strict')}
                className={`text-[10px] px-2 py-0.5 rounded font-medium border ${
                  altQualityMode === 'strict'
                    ? 'bg-cyan-950 text-cyan-300 border-cyan-700'
                    : 'bg-ocean-800 text-slate-300 border-ocean-700'
                }`}
              >
                {altQualityMode.toUpperCase()}
              </button>
            </div>
          </div>
        </div>

        {/* Param 3: Seasonality & Neighbors */}
        <div className="bg-ocean-950/60 border border-ocean-800/80 rounded-xl p-3 space-y-2.5">
          <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider block">
            Model Structure & Spatial Check
          </label>
          <div className="space-y-2 text-xs">
            <label className="flex items-center justify-between text-slate-300 cursor-pointer select-none">
              <span className="text-[11px]">Seasonal Adjustment</span>
              <input
                type="checkbox"
                checked={altSeasonal}
                onChange={(e) => setAltSeasonal(e.target.checked)}
                className="h-3.5 w-3.5 accent-cyan-500 rounded"
              />
            </label>

            <label className="flex items-center justify-between text-slate-300 cursor-pointer select-none">
              <span className="text-[11px]">Spatial Neighbor Outlier Test</span>
              <input
                type="checkbox"
                checked={compareNeighbors}
                onChange={(e) => setCompareNeighbors(e.target.checked)}
                className="h-3.5 w-3.5 accent-cyan-500 rounded"
              />
            </label>

            <div className="pt-1">
              <button
                onClick={handleRunChallenge}
                disabled={isLoading}
                className="w-full py-2 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-ocean-800 text-white font-semibold text-xs flex items-center justify-center space-x-1.5 shadow-md shadow-cyan-950 transition active:scale-[0.98]"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Recalculating...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Challenge Result</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* Error Message */}
      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 text-xs flex items-center space-x-2">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Challenge Results Section */}
      {challengeResult && (
        <div className="space-y-3 pt-2">
          {/* Summary Verdict Banner */}
          <div
            className={`p-3.5 rounded-xl border flex items-start space-x-3 ${
              challengeResult.conclusion_changed
                ? 'bg-amber-950/70 border-amber-600/70 text-amber-200'
                : 'bg-emerald-950/70 border-emerald-600/70 text-emerald-200'
            }`}
          >
            <div className="p-1.5 rounded-lg bg-ocean-950/80 shrink-0 mt-0.5">
              {challengeResult.conclusion_changed ? (
                <AlertTriangle className="h-5 w-5 text-amber-400" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              )}
            </div>
            <div className="text-xs space-y-1">
              <div className="font-bold uppercase tracking-wide flex items-center space-x-2">
                <span>{challengeResult.conclusion_changed ? 'SENSITIVE CONCLUSION' : 'ROBUST RESULT'}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-ocean-950/80 border border-current">
                  {challengeResult.conclusion_changed ? 'HYPOTHESIS CONDITIONAL' : 'PASSES SENSITIVITY CHECK'}
                </span>
              </div>
              <p className="leading-relaxed font-sans">{challengeResult.summary_verdict}</p>
            </div>
          </div>

          {/* Metric Comparison Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {challengeResult.metric_comparisons.map((m, i) => (
              <div key={i} className="bg-ocean-950/70 border border-ocean-800 rounded-xl p-2.5 space-y-1 text-xs">
                <span className="text-[10px] text-slate-400 block truncate">{m.metric_name}</span>
                <div className="flex items-center space-x-1 font-mono text-[11px]">
                  <span className="text-slate-300">
                    {typeof m.original_value === 'number' ? m.original_value.toFixed(4) : m.original_value}
                  </span>
                  <ArrowRight className="h-3 w-3 text-cyan-400 shrink-0" />
                  <span className={m.changed_materially ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
                    {typeof m.challenged_value === 'number' ? m.challenged_value.toFixed(4) : m.challenged_value}
                  </span>
                </div>
                {m.delta !== null && m.delta !== undefined && (
                  <div className="text-[9px] text-slate-400 font-mono">
                    Δ {m.delta > 0 ? '+' : ''}{m.delta} {m.unit}
                  </div>
                )}
                {m.changed_materially && (
                  <span className="inline-block text-[9px] text-amber-300 bg-amber-950/80 px-1.5 py-0.2 rounded border border-amber-800/80">
                    Shifted Materially
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Neighbor Spatial Outlier Card (if present) */}
          {challengeResult.neighbor_comparison && (
            <div className="bg-ocean-950/70 border border-ocean-800 rounded-xl p-3 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-slate-300 font-medium">
                <span className="flex items-center space-x-1.5">
                  <Layers className="h-4 w-4 text-cyan-400" />
                  <span>Spatial Neighbor Outlier Comparison ({challengeResult.neighbor_comparison.neighbor_count} Adjacent Cells)</span>
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono border ${
                  challengeResult.neighbor_comparison.target_is_outlier
                    ? 'bg-cyan-950 text-cyan-300 border-cyan-700'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}>
                  {challengeResult.neighbor_comparison.target_is_outlier ? 'LOCALIZED OUTLIER' : 'REGIONAL COHESION'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1 text-slate-300">
                <div>Target Slope: <strong className="text-white">{challengeResult.neighbor_comparison.target_cell_slope.toFixed(4)}</strong></div>
                <div>Neighbor Mean Slope: <strong className="text-white">{challengeResult.neighbor_comparison.average_neighbor_slope.toFixed(4)}</strong></div>
              </div>
              <p className="text-[11px] text-slate-400 pt-1 border-t border-ocean-800 leading-relaxed">
                {challengeResult.neighbor_comparison.interpretation}
              </p>
            </div>
          )}

          {/* Caveats */}
          {challengeResult.caveats && challengeResult.caveats.length > 0 && (
            <div className="text-[10px] text-slate-400 space-y-0.5 pt-1">
              {challengeResult.caveats.map((c, i) => (
                <div key={i} className="flex items-center space-x-1">
                  <Info className="h-3 w-3 text-cyan-400 shrink-0" />
                  <span>{c}</span>
                </div>
              ))}
            </div>
          )}

        </div>
      )}

    </div>
  );
};
