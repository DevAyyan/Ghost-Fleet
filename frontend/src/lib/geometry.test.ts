import { describe, expect, it } from "vitest";
import { chaikin, clusterShape, convexHull, pointInRing, type Pt } from "./geometry";

const square = (x: number, y: number, h = 0.25): Pt[] => [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h], [x - h, y - h]];

describe("geometry", () => {
  it("convex hull drops interior points and closes the ring", () => {
    const h = convexHull([[0, 0], [2, 0], [2, 2], [0, 2], [1, 1]]);
    expect(h).toHaveLength(5);
    expect(h[0]).toEqual(h[h.length - 1]);
    expect(h).not.toContainEqual([1, 1]);
  });
  it("chaikin rounds corners: more vertices, stays closed", () => {
    const r = chaikin(square(0, 0), 2);
    expect(r.length).toBe(4 * 4 + 1);
    expect(r[0]).toEqual(r[r.length - 1]);
  });
  it("cluster shape covers every member area's centre and has no grid corners", () => {
    const shape = clusterShape([square(66.25, 24.25), square(66.75, 24.25)]);
    expect(pointInRing([66.25, 24.25], shape)).toBe(true);
    expect(pointInRing([66.75, 24.25], shape)).toBe(true);
    expect(shape).not.toContainEqual([66, 24]);           // corners are rounded off
    expect(pointInRing([68, 24.25], shape)).toBe(false);
  });
});
