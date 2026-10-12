'use client';

import React from 'react';
import { ShieldAlert, Satellite, Compass, Activity, FileText, Info, CheckCircle2, AlertTriangle } from 'lucide-react';
import { HealthResponse } from '@/lib/types';

interface HeaderProps {
  health?: HealthResponse | null;
  dataMode?: 'live' | 'cached' | 'demo';
  onOpenMethodology: () => void;
  onOpenStatus: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  health,
  dataMode = 'demo',
  onOpenMethodology,
  onOpenStatus
}) => {
  return (
    <header className="border-b border-ocean-700/60 bg-ocean-950/90 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-[1920px] mx-auto px-4 py-2.5 flex items-center justify-between">
        
        {/* Left: Branding & Tagline */}
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-700 flex items-center justify-center shadow-lg shadow-cyan-500/20 border border-cyan-400/30">
            <Compass className="h-6 w-6 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xl font-bold tracking-tight text-white flex items-center">
                GHOST FLEET <span className="text-cyan-400 ml-1">X</span>
              </span>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-700/50">
                MVP v1.0 • Arabian Sea
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              Discover maritime change. Test the evidence. Decide what to do next.
            </p>
          </div>
        </div>

        {/* Center: Notice & Demo Mode Indicator */}
        <div className="hidden md:flex items-center space-x-3">
          {dataMode === 'demo' ? (
            <div className="flex items-center space-x-2 px-3 py-1 rounded-md bg-amber-950/60 border border-amber-600/40 text-amber-200 text-xs">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                <strong className="font-semibold text-amber-300">DEMO MODE:</strong> Calibrated Regional Arabian Sea Fixture
              </span>
            </div>
          ) : (
            <div className="flex items-center space-x-2 px-3 py-1 rounded-md bg-emerald-950/60 border border-emerald-600/40 text-emerald-200 text-xs">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>
                <strong className="font-semibold text-emerald-300">LIVE MODE:</strong> Authenticated NASA & Maritime Feeds Connected
              </span>
            </div>
          )}

          <div className="text-[11px] text-slate-400 max-w-sm hidden lg:block leading-tight border-l border-ocean-700 pl-3">
            <span className="text-slate-300 font-medium">Non-Accusatory Standard:</span> Unmatched proxy signals represent leads for research review, never proof of illegal conduct.
          </div>
        </div>

        {/* Right: Telemetry & Modal Triggers */}
        <div className="flex items-center space-x-2">
          {/* Status Pills */}
          <button
            onClick={onOpenStatus}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-ocean-900 border border-ocean-700 hover:border-cyan-500/50 text-slate-300 text-xs transition"
            title="Inspect NASA and Maritime Data Source Providers"
          >
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Data Status</span>
            <span className="h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-emerald-900/50 animate-ping" />
          </button>

          {/* Methodology Button */}
          <button
            onClick={onOpenMethodology}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-ocean-800 hover:bg-ocean-700 border border-ocean-600 text-cyan-200 text-xs font-medium transition shadow-sm"
          >
            <Info className="h-3.5 w-3.5 text-cyan-400" />
            <span>Methodology</span>
          </button>
        </div>

      </div>
    </header>
  );
};
