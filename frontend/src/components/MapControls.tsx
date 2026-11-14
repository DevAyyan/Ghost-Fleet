import { useEffect, useState } from "react";
import { formatMonth } from "../lib/format";

interface Props {
  months: string[];
  monthIndex: number;
  onMonth: (i: number) => void;
  onAdvance: () => void;   // next month, wrapping to the start
}

/** Month scrubber for the radar layer, drawn as a chart scale bar. */
export function MapControls({ months, monthIndex, onMonth, onAdvance }: Props) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(onAdvance, 1500);
    return () => window.clearInterval(t);
  }, [playing, onAdvance]);

  const years = Object.entries(months.reduce<Record<string, number>>((acc, m) => {
    acc[m.slice(0, 4)] = (acc[m.slice(0, 4)] ?? 0) + 1;
    return acc;
  }, {}));

  return (
    <div className="map-overlay map-controls">
      <div className="slider-row">
        <span className="slider-title">Radar month</span>
        <button type="button" className="btn btn-sm" aria-label={playing ? "Pause animation" : "Play through months"}
          onClick={() => setPlaying((p) => !p)}>
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="scalebar">
          <input type="range" min={0} max={months.length - 1} value={monthIndex} aria-label="Month of radar detections"
            aria-valuetext={months[monthIndex] ? formatMonth(months[monthIndex]) : undefined}
            onChange={(e) => onMonth(Number(e.target.value))} />
          {/* alternating year segments, like the scale bar on a chart */}
          <div className="scalebar-years" aria-hidden="true">
            {years.map(([y, n]) => <span key={y} style={{ flex: n }} />)}
          </div>
          <div className="scalebar-labels" aria-hidden="true">
            {years.map(([y, n]) => <span key={y} style={{ flex: n }}>{n >= 6 ? y : ""}</span>)}
          </div>
        </div>
        <output className="slider-month">{months[monthIndex] ? formatMonth(months[monthIndex]) : "—"}</output>
      </div>
    </div>
  );
}
