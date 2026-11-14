// Diverging scale (colour-blind safe: blue ↔ orange; never red/green).
// Values are mirrored as CSS tokens in styles/tokens.css for legend/UI use.
export const DIVERGING = {
  down: [39, 116, 196] as const,     // decreasing
  neutral: [74, 86, 102] as const,   // ~no change
  up: [230, 133, 34] as const,       // increasing
};

type RGB = readonly [number, number, number];

const lerp = (a: RGB, b: RGB, t: number): [number, number, number] =>
  [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as [number, number, number];

const toHex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Map a %/yr value to a colour; |v| >= limit saturates. Null -> neutral. */
export function divergingColor(v: number | null | undefined, limit = 15): string {
  if (v == null || !Number.isFinite(v)) return toHex(DIVERGING.neutral);
  const t = Math.max(-1, Math.min(1, v / limit));
  return toHex(t >= 0 ? lerp(DIVERGING.neutral, DIVERGING.up, t) : lerp(DIVERGING.neutral, DIVERGING.down, -t));
}

/** Sequential scale for MSDI at one month (dark ocean -> bright cyan). */
export function sequentialColor(v: number | null | undefined, max: number): string {
  if (v == null || !Number.isFinite(v) || max <= 0) return "#1b2430";
  const t = Math.max(0, Math.min(1, v / max));
  return toHex(lerp([27, 36, 48], [125, 211, 252], Math.sqrt(t)));
}

/** Robust upper bound (95th percentile) so one outlier cell doesn't wash out the map. */
export function robustMax(values: (number | null)[]): number {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 1;
  return v[Math.min(v.length - 1, Math.floor(v.length * 0.95))] || v[v.length - 1] || 1;
}
