// Ships as small 3D models, drawn as vector SVG so they are sharp on any screen at any size.
// Each kind of vessel is a handful of prisms (hull, forecastle, deckhouse, cargo, cranes). A model is turned to a
// compass heading, viewed from the south at an angle above the horizon, lit from the south-west, and painted
// back to front. Nothing here touches the DOM: `shipSvg` returns markup, so it can be tested and cached.
import type { ShipShape } from "./icons";

type P2 = [number, number];
/** One upright block of the model. `pts` is its footprint, counter-clockwise, in ship coordinates:
 *  x across (starboard positive), y along (bow positive), both in metres-ish units; z0..z1 is its height range. */
interface Prism {
  pts: P2[]; z0: number; z1: number;
  side: string; top?: string;            // colours of its walls and of its roof (roof defaults to the wall colour)
  tier: number;                          // blocks standing on other blocks are painted after them
  band?: [z0: number, z1: number];       // a dark strip round the walls: bridge windows
}
export type ShipLook = "natural" | "ghost";
export interface ShipOptions {
  kind: ShipShape;
  heading?: number;        // degrees clockwise from north; 0 points up the screen
  look?: ShipLook;         // "ghost": an empty white hull with broken magenta edges, a ship that stopped broadcasting
  hull?: string;           // override the hull colour (the fishing vessels of a layer share one)
  elevation?: number;      // camera angle above the horizon, degrees: 90 is straight down, 25 is nearly side-on
  plate?: string;          // colour of a faint disc on the water under the ship: the colour of its layer
  plateOpen?: boolean;     // draw that disc as a broken ring only
  consort?: ShipShape;     // a second, smaller vessel alongside to starboard: a meeting at sea
}

const WHITE = "#f4f6f6", WINDOW = "#1c2a3a", STEEL = "#2b3138", YELLOW = "#dfae36", GHOST_EDGE = "#a3166f";
const BOXES = ["#c2410c", "#2d6a9f", "#d9a441", "#0f766e", "#8d96a0", "#7a3fa0"];

const box = (cx: number, cy: number, w: number, l: number, z0: number, z1: number, side: string, tier: number, more: Partial<Prism> = {}): Prism =>
  ({ pts: [[cx + w / 2, cy - l / 2], [cx + w / 2, cy + l / 2], [cx - w / 2, cy + l / 2], [cx - w / 2, cy - l / 2]], z0, z1, side, tier, ...more });

/** A hull seen from above: square stern, parallel sides, and a bow that is `fine` (1 = sharp, 0 = bluff). */
function hullPlan(len: number, beam: number, fine: number): P2[] {
  const h = len / 2, b = beam / 2, run = 0.2 + 0.24 * fine;   // how far back from the stem the bow starts to narrow
  const star: P2[] = [[b * 0.78, -h], [b, -h + len * 0.07], [b, h - len * run], [b * 0.86, h - len * run * 0.62], [b * 0.52, h - len * run * 0.25], [b * 0.16 * (1 - fine) + 0.02, h]];
  return [...star, ...star.map(([x, y]): P2 => [-x, y]).reverse()];
}
/** The part of a convex footprint forward of y = cut. */
function forward(pts: P2[], cut: number): P2[] {
  const out: P2[] = [];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length], ina = a[1] >= cut, inb = b[1] >= cut;
    if (ina) out.push(a);
    if (ina !== inb) { const t = (cut - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, cut]); }
  });
  return out;
}

interface Livery { hull: string; boot: string; deck: string; funnel: string }
const LIVERY: Record<ShipShape, Livery> = {
  fishing: { hull: "#1f5f8b", boot: "#7a1f1a", deck: "#b9a583", funnel: "#1f5f8b" },
  cargo: { hull: "#22384f", boot: "#8a2b22", deck: "#6c7b86", funnel: "#c2410c" },
  carrier: { hull: "#dfe5e8", boot: "#1f5c7a", deck: "#4f7a66", funnel: "#1f5c7a" },
  tanker: { hull: "#30353c", boot: "#8a2b22", deck: "#9a4a3a", funnel: "#d9a441" },
  ship: { hull: "#45586b", boot: "#8a2b22", deck: "#8a959e", funnel: "#45586b" },
};

