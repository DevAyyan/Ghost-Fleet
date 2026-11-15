// What kind of ship a record describes, from Global Fishing Watch's vessel type or gear list.
import type { IconName, ShipShape } from "./icons";

export type VesselClass = "fishing" | "carrier" | "bunker" | "cargo" | "other";

const FISHING_GEAR = /TRAWL|LONGLINE|SEINE|JIGGER|POLE_AND_LINE|GILLNET|POTS|TROLL|DREDGE|DRIFTNET|FIXED_GEAR|FISHING/;

/** `type` is an event's vessel type ("fishing", "carrier", ...); `gear` is an identity's gear list (["DRIFTING_LONGLINES"]). */
export function vesselClass(type?: string | null, gear: string[] = []): VesselClass {
  const words = [type ?? "", ...gear].map((w) => w.toUpperCase());
  if (words.some((w) => w.includes("CARRIER"))) return "carrier";
  if (words.some((w) => w.includes("BUNKER") || w.includes("TANKER"))) return "bunker";
  if (words.some((w) => w.includes("CARGO"))) return "cargo";
  if (words.some((w) => FISHING_GEAR.test(w))) return "fishing";
  return "other";
}

/** Which drawing shows a class of vessel: each has its own deck plan; anything unclassed gets a plain ship. */
const SHAPE: Record<VesselClass, ShipShape> = { fishing: "fishing", carrier: "carrier", bunker: "tanker", cargo: "cargo", other: "ship" };
export const shapeOf = (c: VesselClass): ShipShape => SHAPE[c];
export const ghostIcon = (c: VesselClass): IconName => `ghost-${SHAPE[c]}`;
export const hullIcon = (c: VesselClass): IconName => `hull-${SHAPE[c]}`;
/** The small mark a wide view of the map draws: a short hull for fishing vessels, a long one for everything else. */
export const markIcon = (c: VesselClass): "mark-fishing" | "mark-ship" => (c === "fishing" ? "mark-fishing" : "mark-ship");

export const CLASS_WORD: Record<VesselClass, string> = {
  fishing: "Fishing vessel", carrier: "Refrigerated carrier", bunker: "Bunker tanker", cargo: "Cargo ship", other: "Vessel",
};
