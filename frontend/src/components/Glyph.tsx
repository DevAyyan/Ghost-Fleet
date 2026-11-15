import { ICONS, type IconDef, type IconName } from "../lib/icons";
import { shapeOf, vesselClass } from "../lib/vessel";
import { Ship3d } from "./Ship3d";

/** A chart symbol as inline SVG: the same drawing the map uses, so the legend and the lists match what is on the chart.
 *  Below 18 px the deck fittings are left out, as they are on a world view of the map. */
export function Glyph({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  const def: IconDef = ICONS[name];
  const shapes = size < 18 ? def.shapes.filter((s) => !s.detail) : def.shapes;
  return (
    <svg className={className ? `glyph ${className}` : "glyph"} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {shapes.map((s, i) => (
        <path key={i} d={s.d} fill={s.fill ?? "none"} fillOpacity={s.o} stroke={s.stroke} strokeWidth={s.w} strokeOpacity={s.so}
          strokeDasharray={s.dash?.join(" ")} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/** A ship's name beside a small model of its kind of vessel, from its recorded type or gear. */
export function Ship({ name, type, gear }: { name: string | null; type?: string | null; gear?: string[] }) {
  return <span className="feed-ship"><Ship3d kind={shapeOf(vesselClass(type, gear))} heading={60} size={34} />{name ?? "Unnamed vessel"}</span>;
}
