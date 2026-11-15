// The months the "Lasting changes" trend scan runs over. Separate from the period of the other layers: a trend needs
// years of monthly data (the seasonal correction needs every calendar month twice), the period is at most a year.
import { createContext } from "react";

export interface ChangeSpan { start: string; end: string }   // "YYYY-MM", inclusive
export const MIN_SPAN_MONTHS = 24;

/** null means every month in the panel: the precomputed scan. */
export const ChangeSpanContext = createContext<ChangeSpan | null>(null);

export function monthsBetween(start: string, end: string): number {
  const [ay, am] = start.split("-").map(Number), [by, bm] = end.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) + 1;
}

/** Why a span cannot be scanned, or null if it can. `available` is the panel's months, oldest first. */
export function spanProblem(s: ChangeSpan, available: string[]): string | null {
  const month = /^\d{4}-\d{2}$/;
  if (!month.test(s.start) || !month.test(s.end)) return "Pick both months.";
  if (s.start > s.end) return "The first month is after the last.";
  if (available.length && (s.start < available[0] || s.end > available[available.length - 1]))
    return `Data covers ${available[0]} to ${available[available.length - 1]}.`;
  if (monthsBetween(s.start, s.end) < MIN_SPAN_MONTHS) return `Pick at least ${MIN_SPAN_MONTHS} months: a trend needs each month of the year twice.`;
  return null;
}

/** The query string for a span ("" for the whole panel), to append to a change endpoint. */
export function spanQuery(s: ChangeSpan | null, sep: "?" | "&" = "?"): string {
  return s ? `${sep}start=${s.start}&end=${s.end}` : "";
}

/** A span that covers every available month is the whole panel. */
export function normalSpan(s: ChangeSpan | null, available: string[]): ChangeSpan | null {
  if (!s || !available.length) return s;
  return s.start === available[0] && s.end === available[available.length - 1] ? null : s;
}
