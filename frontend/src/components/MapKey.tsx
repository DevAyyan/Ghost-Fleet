import { useState } from "react";
import { LAYERS, LAYER_GLYPH, type LayerId } from "../lib/layers";
import { Glyph } from "./Glyph";

/** A layer's mark: its chart symbol, or a swatch of its colour or line. The same in the rail and the map key. */
export function LayerSwatch({ id }: { id: LayerId }) {
  const g = LAYER_GLYPH[id];
  return g ? <Glyph name={g} size={22} className="sym" /> : <i className={`sym sym-${id}`} aria-hidden="true" />;
}

/** A protected area as the map draws it: hatched with a solid edge where all fishing is banned, dashed where part of it is. */
export function ZoneSwatch({ full }: { full: boolean }) {
  const id = `hatch-${full ? "full" : "part"}`;
  return (
    <svg className="zone-swatch" width="26" height="20" viewBox="0 0 26 20" aria-hidden="true">
      <defs>
        <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1.6" strokeOpacity="0.6" />
        </pattern>
      </defs>
      <rect x="1.5" y="1.5" width="23" height="17" rx="2" fill="currentColor" fillOpacity={full ? 0.12 : 0.07} />
      {full && <rect x="1.5" y="1.5" width="23" height="17" rx="2" fill={`url(#${id})`} />}
      <rect x="1.5" y="1.5" width="23" height="17" rx="2" fill="none" stroke="currentColor" strokeWidth={full ? 2 : 1.4}
        strokeDasharray={full ? undefined : "3 2"} />
    </svg>
  );
}

const STORE = "gf.mapKeyOpen";
const remembered = () => { try { return localStorage.getItem(STORE) !== "false"; } catch { return true; } };

/** The key on the map: only what is drawn right now, so it never explains a mark that is not there. */
export function MapKey({ visible, noTakeAreas }: { visible: Record<LayerId, boolean>; noTakeAreas: boolean }) {
  const [open, setOpen] = useState(remembered);
  const shown = LAYERS.filter((l) => visible[l.id]);
  const zones = noTakeAreas && (visible.fishing || visible.aisOff);
  if (!shown.length) return null;
  const toggle = () => {
    setOpen((o) => { try { localStorage.setItem(STORE, String(!o)); } catch { /* private window: just not remembered */ } return !o; });
  };
  return (
    <div className="map-overlay map-key" data-open={open}>
      <button type="button" className="map-key-head" aria-expanded={open} aria-controls="map-key-list" onClick={toggle}>
        Key <span className="muted">{open ? "hide" : `${shown.length + (zones ? 2 : 0)} marks`}</span>
      </button>
      {open && (
        <ul id="map-key-list" className="map-key-list">
          {shown.map((l) => <li key={l.id}><span className="map-key-art"><LayerSwatch id={l.id} /></span>{l.key}</li>)}
          {zones && <>
            <li><span className="map-key-art notake"><ZoneSwatch full /></span>Protected area, all fishing banned</li>
            <li><span className="map-key-art notake"><ZoneSwatch full={false} /></span>Protected area, fishing banned in part</li>
          </>}
        </ul>
      )}
    </div>
  );
}
