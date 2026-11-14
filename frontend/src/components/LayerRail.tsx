import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, type ApiError } from "../api/client";
import type { AisOffResponse, MetaResponse, ProtectedFishingResponse, SlicksResponse } from "../api/types";
import { useResource, type Resource } from "../hooks/useResource";
import { formatDateTime, formatDay, formatMonth, formatP, formatSpan, humanCellId, vesselWord } from "../lib/format";
import { EARLIEST, LAYERS, daysAgo, lastDays, periodProblem, spanDays, type LayerId, type Period, type Selection } from "../lib/layers";
import { ErrorState, Skeleton, TrendChip } from "./ui";

interface Props {
  meta?: MetaResponse;
  visible: Record<LayerId, boolean>;
  onToggle: (id: LayerId) => void;
  open: LayerId | null;
  onOpen: (id: LayerId | null) => void;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  aisOff: Resource<AisOffResponse>;
  slicks: Resource<SlicksResponse>;
  fishing: Resource<ProtectedFishingResponse>;
  period: Period;
  onPeriod: (p: Period) => void;
  lanesMonth: string | null;
  nightDay: string;
  chlDay: string;
  highlightIllegalZones: boolean;
  onToggleIllegalZones: (v: boolean) => void;
  noTakeOnly: boolean;
  onToggleNoTakeOnly: (v: boolean) => void;
}

const PRESETS: [string, () => Period][] = [
  ["7 days", () => lastDays(7)], ["30 days", () => lastDays(30)], ["90 days", () => lastDays(90)],
  ["This year", () => ({ start: `${daysAgo(0).slice(0, 4)}-01-01`, end: daysAgo(0) })],
];

/** The period every dated layer is filtered to: two dates, or a preset. Applies as soon as both dates are usable. */
function PeriodBar({ period, onPeriod }: { period: Period; onPeriod: (p: Period) => void }) {
  const [draft, setDraft] = useState(period);
  useEffect(() => setDraft(period), [period]);
  const problem = periodProblem(draft);
  const edit = (next: Period) => {
    setDraft(next);
    if (!periodProblem(next) && (next.start !== period.start || next.end !== period.end)) onPeriod(next);
  };
  const today = daysAgo(0);
  return (
    <fieldset className="period">
      <legend>Period</legend>
      <div className="period-dates">
        <label>From<input type="date" value={draft.start} min={EARLIEST} max={today} onChange={(e) => edit({ ...draft, start: e.target.value })} /></label>
        <label>To<input type="date" value={draft.end} min={EARLIEST} max={today} onChange={(e) => edit({ ...draft, end: e.target.value })} /></label>
      </div>
      <div className="period-presets" role="group" aria-label="Quick periods ending today">
        {PRESETS.map(([name, make]) => {
          const p = make();
          return (
            <button key={name} type="button" className="btn btn-sm" aria-pressed={p.start === period.start && p.end === period.end}
              onClick={() => edit(p)}>{name}</button>
          );
        })}
      </div>
      {problem
        ? <p className="error-text period-note" role="alert">{problem}</p>
        : <p className="muted period-note">{formatDay(period.start)} to {formatDay(period.end)}, {spanDays(period)} days.</p>}
    </fieldset>
  );
}

/** Find a ship by name, MMSI, IMO or call sign and open its path for the period. */
function ShipSearch({ selection, onSelect }: Pick<Props, "selection" | "onSelect">) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const res = useResource(query ? `search:${query}` : null, () => api.searchVessels(query!));
  const submit = (e: FormEvent) => { e.preventDefault(); const q = text.trim(); if (q.length >= 3) setQuery(q); };
  return (
    <div className="ship-search">
      <form onSubmit={submit} role="search" aria-label="Find a ship">
        <label className="sr-only" htmlFor="ship-q">Ship name, MMSI, IMO or call sign</label>
        <input id="ship-q" type="search" placeholder="Find a ship: name, MMSI or IMO" value={text} minLength={3} maxLength={60}
          onChange={(e) => { setText(e.target.value); if (!e.target.value) setQuery(null); }} />
        <button type="submit" className="btn btn-sm" disabled={text.trim().length < 3}>Find</button>
      </form>
      {query && res.status === "loading" && <Skeleton label="Searching ships" lines={2} height="2rem" />}
      {query && res.status === "error" && <ErrorState error={res.error} onRetry={res.refetch} title="Search failed" />}
      {query && res.status === "success" && (res.data.results.length ? (
        <ol className="feed" aria-label={`Ships matching ${query}`}>
          {res.data.results.map((v) => (
            <li key={v.vesselId}>
              <button type="button" className="feed-btn" aria-current={selection?.kind === "vessel" && selection.id === v.vesselId}
                onClick={() => onSelect({ kind: "vessel", id: v.vesselId })}>
                <span className="feed-title">{v.name ?? "Unnamed vessel"}</span>
                <span className="feed-meta">Flag {v.flag ?? "unknown"}{v.mmsi ? `, MMSI ${v.mmsi}` : ""}{v.gear.length ? `. ${v.gear.join(", ").replace(/_/g, " ").toLowerCase()}` : ""}.</span>
              </button>
            </li>
          ))}
        </ol>
      ) : <p className="muted layer-empty">No ship matches “{query}”.</p>)}
    </div>
  );
}

