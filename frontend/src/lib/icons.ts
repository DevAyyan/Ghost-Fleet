// One set of chart symbols for the map, the rail legend, the lists and the drawers.
// Shape says what a record is; colour and a ring say how strong the lead is. Colour alone never carries meaning.
// Every symbol is drawn bow-up in a 24 x 24 box, so a map layer can turn it to a compass bearing.
// They are vector drawings: inline SVG in the page; on the map, the few that are not ships are drawn from distance
// fields of their silhouettes, which stay sharp at any size.

export const INK = "#13263b", PAPER = "#f3f6f5", MAGENTA = "#a3166f", SHELF = "#2d6a9f";
export const SLICK = "#8a5a00", FISHING = "#a3271b", TURNON = "#0284c7", ENCOUNTER = "#c2410c", LOITER = "#0f766e";
export const CLOSURE = "#6d28d9", BORDER = "#3d4f63", OIL = "#5a3e1b", WIND = "#1f6b4a", UNCLASSED = "#7a8794";

export interface Shape {
  d: string;
  fill?: string; o?: number;                        // fill and its opacity
  stroke?: string; w?: number; dash?: number[]; so?: number;   // outline, its width, dashes and opacity
  detail?: boolean;                                 // deck fittings: left out when the symbol is drawn very small
}
export interface IconDef { shapes: Shape[]; halo?: boolean }   // halo: a paper edge so a line symbol reads over the basemap

const n = (v: number) => +v.toFixed(2);

/** Plan view of a hull, bow at the top: a pointed bow, full beam amidships, a slightly narrower rounded stern. */
export function hullPath(cx: number, cy: number, len: number, beam: number): string {
  const y0 = cy - len / 2, y1 = cy + len / 2, b = beam / 2, ys = y0 + len * 0.5, t = b * 0.82, r = beam * 0.24;
  return `M${n(cx)} ${n(y0)}C${n(cx + b * 0.36)} ${n(y0 + len * 0.15)} ${n(cx + b)} ${n(y0 + len * 0.3)} ${n(cx + b)} ${n(ys)}`
    + `L${n(cx + t)} ${n(y1 - r)}Q${n(cx + t)} ${n(y1)} ${n(cx + t - r)} ${n(y1)}H${n(cx - t + r)}Q${n(cx - t)} ${n(y1)} ${n(cx - t)} ${n(y1 - r)}`
    + `L${n(cx - b)} ${n(ys)}C${n(cx - b)} ${n(y0 + len * 0.3)} ${n(cx - b * 0.36)} ${n(y0 + len * 0.15)} ${n(cx)} ${n(y0)}Z`;
}

// ---------- ships, seen from above ----------
export type ShipShape = "fishing" | "cargo" | "carrier" | "tanker" | "ship";
/** Length and beam of each kind of ship, in box units. Fishing vessels are short and beamy; the rest long and narrow. */
const DIMS: Record<ShipShape, [len: number, beam: number]> = {
  fishing: [16.5, 7.8], cargo: [21.5, 6.6], carrier: [21.5, 7], tanker: [21.5, 7.2], ship: [19.5, 6.6],
};
interface Paint { hull: string; deck: string; house: string; line: string; hatch: string }
const PAINT = {
  ink: { hull: INK, deck: "#29425c", house: "#f7f9f9", line: "#0b1826", hatch: "#7b93aa" },
  red: { hull: FISHING, deck: "#b83a2d", house: "#fff6f4", line: "#6a170f", hatch: "#e59a91" },
  orange: { hull: ENCOUNTER, deck: "#d6551f", house: "#fff6ef", line: "#7f2c08", hatch: "#f0a57c" },
  teal: { hull: LOITER, deck: "#1c8a81", house: "#f0fbf9", line: "#094a44", hatch: "#8fd0c9" },
} satisfies Record<string, Paint>;
/** An outline-only ship: a hull with nothing in it. `dash` breaks the outline, the mark of a ship that stopped broadcasting. */
interface Hollow { line: string; dash?: number[] }

