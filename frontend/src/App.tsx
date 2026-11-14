import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api/client";
import { CellDrawer } from "./components/CellDrawer";
import { EventDrawer } from "./components/EventDrawer";
import { Header } from "./components/Header";
import { LayerRail } from "./components/LayerRail";
import { MapView } from "./components/MapView";
import { SeaDrawer, type SeaRecord } from "./components/SeaDrawer";
import { VesselDrawer, useVessel } from "./components/VesselDrawer";
import { useResource } from "./hooks/useResource";
import { DEFAULT_VISIBLE, imageDay, lastDays, monthsIn, periodProblem, type LayerId, type Period, type Selection } from "./lib/layers";

const KINDS = ["event", "cell", "vessel", "aisOff", "hotspot", "turnOn", "slick", "fishing"] as const;
/** The layer a selection belongs to: opening a record turns its layer on and opens it in the rail. */
const LAYER_OF: Partial<Record<(typeof KINDS)[number], LayerId>> = {
  event: "changes", cell: "changes", aisOff: "aisOff", hotspot: "hotspots", turnOn: "turnOns", slick: "slicks", fishing: "fishing",
};

function readUrl(): { selection: Selection; period: Period } {
  const q = new URLSearchParams(window.location.search);
  let selection: Selection = null;
  for (const kind of KINDS) {
    const id = q.get(kind);
    if (id) { selection = { kind, id }; break; }
  }
  const asked = { start: q.get("from") ?? "", end: q.get("to") ?? "" };
  return { selection, period: periodProblem(asked) ? lastDays(30) : asked };
}

function writeUrl(sel: Selection, period: Period) {
  const q = new URLSearchParams();
  const def = lastDays(30);
  if (period.start !== def.start || period.end !== def.end) { q.set("from", period.start); q.set("to", period.end); }
  if (sel) q.set(sel.kind, sel.id);
  const s = q.toString();
  window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
}

