import type { KeyboardEvent } from "react";
import type { AisOffEvent, VesselPoint } from "../api/types";
import { formatDay, formatSpan } from "../lib/format";
import { ICONS, type IconDef, type IconName } from "../lib/icons";
import { timeline } from "../lib/timeline";
import { Glyph } from "./Glyph";

interface Props {
  start: string;
  end: string;
  points: VesselPoint[];
  gaps: AisOffEvent[];
  onFocus: (lat: number, lon: number, key: string) => void;
}

const W = 400, X0 = 8, X1 = 392, EVENTS_Y = 18, AIS_Y = 42, AXIS_Y = 58;
const x = (f: number) => X0 + f * (X1 - X0);

/** A chart symbol placed inside the timeline, centred on (cx, cy). */
function Mark({ name, cx, cy, size }: { name: IconName; cx: number; cy: number; size: number }) {
  const def: IconDef = ICONS[name], k = size / 24;
  return (
    <g transform={`translate(${cx - size / 2} ${cy - size / 2}) scale(${k})`}>
      {def.shapes.filter((s) => !s.detail).map((s, i) => (
        <path key={i} d={s.d} fill={s.fill ?? "none"} stroke={s.stroke} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </g>
  );
}

/** The period as one line: broken where the ship was dark, with what else it was recorded doing marked above. */
export function VesselTimeline({ start, end, points, gaps, onFocus }: Props) {
  const tl = timeline(start, end, points, gaps);
  if (!tl) return null;
  const n = tl.counts;
  const summary = [
    `${tl.gaps.length} dark ${tl.gaps.length === 1 ? "stretch" : "stretches"}`,
    n.fishing ? `${n.fishing} apparent fishing ${n.fishing === 1 ? "event" : "events"}` : "",
    n.port_visit ? `${n.port_visit} port ${n.port_visit === 1 ? "call" : "calls"}` : "",
    n.encounter ? `${n.encounter} ${n.encounter === 1 ? "meeting" : "meetings"} with another vessel` : "",
    n.loitering ? `${n.loitering} loitering ${n.loitering === 1 ? "event" : "events"}` : "",
  ].filter(Boolean).join(", ");
  const press = (go: () => void) => (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };

  return (
    <figure className="tape">
      <svg viewBox={`0 0 ${W} 74`} role="group" aria-label={`Timeline from ${formatDay(start)} to ${formatDay(end)}: ${summary}.`}>
        {/* what it was recorded doing */}
        <g aria-hidden="true">
          {tl.marks.filter((m) => m.kind === "fishing").map((m, i) => <path key={`f${i}`} className="tape-fish" d={`M${x(m.at)} ${EVENTS_Y - 6}V${EVENTS_Y + 6}`} />)}
          {tl.marks.filter((m) => m.kind === "loitering").map((m, i) => <circle key={`l${i}`} className="tape-loiter" cx={x(m.at)} cy={EVENTS_Y} r={3.4} />)}
          {tl.marks.filter((m) => m.kind === "encounter").map((m, i) => <Mark key={`e${i}`} name="meet-carrier" cx={x(m.at)} cy={EVENTS_Y} size={15} />)}
          {tl.marks.filter((m) => m.kind === "port_visit").map((m, i) => <Mark key={`p${i}`} name="anchor" cx={x(m.at)} cy={EVENTS_Y} size={15} />)}
        </g>
        {/* the AIS record: a solid line, broken wherever the signal stopped */}
        <path className="tape-seen" d={`M${X0} ${AIS_Y}H${X1}`} aria-hidden="true" />
        {tl.gaps.map(({ gap, from, to, open }, i) => {
          const a = x(from), b = Math.max(x(to), a + 3);
          const go = () => onFocus(gap.lat, gap.lon, `gap:${gap.id}`);
          return (
            <g key={gap.id} className="tape-gap" role="button" tabIndex={0} onClick={go} onKeyDown={press(go)}
              aria-label={`Dark stretch ${i + 1}: ${formatDay(gap.start)}, ${gap.place}, for ${formatSpan(gap.durationHours)}${open ? ", not seen since" : ""}. Show it on the map.`}>
              <rect className="tape-hit" x={a - 5} y={AIS_Y - 11} width={b - a + 10} height={22} />
              <path className="tape-cut" d={`M${a} ${AIS_Y}H${b}`} />
              <path className="tape-dark" d={`M${a} ${AIS_Y}H${b}`} />
              <circle className="tape-off" cx={a} cy={AIS_Y} r={4} />
              {!open && <circle className="tape-on" cx={b} cy={AIS_Y} r={3.2} />}
              <text className="tape-n" x={(a + b) / 2} y={AIS_Y - 8} textAnchor="middle">{i + 1}</text>
            </g>
          );
        })}
        <g className="tape-axis" aria-hidden="true">
          <path d={`M${X0} ${AXIS_Y - 4}V${AXIS_Y + 2}M${X1} ${AXIS_Y - 4}V${AXIS_Y + 2}${tl.ticks.map((t) => `M${x(t)} ${AXIS_Y - 2}V${AXIS_Y + 2}`).join("")}`} />
          <text x={X0} y={72}>{formatDay(start)}</text>
          <text x={X1} y={72} textAnchor="end">{formatDay(end)}</text>
        </g>
      </svg>
      <figcaption className="track-legend">
        <span><i className="tape-key tape-key-seen" />No AIS gap recorded</span>
        <span><i className="tape-key tape-key-dark" />Dark; numbered as in the list below</span>
        {n.fishing ? <span><i className="tape-key tape-key-fish" />Apparent fishing</span> : null}
        {n.port_visit ? <span><Glyph name="anchor" size={14} />Port call</span> : null}
        {n.encounter ? <span><Glyph name="meet-carrier" size={14} />Met another vessel</span> : null}
        {n.loitering ? <span><i className="tape-key tape-key-loiter" />Loitering</span> : null}
      </figcaption>
    </figure>
  );
}
