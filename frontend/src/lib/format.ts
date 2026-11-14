import type { Direction } from "../api/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2022-01" -> "Jan 2022" */
export function formatMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return ym;
  return `${MONTHS[m - 1]} ${y}`;
}

/** Signed percent per year, e.g. "+8.6%/yr". Null -> "—". */
export function formatPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v.toFixed(digits);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s.replace("-", "")}%/yr`;
}

/** q/p values: "< 0.001", "0.032", "0.41". */
export function formatP(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v < 0.001) return "< 0.001";
  if (v < 0.01) return v.toFixed(3);
  return v.toFixed(2);
}

export function formatShare(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function directionWord(d: Direction): string {
  return d === "INCREASING" ? "Increasing" : d === "DECREASING" ? "Decreasing" : "No trend";
}

/** Text glyph so direction never relies on colour alone. */
export function directionGlyph(d: Direction): string {
  return d === "INCREASING" ? "▲" : d === "DECREASING" ? "▼" : "●";
}

/** "N24.61E66.80" -> "24.61°N 66.80°E", "S34.45W18.98" -> "34.45°S 18.98°W"; synthetic "syn_2_2" -> "Cell 2·2". */
export function humanCellId(id: string): string {
  const m = /^([NS])(-?[\d.]+)([EW])(-?[\d.]+)$/.exec(id);
  if (m) return `${m[2]}°${m[1]} ${m[4]}°${m[3]}`;
  return id.replace(/^syn_/, "Cell ").replace(/_/g, "·");
}

/** ISO timestamp -> "10 Nov 2026" (UTC). */
export function formatDay(iso: string | null | undefined): string {
  const d = iso ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`) : null;
  if (!d || Number.isNaN(d.getTime())) return "unknown date";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 13 -> "13 hours", 96 -> "4 days". */
export function formatSpan(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "unknown time";
  if (hours < 48) return `${Math.round(hours)} ${Math.round(hours) === 1 ? "hour" : "hours"}`;
  return `${Math.round(hours / 24)} days`;
}

const VESSEL_WORD: Record<string, string> = { fishing: "Fishing vessel", cargo: "Cargo ship", carrier: "Refrigerated carrier", bunker: "Bunker tanker" };
export function vesselWord(type: string | null | undefined): string {
  return (type && VESSEL_WORD[type]) || "Vessel";
}

/** ISO timestamp -> "14 Nov 2026, 08:41 UTC". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "unknown time";
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return "unknown time";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** ISO timestamp -> "14 Nov 2026, 08:41 UTC". */
export function formatFetched(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}
