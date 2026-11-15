import type { ReactNode } from "react";
import type {
  AisOffEvent, AisOffHotspot, Authorisation, Closure, ClosureSeason, CoordinatedTurnOn, Encounter, Loitering, OilSlick,
  ProtectedFishingEvent, Statement,
} from "../api/types";
import { formatDateTime, formatDay, formatSpan, vesselWord } from "../lib/format";
import type { IconName } from "../lib/icons";
import type { Period } from "../lib/layers";
import type { ShipOptions } from "../lib/ship3d";
import { CLASS_WORD, shapeOf, vesselClass } from "../lib/vessel";
import { DrawerFrame } from "./DrawerFrame";
import { Ship } from "./Glyph";
import { InsightsPanel } from "./InsightsPanel";
import { SlickCandidates } from "./SlickCandidates";
import { ShipFigure } from "./ShipProfile";
import { Section, StatementRow } from "./ui";

/** One year of one seasonal ban, with where it is drawn (its busiest fishing spot). */
export type ClosureRecord = ClosureSeason & { closure: Closure; lat: number; lon: number };

export function closureRecord(closures: Closure[] | undefined, id: string): ClosureRecord | null {
  for (const c of closures ?? []) {
    const s = c.seasons.find((x) => x.id === id);
    if (s) {
      const top = s.cells[0];
      return { ...s, closure: c, lat: top?.lat ?? 0, lon: top?.lon ?? 0 };
    }
  }
  return null;
}

export const AUTH_WORD: Record<Authorisation, string> = {
  AUTHORISED: "publicly licensed", PARTLY: "partly licensed", NOT_FOUND: "no public licence on record", UNKNOWN: "licence unknown",
};
const PARTY: Record<string, string> = { carrier: "Refrigerated carrier", bunker: "Bunker tanker", support: "Support vessel", tanker: "Tanker", fishing: "Fishing vessel" };

export type SeaRecord =
  | { kind: "aisOff"; record: AisOffEvent }
  | { kind: "hotspot"; record: AisOffHotspot }
  | { kind: "turnOn"; record: CoordinatedTurnOn }
  | { kind: "slick"; record: OilSlick }
  | { kind: "fishing"; record: ProtectedFishingEvent }
  | { kind: "encounter"; record: Encounter }
  | { kind: "loitering"; record: Loitering }
  | { kind: "closure"; record: ClosureRecord };

const coords = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
const km = (v: number | null) => (v == null ? "unknown" : `${Math.round(v).toLocaleString()} km`);
const SOURCE_NOTE = {
  aisOff: "Global Fishing Watch events (AIS gaps classed as likely intentional).",
  hotspot: "Global Fishing Watch events (AIS gaps classed as likely intentional), last 180 days.",
  turnOn: "Global Fishing Watch AIS gap events. Detected by joint dark operational analysis: vessels that turned off AIS on entering the area, operated dark together inside, and restored AIS upon exiting.",
  slick: "SkyTruth Cerulean, a machine-learning model run on Sentinel-1 radar.",
  fishing: "Global Fishing Watch apparent-fishing events tagged inside a no-take marine protected area.",
  encounter: "Global Fishing Watch encounter events, AIS gap events and public RFMO authorisation lists.",
  loitering: "Global Fishing Watch loitering events (carriers and bunker tankers, 20+ nautical miles from shore).",
  closure: "Global Fishing Watch apparent fishing effort (AIS) in the country's EEZ; ban dates from the notices below.",
} as const;