export default function App() {
  const [initial] = useState(readUrl);
  const [selection, setSelection] = useState<Selection>(initial.selection);
  const [period, setPeriod] = useState<Period>(initial.period);
  const [visible, setVisible] = useState<Record<LayerId, boolean>>(() => {
    const layer = initial.selection && LAYER_OF[initial.selection.kind];
    return layer ? { ...DEFAULT_VISIBLE, [layer]: true } : DEFAULT_VISIBLE;
  });
  const [open, setOpen] = useState<LayerId | null>(() => (initial.selection ? LAYER_OF[initial.selection.kind] ?? null : "hotspots"));
  const [spot, setSpot] = useState<{ lon: number; lat: number; key: string } | null>(null);   // a place picked inside the ship panel
  const [highlightIllegalZones, setHighlightIllegalZones] = useState(true);
  const [noTakeOnly, setNoTakeOnly] = useState(false);

  const { start, end } = period;
  const meta = useResource("meta", api.meta);
  const aisOff = useResource(`aisOff:${start}:${end}`, () => api.aisOff(start, end));
  const slicks = useResource(`slicks:${start}:${end}`, () => api.slicks(start, end));
  const fishing = useResource(`fishing:${start}:${end}`, () => api.protectedFishing(start, end));
  // The trend scan's geometry is several MB: fetched only once its layer is switched on.
  const cells = useResource(visible.changes ? "cells" : null, api.cells);
  const events = useResource(visible.changes ? "events" : null, () => api.events());
  const vessel = useVessel(selection?.kind === "vessel" ? selection.id : null, period);

  useEffect(() => writeUrl(selection, period), [selection, period]);

  // shipping lanes come a month at a time: use the months the period touches
  const allMonths = meta.data?.months ?? [];
  const months = useMemo(() => monthsIn(period, allMonths), [period, allMonths]);
  const lanesMonth = months[months.length - 1] ?? null;

  const close = useCallback(() => { setSelection(null); setSpot(null); }, []);
  const changePeriod = useCallback((p: Period) => { setPeriod(p); setSpot(null); }, []);

  const select = useCallback((sel: Selection) => {
    setSelection(sel);
    setSpot(null);
    const layer = sel && LAYER_OF[sel.kind];
    if (layer) {
      setVisible((v) => (v[layer] ? v : { ...v, [layer]: true }));
      setOpen(layer);
    }
  }, []);
  const toggle = useCallback((id: LayerId) => setVisible((v) => ({ ...v, [id]: !v[id] })), []);
  const openLayer = useCallback((id: LayerId | null) => {
    setOpen(id);
    if (id) setVisible((v) => (v[id] ? v : { ...v, [id]: true }));   // opening a layer also draws it
  }, []);

  const seaItem = useMemo<SeaRecord | null>(() => {
    if (!selection) return null;
    const { kind, id } = selection;
    if (kind === "aisOff") { const r = aisOff.data?.events.find((e) => e.id === id); return r ? { kind, record: r } : null; }
    if (kind === "hotspot") { const r = aisOff.data?.hotspots.find((h) => h.id === id); return r ? { kind, record: r } : null; }
    if (kind === "turnOn") { const r = aisOff.data?.turnOnClusters?.find((t) => t.id === id); return r ? { kind, record: r } : null; }
    if (kind === "slick") { const r = slicks.data?.slicks.find((s) => s.id === id); return r ? { kind, record: r } : null; }
    if (kind === "fishing") { const r = fishing.data?.events.find((f) => f.id === id); return r ? { kind, record: r } : null; }
    return null;
  }, [selection, aisOff.data, slicks.data, fishing.data]);
  const focus = useMemo(() => spot ?? (seaItem ? { lon: seaItem.record.lon, lat: seaItem.record.lat, key: `${seaItem.kind}:${seaItem.record.id}` } : null),
    [spot, seaItem]);

  const alpha = meta.data?.alpha ?? 0.05;
  const drawerOpen = selection?.kind === "event" || selection?.kind === "cell" || selection?.kind === "vessel" || !!seaItem;

  return (
    <div className="app">
      <Header meta={meta.data} />
      <main className={`main ${drawerOpen ? "has-drawer" : ""}`}>
        <LayerRail meta={meta.data} visible={visible} onToggle={toggle} open={open} onOpen={openLayer}
          selection={selection} onSelect={select} aisOff={aisOff} slicks={slicks} fishing={fishing}
          period={period} onPeriod={changePeriod} lanesMonth={lanesMonth}
          nightDay={imageDay(period, 3)} chlDay={imageDay(period, 3)}
          highlightIllegalZones={highlightIllegalZones} onToggleIllegalZones={setHighlightIllegalZones}
          noTakeOnly={noTakeOnly} onToggleNoTakeOnly={setNoTakeOnly} />

        <section className="map-wrap" aria-label="Map">
          <MapView visible={visible} aisOff={aisOff.data}
            slicks={slicks.data?.slicks ?? []} fishing={fishing.data?.events ?? []}
            cells={cells.data?.cells ?? []} events={events.data?.data ?? []}
            selection={selection} focus={focus} onSelect={select}
            lanesMonth={lanesMonth} nightDay={imageDay(period, 3)} chlDay={imageDay(period, 3)}
            track={selection?.kind === "vessel" ? vessel.data : undefined}
            highlightIllegalZones={highlightIllegalZones} noTakeOnly={noTakeOnly} />
        </section>

        {selection?.kind === "event" && (
          <EventDrawer key={selection.id} eventId={selection.id} alpha={alpha} onClose={close}
            onOpenCell={(id) => select({ kind: "cell", id })} />
        )}
        {selection?.kind === "cell" && (
          <CellDrawer key={selection.id} cellId={selection.id} alpha={alpha} onClose={close}
            onOpenEvent={(id) => select({ kind: "event", id })} />
        )}
        {selection?.kind === "vessel" && (
          <VesselDrawer key={selection.id} vesselId={selection.id} period={period} onClose={close}
            onFocus={(lat, lon, key) => setSpot({ lat, lon, key })} />
        )}
        {seaItem && <SeaDrawer key={`${seaItem.kind}:${seaItem.record.id}`} item={seaItem} onClose={close}
          onOpenVessel={(id) => select({ kind: "vessel", id })} />}
      </main>
    </div>
  );
}
