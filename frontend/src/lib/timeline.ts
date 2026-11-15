// A ship's period laid out along one line: when it went dark, against what else it was recorded doing.
import type { AisOffEvent, VesselPoint } from "../api/types";

/** Milliseconds for an API time: a full timestamp (with or without a zone) or a bare "YYYY-MM-DD" day, all read as UTC. */
export function timeMs(iso: string | null | undefined, endOfDay = false): number {
  if (!iso) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return Date.parse(`${iso}T00:00:00Z`) + (endOfDay ? 86400000 : 0);
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
}

export interface TimelineGap { gap: AisOffEvent; from: number; to: number; open: boolean }   // from/to: 0..1 across the period; open: not seen again
export interface TimelineMark { kind: VesselPoint["kind"]; at: number }
export interface Timeline { t0: number; t1: number; gaps: TimelineGap[]; marks: TimelineMark[]; ticks: number[]; counts: Partial<Record<VesselPoint["kind"], number>> }

const DAY = 86400000;

/** Positions along the period for every dark stretch and recorded event. Anything outside the period is clipped to it. */
export function timeline(start: string, end: string, points: VesselPoint[], gaps: AisOffEvent[]): Timeline | null {
  const t0 = timeMs(start), t1 = timeMs(end, true);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null;
  const pos = (t: number) => Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
  const counts: Timeline["counts"] = {};
  const marks: TimelineMark[] = [];
  for (const p of points) {
    if (p.kind === "gap_off" || p.kind === "gap_on") continue;   // drawn as stretches, from `gaps`
    const t = timeMs(p.time);
    if (!Number.isFinite(t) || t < t0 || t > t1) continue;
    counts[p.kind] = (counts[p.kind] ?? 0) + 1;
    marks.push({ kind: p.kind, at: pos(t) });
  }
  const spans: TimelineGap[] = [];
  for (const gap of gaps) {
    const a = timeMs(gap.start), b = timeMs(gap.end);
    if (!Number.isFinite(a) || a > t1 || (Number.isFinite(b) && b < t0)) continue;
    spans.push({ gap, from: pos(a), to: Number.isFinite(b) ? pos(b) : 1, open: !Number.isFinite(b) });
  }
  // a tick each week for periods up to about four months, otherwise one at the start of each month
  const days = (t1 - t0) / DAY, ticks: number[] = [];
  if (days <= 125) {
    for (let t = t0 + 7 * DAY; t < t1 - DAY; t += 7 * DAY) ticks.push(pos(t));
  } else {
    const d = new Date(t0);
    for (let m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); m < t1; m = Date.UTC(new Date(m).getUTCFullYear(), new Date(m).getUTCMonth() + 1, 1)) ticks.push(pos(m));
  }
  return { t0, t1, gaps: spans, marks, ticks, counts };
}