const SOURCE_WORD = { VESSEL: "a vessel on AIS", INFRASTRUCTURE: "offshore infrastructure", DARK_VESSEL: "a vessel not on AIS",
                      NATURAL: "a natural seep", UNKNOWN: "no source matched" } as const;
const LIST_MAX = 40;

function count(r: Resource<unknown>, n: number | undefined): ReactNode {
  if (r.status === "error") return <span className="layer-count muted">unavailable</span>;
  if (n == null) return <span className="layer-count muted">…</span>;
  return <b className="layer-count num">{n.toLocaleString()}</b>;
}

function Rows<T extends { id: string }>({ items, kind, selection, onSelect, title, meta, label }: {
  items: T[]; kind: NonNullable<Selection>["kind"]; selection: Selection; onSelect: (s: Selection) => void;
  title: (x: T) => ReactNode; meta: (x: T) => ReactNode; label: string;
}) {
  if (!items.length) return <p className="muted layer-empty">Nothing in this period.</p>;
  return (
    <ol className="feed" aria-label={label}>
      {items.slice(0, LIST_MAX).map((x) => (
        <li key={x.id}>
          <button type="button" className="feed-btn" aria-current={selection?.kind === kind && selection.id === x.id}
            onClick={() => onSelect({ kind, id: x.id })}>
            <span className="feed-title">{title(x)}</span>
            <span className="feed-meta">{meta(x)}</span>
          </button>
        </li>
      ))}
      {items.length > LIST_MAX && <li className="feed-more muted">{(items.length - LIST_MAX).toLocaleString()} more on the map</li>}
    </ol>
  );
}

function Pending({ r, what }: { r: Resource<unknown>; what: string }) {
  if (r.status === "error") {
    const e: ApiError = r.error;
    return e.code === "DATA_UNAVAILABLE"
      ? <p className="muted layer-empty">{e.message}</p>
      : <ErrorState error={e} onRetry={(r as { refetch?: () => void }).refetch} title={`Could not load ${what}`} />;
  }
  return <Skeleton label={`Loading ${what}`} lines={3} height="2.25rem" />;
}