/** A ship drawn from above, centred on (cx, cy) and scaled by `s`: hull, deck, and the fittings that tell its kind. */
function ship(kind: ShipShape, paint: Paint | Hollow, cx = 12, cy = 12, s = 1): Shape[] {
  const [len, beam] = DIMS[kind];
  const solid = "hull" in paint ? paint : null, hollow = solid ? null : (paint as Hollow);
  // u runs along the ship from its centre (negative toward the bow), v across it
  const block = (u0: number, u1: number, half: number) =>
    `M${n(cx - half * s)} ${n(cy + u0 * s)}H${n(cx + half * s)}V${n(cy + u1 * s)}H${n(cx - half * s)}Z`;
  const across = (u: number, half: number) => `M${n(cx - half * s)} ${n(cy + u * s)}H${n(cx + half * s)}`;
  const along = (u0: number, u1: number) => `M${n(cx)} ${n(cy + u0 * s)}V${n(cy + u1 * s)}`;
  const dot = (u: number, r: number) => { const R = n(r * s); return `M${n(cx)} ${n(cy + u * s - r * s)}a${R} ${R} 0 1 0 0 ${n(2 * r * s)}a${R} ${R} 0 1 0 0 ${n(-2 * r * s)}Z`; };
  // a fitting is a filled piece of a painted ship, or a thin outline inside a hollow one
  const part = (d: string, tone: keyof Paint): Shape => (solid
    ? { d, fill: solid[tone], detail: true }
    : { d, stroke: hollow!.line, w: 0.7 * s, so: 0.55, detail: true });
  const rule = (d: string): Shape => ({ d, stroke: solid ? solid.line : hollow!.line, w: 0.85 * s, so: solid ? 1 : 0.55, detail: true });

  const fittings: Record<ShipShape, Shape[]> = {
    // wheelhouse forward of midships, a hatch and a gantry over the working deck aft
    fishing: [part(block(-2.8, 0.5, 2.05), "house"), part(block(2.1, 3.7, 1.35), "hatch"), rule(across(5.3, 2.2)), part(dot(-5.3, 0.55), "house")],
    // three hatch covers, accommodation aft
    cargo: [part(block(-6.6, -3.7, 1.95), "hatch"), part(block(-2.7, 0.2, 1.95), "hatch"), part(block(1.2, 4.1, 1.95), "hatch"), part(block(5.3, 8.3, 2.3), "house")],
    // two long holds with a crane post before each, accommodation aft
    carrier: [part(block(-6.2, -2.3, 2.1), "hatch"), part(block(-0.4, 3.5, 2.1), "hatch"), part(dot(-7.4, 0.6), "line"), part(dot(-1.35, 0.6), "line"),
              part(block(5.2, 8.3, 2.45), "house")],
    // a pipe run down the deck with two manifolds across it, accommodation aft
    tanker: [rule(along(-7.2, 4.3)), rule(across(-2.6, 2)), rule(across(0.3, 2)), part(block(5.3, 8.4, 2.5), "house")],
    ship: [part(block(-1.2, 2.6, 2.15), "house")],
  };
  const hull = hullPath(cx, cy, len * s, beam * s), deck = hullPath(cx, cy + 0.4 * s, (len - 3.6) * s, (beam - 2.8) * s);
  return solid
    ? [{ d: hull, fill: solid.hull, stroke: PAPER, w: 1.3 }, { d: deck, fill: solid.deck, detail: true }, ...fittings[kind]]
    : [{ d: hull, fill: "#ffffff", o: 0.92, stroke: hollow!.line, w: 1.7, dash: hollow!.dash }, ...fittings[kind]];
}

const SHIPS: ShipShape[] = ["fishing", "cargo", "carrier", "tanker", "ship"];
const fleetOf = <P extends string>(prefix: P, paint: Paint | Hollow) =>
  Object.fromEntries(SHIPS.map((k) => [`${prefix}-${k}`, { shapes: ship(k, paint) }])) as Record<`${P}-${ShipShape}`, IconDef>;

// ---------- everything that is not a ship ----------
const SLICK_PATCH = "M4.5 13.5C3 10.5 5.5 6.5 9.5 6C12.5 5.6 14 7.6 16.5 7C19.5 6.3 21.5 9 20.5 12C19.8 14.3 17.5 14.2 16 16"
  + "C14.2 18.2 11 19.3 8 18C5.8 17.1 5.4 15.3 4.5 13.5Z";
const SLICK_SHEEN = "M7.4 12.2C7.2 10.4 8.6 8.6 10.6 8.5M12.4 15.6C14 15.4 15.2 14.4 15.8 13.2";
const ANCHOR = "M12 6.6V20.4M8.2 10H15.8M5 13.8C5 17.8 8.2 20.4 12 20.4C15.8 20.4 19 17.8 19 13.8M5 13.8L3.6 15.9M5 13.8L7 15.4"
  + "M19 13.8L20.4 15.9M19 13.8L17 15.4";
const ANCHOR_RING = "M12 2.6a2 2 0 1 0 0 4a2 2 0 1 0 0 -4Z";
const RING = "M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0 -17Z";

