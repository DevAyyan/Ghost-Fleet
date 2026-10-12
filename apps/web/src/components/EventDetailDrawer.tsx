'use client';

import React, { useState } from 'react';
import {
  X,
  FileText,
  ShieldAlert,
  Flame,
  Activity,
  Layers,
  Database,
  CheckCircle2,
  AlertTriangle,
  Send,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Info
} from 'lucide-react';
import { ChangeEvent, EventDetailResponse, ChallengeResponse, FeedbackRequest } from '@/lib/types';
import { TimeSeriesChart } from './TimeSeriesChart';
import { DisproofLab } from './DisproofLab';
import { submitFeedback } from '@/lib/api';

interface EventDetailDrawerProps {
  event: ChangeEvent;
  eventDetail: EventDetailResponse | null;
  analysisId: string;
  onClose: () => void;
  onOpenReport: () => void;
  challengeResult?: ChallengeResponse | null;
  onChallengeSuccess?: (res: ChallengeResponse) => void;
  onFeedbackSaved?: () => void;
}

export const EventDetailDrawer: React.FC<EventDetailDrawerProps> = ({
  event,
  eventDetail,
  analysisId,
  onClose,
  onOpenReport,
  challengeResult,
  onChallengeSuccess,
  onFeedbackSaved
}) => {
  const [activeTab, setActiveTab] = useState<'timeline' | 'explanations' | 'actions' | 'challenge' | 'feedback'>('timeline');
  const [isMinimized, setIsMinimized] = useState<boolean>(false);

  // Feedback form state
  const [feedbackLabel, setFeedbackLabel] = useState<FeedbackRequest['label']>('needs_followup');
  const [analystName, setAnalystName] = useState<string>('Marine Analyst');
  const [feedbackNotes, setFeedbackNotes] = useState<string>('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState<boolean>(false);
  const [feedbackSuccessMsg, setFeedbackSuccessMsg] = useState<string | null>(null);

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackSubmitting(true);
    setFeedbackSuccessMsg(null);
    try {
      await submitFeedback(event.event_id, {
        label: feedbackLabel,
        analyst_name: analystName,
        notes: feedbackNotes
      });
      setFeedbackSuccessMsg('Analyst review feedback recorded to local investigation log.');
      if (onFeedbackSaved) onFeedbackSaved();
    } catch (err: any) {
      alert(err.message || 'Failed to submit feedback');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  return (
    <div className={`border-t border-ocean-700 bg-ocean-950/95 backdrop-blur-md shadow-2xl transition-all duration-300 flex flex-col ${
      isMinimized ? 'h-12' : 'h-[440px] md:h-[480px]'
    }`}>
      
      {/* Drawer Top Navigation Bar */}
      <div className="px-4 py-2.5 bg-ocean-900 border-b border-ocean-800 flex items-center justify-between shrink-0">
        
        {/* Left: Event Identification */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse" />
            <h3 className="text-sm font-bold text-white tracking-wide">
              {event.area_name}
            </h3>
            <span className="text-[11px] font-mono text-cyan-300 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800">
              [{event.coordinates[1].toFixed(2)}°N, {event.coordinates[0].toFixed(2)}°E]
            </span>
          </div>

          <div className="hidden sm:flex items-center space-x-2 border-l border-ocean-700 pl-3">
            <span className="text-[10px] uppercase font-sans text-slate-400">Priority:</span>
            <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border ${
              event.investigation_priority >= 0.7
                ? 'bg-red-950 text-red-300 border-red-700'
                : 'bg-amber-950 text-amber-300 border-amber-700'
            }`}>
              {(event.investigation_priority * 100).toFixed(0)}%
            </span>

            <span className="text-[10px] uppercase font-sans text-slate-400 ml-1">FDR p-val:</span>
            <span className={`text-[11px] font-mono font-bold ${event.is_significant ? 'text-emerald-400' : 'text-slate-400'}`}>
              {event.p_value_fdr_adjusted < 0.001 ? '<0.001' : event.p_value_fdr_adjusted.toFixed(3)}
            </span>
          </div>
        </div>

        {/* Center: Tabs */}
        {!isMinimized && (
          <div className="flex items-center space-x-1 bg-ocean-950 p-1 rounded-lg border border-ocean-800 text-xs">
            <button
              onClick={() => setActiveTab('timeline')}
              className={`px-3 py-1 rounded-md font-medium transition ${
                activeTab === 'timeline'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Timeline & Signal
            </button>
            <button
              onClick={() => setActiveTab('explanations')}
              className={`px-3 py-1 rounded-md font-medium transition ${
                activeTab === 'explanations'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Alternative Hypotheses
            </button>
            <button
              onClick={() => setActiveTab('actions')}
              className={`px-3 py-1 rounded-md font-medium transition ${
                activeTab === 'actions'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Decision Support
            </button>
            <button
              onClick={() => setActiveTab('challenge')}
              className={`px-3 py-1 rounded-md font-medium transition flex items-center space-x-1 ${
                activeTab === 'challenge'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-amber-400/80 hover:text-amber-300'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              <span>Disproof Lab</span>
            </button>
            <button
              onClick={() => setActiveTab('feedback')}
              className={`px-3 py-1 rounded-md font-medium transition ${
                activeTab === 'feedback'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Analyst Review
            </button>
          </div>
        )}

        {/* Right: Quick Actions & Minimization */}
        <div className="flex items-center space-x-2">
          <button
            onClick={onOpenReport}
            className="flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-cyan-600/90 hover:bg-cyan-500 text-white text-xs font-semibold shadow-sm transition"
            title="Generate print-ready investigation dossier"
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Case Report</span>
          </button>

          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-ocean-800 transition"
            title={isMinimized ? 'Expand Drawer' : 'Minimize Drawer'}
          >
            {isMinimized ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-ocean-800 transition"
            title="Close Drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

      </div>

      {/* Drawer Body Content */}
      {!isMinimized && (
        <div className="flex-1 overflow-y-auto p-4">
          
          {/* TAB 1: Timeline & Signal Evidence */}
          {activeTab === 'timeline' && (
            <div className="space-y-4">
              
              {/* Summary Stats Row */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
                <div className="bg-ocean-900/80 border border-ocean-800 rounded-xl p-2.5 space-y-0.5">
                  <span className="text-[10px] text-slate-400 uppercase font-sans block">Sen's Slope</span>
                  <div className={`font-mono text-sm font-bold ${event.trend_slope > 0 ? 'text-red-400' : 'text-cyan-400'}`}>
                    {event.trend_slope > 0 ? '+' : ''}{event.trend_slope.toFixed(4)}
                  </div>
                  <span className="text-[9px] text-slate-400 font-mono block">msdi/month</span>
                </div>

                <div className="bg-ocean-900/80 border border-ocean-800 rounded-xl p-2.5 space-y-0.5">
                  <span className="text-[10px] text-slate-400 uppercase font-sans block">FDR p-value</span>
                  <div className={`font-mono text-sm font-bold ${event.is_significant ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {event.p_value_fdr_adjusted < 0.001 ? '<0.001' : event.p_value_fdr_adjusted.toFixed(3)}
                  </div>
                  <span className="text-[9px] text-slate-400 block">Benjamini-Hochberg</span>
                </div>

                <div className="bg-ocean-900/80 border border-ocean-800 rounded-xl p-2.5 space-y-0.5">
                  <span className="text-[10px] text-slate-400 uppercase font-sans block">Valid Obs</span>
                  <div className="font-mono text-sm font-bold text-slate-200">
                    {event.valid_sample_count} <span className="text-xs text-slate-400 font-normal">/ 48 mo</span>
                  </div>
                  <span className="text-[9px] text-slate-400 block">
                    {(event.missing_ratio * 100).toFixed(0)}% masked
                  </span>
                </div>

                <div className="bg-ocean-900/80 border border-ocean-800 rounded-xl p-2.5 space-y-0.5">
                  <span className="text-[10px] text-slate-400 uppercase font-sans block">Mean MSDI</span>
                  <div className="font-mono text-sm font-bold text-amber-300">
                    {event.msdi_mean !== null ? (event.msdi_mean > 0 ? '+' : '') + event.msdi_mean.toFixed(3) : 'N/A'}
                  </div>
                  <span className="text-[9px] text-slate-400 block">Normalized Parity</span>
                </div>

                <div className="bg-ocean-900/80 border border-ocean-800 rounded-xl p-2.5 space-y-0.5">
                  <span className="text-[10px] text-slate-400 uppercase font-sans block">Quality Score</span>
                  <div className="font-mono text-sm font-bold text-cyan-300">
                    {(event.quality_score * 100).toFixed(0)}%
                  </div>
                  <span className="text-[9px] text-slate-400 block">Cloud Free Ratio</span>
                </div>

                <div className="bg-ocean-900/80 border border-ocean-800 rounded-xl p-2.5 space-y-0.5">
                  <span className="text-[10px] text-slate-400 uppercase font-sans block">Individual Slopes</span>
                  <div className="font-mono text-[11px] text-slate-300">
                    <div>Sat: <span className="text-cyan-400">{event.satellite_trend_slope.toFixed(3)}</span></div>
                    <div>Trk: <span className="text-emerald-400">{event.tracking_trend_slope.toFixed(3)}</span></div>
                  </div>
                </div>
              </div>

              {/* Time Series EChart */}
              {eventDetail ? (
                <TimeSeriesChart
                  data={eventDetail.time_series}
                  slope={event.trend_slope}
                  areaName={event.area_name}
                />
              ) : (
                <div className="h-64 flex items-center justify-center text-slate-500 text-xs">
                  Loading time series observations...
                </div>
              )}

              {/* Caveat Footer */}
              <div className="text-[11px] text-slate-400 bg-ocean-900/40 p-2.5 rounded-lg border border-ocean-800 flex items-center space-x-2">
                <Info className="h-4 w-4 text-cyan-400 shrink-0" />
                <span><strong>Caveat:</strong> {event.caveat}</span>
              </div>
            </div>
          )}

          {/* TAB 2: Alternative Hypotheses & Explanations */}
          {activeTab === 'explanations' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-300">
                Rule-based scientific evaluation of alternative explanations for the observed divergence between satellite radiance and tracking effort:
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(eventDetail?.explanations || []).map((hyp) => (
                  <div key={hyp.id} className="p-3.5 bg-ocean-900/80 border border-ocean-800 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-xs">{hyp.title}</span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase border ${
                        hyp.likelihood === 'high'
                          ? 'bg-red-950 text-red-300 border-red-700'
                          : hyp.likelihood === 'moderate'
                          ? 'bg-amber-950 text-amber-300 border-amber-700'
                          : 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}>
                        {hyp.likelihood} Likelihood
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-300 leading-normal">{hyp.summary}</p>

                    <div className="text-[10px] space-y-1 pt-1.5 border-t border-ocean-800/80">
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
          )}

          {/* TAB 3: Decision Support & Follow-Up Actions */}
          {activeTab === 'actions' && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-800/50 text-cyan-200 text-xs">
                <strong>Decision Support Architecture:</strong> Ghost Fleet X outputs proportionate research follow-ups and tasking recommendations. These are decision-support steps, never automated enforcement dispatch.
              </div>

              <div className="space-y-2.5">
                {(eventDetail?.suggested_actions || []).map((act, i) => (
                  <div key={i} className="p-3 bg-ocean-900/80 border border-ocean-800 rounded-xl flex items-start space-x-3">
                    <span className="text-xs font-mono font-bold text-cyan-400 bg-ocean-950 px-2 py-1 rounded border border-ocean-800 shrink-0">
                      Step {i + 1}
                    </span>
                    <div className="space-y-1">
                      <div className="font-semibold text-white text-xs">{act.step}</div>
                      <p className="text-[11px] text-slate-300">{act.description}</p>
                      <span className="inline-block text-[9px] uppercase font-mono px-2 py-0.5 rounded bg-ocean-950 text-slate-400 border border-ocean-800">
                        Action Type: {act.type}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: Disproof Lab */}
          {activeTab === 'challenge' && (
            <DisproofLab
              analysisId={analysisId}
              event={event}
              onChallengeSuccess={onChallengeSuccess}
            />
          )}

          {/* TAB 5: Analyst Review Feedback */}
          {activeTab === 'feedback' && (
            <div className="max-w-xl mx-auto space-y-4">
              <div className="text-xs text-slate-300">
                Record an analyst verification label and internal investigation notes for this cell:
              </div>

              {feedbackSuccessMsg && (
                <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-700 text-emerald-200 text-xs flex items-center space-x-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>{feedbackSuccessMsg}</span>
                </div>
              )}

              <form onSubmit={handleSubmitFeedback} className="space-y-3 bg-ocean-900/80 p-4 rounded-xl border border-ocean-800 text-xs">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Analyst Name / Call Sign</label>
                  <input
                    type="text"
                    value={analystName}
                    onChange={(e) => setAnalystName(e.target.value)}
                    className="w-full bg-ocean-950 border border-ocean-700 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-cyan-500"
                    required
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Review Assessment Label</label>
                  <select
                    value={feedbackLabel}
                    onChange={(e) => setFeedbackLabel(e.target.value as any)}
                    className="w-full bg-ocean-950 border border-ocean-700 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-cyan-500"
                  >
                    <option value="needs_followup">Needs Follow-Up (Recommended)</option>
                    <option value="confirmed">Confirmed Anomaly (Cross-referenced)</option>
                    <option value="likely_artifact">Likely Sensor / Weather Artifact</option>
                    <option value="seasonal_normal">Seasonal / Normal Variation</option>
                    <option value="inconclusive">Inconclusive Evidence</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Investigation Notes & Caveats</label>
                  <textarea
                    rows={3}
                    value={feedbackNotes}
                    onChange={(e) => setFeedbackNotes(e.target.value)}
                    placeholder="Enter observation notes, verified vessel registries, or oceanographic context..."
                    className="w-full bg-ocean-950 border border-ocean-700 rounded-lg p-2.5 text-white text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="pt-2 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 italic">
                    Recorded locally in dev store. Not ground truth.
                  </span>
                  <button
                    type="submit"
                    disabled={feedbackSubmitting}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>{feedbackSubmitting ? 'Saving...' : 'Save Assessment'}</span>
                  </button>
                </div>
              </form>

              {/* Saved History */}
              {eventDetail?.review_feedback && (
                <div className="p-3 bg-ocean-950/80 border border-ocean-800 rounded-xl text-xs space-y-1">
                  <div className="font-semibold text-slate-300 flex items-center justify-between">
                    <span>Prior Saved Review</span>
                    <span className="font-mono text-[10px] text-cyan-300 uppercase">
                      {eventDetail.review_feedback.label}
                    </span>
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    By: {eventDetail.review_feedback.analyst_name} • {eventDetail.review_feedback.timestamp}
                  </div>
                  {eventDetail.review_feedback.notes && (
                    <p className="text-slate-300 italic pt-1">
                      "{eventDetail.review_feedback.notes}"
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      )}

    </div>
  );
};