/** The blocks of one vessel, in ship coordinates. */
function model(kind: ShipShape, hullColor?: string): Prism[] {
  const c = { ...LIVERY[kind], ...(hullColor ? { hull: hullColor, funnel: hullColor } : {}) };
  const hull = (len: number, beam: number, fine: number, h: number, fc: number): Prism[] => {
    const plan = hullPlan(len, beam, fine);
    return [
      { pts: plan, z0: 0, z1: 0.28, side: c.boot, tier: 0 },                          // boot-topping at the waterline
      { pts: plan, z0: 0.28, z1: h, side: c.hull, top: c.deck, tier: 0 },
      { pts: forward(plan, len / 2 - len * fc), z0: h, z1: h + 0.34, side: c.hull, top: c.deck, tier: 1 },   // raised forecastle
    ];
  };
  /** Accommodation block with a bridge on top and a funnel behind it, centred at y. */
  const house = (y: number, w: number, h: number): Prism[] => [
    box(0, y, w, 1.5, h, h + 1.35, WHITE, 1, { band: [h + 0.75, h + 1.05] }),
    box(0, y + 0.1, w * 0.84, 1.05, h + 1.35, h + 2.1, WHITE, 2, { band: [h + 1.6, h + 1.9] }),
    box(0, y - 0.95, 0.62, 0.55, h, h + 2.35, c.funnel, 1),
    box(0, y + 0.1, 0.1, 0.1, h + 2.1, h + 3, STEEL, 3),
  ];
  switch (kind) {
    case "fishing": {
      const h = 0.95;
      return [
        ...hull(7, 2.5, 0.85, h, 0.27),
        box(0, -1.55, 1.35, 0.7, h, h + 0.5, "#394a59", 1),                              // net drum
        box(0.9, -2.55, 0.16, 0.16, h, h + 1.75, YELLOW, 1), box(-0.9, -2.55, 0.16, 0.16, h, h + 1.75, YELLOW, 1),
        box(0, -2.55, 1.96, 0.16, h + 1.75, h + 1.92, YELLOW, 2),                         // gantry over the working deck
        box(0, -0.45, 0.5, 0.5, h, h + 1.5, c.funnel, 1),
        box(0, 0.55, 1.75, 1.5, h, h + 0.95, WHITE, 1),
        box(0, 0.7, 1.45, 1.05, h + 0.95, h + 1.65, WHITE, 2, { band: [h + 1.15, h + 1.45] }),
        box(0, 0.9, 0.1, 0.1, h + 1.65, h + 3.1, STEEL, 3),
      ];
    }
    case "cargo": {
      const h = 1, out = [...hull(11, 2.7, 0.6, h, 0.13), ...house(-4, 2.3, h)];
      [-2.35, -1.0, 0.35, 1.7, 3.05].forEach((y, bay) => [-0.6, 0.6].forEach((x, row) => {
        const high = (bay + row) % 3 === 0 ? 1 : 2;
        for (let t = 0; t < high; t++) out.push(box(x, y, 1.12, 1.22, h + t * 0.56, h + (t + 1) * 0.56, BOXES[(bay * 2 + row + t * 3) % BOXES.length], 1 + t));
      }));
      return out;
    }
    case "carrier": {
      const h = 1.15, out = [...hull(11, 2.9, 0.6, h, 0.13), ...house(-4, 2.4, h)];
      [-2.1, 0.2, 2.5].forEach((y) => out.push(box(0, y, 2.05, 1.7, h, h + 0.26, "#c6d0d4", 1)));       // hatch covers
      [-0.95, 1.35].forEach((y) => out.push(box(0, y, 0.3, 0.3, h, h + 1.95, YELLOW, 1), box(0, y + 0.8, 0.16, 1.6, h + 1.7, h + 1.86, YELLOW, 2)));   // derricks
      return out;
    }
    case "tanker": {
      const h = 0.82;
      return [
        ...hull(11, 3, 0.3, h, 0.1), ...house(-4, 2.5, h),
        box(0, 0.35, 0.26, 6.6, h, h + 0.24, "#c9ccd0", 1), box(0.55, 0.35, 0.12, 6.2, h, h + 0.16, "#aab1b8", 1), box(-0.55, 0.35, 0.12, 6.2, h, h + 0.16, "#aab1b8", 1),
        box(0, 0.35, 2.3, 0.4, h, h + 0.42, "#8f99a2", 1),                                // manifold across the deck
        box(0.95, 0.35, 0.2, 0.2, h, h + 1.35, YELLOW, 1), box(0.95, 0.95, 0.14, 1.3, h + 1.2, h + 1.34, YELLOW, 2),   // hose crane
      ];
    }
    default: {
      const h = 0.95;
      return [...hull(9.5, 2.6, 0.6, h, 0.14), box(0, -0.6, 2.1, 2.2, h, h + 1.2, WHITE, 1, { band: [h + 0.65, h + 0.95] }),
        box(0, -0.3, 1.7, 1.2, h + 1.2, h + 1.9, WHITE, 2, { band: [h + 1.42, h + 1.7] }), box(0, -1.9, 0.6, 0.55, h, h + 2.1, c.funnel, 1)];
    }
  }
}

