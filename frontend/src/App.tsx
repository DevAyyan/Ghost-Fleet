import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api/client";
import { CellDrawer } from "./components/CellDrawer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { EventDrawer } from "./components/EventDrawer";
import { Header } from "./components/Header";
import { LayerRail } from "./components/LayerRail";
import { LoadStatus } from "./components/LoadStatus";
import { MapKey } from "./components/MapKey";
import { MapView } from "./components/MapView";
import { DrawerBack } from "./components/DrawerFrame";
import { SeaDrawer, closureRecord, seaTitle, type SeaRecord } from "./components/SeaDrawer";
import { VesselDrawer, useVessel } from "./components/VesselDrawer";
import type { OilSlick } from "./api/types";
import { useResource } from "./hooks/useResource";
import { rankLeads } from "./lib/leads";
import { ChangeSpanContext, normalSpan, spanQuery, type ChangeSpan } from "./lib/span";
import { caseTour, type StepShown, type Tour, type TourData, type TourView } from "./lib/tour";
import { THEMED_TOURS } from "./lib/tours";
import { CaseTour } from "./components/CaseTour";
import { TourPanel } from "./components/TourPanel";
import { DEFAULT_VISIBLE, imageDay, lastDays, monthsIn, periodProblem, type LayerId, type Period, type Selection } from "./lib/layers";

const KINDS = ["event", "cell", "vessel", "aisOff", "hotspot", "turnOn", "slick", "fishing", "encounter", "loitering", "closure"] as const;
/** The layer a selection belongs to: opening a record turns its layer on and opens it in the rail. */
const LAYER_OF: Partial<Record<(typeof KINDS)[number], LayerId>> = {
  event: "changes", cell: "changes", aisOff: "aisOff", hotspot: "hotspots", turnOn: "turnOns", slick: "slicks", fishing: "fishing",
  encounter: "encounters", loitering: "loitering", closure: "closures",
};

function readUrl(): { selection: Selection; period: Period; span: ChangeSpan | null } {
  const q = new URLSearchParams(window.location.search);
  let selection: Selection = null;
  for (const kind of KINDS) {
    const id = q.get(kind);
    if (id) { selection = { kind, id }; break; }
  }
  const asked = { start: q.get("from") ?? "", end: q.get("to") ?? "" };
  const cfrom = q.get("cfrom"), cto = q.get("cto");
  const span = cfrom && cto && /^\d{4}-\d{2}$/.test(cfrom) && /^\d{4}-\d{2}$/.test(cto) ? { start: cfrom, end: cto } : null;
  return { selection, period: periodProblem(asked) ? lastDays(30) : asked, span };
}

function writeUrl(sel: Selection, period: Period, span: ChangeSpan | null) {
  const q = new URLSearchParams();
  const def = lastDays(30);
  if (period.start !== def.start || period.end !== def.end) { q.set("from", period.start); q.set("to", period.end); }
  if (span) { q.set("cfrom", span.start); q.set("cto", span.end); }
  if (sel) q.set(sel.kind, sel.id);
  const s = q.toString();
  window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
}

