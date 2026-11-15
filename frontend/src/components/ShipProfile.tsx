import type { CSSProperties, ReactNode } from "react";
import { shipLength, shipRadius, shipSvg, type ShipOptions } from "../lib/ship3d";
import { CLASS_WORD, shapeOf, type VesselClass } from "../lib/vessel";

const FRAME = 15.4;

/** A ship seen from low on the water, broadside on, with its recorded length marked beneath and a line saying what the drawing is. */
export function ShipFigure({ ship, lengthM, label, children }: { ship: ShipOptions; lengthM?: number | null; label: string; children: ReactNode }) {
  const length = lengthM ? `${Math.round(lengthM)} m` : null;
  // Every figure is drawn to one scale, so a fishing vessel looks as small beside a cargo ship as it is.
  // FRAME is the width of the frame in model units; the dimension line spans exactly the hull.
  const fit = (2 * shipRadius(ship.kind, ship.consort)) / FRAME, span = (shipLength(ship.kind) / FRAME) * 100;
  return (
    <figure className="ship-profile">
      <div className={ship.consort ? "ship-hero ship-hero-pair" : "ship-hero"} role="img" style={{ "--fit": fit } as CSSProperties} aria-label={`${label}${length ? ` Recorded length ${length}.` : ""}`}
        dangerouslySetInnerHTML={{ __html: shipSvg({ ...ship, heading: 90, elevation: 27 }) }} />
      {length && !ship.consort && (
        <div className="sp-dim" style={{ width: `${span}%` }} aria-hidden="true"><i /><b className="num">{length}</b><i /></div>
      )}
      <figcaption>{children}</figcaption>
    </figure>
  );
}

/** The kind of ship this is, drawn to be recognised. It is the usual outline of its type, never a drawing of the ship itself. */
export function ShipProfile({ kind, lengthM, gear }: { kind: VesselClass; lengthM: number | null; gear: string[] }) {
  const word = CLASS_WORD[kind].toLowerCase();
  const gearWords = gear.join(", ").replace(/_/g, " ").toLowerCase();
  return (
    <ShipFigure ship={{ kind: shapeOf(kind) }} lengthM={lengthM}
      label={kind === "other" ? "A generic ship: the vessel type is not recorded." : `Typical outline of a ${word}.`}>
      {kind === "other"
        ? "The record does not say what kind of vessel this is, so the outline is generic."
        : <>Typical outline of a {word}{gearWords && gearWords !== word ? ` (${gearWords})` : ""}. Not a drawing of this ship.</>}
      {!lengthM && " Its length is not recorded."}
    </ShipFigure>
  );
}
