// Guided tours: a few steps on a card over the map, each switching on the layers it talks about, moving the camera to
// what it shows and opening the record it describes. "Follow the top case" walks one lead; the themed tours (tours.ts)
// walk a question across several layers. Every step picks its record from the live data of the period, never a fixed one.
import type { AisOffResponse, CellSummary, EventSummary, OilSlick, ProtectedFishingEvent, Statement } from "../api/types";
import type { Lead } from "./leads";
import type { LayerId, Selection } from "./layers";

/** [[west, south], [east, north]], degrees. */
export type Bounds = [[number, number], [number, number]];
/** Where the camera goes: it zooms in or out until these bounds fill the map, no closer than maxZoom. */
export interface TourView { bounds: Bounds; maxZoom?: number }

/** What a step shows once its data is in. */
export interface StepShown {
  text: string;
  sel?: NonNullable<Selection>;     // the record or ship it opens
  view?: TourView;                  // left out: the map frames the open record (or the ship's path) itself
  slick?: { slick: OilSlick; rank: number };   // the slick the opened ship is a ranked Cerulean candidate source of: linked on the map
}

/** The data a step can pick from; `loading` says which of it is still on its way. */
export interface TourData {
  aisOff?: AisOffResponse;
  fishing?: ProtectedFishingEvent[];
  slicks?: OilSlick[];
  events?: EventSummary[];
  cells?: CellSummary[];
  loading: { aisOff: boolean; fishing: boolean; slicks: boolean; changes: boolean };
}

export interface TourStep {
  title: string;
  layers?: LayerId[];               // exactly these layers are drawn for the step; left out: the layers stay as they are
  noTakeOnly?: boolean;             // the protected-area filter for the step
  /** What the step shows from the data, or "loading" while what it needs is still coming. */
  show: (d: TourData) => StepShown | "loading";
}

export interface Tour { id: string; name: string; blurb: string; steps: TourStep[] }

export const first = (statements: Statement[] | undefined, label: Statement["label"]) => statements?.find((s) => s.label === label)?.text;

// ---------- camera helpers ----------
const clampLat = (v: number) => Math.max(-80, Math.min(84, v));
/** A box of about `km` around a point. */
export function around(lon: number, lat: number, km: number): Bounds {
  const dLat = km / 111;
  const dLon = Math.min(179, km / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180))));
  return [[Math.max(-180, lon - dLon), clampLat(lat - dLat)], [Math.min(180, lon + dLon), clampLat(lat + dLat)]];
}
/** The box around every point, widened to at least `minKm` across. */
export function boundsOf(points: [number, number][], minKm = 150): Bounds | null {
  if (!points.length) return null;
  const lons = points.map((p) => p[0]), lats = points.map((p) => p[1]);
  const w = Math.min(...lons), e = Math.max(...lons), s = Math.min(...lats), n = Math.max(...lats);
  const pad = around((w + e) / 2, (s + n) / 2, minKm / 2);
  return [[Math.min(w, pad[0][0]), Math.min(s, pad[0][1])], [Math.max(e, pad[1][0]), Math.max(n, pad[1][1])]];
}
/** Great-circle distance in km. */
export function km(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const WORLD: TourView = { bounds: [[-170, -55], [170, 72]] };

// ---------- "Follow the top case" ----------
export interface CaseStep { title: string; text: string; sel: NonNullable<Selection> }

/** The steps for one lead, from its record's own statements: where, the ship (when there is one), what it might mean, what to check. */
export function buildTour(lead: Lead, statements: Statement[]): CaseStep[] {
  const record = { kind: lead.kind, id: lead.id };
  const steps: CaseStep[] = [{
    title: "Where it happened",
    text: first(statements, "OBSERVATION") ?? `${lead.title}: ${lead.what}.`,
    sel: record,
  }];
  if (lead.vesselId) {
    steps.push({
      title: "The ship and its path",
      text: "Its recorded path for the period is now on the map. Dark stretches are where it stopped broadcasting AIS; "
        + "the timeline in the panel lists its fishing, port calls and meetings.",
      sel: { kind: "vessel", id: lead.vesselId },
    });
  }
  steps.push({
    title: "What it might mean",
    text: [first(statements, "HYPOTHESIS"), first(statements, "INFERENCE")].find(Boolean)
      ?? `It stands out because: ${lead.why.join("; ")}. That is a reason to look, not a finding.`,
    sel: record,
  });
  steps.push({
    title: "What to check next",
    text: first(statements, "RECOMMENDATION") ?? "Check the vessel against the permits and licences for the area before drawing any conclusion.",
    sel: record,
  });
  return steps;
}

/** The top case as a tour: its layers stay as they are and the map frames each record as it opens. */
export function caseTour(lead: Lead, statements: Statement[]): Tour {
  return {
    id: "top-case", name: "Follow the top case", blurb: lead.title,
    steps: buildTour(lead, statements).map((s) => ({ title: s.title, show: () => ({ text: s.text, sel: s.sel }) })),
  };
}
