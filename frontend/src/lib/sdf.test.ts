import { describe, expect, it } from "vitest";
import { distanceField } from "./sdf";

describe("distance field", () => {
  // a filled 8 x 8 square in the middle of a 24 x 24 image
  const size = 24, alpha = new Array<number>(size * size).fill(0);
  for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) alpha[y * size + x] = 255;
  const field = distanceField(alpha, size), at = (x: number, y: number) => field[y * size + x];

  it("puts the edge at three quarters, as MapLibre expects", () => {
    expect((at(7, 12) + at(8, 12)) / 2).toBeCloseTo(191, -1);   // either side of the left edge
  });
  it("rises inside the shape and falls away outside it", () => {
    expect(at(12, 12)).toBeGreaterThan(at(8, 12));
    expect(at(8, 12)).toBeGreaterThan(at(5, 12));
    expect(at(5, 12)).toBeGreaterThan(at(2, 12));
    expect(at(0, 0)).toBe(0);                                  // more than 8 px from the shape
  });
  it("is symmetric for a symmetric shape", () => {
    expect(at(5, 12)).toBe(at(18, 12));
    expect(at(12, 5)).toBe(at(12, 18));
  });
});