export default function App() {
  const [initial] = useState(readUrl);
  const [selection, setSelection] = useState<Selection>(initial.selection);
  const [period, setPeriod] = useState<Period>(initial.period);
  // the months the "Lasting changes" trend scan runs over (null: every month, the precomputed scan)
  const [changeSpan, setChangeSpan] = useState<ChangeSpan | null>(initial.span);
  const [visible, setVisible] = useState<Record<LayerId, boolean>>(() => {
    const layer = initial.selection && LAYER_OF[initial.selection.kind];
    return layer ? { ...DEFAULT_VISIBLE, [layer]: true } : DEFAULT_VISIBLE;
  });
  const [open, setOpen] = useState<LayerId | null>(() => (initial.selection ? LAYER_OF[initial.selection.kind] ?? null : null));
  const [spot, setSpot] = useState<{ lon: number; lat: number; key: string } | null>(null);   // a place picked inside the ship panel
  const [showNoTakeAreas, setShowNoTakeAreas] = useState(true);
  const [noTakeOnly, setNoTakeOnly] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  // the slick a ship was opened from, as one of its candidate sources: the map links the two
  const [slickLink, setSlickLink] = useState<{ slick: OilSlick; rank: number } | null>(null);

  const { start, end } = period;
  const meta = useResource("meta", api.meta);
  const aisOff = useResource(`aisOff:${start}:${end}`, () => api.aisOff(start, end));
  const slicks = useResource(`slicks:${start}:${end}`, () => api.slicks(start, end));
  const fishing = useResource(`fishing:${start}:${end}`, () => api.protectedFishing(start, end));
  const encounters = useResource(`encounters:${start}:${end}`, () => api.encounters(start, end));
  const loitering = useResource(visible.loitering ? `loitering:${start}:${end}` : null, () => api.loitering(start, end));
  const closures = useResource(visible.closures ? "closures" : null, api.closures);
  // The trend scan's geometry is several MB: fetched only once its layer is switched on.
  const sq = spanQuery(changeSpan);
  const cells = useResource(visible.changes ? `cells${sq}` : null, () => api.cells(changeSpan));
  const events = useResource(visible.changes || open === "changes" ? `events${sq}` : null, () => api.events(changeSpan));
  const vessel = useVessel(selection?.kind === "vessel" ? selection.id : null, period);

  useEffect(() => writeUrl(selection, period, changeSpan), [selection, period, changeSpan]);
  const changeSpanTo = useCallback((s: ChangeSpan | null) => {
    setChangeSpan(normalSpan(s, meta.data?.months ?? []));
    // a change's id belongs to the span it was found in: close it rather than show another span's change under it
    setSelection((sel) => (sel?.kind === "event" || sel?.kind === "cell" ? null : sel));
  }, [meta.data]);

  // shipping lanes come a month at a time: use the months the period touches
  const allMonths = meta.data?.months ?? [];
  const months = useMemo(() => monthsIn(period, allMonths), [period, allMonths]);
  const lanesMonth = months[months.length - 1] ?? null;

  // the cases opened on the way to this one, newest last: a case opened from inside another can go back to it
  const [trail, setTrail] = useState<{ sel: NonNullable<Selection>; label: string }[]>([]);
  const close = useCallback(() => { setSelection(null); setSpot(null); setSlickLink(null); setTrail([]); }, []);
  const changePeriod = useCallback((p: Period) => { setPeriod(p); setSpot(null); }, []);

  const choose = useCallback((sel: Selection) => {
    setSelection(sel);
    setSpot(null);
    setSlickLink(null);
    const layer = sel && LAYER_OF[sel.kind];
    if (layer) {
      setVisible((v) => (v[layer] ? v : { ...v, [layer]: true }));
      setOpen(layer);
    }
  }, []);
  // picked from the rail or the map: a fresh start, nothing to go back to
  const select = useCallback((sel: Selection) => { setTrail([]); choose(sel); }, [choose]);
  const toggle = useCallback((id: LayerId) => setVisible((v) => ({ ...v, [id]: !v[id] })), []);
  // opening a layer only shows its notes and records: the eye beside it alone decides whether it is drawn
  const openLayer = useCallback((id: LayerId | null) => setOpen(id), []);

  const lookup = useCallback((sel: Selection): SeaRecord | null => {
    if (!sel) return null;
    const { kind, id } = sel;
    if (kind === "aisOff") { const r = aisOff.data?.events.find((e) => e.id === id); return r ? { kind, record: r } : null; }
    if (kind === "hotspot") { const r = aisOff.data?.hotspots.find((h) => h.id === id); return r ? { kind, record: r } : null; }
    if (kind === "turnOn") { const r = aisOff.data?.turnOnClusters?.find((t) => t.id === id); return r ? { kind, record: r } : null; }
    if (kind === "slick") { const r = slicks.data?.slicks.find((s) => s.id === id); return r ? { kind, record: r } : null; }
    if (kind === "fishing") { const r = fishing.data?.events.find((f) => f.id === id); return r ? { kind, record: r } : null; }
    if (kind === "encounter") { const r = encounters.data?.events.find((e) => e.id === id); return r ? { kind, record: r } : null; }
    if (kind === "loitering") { const r = loitering.data?.events.find((e) => e.id === id); return r ? { kind, record: r } : null; }
    if (kind === "closure") { const r = closureRecord(closures.data?.closures, id); return r ? { kind, record: r } : null; }
    return null;
  }, [aisOff.data, slicks.data, fishing.data, encounters.data, loitering.data, closures.data]);
  const seaItem = useMemo(() => lookup(selection), [lookup, selection]);

  // the period's strongest leads across every layer, and the case tour that follows the top one with a ship
  const leads = useMemo(() => rankLeads({
    aisOff: aisOff.data?.events, turnOns: aisOff.data?.turnOnClusters, fishing: fishing.data?.events,
    encounters: encounters.data?.events, slicks: slicks.data?.slicks,
  }), [aisOff.data, fishing.data, encounters.data, slicks.data]);
  const leadsLoading = [aisOff, fishing, slicks].some((r) => r.status === "loading");
  const tourLead = leads.find((l) => l.vesselId) ?? leads[0];

  // ---------- guided tours ----------
  const [toursOpen, setToursOpen] = useState(false);
  // n counts every step taken, so going back to a step moves the camera there again
  const [tour, setTour] = useState<{ tour: Tour; at: number; n: number } | null>(null);
  const [camera, setCamera] = useState<{ view: TourView; key: string } | null>(null);
  // the layers and filters from before the tour: put back when it ends
  const saved = useRef<{ visible: Record<LayerId, boolean>; noTakeOnly: boolean; showNoTakeAreas: boolean } | null>(null);
  const applied = useRef<string | null>(null);
  const pending = (r: { status: string }) => r.status !== "success" && r.status !== "error";
  const tourData = useMemo<TourData>(() => ({
    aisOff: aisOff.data, fishing: fishing.data?.events, slicks: slicks.data?.slicks, events: events.data?.data, cells: cells.data?.cells,
    loading: { aisOff: pending(aisOff), fishing: pending(fishing), slicks: pending(slicks), changes: pending(events) || pending(cells) },
  }), [aisOff, fishing, slicks, events, cells]);
  const step = tour ? tour.tour.steps[tour.at] : null;
  const shown = useMemo<StepShown | "loading" | null>(() => (step ? step.show(tourData) : null), [step, tourData]);
  const stepKey = tour ? `${tour.tour.id}:${tour.at}:${tour.n}` : null;

  const startTour = (t: Tour) => {
    if (!tour) saved.current = { visible, noTakeOnly, showNoTakeAreas };
    setTour((cur) => ({ tour: t, at: 0, n: (cur?.n ?? 0) + 1 }));
    setToursOpen(false);
  };
  const startTopCase = () => {
    if (tourLead) startTour(caseTour(tourLead, lookup({ kind: tourLead.kind, id: tourLead.id })?.record.statements ?? []));
  };
  const tourStep = (at: number) => {
    if (!tour || at < 0 || at >= tour.tour.steps.length) return;
    setTour({ ...tour, at, n: tour.n + 1 });
  };
  const endTour = useCallback(() => {
    setTour(null);
    const before = saved.current;
    saved.current = null;
    if (!before) return;
    // put the layers back, keeping the open case's own layer drawn so the panel and the map still agree
    const layer = selection && LAYER_OF[selection.kind];
    setVisible(layer ? { ...before.visible, [layer]: true } : before.visible);
    setNoTakeOnly(before.noTakeOnly);
    setShowNoTakeAreas(before.showNoTakeAreas);
  }, [selection]);
  // entering a step: draw exactly its layers (they start loading what the step needs)
  useEffect(() => {
    if (!step) return;
    if (step.layers) {
      const on = new Set(step.layers);
      setVisible((v) => Object.fromEntries(Object.keys(v).map((k) => [k, on.has(k as LayerId)])) as Record<LayerId, boolean>);
    }
    if (step.noTakeOnly !== undefined) { setNoTakeOnly(step.noTakeOnly); setShowNoTakeAreas(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);
  // once its data is in: open what the step shows and frame it
  useEffect(() => {
    if (!stepKey || !shown || shown === "loading" || applied.current === stepKey) return;
    applied.current = stepKey;
    if (shown.sel) select(shown.sel);
    else close();   // a step about a whole layer: the last case would only get in the way
    if (shown.slick) setSlickLink(shown.slick);
    if (shown.view) setCamera({ view: shown.view, key: stepKey });
  }, [stepKey, shown, select, close]);
  const endRef = useRef(endTour);
  endRef.current = endTour;
  useEffect(() => endRef.current(), [period]);   // a new period has other records
  const focus = useMemo(() => spot ?? (seaItem ? { lon: seaItem.record.lon, lat: seaItem.record.lat, key: `${seaItem.kind}:${seaItem.record.id}` } : null),
    [spot, seaItem]);

  const caseLabel = selection?.kind === "vessel" ? (vessel.data?.identity.name ?? "the ship")
    : seaItem ? seaTitle(seaItem) : selection?.kind === "event" || selection?.kind === "cell" ? "the change" : "the last case";
  /** Open a case from inside another, remembering the way back. */
  const follow = (sel: Selection) => {
    if (selection) setTrail((t) => [...t, { sel: selection, label: caseLabel }]);
    choose(sel);
  };
  const back = trail.length ? {
    label: trail[trail.length - 1].label,
    onBack: () => { const last = trail[trail.length - 1]; setTrail((t) => t.slice(0, -1)); choose(last.sel); },
  } : null;

  const alpha = meta.data?.alpha ?? 0.05;
  const drawerOpen = selection?.kind === "event" || selection?.kind === "cell" || selection?.kind === "vessel" || !!seaItem;

  return (
    <div className="app">
      <Header meta={meta.data} />
      <main className={`main${drawerOpen ? " has-drawer" : ""}${railOpen ? "" : " rail-closed"}`}>
        <LayerRail meta={meta.data} visible={visible} onToggle={toggle} open={open} onOpen={openLayer}
          selection={selection} onSelect={select} leads={leads} leadsLoading={leadsLoading} aisOff={aisOff} slicks={slicks} fishing={fishing}
          encounters={encounters} loitering={loitering} closures={closures}
          period={period} onPeriod={changePeriod} lanesMonth={lanesMonth}
          changeSpan={changeSpan} onChangeSpan={changeSpanTo} changeEvents={events}
          nightDay={imageDay(period, 3)} chlDay={imageDay(period, 3)}
          showNoTakeAreas={showNoTakeAreas} onToggleNoTakeAreas={setShowNoTakeAreas}
          noTakeOnly={noTakeOnly} onToggleNoTakeOnly={setNoTakeOnly} />

        <section className="map-wrap" aria-label="Map">
          <button type="button" className="btn btn-sm rail-toggle" aria-expanded={railOpen} onClick={() => setRailOpen((o) => !o)}>
            {railOpen ? "Hide layers" : "Show layers"}
          </button>
          <ErrorBoundary title="The map could not be drawn">
          <MapView visible={visible} aisOff={aisOff.data}
            slicks={slicks.data?.slicks ?? []} fishing={fishing.data?.events ?? []}
            encounters={encounters.data?.events ?? []} loitering={loitering.data?.events ?? []}
            closures={closures.data?.closures ?? []} period={period}
            cells={cells.data?.cells ?? []} events={events.data?.data ?? []}
            selection={selection} focus={focus} onSelect={select}
            lanesMonth={lanesMonth} nightDay={imageDay(period, 3)} chlDay={imageDay(period, 3)}
            track={selection?.kind === "vessel" ? vessel.data : undefined}
            slickLink={selection?.kind === "vessel" ? slickLink?.slick ?? null : null}
            showNoTakeAreas={showNoTakeAreas} noTakeOnly={noTakeOnly} camera={camera} />
          </ErrorBoundary>
          <button type="button" className="btn btn-sm tours-toggle" aria-expanded={toursOpen} onClick={() => setToursOpen((o) => !o)}>
            {toursOpen ? "Hide tours" : "Guided tours"}
          </button>
          {toursOpen && <TourPanel topLead={tourLead} leadsLoading={leadsLoading} tours={THEMED_TOURS} active={tour?.tour.id ?? null}
            onTopCase={startTopCase} onStart={startTour} onEnd={endTour} onClose={() => setToursOpen(false)} />}
          {tour && shown && <CaseTour tour={tour.tour} at={tour.at} shown={shown} onStep={tourStep} onEnd={endTour} besidePanel={toursOpen} />}
          <MapKey visible={visible} noTakeAreas={showNoTakeAreas} />
          <LoadStatus items={[
            ...(visible.aisOff || visible.hotspots || visible.turnOns ? [{ name: "AIS-off events", ...aisOff }] : []),
            ...(visible.fishing ? [{ name: "fishing in protected areas", ...fishing }] : []),
            ...(visible.slicks ? [{ name: "oil slicks", ...slicks }] : []),
            ...(visible.encounters ? [{ name: "meetings at sea", ...encounters }] : []),
            ...(visible.loitering ? [{ name: "carriers waiting offshore", ...loitering }] : []),
            ...(visible.closures ? [{ name: "seasonal bans", ...closures }] : []),
            ...(visible.changes ? [{ name: "lasting changes", ...cells }] : []),
          ]} />
        </section>

        <ErrorBoundary resetKey={selection ? `${selection.kind}:${selection.id}` : null} onReset={close}
          title="This record could not be shown">
        <DrawerBack.Provider value={back}>
        <ChangeSpanContext.Provider value={changeSpan}>
        {selection?.kind === "event" && (
          <EventDrawer key={selection.id} eventId={selection.id} alpha={alpha} onClose={close}
            onOpenCell={(id) => follow({ kind: "cell", id })} />
        )}
        {selection?.kind === "cell" && (
          <CellDrawer key={selection.id} cellId={selection.id} alpha={alpha} onClose={close}
            onOpenEvent={(id) => follow({ kind: "event", id })} />
        )}
        {selection?.kind === "vessel" && (
          <VesselDrawer key={selection.id} vesselId={selection.id} period={period} onClose={close} fromSlick={slickLink}
            onFocus={(lat, lon, key) => setSpot({ lat, lon, key })} />
        )}
        {seaItem && <SeaDrawer key={`${seaItem.kind}:${seaItem.record.id}`} item={seaItem} onClose={close} period={period}
          onOpenVessel={(id) => follow({ kind: "vessel", id })} candidatesAvailable={slicks.data?.candidatesAvailable}
          onOpenSlickSource={(id, slick, rank) => { follow({ kind: "vessel", id }); setSlickLink({ slick, rank }); }} />}
        </ChangeSpanContext.Provider>
        </DrawerBack.Provider>
        </ErrorBoundary>
      </main>
    </div>
  );
}