const LEN: Record<ShipShape, number> = { fishing: 7, cargo: 11, carrier: 11, tanker: 11, ship: 9.5 };
/** A kind of ship's length, in model units. */
export const shipLength = (kind: ShipShape): number => LEN[kind];
/** Half the side of the square a ship is drawn in, in model units: room for the hull at any heading, and for its masts. */
export function shipRadius(kind: ShipShape, consort?: ShipShape): number {
  return LEN[kind] / 2 + (consort ? 2.2 : 1.3);
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const shade = (c: string, k: number) => `#${hex(c).map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, "0")).join("")}`;
const f = (v: number) => (Math.round(v * 100) / 100).toString();

const cache = new Map<string, string>();

/** SVG markup of a ship. The drawing is a square, `2 * shipRadius` model units on a side, centred on the ship's
 *  midpoint at the waterline; size it with CSS. The same options always return the same string. */
export function shipSvg(o: ShipOptions): string {
  const heading = (((o.heading ?? 0) % 360) + 360) % 360, elevation = o.elevation ?? 52, ghost = o.look === "ghost";
  const key = [o.kind, heading, o.look ?? "", o.hull ?? "", elevation, o.plate ?? "", o.plateOpen ? 1 : 0, o.consort ?? ""].join("|");
  const hit = cache.get(key);
  if (hit) return hit;

  const rad = Math.PI / 180, cb = Math.cos(heading * rad), sb = Math.sin(heading * rad), se = Math.sin(elevation * rad), ce = Math.cos(elevation * rad);
  /** Ship coordinates -> ground coordinates (east, north) for this heading. */
  const turn = ([x, y]: P2): P2 => [x * cb + y * sb, -x * sb + y * cb];
  /** Ground coordinates and height -> the drawing. */
  const at = ([e, n]: P2, z: number) => `${f(e)},${f(-(n * se + z * ce))}`;
  const poly = (pts: P2[], z: number) => pts.map((p) => at(p, z)).join(" ");

  // one group per vessel, the farther (more northerly) one first; within a vessel, lower tiers first, then far to near
  const vessels: Prism[][] = [model(o.kind, o.hull)];
  if (o.consort) {
    const k = 0.78, dx = LEN[o.kind] * 0.13 + 1.95;
    vessels.push(model(o.consort).map((p) => ({ ...p, pts: p.pts.map(([x, y]): P2 => [x * k + dx, y * k - 0.4]), z0: p.z0 * k, z1: p.z1 * k, band: p.band && [p.band[0] * k, p.band[1] * k] })));
  }
  const north = (pts: P2[]) => pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const groups = vessels.map((v) => v.map((p) => ({ ...p, pts: p.pts.map(turn) })))
    .sort((a, b) => north(b.flatMap((p) => p.pts)) - north(a.flatMap((p) => p.pts)));

  const out: string[] = [];
  const R = shipRadius(o.kind, o.consort);
  if (o.plate) {   // the layer's colour on the water under the ship
    const rx = R - 0.45;
    out.push(`<ellipse cx="0" cy="0" rx="${f(rx)}" ry="${f(rx * se)}" fill="${o.plate}" fill-opacity="${o.plateOpen ? 0.04 : 0.14}" stroke="${o.plate}" stroke-width="0.11"`
      + `${o.plateOpen ? ' stroke-dasharray="0.6 0.45"' : ""} stroke-opacity="0.8"/>`);
  }
  // a soft shadow on the water, cast away from the light
  for (const g of groups) out.push(`<polygon points="${g[0].pts.map(([e, n]) => at([e + 0.3, n - 0.42], 0)).join(" ")}" fill="#13263b" fill-opacity="${ghost ? 0.1 : 0.22}"/>`);

  const edge = ghost ? ` stroke="${GHOST_EDGE}" stroke-width="0.11" stroke-linejoin="round"` : "";
  for (const g of groups) {
    g.sort((a, b) => a.tier - b.tier || north(b.pts) - north(a.pts));
    for (const p of g) {
      p.pts.forEach((a, i) => {
        const b = p.pts[(i + 1) % p.pts.length];
        const nx = b[1] - a[1], ny = -(b[0] - a[0]), len = Math.hypot(nx, ny) || 1;   // outward normal of this wall
        if (ny / len >= -0.02) return;                                               // faces away from the camera, which looks north
        const lit = 0.6 + 0.34 * Math.max(0, (nx * -0.84 + ny * -0.54) / len);         // lit from the south-west
        const wall = `${at(a, p.z0)} ${at(b, p.z0)} ${at(b, p.z1)} ${at(a, p.z1)}`;
        if (ghost) {
          out.push(`<polygon points="${wall}" fill="#ffffff" fill-opacity="${f(0.72 + 0.2 * lit)}"${edge}${p.tier === 0 ? ' stroke-dasharray="0.42 0.3"' : ' stroke-opacity="0.55"'}/>`);
        } else {
          const fill = shade(p.side, lit);
          out.push(`<polygon points="${wall}" fill="${fill}" stroke="${shade(p.side, lit * 0.74)}" stroke-width="0.05" stroke-linejoin="round"/>`);
          if (p.band) out.push(`<polygon points="${at(a, p.band[0])} ${at(b, p.band[0])} ${at(b, p.band[1])} ${at(a, p.band[1])}" fill="${shade(WINDOW, 0.75 + 0.5 * lit)}"/>`);
        }
      });
      const roof = poly(p.pts, p.z1);
      if (ghost) out.push(`<polygon points="${roof}" fill="#ffffff" fill-opacity="0.94"${edge}${p.tier === 0 ? ' stroke-dasharray="0.42 0.3"' : ' stroke-opacity="0.55"'}/>`);
      else { const top = p.top ?? shade(p.side, 1.06); out.push(`<polygon points="${roof}" fill="${top}" stroke="${shade(top, 0.76)}" stroke-width="0.05" stroke-linejoin="round"/>`); }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(-R)} ${f(-R)} ${f(2 * R)} ${f(2 * R)}" aria-hidden="true" focusable="false">${out.join("")}</svg>`;
  cache.set(key, svg);
  return svg;
}
