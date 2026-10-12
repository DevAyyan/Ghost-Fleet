'use client';

import React from 'react';
import { X, BookOpen, AlertCircle, Compass, BarChart3, ShieldCheck, Database, Layers } from 'lucide-react';

interface MethodologyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MethodologyModal: React.FC<MethodologyModalProps> = ({
  isOpen,
  onClose
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-ocean-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-ocean-900 border border-ocean-700 rounded-2xl shadow-2xl my-8 overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ocean-800 bg-ocean-950/70">
          <div className="flex items-center space-x-2.5">
            <div className="h-8 w-8 rounded-lg bg-cyan-600/30 border border-cyan-400/40 flex items-center justify-center">
              <BookOpen className="h-4 w-4 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide uppercase">
                Ghost Fleet X • Scientific & Statistical Methodology
              </h2>
              <p className="text-xs text-slate-400">
                Mathematical Formulations, Sensor Pipelines, and Ethical Safeguards
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
        <div className="p-6 space-y-6 text-slate-300 text-xs leading-relaxed max-h-[80vh] overflow-y-auto">
          
          {/* Section 1: Core Ethical Non-Accusatory Principle */}
          <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-600/50 text-amber-200 space-y-1">
            <div className="font-bold uppercase tracking-wider text-amber-300 flex items-center space-x-1.5">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Ethical Non-Accusatory Foundation</span>
            </div>
            <p>
              Ghost Fleet X is an analytical change-intelligence decision-support tool. It detects <strong>statistical signal divergence</strong> between satellite-observed radiance and reported transponder effort. It <strong>never</strong> claims or infers illegal activity, guilt, or illicit intent from an unmatched proxy signal.
            </p>
          </div>

          {/* Section 2: Primary Derived Variable: MSDI */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase text-cyan-300 tracking-wider flex items-center space-x-1.5">
              <BarChart3 className="h-4 w-4" />
              <span>1. Maritime Signal Drift Index (MSDI)</span>
            </h3>
            <p>
              To compare disparate physical sensors without unit incompatibility, raw satellite radiance and reported tracking effort are separately min-max normalized onto a standardized [0.0, 1.0] scale across the study period:
            </p>
            <div className="p-3 bg-ocean-950 border border-ocean-800 rounded-xl font-mono text-cyan-300 text-[11px] text-center">
              MSDI = satellite_proxy_norm - tracking_proxy_norm
            </div>
            <ul className="list-disc list-inside space-y-1 text-slate-300 pl-2 text-[11px]">
              <li><strong>MSDI ≈ 0.0:</strong> Signal parity. Nighttime radiance is proportional to reported transponder tracking.</li>
              <li><strong>MSDI &gt; 0:</strong> Positive signal drift. Elevated nighttime radiance observed without commensurate tracking transponder broadcasts.</li>
              <li><strong>MSDI &lt; 0:</strong> Negative signal drift. High transponder activity without matching illuminated nighttime light signatures.</li>
            </ul>
          </div>

          {/* Section 3: Non-Parametric Trend & Significance */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase text-cyan-300 tracking-wider flex items-center space-x-1.5">
              <Compass className="h-4 w-4" />
              <span>2. Sen’s Slope & Seasonal Mann-Kendall Testing</span>
            </h3>
            <p>
              Marine time-series data exhibit strong seasonality (e.g., Arabian Sea summer southwest monsoon June–August vs winter fishing season) and skewed residuals:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
              <div className="p-3 bg-ocean-950/80 border border-ocean-800 rounded-xl space-y-1">
                <strong className="text-white block font-sans">Sen's Slope Magnitude:</strong>
                <p>
                  Calculates the median of all pairwise slopes:
                  <span className="block font-mono text-cyan-300 mt-1">Q = median((x_j - x_i) / (j - i))</span>
                  Extremely robust against atmospheric outlier spikes.
                </p>
              </div>
              <div className="p-3 bg-ocean-950/80 border border-ocean-800 rounded-xl space-y-1">
                <strong className="text-white block font-sans">Seasonal Mann-Kendall:</strong>
                <p>
                  Evaluates monotonic trend by comparing observations from like months across years, eliminating seasonal confounding cycles without distorting baseline dynamics.
                </p>
              </div>
            </div>
          </div>

          {/* Section 4: FDR Multiple Comparisons Correction */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase text-cyan-300 tracking-wider flex items-center space-x-1.5">
              <ShieldCheck className="h-4 w-4" />
              <span>3. Benjamini-Hochberg False Discovery Rate (FDR)</span>
            </h3>
            <p>
              When evaluating hundreds of grid cells simultaneously, standard p-values produce false discoveries by chance. Ghost Fleet X applies the Benjamini-Hochberg procedure across all regional cells (target α = 0.05):
            </p>
            <div className="p-2.5 bg-ocean-950 border border-ocean-800 rounded-xl font-mono text-[11px] text-center text-slate-300">
              Rank p-values p_(1) ≤ p_(2) ≤ ... ≤ p_(m); find max k where p_(k) ≤ (k / m) * α
            </div>
            <p className="text-[11px] text-slate-400">
              Only cells meeting adjusted significance are rendered with divergent trend colors; non-significant cells are strictly styled in neutral slate gray to prevent cognitive bias.
            </p>
          </div>

          {/* Section 5: NASA Data Products */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase text-cyan-300 tracking-wider flex items-center space-x-1.5">
              <Database className="h-4 w-4" />
              <span>4. NASA Earth Science Products</span>
            </h3>
            <div className="space-y-2 text-[11px]">
              <div className="p-2.5 bg-ocean-950/70 border border-ocean-800 rounded-xl">
                <span className="font-semibold text-white block">NASA VNP46A2 VIIRS Nighttime Lights (LAADS DAAC)</span>
                <span className="text-slate-400 block mt-0.5">
                  Daily lunar BRDF-adjusted radiance product aggregated into monthly 0.5° spatial cells. Cloud masks and mandatory quality flags are strictly enforced; degraded observations are masked, never converted to zero.
                </span>
              </div>
              <div className="p-2.5 bg-ocean-950/70 border border-ocean-800 rounded-xl">
                <span className="font-semibold text-white block">NASA POWER Agroclimatology & Surface Meteorology</span>
                <span className="text-slate-400 block mt-0.5">
                  Provides 10-meter surface wind speeds (WS10M), corrected precipitation (PRECTOTCORR), and surface temperatures (TS) as physical contextual factors for maritime operational conditions.
                </span>
              </div>
              <div className="p-2.5 bg-ocean-950/70 border border-ocean-800 rounded-xl">
                <span className="font-semibold text-white block">NASA GIBS EOSDIS Browse Imagery</span>
                <span className="text-slate-400 block mt-0.5">
                  Live WMTS visual map layers for visual confirmation. Rendered tiles are never used as quantitative numeric inputs.
                </span>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-ocean-950 border-t border-ocean-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold transition"
          >
            Close Methodology
          </button>
        </div>

      </div>
    </div>
  );
};
