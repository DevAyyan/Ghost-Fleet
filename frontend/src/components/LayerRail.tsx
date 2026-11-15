import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api, type ApiError } from "../api/client";
import type { AisOffResponse, ClosuresResponse, EncountersResponse, LoiteringResponse, MetaResponse, ProtectedFishingResponse, SlicksResponse } from "../api/types";
import { useResource, type Resource } from "../hooks/useResource";
import { formatDateTime, formatDay, formatMonth, formatP, formatSpan, humanCellId, vesselWord } from "../lib/format";
import type { IconName } from "../lib/icons";
import { rankLeads, type Lead } from "../lib/leads";
import { EARLIEST, LAYERS, LAYER_GROUPS, daysAgo, lastDays, periodProblem, spanDays, type LayerId, type Period, type SeaKind, type Selection } from "../lib/layers";
import type { ShipOptions } from "../lib/ship3d";
import { Glyph, Ship } from "./Glyph";
import { LayerSwatch, ZoneSwatch } from "./MapKey";
import { Ship3d } from "./Ship3d";
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
  encounters: Resource<EncountersResponse>;
  loitering: Resource<LoiteringResponse>;
  closures: Resource<ClosuresResponse>;
  period: Period;
  onPeriod: (p: Period) => void;
  lanesMonth: string | null;
  nightDay: string;
  chlDay: string;
  showNoTakeAreas: boolean;
  onToggleNoTakeAreas: (v: boolean) => void;
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
                <span className="feed-title"><Ship name={v.name} gear={v.gear} /></span>
                <span className="feed-meta">Flag {v.flag ?? "unknown"}{v.mmsi ? `, MMSI ${v.mmsi}` : ""}{v.gear.length ? `. ${v.gear.join(", ").replace(/_/g, " ").toLowerCase()}` : ""}.</span>
              </button>
            </li>
          ))}
        </ol>
      ) : <p className="muted layer-empty">No ship matches “{query}”.</p>)}
    </div>
  );
}

/** What each kind of lead is, as its map symbol and a few words. */
const LEAD_GLYPH: Partial<Record<SeaKind, IconName>> = { aisOff: "ghost-fishing", turnOn: "fleet", fishing: "fish", encounter: "meet-carrier", slick: "slick" };
const LEAD_WORD: Partial<Record<SeaKind, string>> = {
  aisOff: "AIS switched off", turnOn: "Went dark together", fishing: "Fishing in a protected area", encounter: "Meeting at sea", slick: "Possible oil slick",
};

