'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { ControlRail } from '@/components/ControlRail';
import { MapView } from '@/components/MapView';
import { EventList } from '@/components/EventList';
import { EventDetailDrawer } from '@/components/EventDetailDrawer';
import { MethodologyModal } from '@/components/MethodologyModal';
import { DataStatusModal } from '@/components/DataStatusModal';
import { CaseReportModal } from '@/components/CaseReportModal';
import {
  HealthResponse,
  MetadataResponse,
  AnalysisRequest,
  AnalysisResponse,
  ChangeEvent,
  EventDetailResponse,
  ChallengeResponse
} from '@/lib/types';
import {
  fetchHealth,
  fetchMetadata,
  runAnalysis,
  fetchEventDetail
} from '@/lib/api';
import { AlertCircle, RefreshCw } from 'lucide-react';

const DEFAULT_REQUEST: AnalysisRequest = {
  region_id: 'arabian-sea-demo',
  start_date: '2021-01-01',
  end_date: '2024-12-31',
  cadence: 'monthly',
  grid_degrees: 0.5,
  quality_mode: 'strict',
  min_valid_obs: 15,
  seasonal_adjustment: true,
  significance_method: 'seasonal_mann_kendall',
};

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [request, setRequest] = useState<AnalysisRequest>(DEFAULT_REQUEST);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ChangeEvent | null>(null);
  const [eventDetail, setEventDetail] = useState<EventDetailResponse | null>(null);
  const [challengeResult, setChallengeResult] = useState<ChallengeResponse | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modals state
  const [isMethodologyOpen, setIsMethodologyOpen] = useState<boolean>(false);
  const [isStatusOpen, setIsStatusOpen] = useState<boolean>(false);
  const [isReportOpen, setIsReportOpen] = useState<boolean>(false);

  // Fetch event detail when an event is selected
  const loadEventDetail = useCallback(async (eventId: string) => {
    try {
      const detail = await fetchEventDetail(eventId);
      setEventDetail(detail);
    } catch (err: any) {
      console.error('Failed to fetch event detail:', err);
    }
  }, []);

  const handleSelectEvent = useCallback((event: ChangeEvent) => {
    setSelectedEvent(event);
    setChallengeResult(null);
    loadEventDetail(event.event_id);
  }, [loadEventDetail]);

  const handleSelectCell = useCallback((cellId: string) => {
    if (!analysis) return;
    const match = analysis.events.find((e) => e.cell_id === cellId);
    if (match) {
      handleSelectEvent(match);
    }
  }, [analysis, handleSelectEvent]);

  // Execute scan
  const executeScan = useCallback(async (scanReq: AnalysisRequest) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await runAnalysis(scanReq);
      setAnalysis(res);
      if (res.events && res.events.length > 0) {
        // Automatically select the highest priority event
        const topEvent = res.events[0];
        setSelectedEvent(topEvent);
        setChallengeResult(null);
        await loadEventDetail(topEvent.event_id);
      } else {
        setSelectedEvent(null);
        setEventDetail(null);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Analysis scan execution failed.');
    } finally {
      setIsLoading(false);
    }
  }, [loadEventDetail]);

  // Initial mount load
  useEffect(() => {
    fetchHealth().then(setHealth).catch((e) => console.warn('Health check failed:', e));
    fetchMetadata().then(setMetadata).catch((e) => console.warn('Metadata load failed:', e));
    executeScan(DEFAULT_REQUEST);
  }, [executeScan]);

  const handleResetDefaults = () => {
    setRequest(DEFAULT_REQUEST);
    executeScan(DEFAULT_REQUEST);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-ocean-950 overflow-hidden font-sans">
      
      {/* 1. Header Navigation */}
      <Header
        health={health}
        dataMode={analysis?.data_mode ?? 'demo'}
        onOpenMethodology={() => setIsMethodologyOpen(true)}
        onOpenStatus={() => setIsStatusOpen(true)}
      />

      {/* 2. Global Error Banner */}
      {errorMessage && (
        <div className="bg-red-950/80 border-b border-red-800 text-red-200 px-4 py-2 text-xs flex items-center justify-between z-30">
          <div className="flex items-center space-x-2">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => executeScan(request)}
            className="flex items-center space-x-1 text-xs text-red-300 hover:text-white underline"
          >
            <RefreshCw className="h-3 w-3" />
            <span>Retry Scan</span>
          </button>
        </div>
      )}

      {/* 3. Main Workspace Grid */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Left Rail: Temporal & Quality Parameters */}
        <ControlRail
          request={request}
          onChangeRequest={setRequest}
          onRunScan={() => executeScan(request)}
          isLoading={isLoading}
          onResetDefaults={handleResetDefaults}
        />

        {/* Center: Geospatial Map + Bottom Detail Drawer */}
        <main className="flex-1 flex flex-col relative overflow-hidden bg-ocean-950">
          
          {/* Geospatial Map Area */}
          <div className="flex-1 relative w-full h-full">
            <MapView
              gridResults={analysis?.grid_results ?? []}
              selectedEvent={selectedEvent}
              onSelectCell={handleSelectCell}
              isLoading={isLoading}
            />
          </div>

          {/* Bottom Drawer: Signal Evidence, Hypotheses, Disproof Lab */}
          {selectedEvent && (
            <EventDetailDrawer
              event={selectedEvent}
              eventDetail={eventDetail}
              analysisId={analysis?.analysis_id ?? ''}
              onClose={() => setSelectedEvent(null)}
              onOpenReport={() => setIsReportOpen(true)}
              challengeResult={challengeResult}
              onChallengeSuccess={setChallengeResult}
              onFeedbackSaved={() => loadEventDetail(selectedEvent.event_id)}
            />
          )}

        </main>

        {/* Right Rail: Ranked Investigation Leads List */}
        <EventList
          events={analysis?.events ?? []}
          selectedEvent={selectedEvent}
          onSelectEvent={handleSelectEvent}
        />

      </div>

      {/* 4. Modals */}
      <MethodologyModal
        isOpen={isMethodologyOpen}
        onClose={() => setIsMethodologyOpen(false)}
      />

      <DataStatusModal
        isOpen={isStatusOpen}
        onClose={() => setIsStatusOpen(false)}
        health={health}
        metadata={metadata}
      />

      <CaseReportModal
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        eventDetail={eventDetail}
        challengeResult={challengeResult}
      />

    </div>
  );
}
