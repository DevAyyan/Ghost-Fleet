import { describe, expect, it } from "vitest";
import type { Lead } from "./leads";
import { buildTour } from "./tour";

const lead = (vesselId: string | null): Lead => ({
  kind: "fishing", id: "f1", title: "Boat", what: "Fished in a no-take area", why: ["all fishing banned there"], score: 3, vesselId,
});

describe("buildTour", () => {
  it("walks record, ship, meaning, next step, using the record's own statements", () => {
    const steps = buildTour(lead("v1"), [
      { label: "OBSERVATION", text: "Seen fishing." }, { label: "HYPOTHESIS", text: "Maybe unlicensed." },
      { label: "RECOMMENDATION", text: "Check the permit list." },
    ]);
    expect(steps.map((s) => s.title)).toEqual(["Where it happened", "The ship and its path", "What it might mean", "What to check next"]);
    expect(steps[1].sel).toEqual({ kind: "vessel", id: "v1" });
    expect(steps.map((s) => s.text)).toContain("Maybe unlicensed.");
    expect(steps[3].text).toBe("Check the permit list.");
  });
  it("skips the ship step without a ship and falls back to plain text", () => {
    const steps = buildTour(lead(null), []);
    expect(steps).toHaveLength(3);
    expect(steps[2].text).toMatch(/permits/);
    expect(steps[1].text).toMatch(/not a finding/);
  });
});
