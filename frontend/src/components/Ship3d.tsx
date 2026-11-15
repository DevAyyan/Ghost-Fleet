import { shipSvg, type ShipOptions } from "../lib/ship3d";

/** A ship as a small 3D model. It is a vector drawing, so it is sharp at any size; the markup comes from our own renderer. */
export function Ship3d({ size, className, ...ship }: ShipOptions & { size: number; className?: string }) {
  return (
    <span className={className ? `ship-art ${className}` : "ship-art"} style={{ width: size, height: size }} aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: shipSvg(ship) }} />
  );
}
