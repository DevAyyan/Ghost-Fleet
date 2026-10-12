'use client';

import React from 'react';
import { Printer, Download, X, ShieldAlert, Compass, Calendar, CheckCircle2, AlertTriangle, FileText, Database, Info } from 'lucide-react';
import { EventDetailResponse, ChallengeResponse } from '@/lib/types';

interface CaseReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventDetail: EventDetailResponse | null;
  challengeResult?: ChallengeResponse | null;
}

export const CaseReportModal: React.FC<CaseReportModalProps> = ({
  isOpen,
  onClose,
  eventDetail,
  challengeResult
}) => {
  if (!isOpen || !eventDetail) return null;

  const { event, time_series, explanations, suggested_actions, data_provenance, review_feedback } = eventDetail;

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(eventDetail, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `GhostFleetX_Case_${event.event_id}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="fixed inset-0 z-50 bg-ocean-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto no-print">
      <div className="relative w-full max-w-4xl bg-ocean-900 border border-ocean-700/80 rounded-2xl shadow-2xl my-8 overflow-hidden print-container">
        
        {/* Header Actions (Excluded when printed) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ocean-700/80 bg-ocean-950/60 no-print">
          <div className="flex items-center space-x-2.5">
            <div className="h-8 w-8 rounded-lg bg-cyan-600/30 border border-cyan-400/40 flex items-center justify-center">
              <FileText className="h-4 w-4 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide uppercase">
                Auditable Case Report • Investigation Dossier
              </h2>
              <p className="text-xs text-slate-400">
                Case ID: <span className="font-mono text-cyan-300">{event.event_id}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handlePrint}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition shadow-sm"
              title="Print to PDF or paper printer"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print / PDF</span>
            </button>
            <button
              onClick={handleDownloadJSON}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-ocean-800 hover:bg-ocean-700 border border-ocean-600 text-slate-300 text-xs font-medium transition"
              title="Export structured JSON evidence data"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export JSON</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-ocean-800 transition ml-2"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Dossier Body (Printable Content) */}
        <div className="p-6 md:p-8 space-y-6 text-slate-200 text-xs leading-relaxed max-h-[82vh] overflow-y-auto">
          
          {/* Dossier Letterhead */}
          <div className="border-b border-ocean-700 pb-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-lg font-black text-white tracking-tight">GHOST FLEET <span className="text-cyan-400">X</span></span>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-ocean-950 text-cyan-300 border border-cyan-800">
                  MARITIME CHANGE-INTELLIGENCE
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Regional Environmental & Maritime Divergence Case File • Arabian Sea / Pakistan EEZ Focus
              </p>
            </div>

            <div className="text-right text-[11px] font-mono text-slate-400">
              <div>Generated: {new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC</div>
              <div>Data Mode: <strong className="text-cyan-300 uppercase">{data_provenance.data_mode}</strong></div>
              <div>Method: Seasonal Mann-Kendall + FDR</div>
            </div>
          </div>

          {/* Mandatory Ethical Non-Accusatory Warning */}
          <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-600/50 text-amber-200 text-[11px] flex items-start space-x-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <strong className="font-semibold block uppercase tracking-wider text-amber-300">
                Ethical Safeguard & Non-Accusatory Notice
              </strong>
              <p>
                Ghost Fleet X is an analytical decision-support tool. An unmatched satellite signal or statistically significant trend represents an investigation lead for maritime researchers and conservation monitors, <strong>NEVER proof of illegal conduct or vessel guilt</strong>. Discrepancies may arise from cloud cover, artisanal vessels lacking AIS equipment, receiver coverage dropouts, or legitimate seasonal variations. Human verification is strictly required.
              </p>
            </div>
          </div>

          {/* Target Geometry & Metadata */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-ocean-950/80 p-4 rounded-xl border border-ocean-800">
            <div>
              <span className="text-[10px] text-slate-400 uppercase block">Study Target Cell</span>
              <span className="font-semibold text-white text-xs">{event.area_name}</span>
              <span className="text-[10px] text-slate-400 block font-mono">Cell ID: {event.cell_id}</span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 uppercase block">Cell Coordinates</span>
              <span className="font-mono text-cyan-300 text-xs">
                {event.coordinates[1].toFixed(2)}°N, {event.coordinates[0].toFixed(2)}°E
              </span>
              <span className="text-[10px] text-slate-400 block font-mono">
                BBox: [{event.cell_bbox.map((c) => c.toFixed(2)).join(', ')}]
              </span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 uppercase block">Investigation Priority</span>
              <span className="font-bold text-white text-sm">
                {(event.investigation_priority * 100).toFixed(0)}%
              </span>
              <span className="text-[10px] text-slate-400 block">
                Ranked by magnitude & evidence
              </span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 uppercase block">Significance Class</span>
              <span className={`font-semibold text-xs uppercase ${event.is_significant ? 'text-emerald-400' : 'text-slate-400'}`}>
                {event.significance_class.replace('_', ' ')}
              </span>
              <span className="text-[10px] text-slate-400 block font-mono">
                FDR p = {event.p_value_fdr_adjusted < 0.001 ? '<0.001' : event.p_value_fdr_adjusted.toFixed(4)}
              </span>
            </div>
          </div>

          {/* Quantitative Evidence & Trend Summary */}
          <div>
            <h3 className="text-xs font-bold uppercase text-slate-300 tracking-wider mb-2 flex items-center space-x-1.5">
              <Compass className="h-4 w-4 text-cyan-400" />
              <span>Statistical & Signal Drift Evidence</span>
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse border border-ocean-800 text-[11px]">
                <thead>
                  <tr className="bg-ocean-950/90 text-slate-400 border-b border-ocean-800">
                    <th className="p-2 border-r border-ocean-800">Metric</th>
                    <th className="p-2 border-r border-ocean-800">Value</th>
                    <th className="p-2 border-r border-ocean-800">Unit / Reference</th>
                    <th className="p-2">Analytical Interpretation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ocean-800 font-mono">
                  <tr>
                    <td className="p-2 border-r border-ocean-800 font-sans text-slate-300">MSDI Sen's Slope</td>
                    <td className="p-2 border-r border-ocean-800 font-bold text-cyan-300">{event.trend_slope > 0 ? '+' : ''}{event.trend_slope.toFixed(5)}</td>
                    <td className="p-2 border-r border-ocean-800 text-slate-400">{event.slope_unit}</td>
                    <td className="p-2 font-sans text-slate-300">Non-parametric monotonic drift between radiance proxy and tracking proxy.</td>
                  </tr>
                  <tr>
                    <td className="p-2 border-r border-ocean-800 font-sans text-slate-300">Raw Mann-Kendall p-value</td>
                    <td className="p-2 border-r border-ocean-800 text-slate-300">{event.p_value.toFixed(4)}</td>
                    <td className="p-2 border-r border-ocean-800 text-slate-400">p-statistic</td>
                    <td className="p-2 font-sans text-slate-300">Unadjusted probability under null hypothesis of no monotonic trend.</td>
                  </tr>
                  <tr>
                    <td className="p-2 border-r border-ocean-800 font-sans text-slate-300">FDR Adjusted p-value</td>
                    <td className="p-2 border-r border-ocean-800 font-bold text-emerald-400">{event.p_value_fdr_adjusted.toFixed(4)}</td>
                    <td className="p-2 border-r border-ocean-800 text-slate-400">Benjamini-Hochberg (α=0.05)</td>
                    <td className="p-2 font-sans text-slate-300">Corrects for spatial multi-comparison testing across all regional grid cells.</td>
                  </tr>
                  <tr>
                    <td className="p-2 border-r border-ocean-800 font-sans text-slate-300">Valid Observations</td>
                    <td className="p-2 border-r border-ocean-800 text-slate-300">{event.valid_sample_count} / {time_series.length} mo</td>
                    <td className="p-2 border-r border-ocean-800 text-slate-400">Missing Ratio: {(event.missing_ratio * 100).toFixed(1)}%</td>
                    <td className="p-2 font-sans text-slate-300">Observations passing cloud obscuration and quality masking thresholds.</td>
                  </tr>
                  <tr>
                    <td className="p-2 border-r border-ocean-800 font-sans text-slate-300">Mean & Latest MSDI</td>
                    <td className="p-2 border-r border-ocean-800 text-slate-300">Mean: {event.msdi_mean ?? 'N/A'} | Latest: {event.msdi_latest ?? 'N/A'}</td>
                    <td className="p-2 border-r border-ocean-800 text-slate-400">Normalized [-1.0, +1.0]</td>
                    <td className="p-2 font-sans text-slate-300">Divergence: satellite_proxy_norm - tracking_proxy_norm. Positive indicates excess light.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Alternative Explanations & Hypotheses */}
          <div>
            <h3 className="text-xs font-bold uppercase text-slate-300 tracking-wider mb-2 flex items-center space-x-1.5">
              <Database className="h-4 w-4 text-cyan-400" />
              <span>Alternative Hypotheses & Evaluated Explanations</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {explanations.map((hyp) => (
                <div key={hyp.id} className="p-3 bg-ocean-950/70 border border-ocean-800 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white text-xs">{hyp.title}</span>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase border ${
                      hyp.likelihood === 'high'
                        ? 'bg-red-950 text-red-300 border-red-800'
                        : hyp.likelihood === 'moderate'
                        ? 'bg-amber-950 text-amber-300 border-amber-800'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}>
                      {hyp.likelihood} Likelihood
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-normal">{hyp.summary}</p>
                  
                  <div className="text-[10px] space-y-1 pt-1 border-t border-ocean-800/80">
                    <div className="text-emerald-400">
                      <strong>Supporting Evidence:</strong> {hyp.supporting_evidence.join('; ')}
                    </div>
                    {hyp.counter_evidence.length > 0 && (
                      <div className="text-amber-400">
                        <strong>Counter Evidence:</strong> {hyp.counter_evidence.join('; ')}
                      </div>
                    )}
                    <div className="text-slate-400">
                      <strong>Limitations:</strong> {hyp.limitations.join('; ')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Decision Support & Proportionate Actions */}
          <div>
            <h3 className="text-xs font-bold uppercase text-slate-300 tracking-wider mb-2 flex items-center space-x-1.5">
              <CheckCircle2 className="h-4 w-4 text-cyan-400" />
              <span>Decision Support • Proportionate Investigation Steps</span>
            </h3>

            <div className="space-y-2">
              {suggested_actions.map((act, i) => (
                <div key={i} className="p-2.5 bg-ocean-950/60 border border-ocean-800 rounded-xl flex items-start space-x-2.5">
                  <span className="text-xs font-mono font-bold text-cyan-400 bg-ocean-900 px-2 py-0.5 rounded border border-ocean-700">
                    Step {i + 1}
                  </span>
                  <div>
                    <div className="font-semibold text-white text-xs">{act.step}</div>
                    <p className="text-[11px] text-slate-400 mt-0.5">{act.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Disproof Lab Results (if executed) */}
          {challengeResult && (
            <div className="p-4 bg-ocean-950/80 border border-cyan-900/50 rounded-xl space-y-2">
              <h4 className="text-xs font-bold text-cyan-300 uppercase tracking-wider flex items-center space-x-1.5">
                <ShieldAlert className="h-4 w-4" />
                <span>Disproof Lab Sensitivity Audit Log</span>
              </h4>
              <div className="text-[11px] text-slate-300">
                <span>Verdict: </span>
                <strong className={challengeResult.conclusion_changed ? 'text-amber-400' : 'text-emerald-400'}>
                  {challengeResult.summary_verdict}
                </strong>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                Original Slope: {challengeResult.original_slope.toFixed(4)} ({challengeResult.original_significance}) → Challenged Slope: {challengeResult.challenged_slope.toFixed(4)} ({challengeResult.challenged_significance})
              </div>
            </div>
          )}

          {/* Analyst Review Notes (if present) */}
          {review_feedback && (
            <div className="p-4 bg-ocean-950/80 border border-ocean-800 rounded-xl space-y-1">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Analyst Review Assessment
              </h4>
              <div className="flex items-center space-x-2 text-xs">
                <span className="text-slate-400">Label:</span>
                <span className="font-mono font-semibold text-cyan-300 uppercase px-2 py-0.5 bg-ocean-900 rounded border border-ocean-700">
                  {review_feedback.label}
                </span>
                <span className="text-slate-400">By: {review_feedback.analyst_name}</span>
                <span className="text-slate-400 font-mono text-[10px]">({review_feedback.timestamp})</span>
              </div>
              {review_feedback.notes && (
                <p className="text-[11px] text-slate-300 pt-1 italic font-sans">
                  "{review_feedback.notes}"
                </p>
              )}
            </div>
          )}

          {/* Data Provenance & Citations */}
          <div className="border-t border-ocean-800 pt-4 text-[10px] text-slate-400 space-y-1">
            <div className="font-bold uppercase text-slate-300">Data Sources & Citations:</div>
            <div>• NASA VIIRS VNP46A2 Lunar BRDF-adjusted Nighttime Lights — NASA LAADS DAAC. Units: nW/(cm²·sr)</div>
            <div>• Global Fishing Watch / Regional Tracking Effort Proxy — apparent tracking hours.</div>
            <div>• NASA POWER Agroclimatology & Surface Meteorology REST API — Langley Research Center.</div>
            <div>• NASA GIBS EOSDIS Day/Night Tile Imagery for visual geospatial reference.</div>
          </div>

        </div>

      </div>
    </div>
  );
};