export const ICONS = {
  // AIS switched off: an empty hull with a broken outline, one for each kind of ship
  ...fleetOf("ghost", { line: MAGENTA, dash: [2.7, 1.8] }),
  // ink ships, for lists and for the last recorded position of an open ship
  ...fleetOf("hull", PAINT.ink),
  // apparent fishing inside a protected area
  fish: { shapes: ship("fishing", PAINT.red) },
  // a meeting at sea: a carrier or a bunker tanker with a fishing vessel alongside
  "meet-carrier": { shapes: [...ship("carrier", PAINT.orange, 8.4, 12, 0.94), ...ship("fishing", PAINT.orange, 16.6, 13.4, 0.74)] },
  "meet-tanker": { shapes: [...ship("tanker", PAINT.orange, 8.4, 12, 0.94), ...ship("fishing", PAINT.orange, 16.6, 13.4, 0.74)] },
  // a carrier or tanker waiting offshore: an open hull until it is recorded meeting a vessel
  "wait-carrier": { shapes: ship("carrier", { line: LOITER }) },
  "wait-tanker": { shapes: ship("tanker", { line: LOITER }) },
  "wait-met-carrier": { shapes: ship("carrier", PAINT.teal) },
  "wait-met-tanker": { shapes: ship("tanker", PAINT.teal) },
  // a possible oil slick; an ink edge when a ship on AIS is its best-matching source
  slick: { shapes: [{ d: SLICK_PATCH, fill: SLICK, stroke: PAPER, w: 1.1, o: 0.88 }, { d: SLICK_SHEEN, stroke: "#d9b566", w: 0.9, so: 0.8, detail: true }] },
  "slick-ship": { shapes: [{ d: SLICK_PATCH, fill: SLICK, stroke: INK, w: 1.9, o: 0.92 }, { d: SLICK_SHEEN, stroke: "#d9b566", w: 0.9, so: 0.8, detail: true }] },
  // ships that were dark together
  fleet: { shapes: ([[12, 7.2], [6.4, 16], [17.6, 16]] as const).flatMap(([x, y]) => ship("fishing", { ...PAINT.ink, hull: TURNON, deck: "#1a94d6", line: "#01507a", hatch: "#bfe3f7" }, x, y, 0.68)) },
  // offshore structures, as a paper chart draws them
  platform: { halo: true, shapes: [{ d: "M6 6H18V18H6Z", fill: PAPER, stroke: OIL, w: 2 }, { d: "M12 9.6a2.4 2.4 0 1 0 0 4.8a2.4 2.4 0 1 0 0 -4.8Z", fill: OIL }] },
  turbine: { halo: true, shapes: [{ d: "M12 12V3.5M12 12L19.4 16.2M12 12L4.6 16.2", stroke: WIND, w: 2.2 }, { d: "M12 10.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0 -3.6Z", fill: WIND }] },
  structure: { halo: true, shapes: [{ d: "M7.5 7.5H16.5V16.5H7.5Z", fill: UNCLASSED }] },
  // a port call on a ship's path
  anchor: { halo: true, shapes: [{ d: ANCHOR, stroke: INK, w: 1.9 }, { d: ANCHOR_RING, fill: PAPER, stroke: INK, w: 1.7 }] },
  // the record open in the drawer
  reticle: { halo: true, shapes: [{ d: `${RING}M12 0.8V5M12 19V23.2M0.8 12H5M19 12H23.2`, stroke: INK, w: 1.6 }] },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

/** Paint a symbol's silhouette, in black, for the map to turn into a distance field: everything it fills or strokes,
 *  except paper-coloured fills (those are holes, as in a ring) and deck fittings. */
export function drawSilhouette(ctx: CanvasRenderingContext2D, name: IconName): void {
  const def: IconDef = ICONS[name];
  ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.fillStyle = "#000"; ctx.strokeStyle = "#000";
  for (const s of def.shapes) {
    if (s.detail) continue;
    const p = new Path2D(s.d);
    if (s.fill && s.fill !== PAPER && s.fill !== "#ffffff") ctx.fill(p);
    if (s.stroke && s.stroke !== PAPER) { ctx.lineWidth = s.w ?? 1; ctx.stroke(p); }
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** A symbol as an SVG element, for places outside React (the map's hover card). Sharp at any size. */
export function iconSvg(name: IconName, size: number): SVGSVGElement {
  const def: IconDef = ICONS[name];
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  for (const s of def.shapes) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", s.d); p.setAttribute("fill", s.fill ?? "none");
    if (s.o != null) p.setAttribute("fill-opacity", String(s.o));
    if (s.stroke) {
      p.setAttribute("stroke", s.stroke); p.setAttribute("stroke-width", String(s.w ?? 1));
      p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
      if (s.dash) p.setAttribute("stroke-dasharray", s.dash.join(" "));
      if (s.so != null) p.setAttribute("stroke-opacity", String(s.so));
    }
    svg.appendChild(p);
  }
  return svg;
}
