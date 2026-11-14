import { describe, expect, it } from "vitest";
import { ApiError, _request, toApiError } from "../api/client";
import { divergingColor, robustMax, sequentialColor } from "./color";
import { trackFeatures } from "./track";
import type { VesselResponse } from "../api/types";
import { imageDay, lastDays, monthsIn, periodProblem, spanDays } from "./layers";
import { directionGlyph, formatDay, formatMonth, formatP, formatPct, formatSpan, humanCellId, vesselWord } from "./format";

describe("format", () => {
  it("formats months", () => {
    expect(formatMonth("2022-01")).toBe("Jan 2022");
    expect(formatMonth("garbage")).toBe("garbage");
  });
  it("formats signed percent with a true minus sign", () => {
    expect(formatPct(8.64)).toBe("+8.6%/yr");
    expect(formatPct(-10.5)).toBe("−10.5%/yr");
    expect(formatPct(0)).toBe("0.0%/yr");
    expect(formatPct(null)).toBe("—");
  });
  it("formats p/q values", () => {
    expect(formatP(0.00001)).toBe("< 0.001");
    expect(formatP(0.0042)).toBe("0.004");
    expect(formatP(0.41)).toBe("0.41");
    expect(formatP(null)).toBe("—");
  });
  it("never relies on colour alone for direction", () => {
    expect(directionGlyph("INCREASING")).toBe("▲");
    expect(directionGlyph("DECREASING")).toBe("▼");
  });
  it("humanises synthetic ids", () => expect(humanCellId("syn_2_2")).toBe("Cell 2·2"));
  it("formats days, spans and vessel types for the sea layers", () => {
    expect(formatDay("2026-11-10T07:21:55.000Z")).toBe("10 Nov 2026");
    expect(formatDay("2026-10-15T22:09:05")).toBe("15 Oct 2026");          // Cerulean times carry no zone: read as UTC
    expect(formatDay(null)).toBe("unknown date");
    expect(formatSpan(13.4)).toBe("13 hours");
    expect(formatSpan(96)).toBe("4 days");
    expect(vesselWord("carrier")).toBe("Refrigerated carrier");
    expect(vesselWord(null)).toBe("Vessel");
  });
  it("validates and measures periods", () => {
    const now = new Date("2026-11-14T12:00:00Z");
    expect(lastDays(30, now)).toEqual({ start: "2026-10-15", end: "2026-11-14" });
    expect(spanDays({ start: "2026-05-07", end: "2026-07-09" })).toBe(64);
    expect(periodProblem({ start: "2026-05-07", end: "2026-07-09" }, now)).toBeNull();
    expect(periodProblem({ start: "2026-07-09", end: "2026-05-07" }, now)).toMatch(/after/);
    expect(periodProblem({ start: "2026-11-01", end: "2026-11-20" }, now)).toMatch(/future/);
    expect(periodProblem({ start: "2019-12-01", end: "2020-01-05" }, now)).toMatch(/2020/);
    expect(periodProblem({ start: "2024-01-01", end: "2025-06-01" }, now)).toMatch(/year/);
    expect(periodProblem({ start: "", end: "2025-06-01" }, now)).toMatch(/both/);
  });
  it("maps a period onto radar months and NASA image days", () => {
    const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
    expect(monthsIn({ start: "2026-05-07", end: "2026-07-09" }, months)).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(monthsIn({ start: "2026-11-01", end: "2026-11-14" }, months)).toEqual(["2026-10"]);     // no radar yet: newest month
    const now = new Date("2026-11-14T12:00:00Z");
    expect(imageDay({ start: "2026-05-07", end: "2026-07-09" }, 3, now)).toBe("2026-07-09");
    expect(imageDay({ start: "2026-10-15", end: "2026-11-14" }, 3, now)).toBe("2026-11-11");
  });
  it("shades a ship's path from its start to its latest position", () => {
    const pt = (time: string, lon: number, kind: string, eventId?: string) => ({ time, lat: -17, lon, kind, label: null, eventId });
    const track = { points: [
      pt("2026-08-01T00:00:00Z", 178, "port_visit"), pt("2026-08-03T00:00:00Z", 179.5, "gap_off", "g"),
      pt("2026-08-05T00:00:00Z", -179.5, "gap_on", "g"), pt("2026-08-09T00:00:00Z", -178, "fishing"),
    ] } as unknown as VesselResponse;
    const g = trackFeatures(track);
    const props = g.lines.features.map((f) => f.properties as { dark: boolean; t: number });
    expect(props.map((p) => p.dark)).toEqual([false, true, false]);          // only the stretch between off and on is unseen
    expect(props[0].t).toBeLessThan(props[1].t);
    expect(props[1].t).toBeLessThan(props[2].t);                             // later stretches are darker
    expect(props[0].t).toBeCloseTo(0.125);                                   // by time, not by position in the list
    expect(g.coords.map((c) => c[0])).toEqual([178, 179.5, 180.5, 182]);     // crosses the antimeridian without wrapping
    expect(g.start).toEqual({ at: [178, -17], time: "2026-08-01T00:00:00Z" });
    expect(g.latest).toEqual({ at: [182, -17], time: "2026-08-09T00:00:00Z" });
    expect(trackFeatures(undefined).start).toBeNull();
  });
  it("humanises cell ids in every hemisphere", () => {
    expect(humanCellId("N24.61E66.80")).toBe("24.61°N 66.80°E");
    expect(humanCellId("S34.45W18.98")).toBe("34.45°S 18.98°W");
  });
});

describe("color", () => {
  it("diverges blue (down) / orange (up) and saturates", () => {
    expect(divergingColor(15)).toBe("#e68522");
    expect(divergingColor(99)).toBe("#e68522");
    expect(divergingColor(-15)).toBe("#2774c4");
    expect(divergingColor(0)).toBe(divergingColor(null));
  });
  it("sequential handles nulls and zero max", () => {
    expect(sequentialColor(null, 1)).toBe("#1b2430");
    expect(sequentialColor(1, 0)).toBe("#1b2430");
    expect(sequentialColor(2, 1)).toBe("#7dd3fc");
  });
  it("robustMax ignores a single outlier", () => {
    const v = [...Array.from({ length: 99 }, (_, i) => i / 100), 1000];
    expect(robustMax(v)).toBeLessThan(1);
    expect(robustMax([null, null])).toBe(1);
  });
});

describe("api client errors", () => {
  it("parses the backend error envelope", async () => {
    const res = new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Event 'X' not found" } }), { status: 404 });
    const e = await toApiError(res);
    expect(e).toBeInstanceOf(ApiError);
    expect([e.status, e.code, e.message]).toEqual([404, "NOT_FOUND", "Event 'X' not found"]);
  });
  it("degrades gracefully for non-JSON server errors", async () => {
    const e = await toApiError(new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(e.code).toBe("SERVER_UNAVAILABLE");
  });
  it("maps network failures to NETWORK_ERROR", async () => {
    const failing = (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    await expect(_request("/api/meta", undefined, failing)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});