/** The strongest leads of the period across every layer: the place to start. Selecting one opens its case and draws its layer. */
function TopLeads({ leads, loading, selection, onSelect }: { leads: Lead[]; loading: boolean } & Pick<Props, "selection" | "onSelect">) {
  return (
    <section className="leads" aria-labelledby="leads-title">
      <h3 id="leads-title" className="leads-title">Start here: the strongest leads</h3>
      <p className="leads-note">Ranked by what makes each stand out, shown under it. Select one to open its case.</p>
      {!leads.length && loading && <Skeleton label="Finding the strongest leads" lines={3} height="3rem" />}
      {!leads.length && !loading && <p className="muted layer-empty">Nothing stands out in this period. Try a longer one, or browse the layers below.</p>}
      {leads.length > 0 && (
        <ol className="feed leads-list" aria-label="Strongest leads, strongest first">
          {leads.map((l) => (
            <li key={`${l.kind}:${l.id}`}>
              <button type="button" className="feed-btn lead-btn" aria-current={selection?.kind === l.kind && selection.id === l.id}
                onClick={() => onSelect({ kind: l.kind, id: l.id })}>
                {LEAD_GLYPH[l.kind] && <Glyph name={LEAD_GLYPH[l.kind]!} size={26} className="lead-sym" />}
                <span className="lead-text">
                  <span className="lead-kind">{LEAD_WORD[l.kind]}</span>
                  <span className="feed-title">{l.title}</span>
                  <span className="feed-meta">{l.what}</span>
                  <span className="lead-why">{l.why.map((w) => <span key={w}>{w}</span>)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** What a layer's drawings mean: a ship as the map draws it close up, or a chart symbol. */
function Key({ items, note }: { items: [IconName | ShipOptions, string][]; note?: string }) {
  return (
    <ul className="key">
      {items.map(([art, text]) => (
        <li key={text}>{typeof art === "string" ? <Glyph name={art} size={26} /> : <Ship3d size={art.consort ? 62 : 52} heading={60} {...art} />}{text}</li>
      ))}
      {note && <li className="key-note">{note}</li>}
    </ul>
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
  const { meta, visible, onToggle, open, onOpen, selection, onSelect, aisOff, slicks, fishing, encounters, loitering, closures,
          period, onPeriod, lanesMonth, nightDay, chlDay,
          showNoTakeAreas, onToggleNoTakeAreas, noTakeOnly, onToggleNoTakeOnly } = p;

  const filteredFishing = fishing.data?.events
    ? (noTakeOnly ? fishing.data.events.filter((e) => e.fullNoTake) : fishing.data.events)
    : [];

  const leads = useMemo(() => rankLeads({
    aisOff: aisOff.data?.events, turnOns: aisOff.data?.turnOnClusters, fishing: fishing.data?.events,
    encounters: encounters.data?.events, slicks: slicks.data?.slicks,
  }), [aisOff.data, fishing.data, encounters.data, slicks.data]);
  const leadsLoading = [aisOff, fishing, slicks].some((r) => r.status === "loading");

  const counts: Record<LayerId, ReactNode> = {
    lanes: null,
    borders: null,
    encounters: count(encounters, encounters.data?.total),
    loitering: visible.loitering ? count(loitering, loitering.data?.total) : null,
    closures: closures.data ? <b className="layer-count num">{closures.data.closures.length}</b> : null,
    infra: null,
    effort: null,
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
        <Key items={[[{ kind: "fishing", look: "ghost" }, "Fishing vessel"], [{ kind: "cargo", look: "ghost" }, "Cargo ship"],
                     [{ kind: "carrier", look: "ghost" }, "Refrigerated carrier"], [{ kind: "tanker", look: "ghost" }, "Bunker tanker"]]}
          note="A ship that stopped broadcasting is drawn empty. From far out it is a small white hull; zoom in and it becomes the ship. The bow points to where it reappeared, and pointing at a ship shows the stretch it sailed unseen. No-take protected areas the ships went dark in are outlined in green; click one for its name." />
        <Rows items={aisOff.data.events} kind="aisOff" selection={selection} onSelect={onSelect} label="Vessels that switched AIS off, newest first"
        title={(e) => <Ship name={e.vesselName} type={e.vesselType} />}
        meta={(e) => `${vesselWord(e.vesselType)}, flag ${e.flag ?? "unknown"}. ${e.place}, ${formatDay(e.start)}, dark for ${formatSpan(e.durationHours)}.`} />
      </>
    ) : <Pending r={aisOff} what="AIS-off events" />,
    hotspots: () => aisOff.data ? (
      <Rows items={aisOff.data.hotspots} kind="hotspot" selection={selection} onSelect={onSelect} label="Places where AIS is switched off most often"
        title={(h) => <>{h.place} <span className="num feed-figure">{h.count}</span></>}
        meta={(h) => `${Math.round(h.topVesselTypeShare * 100)}% ${vesselWord(h.topVesselType).toLowerCase()}s${h.topFlags.length ? `, mostly flagged ${h.topFlags.join(", ")}` : ""}. Typical gap ${formatSpan(h.medianDurationHours)}.`} />
    ) : <Pending r={aisOff} what="AIS-off hot spots" />,
    turnOns: () => aisOff.data ? (
      <>
      <Key items={[["fleet", "Ships that were dark at the same time, drawn larger the more there were"]]}
        note="The dashed outline joins where they switched AIS off and where they switched it back on." />
      <Rows items={aisOff.data.turnOnClusters ?? []} kind="turnOn" selection={selection} onSelect={onSelect}
        label="Areas where vessels entered dark, operated together, and exited"
        title={(t) => <>{t.place} <span className="num feed-figure">{t.count} vessels</span></>}
        meta={(t) => `${formatSpan(t.sharedHours)} concurrently dark (${formatDateTime(t.coPresenceStart)} to ${formatDateTime(t.coPresenceEnd)}). ${t.topFlags.length ? `Flagged ${t.topFlags.join(", ")}. ` : ""}${t.vesselTypes.map(vesselWord).join(", ")}.`} />
      </>
    ) : <Pending r={aisOff} what="joint dark operations" />,
    fishing: () => fishing.data ? (
      <>
        <ul className="key zone-key" aria-label="What the map shows">
          <li><ZoneSwatch full />No fishing at all: a no-take protected area</li>
          <li><ZoneSwatch full={false} />No fishing in part of it: a zone inside is no-take</li>
          <li><Ship3d size={52} heading={60} kind="fishing" hull="#a3271b" />A vessel that moved as if fishing inside one</li>
          <li className="key-note">Point at an area on the map to read its rule; click its label to zoom in. A vessel inside is a lead to check against the area’s permits, never a finding.</li>
        </ul>
        <div className="zone-filter">
          <label>
            <input type="checkbox" checked={showNoTakeAreas} onChange={(e) => onToggleNoTakeAreas(e.target.checked)} />
            Show the protected areas on the map
          </label>
          <div className="zone-filter-which" role="group" aria-label="Which records to show">
            <span className="muted">Show vessels in</span>
            <label>
              <input type="radio" name="noTakeFilter" checked={!noTakeOnly} onChange={() => onToggleNoTakeOnly(false)} />
              any of these areas ({fishing.data.events.length})
            </label>
            <label>
              <input type="radio" name="noTakeFilter" checked={noTakeOnly} onChange={() => onToggleNoTakeOnly(true)} />
              only where all fishing is banned ({fishing.data.events.filter((e) => e.fullNoTake).length})
            </label>
          </div>
        </div>
        <p className="muted layer-empty">This layer is built a day at a time. Days checked so far: {formatDay(fishing.data.days[0])} to {formatDay(fishing.data.days[fishing.data.days.length - 1])} ({fishing.data.scanned.toLocaleString()} apparent-fishing events).</p>
        <Rows items={filteredFishing} kind="fishing" selection={selection} onSelect={onSelect} label="Apparent fishing inside marine protected areas"
          title={(f) => <Ship name={f.vesselName} type={f.vesselType ?? "fishing"} />}
          meta={(f) => `Flag ${f.flag ?? "unknown"}. ${f.place}, ${formatDay(f.start)}${f.durationHours ? `, about ${formatSpan(f.durationHours)}` : ""}. ${f.fullNoTake ? "All fishing banned there." : "Fishing banned in part of that area."}`} />
      </>
    ) : <Pending r={fishing} what="fishing in no-take areas" />,
    slicks: () => slicks.data ? (
      <>
        {slicks.data.totalMatched != null && slicks.data.totalMatched > slicks.data.slicks.length && (
          <p className="muted layer-empty">Showing the {slicks.data.slicks.length.toLocaleString()} largest of {slicks.data.totalMatched.toLocaleString()} detected in the period.</p>
        )}
        <Key items={[["slick", "Possible slick, drawn larger the more sea it covers"], ["slick-ship", "A ship on AIS is its best-matching source"]]} />
        <Rows items={slicks.data.slicks} kind="slick" selection={selection} onSelect={onSelect} label="Possible oil slicks, largest first"
          title={(s) => <>{s.place} <span className="num feed-figure">{Math.round(s.areaKm2).toLocaleString()} km²</span></>}
          meta={(s) => {
            const best = s.candidates[0];
            const who = !best ? SOURCE_WORD[s.possibleSource]
              : best.type === "VESSEL" ? `${best.vesselName ?? `MMSI ${best.ref}`}${best.wentDark ? " (switched AIS off nearby)" : ""}`
              : best.type === "DARK_VESSEL" ? "a ship not on AIS" : best.type === "INFRASTRUCTURE" ? "an offshore structure" : "unidentified";
            return `${formatDay(s.time)}. Best-matching candidate source: ${who}.`;
          }} />
      </>
    ) : <Pending r={slicks} what="oil slicks" />,
    borders: () => <p className="muted layer-empty">Dashed lines mark where one country's waters end. Solid shading is not drawn so the data stays readable.</p>,
    encounters: () => encounters.data ? (
      <>
        {encounters.data.truncated && <p className="muted layer-empty">This period has more meetings than can be fetched; the newest are used.</p>}
        <p className="muted layer-empty">{encounters.data.events.filter((e) => e.darkLink).length.toLocaleString()} with AIS switched off nearby,{" "}
          {encounters.data.events.filter((e) => e.vessels.some((v) => v.authorisation === "NOT_FOUND")).length.toLocaleString()} involving a vessel with no public licence on record.</p>
        <Key items={[[{ kind: "carrier", consort: "fishing" }, "A refrigerated carrier with a fishing vessel alongside"],
                     [{ kind: "tanker", consort: "fishing" }, "A bunker tanker with a fishing vessel alongside"]]}
          note="A magenta ring: AIS was switched off nearby. From far out, a larger mark is a stronger lead." />
        <Rows items={encounters.data.events} kind="encounter" selection={selection} onSelect={onSelect} label="Meetings at sea, strongest leads first"
          title={(e) => <>{e.vessels.map((v) => v.name ?? "Unnamed").join(" + ")}{e.darkLink && <span className="feed-figure"> AIS off</span>}</>}
          meta={(e) => `${e.type?.replace("-", " and ") ?? "Meeting"}, ${e.place}, ${formatDay(e.start)}, ${formatSpan(e.durationHours)}.${e.vessels.some((v) => v.authorisation === "NOT_FOUND") ? " No public licence on record for one vessel." : ""}`} />
      </>
    ) : <Pending r={encounters} what="meetings at sea" />,
    loitering: () => loitering.data ? (
      <>
      <Key items={[[{ kind: "carrier" }, "Waiting, no meeting recorded"], [{ kind: "carrier", plate: "#0f766e" }, "Met a vessel within a day"]]} />
      <Rows items={loitering.data.events} kind="loitering" selection={selection} onSelect={onSelect} label="Carriers and bunker tankers waiting offshore"
        title={(l) => <><Ship name={l.vesselName} type={l.vesselType} />{l.metVessel && <span className="feed-figure"> met a vessel</span>}</>}
        meta={(l) => `${vesselWord(l.vesselType)}, flag ${l.flag ?? "unknown"}. ${l.place}, ${Math.round(l.shoreKm ?? 0).toLocaleString()} km out, ${formatSpan(l.durationHours)} from ${formatDay(l.start)}.`} />
      </>
    ) : <Pending r={loitering} what="carriers waiting offshore" />,
    closures: () => closures.data ? (
      <ol className="feed" aria-label="Seasonal fishing bans, each year">
        {closures.data.closures.flatMap((c) => c.seasons.map((s) => (
          <li key={s.id}>
            <button type="button" className="feed-btn" aria-current={selection?.kind === "closure" && selection.id === s.id}
              onClick={() => onSelect({ kind: "closure", id: s.id })}>
              <span className="feed-title">{c.name} {s.year} <span className="num feed-figure">{Math.round(s.hoursDuring).toLocaleString()} h</span></span>
              <span className="feed-meta">{c.window}. {s.ratio == null ? "" : `Fishing ${Math.round((1 - s.ratio) * 100)}% below the weeks around the ban; `}{s.cellsDuring.toLocaleString()} spots fished during it.</span>
            </button>
          </li>
        )))}
      </ol>
    ) : <Pending r={closures} what="seasonal bans" />,
    infra: () => (
      <>
        <Key items={[["platform", "Oil or gas platform"], ["turbine", "Wind turbine"], ["structure", "Structure, type not classified"]]} />
        <p className="muted layer-empty">Select one on the map for details. They appear once you zoom in a little.</p>
      </>
    ),
    effort: () => <p className="muted layer-empty">Fishing hours from {formatDay(period.start)} to {formatDay(period.end)}. Tiles can take a few seconds the first time.</p>,
    changes: () => <ChangeList meta={meta} selection={selection} onSelect={onSelect} />,
    nightLights: () => <p className="muted layer-empty">Image date: {formatDay(nightDay)}. This layer covers the chart with a night view; the other layers stay on top.</p>,
    chlorophyll: () => <p className="muted layer-empty">Image date: {formatDay(chlDay)}.</p>,
  };

  return (
    <aside className="rail theme-navy" aria-label="Map layers and what they show">
      <div className="rail-head">
        <h2>At sea</h2>
        <PeriodBar period={period} onPeriod={onPeriod} />
      </div>
      <div className="rail-body">
        <ShipSearch selection={selection} onSelect={onSelect} />
        <TopLeads leads={leads} loading={leadsLoading} selection={selection} onSelect={onSelect} />
        <h3 className="rail-section">Map layers</h3>
        {LAYER_GROUPS.map((g) => (
          <section key={g.id} className="layer-group" aria-labelledby={`layer-group-${g.id}`}>
            <h3 id={`layer-group-${g.id}`} className="layer-group-name">{g.name}</h3>
            <ul className="layer-list">
              {LAYERS.filter((l) => l.group === g.id).map((l) => {
                const isOpen = open === l.id;
                return (
                  <li key={l.id} className="layer" data-open={isOpen} data-on={visible[l.id]}>
                    <div className="layer-row">
                      <input type="checkbox" id={`layer-${l.id}`} checked={visible[l.id]} onChange={() => onToggle(l.id)}
                        aria-label={`Show ${l.name} on the map`} />
                      <LayerSwatch id={l.id} />
                      <button type="button" className="layer-name" aria-expanded={isOpen} aria-controls={`layer-detail-${l.id}`}
                        onClick={() => onOpen(isOpen ? null : l.id)}>
                        <span>{l.name}</span>{counts[l.id]}<i className="chev" aria-hidden="true" />
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
          </section>
        ))}
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
