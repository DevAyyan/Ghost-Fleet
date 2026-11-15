import { describe, expect, it } from "vitest";
import { monthsBetween, normalSpan, spanProblem, spanQuery } from "./span";

const months = Array.from({ length: 82 }, (_, i) => `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);

describe("change span", () => {
  it("counts months inclusively", () => {
    expect(monthsBetween("2020-01", "2020-12")).toBe(12);
    expect(monthsBetween("2023-11", "2026-10")).toBe(36);
  });
  it("refuses spans the scan cannot run on", () => {
    expect(spanProblem({ start: "2024-01", end: "2024-12" }, months)).toMatch(/at least 24/);
    expect(spanProblem({ start: "2024-01", end: "2022-01" }, months)).toMatch(/after/);
    expect(spanProblem({ start: "2019-01", end: "2022-01" }, months)).toMatch(/covers 2020-01/);
    expect(spanProblem({ start: "", end: "2022-01" }, months)).toMatch(/both/);
    expect(spanProblem({ start: "2022-01", end: "2023-12" }, months)).toBeNull();
  });
  it("treats the full panel as no span", () => {
    expect(normalSpan({ start: "2020-01", end: "2026-10" }, months)).toBeNull();
    expect(normalSpan({ start: "2021-01", end: "2026-10" }, months)).toEqual({ start: "2021-01", end: "2026-10" });
  });
  it("builds the query", () => {
    expect(spanQuery(null)).toBe("");
    expect(spanQuery({ start: "2022-01", end: "2023-12" }, "&")).toBe("&start=2022-01&end=2023-12");
  });
});
