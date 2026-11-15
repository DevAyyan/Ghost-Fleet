import { describe, expect, it } from "vitest";
import { shipRadius, shipSvg } from "./ship3d";

describe("3D ships", () => {
  it("draws every kind as a square SVG centred on the ship", () => {
    for (const kind of ["fishing", "cargo", "carrier", "tanker", "ship"] as const) {
      const svg = shipSvg({ kind, heading: 60 }), r = shipRadius(kind);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain(`viewBox="${-r} ${-r} ${2 * r} ${2 * r}"`);
      expect(svg.match(/<polygon/g)!.length).toBeGreaterThan(12);
      expect(svg).not.toContain("NaN");
    }
  });
  it("returns the same markup for the same ship, and different markup when it turns", () => {
    expect(shipSvg({ kind: "cargo", heading: 90 })).toBe(shipSvg({ kind: "cargo", heading: 450 }));
    expect(shipSvg({ kind: "cargo", heading: 90 })).not.toBe(shipSvg({ kind: "cargo", heading: 180 }));
  });
  it("shows only the walls that face the camera", () => {
    // heading north, a box-shaped house shows its south wall and not its north one: fewer walls than edges
    const walls = shipSvg({ kind: "ship", heading: 0 }).match(/<polygon/g)!.length;
    const turned = shipSvg({ kind: "ship", heading: 45 }).match(/<polygon/g)!.length;
    expect(turned).toBeGreaterThan(walls);                      // at 45 degrees two walls of each box are visible
  });
  it("draws a ghost with broken magenta edges and no paint", () => {
    const ghost = shipSvg({ kind: "fishing", heading: 30, look: "ghost" });
    expect(ghost).toContain('stroke="#a3166f"');
    expect(ghost).toContain("stroke-dasharray");
    expect(ghost).not.toContain("#1f5f8b");                     // the fishing vessel's blue hull
  });
  it("makes room for a vessel alongside", () => {
    expect(shipRadius("carrier", "fishing")).toBeGreaterThan(shipRadius("carrier"));
    expect(shipSvg({ kind: "carrier", consort: "fishing" }).length).toBeGreaterThan(shipSvg({ kind: "carrier" }).length);
  });
});
