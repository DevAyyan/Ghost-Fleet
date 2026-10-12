'use client';

import React, { useState } from 'react';
import { Flame, AlertTriangle, CheckCircle, HelpCircle, ChevronRight, Filter } from 'lucide-react';
import { ChangeEvent } from '@/lib/types';

interface EventListProps {
  events: ChangeEvent[];
  selectedEvent: ChangeEvent | null;
  onSelectEvent: (event: ChangeEvent) => void;
}

export const EventList: React.FC<EventListProps> = ({
  events,
  selectedEvent,
  onSelectEvent
}) => {
  const [filterSigOnly, setFilterSigOnly] = useState<boolean>(false);

  const displayedEvents = filterSigOnly
    ? events.filter((e) => e.is_significant)
    : events;

  return (
    <div className="w-full lg:w-96 flex flex-col bg-ocean-900/95 border-l border-ocean-800 shrink-0 h-full overflow-hidden">
      
      {/* Header */}
      <div className="p-4 border-b border-ocean-800 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide uppercase flex items-center space-x-1.5">
              <Flame className="h-4 w-4 text-amber-400" />
              <span>Ranked Investigation Leads</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Ranked by composite change priority (magnitude + persistence + FDR evidence)
            </p>
          </div>
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-ocean-800 text-cyan-300 border border-ocean-700">
            {displayedEvents.length} Leads
          </span>
        </div>

        {/* Filter Toggle */}
        <div className="flex items-center justify-between text-xs pt-1">
          <label className="flex items-center space-x-1.5 text-slate-300 hover:text-white cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filterSigOnly}
              onChange={(e) => setFilterSigOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-cyan-500 rounded"
            />
            <span className="text-[11px]">Significant Only (FDR p &lt; 0.05)</span>
          </label>

          <span className="text-[10px] text-slate-400">
            Sorted by Priority
          </span>
        </div>
      </div>

      {/* Events List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {displayedEvents.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">
            No events match the current filter.
          </div>
        ) : (
          displayedEvents.map((evt, idx) => {
            const isSelected = selectedEvent?.event_id === evt.event_id;
            
            // Priority Color Coding
            const priorityBadge = evt.investigation_priority >= 0.7
              ? 'bg-red-950/80 text-red-300 border-red-700/60'
              : evt.investigation_priority >= 0.4
              ? 'bg-amber-950/80 text-amber-300 border-amber-700/60'
              : 'bg-slate-800 text-slate-300 border-slate-700';

            return (
              <div
                key={evt.event_id}
                onClick={() => onSelectEvent(evt)}
                className={`p-3 rounded-xl cursor-pointer transition border text-left ${
                  isSelected
                    ? 'bg-ocean-800/90 border-cyan-400 shadow-md shadow-cyan-950/50'
                    : 'bg-ocean-950/60 hover:bg-ocean-850 border-ocean-800/80 hover:border-ocean-700'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-xs font-semibold text-white">
                        #{idx + 1} {evt.area_name}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                      [{evt.coordinates[1].toFixed(1)}°N, {evt.coordinates[0].toFixed(1)}°E]
                    </div>
                  </div>

                  {/* Priority Badge */}
                  <div className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${priorityBadge}`}>
                    Priority {(evt.investigation_priority * 100).toFixed(0)}%
                  </div>
                </div>

                {/* Key Metrics Grid */}
                <div className="grid grid-cols-3 gap-1.5 mt-2.5 pt-2 border-t border-ocean-800/60 text-[10px] font-mono">
                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase font-sans">Sen's Slope</span>
                    <span className={evt.trend_slope > 0 ? 'text-red-400' : 'text-cyan-400'}>
                      {evt.trend_slope > 0 ? '+' : ''}{evt.trend_slope.toFixed(4)}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase font-sans">FDR p-value</span>
                    <span className={evt.is_significant ? 'text-emerald-400' : 'text-slate-400'}>
                      {evt.p_value_fdr_adjusted < 0.001 ? '< 0.001' : evt.p_value_fdr_adjusted.toFixed(3)}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase font-sans">Valid Obs</span>
                    <span className="text-slate-300">
                      {evt.valid_sample_count} mo
                    </span>
                  </div>
                </div>

                {/* Status Strip & Top Hypothesis */}
                <div className="mt-2 text-[10px] flex items-center justify-between text-slate-400">
                  <span className="truncate max-w-[200px]" title={evt.top_explanation}>
                    Hypothesis: {evt.top_explanation}
                  </span>
                  <div className="flex items-center text-cyan-400 text-[11px] font-medium shrink-0">
                    <span>Inspect</span>
                    <ChevronRight className="h-3 w-3 ml-0.5" />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

    </div>
  );
};