function facts(item: SeaRecord): [string, ReactNode][] {
  switch (item.kind) {
    case "aisOff": {
      const e = item.record;
      return [["Vessel", `${vesselWord(e.vesselType)}, flag ${e.flag ?? "unknown"}`], ["Went dark", formatDay(e.start)],
        ["Back on AIS", e.end ? formatDay(e.end) : "not yet"], ["Dark for", formatSpan(e.durationHours)],
        ["Moved while dark", km(e.distanceKm)], ["From shore", km(e.shoreKm)], ["Where", `${e.place}, ${coords(e.lat, e.lon)}`],
        ["Protected area", e.inNoTake ? "Inside a no-take area" : e.inProtectedArea ? "Inside a protected area" : e.highSeas ? "No, high seas" : "No"]];
    }
    case "hotspot": {
      const h = item.record;
      return [["Vessels that went dark", h.count.toLocaleString()], ["Most were", `${vesselWord(h.topVesselType).toLowerCase()}s (${Math.round(h.topVesselTypeShare * 100)}%)`],
        ["Most common flags", h.topFlags.join(", ") || "unknown"], ["Typical gap", formatSpan(h.medianDurationHours)],
        ["Centre", coords(h.lat, h.lon)], ["Counted within", `about ${Math.round(h.radiusKm)} km`]];
    }
    case "turnOn": {
      const t = item.record;
      return [
        ["Vessels involved", `${t.count.toLocaleString()} vessels`],
        ["All dark together", `${formatDateTime(t.coPresenceStart)} to ${formatDateTime(t.coPresenceEnd)} (${formatSpan(t.sharedHours)})`],
        ["Entered (AIS off)", `${coords(t.enterLat, t.enterLon)}${t.earliestEnter ? ` (${formatDay(t.earliestEnter)})` : ""}`],
        ["Exited (AIS on)", `${coords(t.exitLat, t.exitLon)} (${formatDay(t.earliest)})`],
        ["Exit time window", `within ${formatSpan(t.spanHours)}`],
        ["Area", `${t.place}, ${coords(t.lat, t.lon)}`],
        ["Most common flags", t.topFlags.join(", ") || "unknown"],
        ["Vessel types", t.vesselTypes.map(vesselWord).join(", ")],
        ["Area spread", `about ${Math.round(t.radiusKm)} km`],
      ];
    }
    case "slick": {
      const s = item.record;
      return [["Seen on", formatDay(s.time)], ["Area", `${Math.round(s.areaKm2).toLocaleString()} km²`], ["Length", km(s.lengthKm)],
        ["Model confidence", `${Math.min(99, Math.round(s.confidence * 100))}%`], ["Where", `${s.place}, ${coords(s.lat, s.lon)}`]];
    }
    case "fishing": {
      const f = item.record;
      return [["Vessel", `${vesselWord(f.vesselType)}, flag ${f.flag ?? "unknown"}`], ["Started", formatDay(f.start)],
        ["Lasted", formatSpan(f.durationHours)], ["From shore", km(f.shoreKm)], ["Where", `${f.place}, ${coords(f.lat, f.lon)}`],
        ["Area type", f.fullNoTake ? "No-take marine protected area" : "Protected area that is partly no-take"]];
    }
    case "encounter": {
      const e = item.record;
      return [["Met on", formatDateTime(e.start)], ["Lasted", formatSpan(e.durationHours)],
        ["Apart", e.medianDistanceKm == null ? "unknown" : `about ${Math.round(e.medianDistanceKm * 1000).toLocaleString()} m`],
        ["Speed", e.medianSpeedKnots == null ? "unknown" : `${e.medianSpeedKnots.toFixed(1)} knots`],
        ["From shore", km(e.shoreKm)], ["Where", `${e.place}, ${coords(e.lat, e.lon)}${e.highSeas ? ", high seas" : ""}`],
        ["Fisheries bodies", e.rfmo.join(", ") || "none"],
        ["GFW risk flag", e.potentialRisk ? "Yes: a vessel lacks a matching public authorisation" : "No"]];
    }
    case "loitering": {
      const l = item.record;
      return [["Vessel", `${vesselWord(l.vesselType)}, flag ${l.flag ?? "unknown"}`], ["Started", formatDateTime(l.start)],
        ["Lasted", formatSpan(l.durationHours)], ["Average speed", l.speedKnots == null ? "unknown" : `${l.speedKnots.toFixed(1)} knots`],
        ["From shore", km(l.shoreKm)], ["Where", `${l.place}, ${coords(l.lat, l.lon)}${l.highSeas ? ", high seas" : ""}`],
        ["Met a vessel", l.metVessel ? "Yes, within 24 hours" : "No recorded encounter"]];
    }
    case "closure": {
      const s = item.record, c = s.closure;
      const h = (v: number) => `${Math.round(v).toLocaleString()} hours`;
      return [["Ban", `${formatDay(s.start)} to ${formatDay(s.end)} (${s.days} days)`], ["Applies to", c.scope],
        ["Fishing during", h(s.hoursDuring)], [`${s.days} days before`, h(s.hoursBefore)], [`${s.days} days after`, h(s.hoursAfter)],
        ["Spots fished during", `${s.cellsDuring.toLocaleString()} (0.1° squares)`], ["Busiest", s.cells[0] ? coords(s.cells[0].lat, s.cells[0].lon) : "none"],
        ["Rule confidence", c.confidence.charAt(0) + c.confidence.slice(1).toLowerCase()]];
    }
  }
}