export function LayerRail(p: Props) {
  const { meta, visible, onToggle, open, onOpen, selection, onSelect, aisOff, slicks, fishing,
          period, onPeriod, lanesMonth, nightDay, chlDay,
          highlightIllegalZones, onToggleIllegalZones, noTakeOnly, onToggleNoTakeOnly } = p;

  const filteredFishing = fishing.data?.events
    ? (noTakeOnly ? fishing.data.events.filter((e) => e.fullNoTake) : fishing.data.events)
    : [];

  const counts: Record<LayerId, ReactNode> = {
    lanes: null,
    aisOff: count(aisOff, aisOff.data?.total),
    hotspots: count(aisOff, aisOff.data?.hotspots.length),
    turnOns: count(aisOff, aisOff.data?.turnOnClusters?.length),
    fishing: fishing.status === "error" && fishing.error.code === "DATA_UNAVAILABLE"
      ? <span className="layer-count muted">not built</span> : count(fishing, filteredFishing.length),
    slicks: count(slicks, slicks.data?.slicks.length),
    changes: meta && meta.eventCount > 0 ? <b className="layer-count num">{meta.eventCount.toLocaleString()}</b> : null,
    nightLights: null,
    chlorophyll: null,
  };

  const detail: Record<LayerId, () => ReactNode> = {
    lanes: () => <p className="muted layer-empty">Month shown: {lanesMonth ? formatMonth(lanesMonth) : "latest"}. Tiles load as you move the map; the first view of a month or an area can take several seconds.</p>,
    aisOff: () => aisOff.data ? (
      <>
        {aisOff.data.truncated && <p className="muted layer-empty">This period has more events than can be fetched; the newest 15,000 are used.</p>}
        <Rows items={aisOff.data.events} kind="aisOff" selection={selection} onSelect={onSelect} label="Vessels that switched AIS off, newest first"
        title={(e) => e.vesselName ?? "Unnamed vessel"}
        meta={(e) => `${vesselWord(e.vesselType)}, flag ${e.flag ?? "unknown"}. ${e.place}, ${formatDay(e.start)}, dark for ${formatSpan(e.durationHours)}.`} />
      </>
    ) : <Pending r={aisOff} what="AIS-off events" />,
    hotspots: () => aisOff.data ? (
      <Rows items={aisOff.data.hotspots} kind="hotspot" selection={selection} onSelect={onSelect} label="Places where AIS is switched off most often"
        title={(h) => <>{h.place} <span className="num feed-figure">{h.count}</span></>}
        meta={(h) => `${Math.round(h.topVesselTypeShare * 100)}% ${vesselWord(h.topVesselType).toLowerCase()}s${h.topFlags.length ? `, mostly flagged ${h.topFlags.join(", ")}` : ""}. Typical gap ${formatSpan(h.medianDurationHours)}.`} />
    ) : <Pending r={aisOff} what="AIS-off hot spots" />,
    turnOns: () => aisOff.data ? (
      <Rows items={aisOff.data.turnOnClusters ?? []} kind="turnOn" selection={selection} onSelect={onSelect}
        label="Areas where vessels entered dark, operated together, and exited"
        title={(t) => <>{t.place} <span className="num feed-figure">{t.count} vessels</span></>}
        meta={(t) => `${formatSpan(t.sharedHours)} concurrently dark (${formatDateTime(t.coPresenceStart)} to ${formatDateTime(t.coPresenceEnd)}). ${t.topFlags.length ? `Flagged ${t.topFlags.join(", ")}. ` : ""}${t.vesselTypes.map(vesselWord).join(", ")}.`} />
    ) : <Pending r={aisOff} what="joint dark operations" />,
    fishing: () => fishing.data ? (
      <>
        <div className="filter-box" style={{ padding: "var(--s-2) var(--s-5)", borderBottom: "1px solid var(--rule)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--s-2)", fontWeight: 600, fontSize: "var(--fs-sm)", cursor: "pointer" }}>
            <input type="checkbox" checked={highlightIllegalZones} onChange={(e) => onToggleIllegalZones(e.target.checked)} />
            Highlight illegal fishing zones on map
          </label>
          {highlightIllegalZones && (
            <div style={{ marginTop: "var(--s-1)", display: "flex", gap: "var(--s-3)", fontSize: "var(--fs-xs)" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                <input type="radio" name="illegalFilter" checked={!noTakeOnly} onChange={() => onToggleNoTakeOnly(false)} />
                All MPAs ({fishing.data.events.length})
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                <input type="radio" name="illegalFilter" checked={noTakeOnly} onChange={() => onToggleNoTakeOnly(true)} />
                Strict No-Take only ({fishing.data.events.filter((e) => e.fullNoTake).length})
              </label>
            </div>
          )}
        </div>
        <p className="muted layer-empty" style={{ marginTop: "var(--s-2)" }}>This layer is built a day at a time. Days checked so far: {formatDay(fishing.data.days[0])} to {formatDay(fishing.data.days[fishing.data.days.length - 1])} ({fishing.data.scanned.toLocaleString()} apparent-fishing events).</p>
        <Rows items={filteredFishing} kind="fishing" selection={selection} onSelect={onSelect} label="Apparent fishing inside marine protected areas"
          title={(f) => f.vesselName ?? "Unnamed vessel"}
          meta={(f) => `Flag ${f.flag ?? "unknown"}. ${f.place}, ${formatDay(f.start)}${f.durationHours ? `, about ${formatSpan(f.durationHours)}` : ""}. ${f.fullNoTake ? "Strict No-Take area." : "Partly no-take area."}`} />
      </>
    ) : <Pending r={fishing} what="fishing in no-take areas" />,
    slicks: () => slicks.data ? (
      <>
        {slicks.data.totalMatched != null && slicks.data.totalMatched > slicks.data.slicks.length && (
          <p className="muted layer-empty">Showing the {slicks.data.slicks.length.toLocaleString()} largest of {slicks.data.totalMatched.toLocaleString()} detected in the period.</p>
        )}
        <Rows items={slicks.data.slicks} kind="slick" selection={selection} onSelect={onSelect} label="Possible oil slicks, largest first"
          title={(s) => <>{s.place} <span className="num feed-figure">{Math.round(s.areaKm2).toLocaleString()} km²</span></>}
          meta={(s) => `${formatDay(s.time)}. Nearest candidate source: ${SOURCE_WORD[s.possibleSource]}.`} />
      </>
    ) : <Pending r={slicks} what="oil slicks" />,
    changes: () => <ChangeList meta={meta} selection={selection} onSelect={onSelect} />,
    nightLights: () => <p className="muted layer-empty">Image date: {formatDay(nightDay)}. This layer covers the chart with a night view; the other layers stay on top.</p>,
    chlorophyll: () => <p className="muted layer-empty">Image date: {formatDay(chlDay)}.</p>,
  };

  return (
    <aside className="rail" aria-label="Map layers and what they show">
      <div className="rail-head">
        <h2>At sea</h2>
        <PeriodBar period={period} onPeriod={onPeriod} />
      </div>
      <div className="rail-body">
        <ShipSearch selection={selection} onSelect={onSelect} />
        <ul className="layer-list">
          {LAYERS.map((l) => {
            const isOpen = open === l.id;
            return (
              <li key={l.id} className="layer" data-open={isOpen}>
                <div className="layer-row">
                  <input type="checkbox" id={`layer-${l.id}`} checked={visible[l.id]} onChange={() => onToggle(l.id)}
                    aria-label={`Show ${l.name} on the map`} />
                  <i className={`sym sym-${l.id}`} aria-hidden="true" />
                  <button type="button" className="layer-name" aria-expanded={isOpen} aria-controls={`layer-detail-${l.id}`}
                    onClick={() => onOpen(isOpen ? null : l.id)}>
                    <span>{l.name}</span>{counts[l.id]}
                  </button>
                </div>
                {isOpen && (
                  <div className="layer-detail" id={`layer-detail-${l.id}`}>
                    <p className="layer-about">{l.about}</p>
                    <p className="layer-source">Source: {l.source}</p>
                    {detail[l.id]()}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

function ChangeList({ meta, selection, onSelect }: Pick<Props, "meta" | "selection" | "onSelect">) {
  const res = useResource("events", () => api.events());
  if (res.status === "loading" || res.status === "idle") return <Skeleton label="Loading changes" lines={4} />;
  if (res.status === "error") return <ErrorState error={res.error} onRetry={res.refetch} title="Could not load changes" />;
  const events = res.data.data;
  if (!events.length) return <p className="muted layer-empty">No change survived every correction. Apparent shifts were explained by coverage, AIS reception, season or wind.</p>;
  return (
    <>
      {meta && (
        <p className="muted layer-empty">
          Tested {meta.cellCount.toLocaleString()} areas over {meta.months.length} months; {meta.eventCount.toLocaleString()} changes survive every correction.
          {meta.eventCount > events.length ? ` The ${events.length} strongest are listed and drawn.` : ""}
        </p>
      )}
      <ol className="feed" aria-label="Ranked lasting changes">
        {events.map((e) => (
          <li key={e.eventId}>
            <button type="button" className="feed-btn" aria-current={selection?.kind === "event" && selection.id === e.eventId}
              onClick={() => onSelect({ kind: "event", id: e.eventId })}>
              <span className="feed-title">{e.place ?? humanCellId(e.leadCellId)} <TrendChip direction={e.direction} pct={e.pctPerYear} /></span>
              <span className="feed-meta">Around {humanCellId(e.leadCellId)}, {e.cellIds.length} {e.cellIds.length === 1 ? "area" : "areas"}, false-discovery q {formatP(e.q)}.</span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}
