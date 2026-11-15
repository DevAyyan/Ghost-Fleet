// The strongest leads of the period, across every kind of record, in one ranked list: where to start looking.
// The score is a plain rule of thumb (the reasons are shown beside each lead), never a measure of guilt.
import type { AisOffEvent, CoordinatedTurnOn, Encounter, OilSlick, ProtectedFishingEvent } from "../api/types";
import type { SeaKind } from "./layers";

export interface Lead {
  kind: SeaKind;
  id: string;
  title: string;                 // the vessel or place
  what: string;                  // what happened, in a few words
  why: string[];                 // what makes it stand out: the rule of thumb behind the score
  score: number;
  vesselId: string | null;       // the ship to follow, when there is one
}

export interface LeadInputs {
  aisOff?: AisOffEvent[];
  turnOns?: CoordinatedTurnOn[];
  fishing?: ProtectedFishingEvent[];
  encounters?: Encounter[];
  slicks?: OilSlick[];
}

const hours = (h: number | null | undefined) => (h == null ? "" : h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h)} h`);
const named = (n: string | null | undefined) => n?.trim() || "Unnamed vessel";

function fishingLeads(rows: ProtectedFishingEvent[]): Lead[] {
  return rows.map((f) => {
    const why = [f.fullNoTake ? "all fishing banned there" : "fishing banned in part of the area"];
    if ((f.durationHours ?? 0) >= 6) why.push(`fished about ${hours(f.durationHours)}`);
    return {
      kind: "fishing", id: f.id, title: named(f.vesselName), what: `Appeared to fish inside a protected area, ${f.place}`, why,
      score: (f.fullNoTake ? 3 : 2) + Math.min(1, (f.durationHours ?? 0) / 24), vesselId: f.vesselId ?? null,
    };
  });
}

function turnOnLeads(rows: CoordinatedTurnOn[]): Lead[] {
  return rows.filter((t) => t.count >= 2).map((t) => ({
    kind: "turnOn", id: t.id, title: t.place, what: `${t.count} vessels went dark together and came back together`,
    why: [`${t.count} vessels`, `dark together ${hours(t.sharedHours)}`],
    score: 2 + Math.min(2, Math.log2(t.count)), vesselId: t.vessels.find((v) => v.vesselId)?.vesselId ?? null,
  }));
}

function aisOffLeads(rows: AisOffEvent[]): Lead[] {
  // AIS gaps are many: only those with something more than the gap itself are leads worth putting first
  return rows.flatMap((e) => {
    const why: string[] = [];
    let score = 1;
    if (e.inNoTake) { why.push("went dark inside a no-take area"); score += 2; }
    else if (e.inProtectedArea) { why.push("went dark inside a protected area"); score += 1; }
    if ((e.durationHours ?? 0) >= 72) { why.push(`dark for ${hours(e.durationHours)}`); score += 0.5; }
    if ((e.distanceKm ?? 0) >= 200) { why.push(`moved ${Math.round(e.distanceKm!).toLocaleString()} km unseen`); score += 0.5; }
    if (!why.length) return [];
    return [{ kind: "aisOff" as const, id: e.id, title: named(e.vesselName), what: `Switched AIS off, ${e.place}`, why, score,
              vesselId: e.vesselId ?? null }];
  });
}

function encounterLeads(rows: Encounter[]): Lead[] {
  return rows.flatMap((e) => {
    const unlicensed = e.vessels.some((v) => v.authorisation === "NOT_FOUND");
    if (!e.darkLink && !unlicensed) return [];
    const why: string[] = [];
    if (e.darkLink) why.push("AIS switched off nearby");
    if (unlicensed) why.push("a vessel with no public licence");
    return [{
      kind: "encounter" as const, id: e.id, title: e.vessels.map((v) => named(v.name)).join(" + "), what: `Met at sea, ${e.place}`, why,
      score: 1.5 + (e.darkLink ? 1 : 0) + (unlicensed ? 1 : 0), vesselId: e.vessels.find((v) => v.vesselId)?.vesselId ?? null,
    }];
  });
}

function slickLeads(rows: OilSlick[]): Lead[] {
  return rows.flatMap((s) => {
    const best = s.candidates[0];
    if (!best || best.type !== "VESSEL") return [];
    const why = [`${Math.round(s.areaKm2).toLocaleString()} km² slick`, `best match: ${named(best.vesselName)}`];
    if (best.wentDark) why.push("that ship switched AIS off nearby");
    return [{ kind: "slick" as const, id: s.id, title: s.place, what: "Possible oil slick with a ship as its best-matching source", why,
              score: 2 + (best.wentDark ? 1.5 : 0) + Math.min(0.5, s.areaKm2 / 200), vesselId: null }];
  });
}

/** The `limit` strongest leads, with at most `perKind` of any one kind so the list shows the range of what is going on. */
export function rankLeads(inputs: LeadInputs, limit = 12, perKind = 4): Lead[] {
  const all = [
    ...fishingLeads(inputs.fishing ?? []), ...turnOnLeads(inputs.turnOns ?? []), ...aisOffLeads(inputs.aisOff ?? []),
    ...encounterLeads(inputs.encounters ?? []), ...slickLeads(inputs.slicks ?? []),
  ].sort((a, b) => b.score - a.score);
  const taken = new Map<SeaKind, number>();
  const out: Lead[] = [];
  for (const l of all) {
    const n = taken.get(l.kind) ?? 0;
    if (n >= perKind) continue;
    taken.set(l.kind, n + 1);
    out.push(l);
    if (out.length >= limit) break;
  }
  return out;
}