/** The symbol a record has on the map, for those drawn as a symbol and not as a ship. */
function icon(item: SeaRecord): IconName | undefined {
  if (item.kind === "turnOn") return "fleet";
  if (item.kind === "slick") return item.record.candidates[0]?.type === "VESSEL" ? "slick-ship" : "slick";
  return undefined;
}

/** The ship, or pair of ships, a record is about, as the map draws it close up, with a line saying what the drawing is. */
function figure(item: SeaRecord): { ship: ShipOptions; label: string; caption: string } | null {
  const NOT = "Not a drawing of this ship.";
  switch (item.kind) {
    case "aisOff": {
      const c = vesselClass(item.record.vesselType), word = CLASS_WORD[c].toLowerCase();
      return { ship: { kind: shapeOf(c), look: "ghost" }, label: `A ${word}, drawn as an empty hull.`,
               caption: `Typical outline of a ${word}, drawn empty because it stopped broadcasting. ${NOT}` };
    }
    case "fishing":
      return { ship: { kind: "fishing", hull: "#a3271b" }, label: "A fishing vessel.", caption: `Typical outline of a fishing vessel. ${NOT}` };
    case "encounter": {
      const tanker = item.record.type?.startsWith("bunker"), big = tanker ? "bunker tanker" : "refrigerated carrier";
      return { ship: { kind: tanker ? "tanker" : "carrier", consort: "fishing" }, label: `A ${big} with a fishing vessel alongside.`,
               caption: `Typical outlines of a ${big} and a fishing vessel alongside. Not drawings of these ships.` };
    }
    case "loitering": {
      const tanker = vesselClass(item.record.vesselType) === "bunker", word = tanker ? "bunker tanker" : "refrigerated carrier";
      return { ship: { kind: tanker ? "tanker" : "carrier" }, label: `A ${word}.`, caption: `Typical outline of a ${word}. ${NOT}` };
    }
    default: return null;
  }
}

export function seaTitle(item: SeaRecord): string {
  switch (item.kind) {
    case "aisOff": return `${item.record.vesselName ?? "Unnamed vessel"} went dark`;
    case "hotspot": return `Where ships go dark: ${item.record.place}`;
    case "turnOn": return `Joint dark operation: ${item.record.place} (${item.record.count} vessels)`;
    case "slick": return `Possible oil slick, ${item.record.place}`;
    case "fishing": return `${item.record.vesselName ?? "Unnamed vessel"}: apparent fishing in a no-take area`;
    case "encounter": return `Meeting at sea: ${item.record.vessels.map((v) => v.name ?? "unnamed").join(" and ")}`;
    case "loitering": return `${item.record.vesselName ?? "Unnamed vessel"} waiting offshore`;
    case "closure": return `${item.record.closure.name}, ${item.record.year}`;
  }
}

