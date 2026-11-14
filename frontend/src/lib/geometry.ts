// Small planar helpers for drawing trend clusters as smooth regions (no grid on the map).
export type Pt = [number, number];

/** Andrew's monotone chain convex hull. Returns a closed ring (first point repeated). */
export function convexHull(points: Pt[]): Pt[] {
  const p = [...new Map(points.map((q) => [`${q[0]},${q[1]}`, q])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p.length ? [...p, p[0]] : [];
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return [...hull, hull[0]];
}

/** Chaikin corner cutting: rounds a closed ring. */
export function chaikin(ring: Pt[], iterations = 3): Pt[] {
  let r = ring.slice(0, -1);
  for (let k = 0; k < iterations && r.length >= 3; k++) {
    const next: Pt[] = [];
    r.forEach((a, i) => {
      const b = r[(i + 1) % r.length];
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    });
    r = next;
  }
  return r.length ? [...r, r[0]] : [];
}

export function centroid(points: Pt[]): Pt {
  const n = points.length || 1;
  return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
}

/** Scale a ring about its centroid (factor > 1 grows it). */
export function scaleRing(ring: Pt[], factor: number): Pt[] {
  const c = centroid(ring.slice(0, -1));
  return ring.map((p) => [c[0] + (p[0] - c[0]) * factor, c[1] + (p[1] - c[1]) * factor]);
}

/** Smooth blob around a set of analysis areas: hull of their corners, rounded, slightly enlarged. */
export function clusterShape(boundaries: Pt[][]): Pt[] {
  const hull = convexHull(boundaries.flat());
  return hull.length >= 4 ? chaikin(scaleRing(hull, 1.08), 4) : hull;
}

/** Ray-casting point-in-polygon for a closed ring. */
export function pointInRing(pt: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
