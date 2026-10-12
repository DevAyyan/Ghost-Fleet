'use client';

import React from 'react';
import ReactECharts from 'echarts-for-react';
import { TimeSeriesPoint } from '@/lib/types';

interface TimeSeriesChartProps {
  data: TimeSeriesPoint[];
  slope: number;
  areaName: string;
}

export const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({
  data,
  slope,
  areaName
}) => {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-500 text-xs">
        No time-series observations available for this cell.
      </div>
    );
  }

  const dates = data.map((d) => d.date);
  const radianceRaw = data.map((d) => (d.valid_observation ? d.radiance_raw : null));
  const radianceMasked = data.map((d) => (!d.valid_observation ? d.radiance_raw : null));
  const trackingRaw = data.map((d) => (d.valid_observation ? d.tracking_raw : null));
  const msdi = data.map((d) => d.msdi);
  const wind = data.map((d) => d.weather_wind_speed ?? null);
  const precip = data.map((d) => d.weather_precipitation ?? null);

  // Compute linear Sen's slope overlay trendline for MSDI
  const validMsdi = data.map((d, i) => (d.msdi !== null ? { x: i, y: d.msdi } : null)).filter(Boolean) as { x: number; y: number }[];
  const firstY = validMsdi.length > 0 ? validMsdi[0].y : 0;
  const trendLine = dates.map((_, i) => roundTo4(firstY + slope * i));

  function roundTo4(num: number) {
    return Math.round(num * 10000) / 10000;
  }

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(10, 17, 36, 0.95)',
      borderColor: '#1c3266',
      borderWidth: 1,
      textStyle: { color: '#f1f5f9', fontSize: 11 },
      axisPointer: { type: 'cross', lineStyle: { color: '#0284c7' } },
      formatter: (params: any[]) => {
        if (!params || params.length === 0) return '';
        const date = params[0].axisValue;
        const pt = data.find((d) => d.date === date);
        let html = `<div style="font-weight:600; margin-bottom:4px; color:#38bdf8;">${date} • ${areaName}</div>`;
        html += `<div style="font-size:10px; color:${pt?.valid_observation ? '#34d399' : '#f87171'}; margin-bottom:6px;">Status: ${pt?.valid_observation ? 'Valid Observation' : 'Cloud / Sensor Degraded'}</div>`;
        params.forEach((p) => {
          if (p.value !== null && p.value !== undefined) {
            html += `<div style="display:flex; justify-content:space-between; gap:12px; font-size:10px;">
              <span style="color:${p.color};">${p.seriesName}:</span>
              <span style="font-family:monospace; font-weight:600;">${p.value}</span>
            </div>`;
          }
        });
        return html;
      },
    },
    legend: {
      data: [
        'Nighttime Radiance (VIIRS nW)',
        'Tracking Effort (Hours)',
        'MSDI Drift Index',
        'Sen’s Slope Trendline',
        'NASA POWER 10m Wind (m/s)',
      ],
      textStyle: { color: '#94a3b8', fontSize: 10 },
      top: 0,
    },
    grid: {
      left: '4%',
      right: '6%',
      bottom: '12%',
      top: '16%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: dates,
      axisLine: { lineStyle: { color: '#1c3266' } },
      axisLabel: { color: '#64748b', fontSize: 10, rotate: 30 },
    },
    yAxis: [
      {
        type: 'value',
        name: 'MSDI & Normalized Proxy',
        nameTextStyle: { color: '#64748b', fontSize: 9 },
        splitLine: { lineStyle: { color: '#0f172a', type: 'dashed' } },
        axisLabel: { color: '#64748b', fontSize: 10 },
      },
      {
        type: 'value',
        name: 'NASA POWER Wind (m/s)',
        nameTextStyle: { color: '#a855f7', fontSize: 9 },
        position: 'right',
        splitLine: { show: false },
        axisLabel: { color: '#a855f7', fontSize: 10 },
      },
    ],
    series: [
      {
        name: 'MSDI Drift Index',
        type: 'line',
        data: msdi,
        yAxisIndex: 0,
        itemStyle: { color: '#f59e0b' },
        lineStyle: { width: 2.5 },
        smooth: true,
        markLine: {
          silent: true,
          lineStyle: { color: '#475569', type: 'dashed' },
          data: [{ yAxis: 0, label: { formatter: 'MSDI 0.0 (Matched)', position: 'insideEndTop' } }],
        },
      },
      {
        name: 'Sen’s Slope Trendline',
        type: 'line',
        data: trendLine,
        yAxisIndex: 0,
        lineStyle: { color: '#ef4444', width: 1.8, type: 'dashed' },
        showSymbol: false,
      },
      {
        name: 'Nighttime Radiance (VIIRS nW)',
        type: 'scatter',
        data: radianceRaw,
        yAxisIndex: 0,
        symbolSize: 6,
        itemStyle: { color: '#38bdf8' },
      },
      {
        name: 'Tracking Effort (Hours)',
        type: 'line',
        data: trackingRaw,
        yAxisIndex: 0,
        itemStyle: { color: '#10b981' },
        lineStyle: { width: 1.2, opacity: 0.8 },
      },
      {
        name: 'NASA POWER 10m Wind (m/s)',
        type: 'line',
        data: wind,
        yAxisIndex: 1,
        itemStyle: { color: '#a855f7' },
        lineStyle: { width: 1.5, type: 'dotted', opacity: 0.65 },
        areaStyle: {
          color: 'rgba(168, 85, 247, 0.08)',
        },
      },
    ],
  };

  return (
    <div className="w-full h-80 rounded-xl bg-ocean-950/70 border border-ocean-800/80 p-2">
      <ReactECharts
        option={option}
        style={{ height: '100%', width: '100%' }}
        notMerge={true}
        lazyUpdate={true}
      />
    </div>
  );
};
