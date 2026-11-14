import { useMemo, useState } from "react";
import type { MonthPoint, Trend } from "../api/types";
import { formatMonth } from "../lib/format";
import { S1B_GAP } from "../lib/constants";

const W = 400, H = 170, PAD = { l: 34, r: 8, t: 10, b: 22 };

type Line = { key: string; label: string; color: string; values: (number | null)[]; dashed?: boolean };

function indexToMean(v: (number | null)[]): (number | null)[] {
  const ok = v.filter((x): x is number => x != null);
  const m = ok.reduce((a, b) => a + b, 0) / (ok.length || 1);
  return v.map((x) => (x == null || !m ? null : (x / m) * 100));
}

function path(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = "", pen = false;
  values.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

export function SeriesChart({ series, finalTrend }: { series: MonthPoint[]; finalTrend: Trend }) {
  const [view, setView] = useState<"coverage" | "corrected">("coverage");
  const months = series.map((p) => p.month);

  const lines: Line[] = useMemo(() => {
    if (view === "coverage") {
      return [
        { key: "raw", label: "Vessels not on AIS, raw count", color: "var(--sounding)", values: indexToMean(series.map((p) => p.raw)), dashed: true },
        { key: "msdi", label: "Per Sentinel-1 pass (MSDI)", color: "var(--magenta)", values: indexToMean(series.map((p) => p.msdi)) },
      ];
    }
    const y = series.map((p) => p.environmentAdjusted);
    const s = finalTrend.slopePerMonth ?? 0;
    const resid = y.map((v, i) => (v == null ? null : v - s * i)).filter((v): v is number => v != null).sort((a, b) => a - b);
    const b = resid.length ? resid[Math.floor(resid.length / 2)] : 0;
    return [
      { key: "env", label: "After every correction", color: "var(--sounding)", values: y },
      { key: "sen", label: "Sen's slope trend", color: finalTrend.direction === "DECREASING" ? "var(--trend-down)" : "var(--trend-up)", values: y.map((_, i) => b + s * i) },
    ];
  }, [view, series, finalTrend]);

  const all = lines.flatMap((l) => l.values).filter((v): v is number => v != null);
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (i: number) => PAD.l + (i / Math.max(1, months.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - (lo - span * 0.05)) / (span * 1.1)) * (H - PAD.t - PAD.b);
  const gapStart = months.indexOf(S1B_GAP.start), gapEnd = months.indexOf(S1B_GAP.end);
  const years = months.map((m, i) => [m, i] as const).filter(([m]) => m.endsWith("-01"));
  const ticks = [lo, (lo + hi) / 2, hi];

  const summary = view === "coverage"
    ? "Raw detections and coverage-normalised MSDI, each indexed to its own mean. The shaded band marks the Sentinel-1B outage, when raw counts drop because the satellite imaged the area half as often."
    : `Fully corrected MSDI anomaly with Sen's slope trend line (${finalTrend.direction.toLowerCase()}).`;

  return (
    <div>
      <div className="segmented" role="group" aria-label="Chart view">
        <button type="button" aria-pressed={view === "coverage"} onClick={() => setView("coverage")}>Coverage check</button>
        <button type="button" aria-pressed={view === "corrected"} onClick={() => setView("corrected")}>Corrected trend</button>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        {gapStart >= 0 && view === "coverage" && (
          <g>
            <rect x={x(gapStart)} y={PAD.t} width={x(gapEnd >= 0 ? gapEnd : months.length - 1) - x(gapStart)} height={H - PAD.t - PAD.b}
              fill="var(--warn)" opacity={0.08} />
            <text x={x(gapStart) + 4} y={PAD.t + 10} style={{ fill: "var(--warn)" }}>Sentinel-1B offline: half the passes</text>
          </g>
        )}
        {ticks.map((t, i) => (
          <g key={i}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text x={PAD.l - 4} y={y(t) + 3} textAnchor="end">{span >= 10 ? t.toFixed(0) : t.toFixed(2)}</text>
          </g>
        ))}
        <line className="axis" x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} />
        {years.map(([m, i]) => (
          <text key={m} x={x(i)} y={H - 6} textAnchor="middle">{m.slice(0, 4)}</text>
        ))}
        {lines.map((l) => (
          <path key={l.key} d={path(l.values, x, y)} fill="none" stroke={l.color} strokeWidth={l.key === "sen" ? 2 : 1.5}
            strokeDasharray={l.dashed ? "3 2" : undefined} />
        ))}
      </svg>
      <div className="chart-legend">
        {lines.map((l) => (
          <span key={l.key}><i className="swatch" style={{ background: l.color }} />{l.label}</span>
        ))}
        {view === "coverage" && <span>Indexed so each line's average is 100, {formatMonth(months[0])} to {formatMonth(months[months.length - 1])}</span>}
      </div>
    </div>
  );
}
