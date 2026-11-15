import { describe, expect, it } from "vitest";
import { ghostIcon, hullIcon, vesselClass } from "./vessel";

describe("vessel class", () => {
  it("reads an event's vessel type", () => {
    expect(vesselClass("fishing")).toBe("fishing");
    expect(vesselClass("carrier")).toBe("carrier");
    expect(vesselClass("bunker")).toBe("bunker");
    expect(vesselClass("cargo")).toBe("cargo");
    expect(vesselClass(null)).toBe("other");
  });
  it("reads an identity's gear list", () => {
    expect(vesselClass(null, ["DRIFTING_LONGLINES"])).toBe("fishing");
    expect(vesselClass(null, ["SQUID_JIGGER"])).toBe("fishing");
    expect(vesselClass(null, ["CARRIER"])).toBe("carrier");
    expect(vesselClass(null, ["PASSENGER"])).toBe("other");
  });
  it("picks a drawing for each class, and a plain ship when the class is unknown", () => {
    expect(ghostIcon("fishing")).toBe("ghost-fishing");
    expect(ghostIcon("carrier")).toBe("ghost-carrier");
    expect(ghostIcon("bunker")).toBe("ghost-tanker");
    expect(hullIcon("cargo")).toBe("hull-cargo");
    expect(hullIcon("other")).toBe("hull-ship");
  });
});
