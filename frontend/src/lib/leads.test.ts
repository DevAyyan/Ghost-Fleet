import { describe, expect, it } from "vitest";
import type { AisOffEvent, Encounter, OilSlick, ProtectedFishingEvent } from "../api/types";
import { rankLeads } from "./leads";

const fish = (id: string, fullNoTake: boolean, durationHours = 2): ProtectedFishingEvent => ({
  id, lat: 0, lon: 0, start: null, end: null, durationHours, vesselName: `F${id}`, flag: null, vesselType: "fishing",
  shoreKm: null, fullNoTake, place: "Somewhere", statements: [], vesselId: `v${id}`,
});
const gap = (id: string, over: Partial<AisOffEvent> = {}): AisOffEvent => ({
  id, lat: 0, lon: 0, start: null, end: null, durationHours: 10, distanceKm: 10, vesselName: null, flag: null, vesselType: null,
  shoreKm: null, place: "Here", inProtectedArea: false, inNoTake: false, highSeas: false, statements: [], ...over,
});

describe("rankLeads", () => {
  it("puts fishing where all fishing is banned above partly no-take areas", () => {
    const leads = rankLeads({ fishing: [fish("a", false), fish("b", true)] });
    expect(leads.map((l) => l.id)).toEqual(["b", "a"]);
    expect(leads[0].why[0]).toMatch(/all fishing banned/);
    expect(leads[0].vesselId).toBe("vb");
  });

  it("leaves out ordinary AIS gaps and keeps those with more to them", () => {
    const leads = rankLeads({ aisOff: [gap("plain"), gap("mpa", { inNoTake: true }), gap("far", { distanceKm: 500 })] });
    expect(leads.map((l) => l.id).sort()).toEqual(["far", "mpa"]);
    expect(leads[0].id).toBe("mpa");
  });

  it("caps each kind so one layer cannot fill the list", () => {
    const fishing = Array.from({ length: 10 }, (_, i) => fish(String(i), true));
    const leads = rankLeads({ fishing, aisOff: [gap("g", { inProtectedArea: true })] }, 12, 4);
    expect(leads.filter((l) => l.kind === "fishing")).toHaveLength(4);
    expect(leads.some((l) => l.kind === "aisOff")).toBe(true);
  });

  it("only counts encounters with a dark link or an unlicensed vessel, and slicks matched to a ship", () => {
    const enc = (id: string, darkLink: boolean): Encounter => ({
      id, lat: 0, lon: 0, start: null, end: null, durationHours: 3, type: null, medianDistanceKm: null, medianSpeedKnots: null,
      potentialRisk: false, shoreKm: null, highSeas: true, place: "P", rfmo: [], darkLink, statements: [],
      vessels: [{ vesselId: "x", name: "X", flag: null, vesselType: "carrier", mmsi: null, authorisation: "AUTHORISED", wentDark: false }],
    });
    const slick = (id: string, type: "VESSEL" | "UNKNOWN"): OilSlick => ({
      id, lat: 0, lon: 0, time: null, areaKm2: 50, lengthKm: 10, confidence: 0.9, possibleSource: "VESSEL", place: "S", url: null,
      statements: [], candidates: [{ rank: 1, type, ref: "1", score: 0.8, url: null, wentDark: false, vesselName: "Tanker" }],
    });
    const leads = rankLeads({ encounters: [enc("quiet", false), enc("dark", true)], slicks: [slick("s1", "VESSEL"), slick("s2", "UNKNOWN")] });
    expect(leads.map((l) => l.id).sort()).toEqual(["dark", "s1"]);
  });

  it("returns nothing when nothing is loaded", () => expect(rankLeads({})).toEqual([]));
});
