import { describe, expect, it } from "vitest";
import type { AisOffEvent, VesselPoint } from "../api/types";
import { timeMs, timeline } from "./timeline";

const pt = (time: string, kind: VesselPoint["kind"]): VesselPoint => ({ time, lat: 0, lon: 0, kind, label: null });
const gap = (start: string, end: string | null): AisOffEvent => ({ id: start, lat: 0, lon: 0, start, end, durationHours: 24, distanceKm: 1, vesselName: null,
  flag: null, vesselType: null, shoreKm: null, place: "sea", inProtectedArea: false, inNoTake: false, highSeas: true, statements: [] });

describe("timeline", () => {
  it("reads bare days and timestamps as UTC", () => {
    expect(timeMs("2026-11-01")).toBe(Date.UTC(2026, 10, 1));
    expect(timeMs("2026-11-01", true)).toBe(Date.UTC(2026, 10, 2));
    expect(timeMs("2026-11-01T12:00:00")).toBe(timeMs("2026-11-01T12:00:00Z"));
    expect(timeMs(null)).toBeNaN();
  });
  it("places events and dark stretches across the period, inclusive of its last day", () => {
    const tl = timeline("2026-11-01", "2026-11-10", [pt("2026-11-06T00:00:00Z", "fishing"), pt("2026-11-03T00:00:00Z", "gap_off")],
      [gap("2026-11-03T00:00:00Z", "2026-11-05T00:00:00Z")])!;
    expect(tl.marks).toEqual([{ kind: "fishing", at: 0.5 }]);            // gap points are not marks
    expect(tl.counts).toEqual({ fishing: 1 });
    expect(tl.gaps[0].from).toBeCloseTo(0.2);
    expect(tl.gaps[0].to).toBeCloseTo(0.4);
    expect(tl.gaps[0].open).toBe(false);
    expect(tl.ticks).toHaveLength(1);                                    // one week mark in ten days
  });
  it("runs an unfinished dark stretch to the end and clips one that began before the period", () => {
    const tl = timeline("2026-11-01", "2026-11-10", [], [gap("2026-11-08T00:00:00Z", null), gap("2026-10-20T00:00:00Z", "2026-11-02T00:00:00Z")])!;
    expect(tl.gaps[0]).toMatchObject({ to: 1, open: true });
    expect(tl.gaps[1].from).toBe(0);
    expect(tl.gaps[1].to).toBeCloseTo(0.1);
  });
  it("gives nothing for an unusable period", () => {
    expect(timeline("", "2026-11-10", [], [])).toBeNull();
  });
});
