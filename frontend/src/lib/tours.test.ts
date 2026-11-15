import { describe, expect, it } from "vitest";
import type { AisOffEvent, AisOffResponse, CoordinatedTurnOn, EventSummary, OilSlick, ProtectedFishingEvent } from "../api/types";
import { around, boundsOf, km, type StepShown, type TourData } from "./tour";
import { ARABIAN_SEA, THEMED_TOURS, pickChange, pickSlick } from "./tours";

const idle = { aisOff: false, fishing: false, slicks: false, changes: false };
const tour = (id: string) => THEMED_TOURS.find((t) => t.id === id)!;
const shown = (r: StepShown | "loading") => { if (r === "loading") throw new Error("still loading"); return r; };

const gap = (o: Partial<AisOffEvent>): AisOffEvent => ({
  id: "g", lat: 0, lon: 0, start: "2026-10-01T00:00:00Z", end: null, durationHours: 10, distanceKm: 5, vesselName: "Dark One",
  flag: null, vesselType: null, shoreKm: null, place: "Somewhere", inProtectedArea: false, inNoTake: false, highSeas: true,
  statements: [], vesselId: "v-gap", mmsi: "111", ...o,
});
const slick = (o: Partial<OilSlick>): OilSlick => ({
  id: "s", lat: 0, lon: 0, time: "2026-10-01T06:00:00Z", areaKm2: 10, lengthKm: 5, confidence: 0.9, possibleSource: "VESSEL",
  place: "Off a coast", url: null, statements: [], candidates: [], ...o,
});

describe("camera helpers", () => {
  it("measures and boxes", () => {
    expect(km(0, 0, 1, 0)).toBeCloseTo(111.2, 0);
    const b = around(60, 20, 111);
    expect(b[0][1]).toBeCloseTo(19, 1);
    expect(b[1][1]).toBeCloseTo(21, 1);
    expect(boundsOf([])).toBeNull();
    const wide = boundsOf([[10, 10], [30, 20]])!;
    expect(wide).toEqual([[10, 10], [30, 20]]);
  });
});

describe("pickSlick", () => {
  it("prefers a slick whose Cerulean candidate went dark and is in the AIS-off records", () => {
    const near = slick({ id: "near", lon: 1, lat: 1, areaKm2: 50 });
    const cand = slick({ id: "cand", lon: 40, lat: 10, areaKm2: 5,
      candidates: [{ rank: 2, type: "VESSEL", ref: "222", score: 0.5, url: null, wentDark: true, vesselName: "B" }] });
    const p = pickSlick([near, cand], [gap({ id: "a", lon: 1.1, lat: 1 }), gap({ id: "b", lon: 45, lat: 10, mmsi: "222", vesselId: "v-b" })]);
    expect(p?.slick.id).toBe("cand");
    expect(p?.candidateRank).toBe(2);
    expect(p?.gap?.vesselId).toBe("v-b");
  });
  it("otherwise takes the closest switch-off within reach in place and time", () => {
    const p = pickSlick([slick({ id: "x", lon: 0, lat: 0 }), slick({ id: "y", lon: 50, lat: 0 })],
      [gap({ id: "far", lon: 10, lat: 0 }), gap({ id: "close", lon: 50.5, lat: 0 }), gap({ id: "late", lon: 0.1, lat: 0, start: "2026-12-01T00:00:00Z" })]);
    expect(p?.slick.id).toBe("y");
    expect(p?.gap?.id).toBe("close");
    expect(p?.candidateRank).toBeNull();
  });
  it("falls back to the largest slick when no ship went dark nearby", () => {
    const p = pickSlick([slick({ id: "small", areaKm2: 1 }), slick({ id: "big", areaKm2: 9 })], [gap({ lon: 120, lat: 0 })]);
    expect(p).toMatchObject({ gap: null });
    expect(p?.slick.id).toBe("big");
    expect(pickSlick([], [])).toBeNull();
  });
});

describe("pickChange", () => {
  const ev = (eventId: string, rank: number, leadCellId: string) => ({ eventId, rank, leadCellId, cellIds: [leadCellId] }) as EventSummary;
  const cells = [{ cellId: "gulf", center: [58, 24] as [number, number] }, { cellId: "pacific", center: [-150, 0] as [number, number] }];
  it("takes the strongest change in the region, else the strongest anywhere", () => {
    expect(pickChange([ev("p", 1, "pacific"), ev("g", 3, "gulf")], cells, ARABIAN_SEA)).toMatchObject({ event: { eventId: "g" }, local: true });
    expect(pickChange([ev("p", 1, "pacific")], cells, ARABIAN_SEA)).toMatchObject({ event: { eventId: "p" }, local: false });
    expect(pickChange([], cells, ARABIAN_SEA)).toBeNull();
  });
});