export function SeaDrawer({ item, onClose, onOpenVessel, period, onOpenSlickSource, candidatesAvailable }: {
  item: SeaRecord; onClose: () => void; onOpenVessel: (vesselId: string) => void; period: Period;
  onOpenSlickSource?: (vesselId: string, slick: OilSlick, rank: number) => void; candidatesAvailable?: boolean;
}) {
  const vesselId = item.kind === "aisOff" || item.kind === "fishing" || item.kind === "loitering" ? item.record.vesselId : null;
  const statements: Statement[] = item.record.statements;
  const seen = statements.filter((s) => s.label === "OBSERVATION" || s.label === "INFERENCE");
  const might = statements.filter((s) => s.label === "HYPOTHESIS");
  const next = statements.filter((s) => s.label === "RECOMMENDATION");
  const fig = figure(item);
  return (
    <DrawerFrame title={seaTitle(item)} onClose={onClose} icon={icon(item)}>
      {fig && <ShipFigure ship={fig.ship} label={fig.label}>{fig.caption}</ShipFigure>}
      <Section title="What was seen">
        {seen.map((s) => <StatementRow key={s.text} statement={s} />)}
        <dl className="facts">
          {facts(item).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        {vesselId && (
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => onOpenVessel(vesselId)}>See this ship and its path</button>
          </div>
        )}
      </Section>
      {item.kind === "slick" && (
        <Section title="Which ship may have caused it"
          hint="Cerulean ranks ships whose AIS track crossed the slick near the time of the radar image, and structures beside it, by how well they fit the slick's shape. A candidate is a lead to check, never proof of who released the oil.">
          <SlickCandidates slick={item.record} available={candidatesAvailable}
            onOpenVessel={(id, c) => (onOpenSlickSource ? onOpenSlickSource(id, item.record, c.rank) : onOpenVessel(id))} />
        </Section>
      )}
      {item.kind === "fishing" && vesselId && (
        <Section title="Licences and blacklists" hint="Whether this vessel is on a fisheries body's IUU list, and how often it fished where no public licence for it was found, in the chosen period.">
          <InsightsPanel vesselId={vesselId} period={period} />
        </Section>
      )}
      {item.kind === "encounter" && (
        <Section title="The two vessels" hint="Licence status is from public RFMO authorisation lists, which are incomplete. Open a vessel for its path and blacklist checks.">
          <ul className="feed">
            {item.record.vessels.map((v, i) => (
              <li key={v.vesselId ?? i}>
                <button type="button" className="feed-btn" disabled={!v.vesselId} onClick={() => v.vesselId && onOpenVessel(v.vesselId)}>
                  <span className="feed-title"><Ship name={v.name} type={v.vesselType} /></span>
                  <span className="feed-meta">
                    {PARTY[v.vesselType ?? ""] ?? "Vessel"}, flag {v.flag ?? "unknown"}. {AUTH_WORD[v.authorisation].replace(/^./, (c) => c.toUpperCase())}.
                    {v.wentDark ? " Switched AIS off within 48 hours." : ""}{v.vesselId ? " Select to see its path." : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {item.kind === "closure" && (
        <Section title="Where vessels fished during the ban" hint="The busiest 0.1° squares, by apparent fishing hours from AIS. Exempt vessels cannot be told apart here.">
          <ol className="feed">
            {item.record.cells.slice(0, 12).map((c) => (
              <li key={`${c.lat},${c.lon}`} className="feed-more">
                <span className="num">{coords(c.lat, c.lon)}</span>: {Math.round(c.hours).toLocaleString()} hours, {c.vessels} vessel(s)
              </li>
            ))}
          </ol>
        </Section>
      )}
      {item.kind === "turnOn" && (
        <Section title={`Vessels in this joint operation (${item.record.count})`}
          hint="Each vessel turned off AIS while entering, operated dark inside with the others, and turned AIS on while exiting. Select a vessel to see its path.">
          <ul className="feed">
            {item.record.vessels.map((v, i) => (
              <li key={i}>
                <button type="button" className="feed-btn" disabled={!v.vesselId} onClick={() => v.vesselId && onOpenVessel(v.vesselId)}>
                  <span className="feed-title">
                    <Ship name={v.vesselName} type={v.vesselType} />
                    <span className="feed-figure muted">Dark for {formatSpan(v.durationHours)}</span>
                  </span>
                  <span className="feed-meta">{vesselWord(v.vesselType)}, flag {v.flag ?? "unknown"}.</span>
                  <span className="feed-meta">AIS off at <span className="num">{coords(v.enterLat, v.enterLon)}</span>{v.start ? `, ${formatDateTime(v.start)}` : ""}.</span>
                  <span className="feed-meta">AIS on again at <span className="num">{coords(v.exitLat, v.exitLon)}</span>{v.end ? `, ${formatDateTime(v.end)}` : ""}.</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {might.length > 0 && (
        <Section title="What might have happened"
          hint="These are possibilities drawn from the context: the kind of vessel, protected areas, distance from shore and known high-risk waters. None is a finding.">
          {might.map((s) => <StatementRow key={s.text} statement={s} />)}
        </Section>
      )}
      {next.length > 0 && (
        <Section title="Next step">{next.map((s) => <StatementRow key={s.text} statement={s} />)}</Section>
      )}
      <Section title="Source">
        <p className="muted">{SOURCE_NOTE[item.kind]}</p>
        {item.kind === "slick" && item.record.url && (
          <p><a href={item.record.url} target="_blank" rel="noreferrer">Open the radar image of this slick on Cerulean</a></p>
        )}
        {item.kind === "closure" && (
          <ul>{item.record.closure.sources.map((u) => <li key={u}><a href={u} target="_blank" rel="noreferrer">{new URL(u).hostname}</a></li>)}</ul>
        )}
        <p className="muted">A lead to check, never by itself evidence of wrongdoing.</p>
      </Section>
    </DrawerFrame>
  );
}