describe("themed tours", () => {
  it("are the four themes, each step naming the layers it draws", () => {
    expect(THEMED_TOURS.map((t) => t.id)).toEqual(["fisheries", "dark-fleet", "trade", "environment"]);
    for (const t of THEMED_TOURS) for (const s of t.steps) expect(s.layers?.length).toBeGreaterThan(0);
    expect(tour("fisheries").steps[0].layers).toEqual(["chlorophyll", "nightLights"]);
  });

  it("wait while their data loads, and say so plainly when the period has nothing", () => {
    expect(tour("dark-fleet").steps[1].show({ loading: { ...idle, aisOff: true } })).toBe("loading");
    const empty: TourData = { loading: idle, fishing: [], slicks: [], events: [], cells: [],
      aisOff: { events: [], hotspots: [], turnOnClusters: [] } as unknown as AisOffResponse };
    for (const t of THEMED_TOURS) {
      for (const s of t.steps) {
        const r = shown(s.show(empty));
        expect(r.text.length).toBeGreaterThan(20);
        expect(r.sel).toBeUndefined();
      }
    }
  });

  it("dark fleet: opens the biggest group that went dark together, then one of its ships", () => {
    const cluster = (id: string, count: number): CoordinatedTurnOn => ({
      id, lat: 5, lon: 5, enterLat: 4, enterLon: 4, exitLat: 6, exitLon: 6, radiusKm: 30, count, sharedHours: 3, spanHours: 5,
      coPresenceStart: "", coPresenceEnd: "", earliest: "", latest: "", place: `Place ${id}`, topFlags: [], vesselTypes: [], statements: [],
      vessels: [{ vesselId: null, vesselName: null, vesselType: null, flag: null, end: null, durationHours: 3, distanceKm: 1,
        enterLat: 4, enterLon: 4, exitLat: 6, exitLon: 6, lat: 5, lon: 5 },
        { vesselId: `ship-${id}`, vesselName: "Second", vesselType: null, flag: null, end: null, durationHours: 3, distanceKm: 1,
        enterLat: 4, enterLon: 4, exitLat: 6, exitLon: 6, lat: 5, lon: 5 }],
    });
    const d: TourData = { loading: idle, aisOff: { events: [], hotspots: [], turnOnClusters: [cluster("a", 2), cluster("b", 6)] } as unknown as AisOffResponse };
    const steps = tour("dark-fleet").steps.map((s) => shown(s.show(d)));
    expect(steps[1].sel).toEqual({ kind: "turnOn", id: "b" });
    expect(steps[1].view?.maxZoom).toBe(7);
    expect(steps[2].sel).toEqual({ kind: "vessel", id: "ship-b" });
    expect(steps[2].view).toBeUndefined();   // the ship's own path frames the map
  });

  it("fisheries: zooms out on the region first, then in on the strongest fishing record", () => {
    const f = { id: "f1", lat: 10, lon: 70, start: null, end: null, durationHours: 12, vesselName: "Boat", flag: null, vesselType: null,
      shoreKm: null, fullNoTake: true, place: "A reserve", statements: [{ label: "OBSERVATION", text: "Seen fishing in the reserve." }],
      vesselId: "v1" } as ProtectedFishingEvent;
    const d: TourData = { loading: idle, fishing: [f] };
    const [region, record, ship] = tour("fisheries").steps.map((s) => shown(s.show(d)));
    expect(region.view?.maxZoom).toBe(5);
    expect(record).toMatchObject({ sel: { kind: "fishing", id: "f1" }, text: "Seen fishing in the reserve." });
    expect(record.view!.maxZoom).toBeGreaterThan(region.view!.maxZoom!);
    expect(ship.sel).toEqual({ kind: "vessel", id: "v1" });
  });

  it("environment: links the ship to the slick only when Cerulean ranked it", () => {
    const s = slick({ lon: 1, lat: 1 });
    const d: TourData = { loading: idle, slicks: [s], aisOff: { events: [gap({ lon: 1.2, lat: 1 })] } as unknown as AisOffResponse };
    const ship = shown(tour("environment").steps[2].show(d));
    expect(ship.sel).toEqual({ kind: "vessel", id: "v-gap" });
    expect(ship.slick).toBeUndefined();
  });
});
