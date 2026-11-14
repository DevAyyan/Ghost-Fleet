import type { ReactNode } from "react";
import type { AisOffEvent, AisOffHotspot, CoordinatedTurnOn, OilSlick, ProtectedFishingEvent, Statement } from "../api/types";
import { formatDateTime, formatDay, formatSpan, vesselWord } from "../lib/format";
import { DrawerFrame } from "./DrawerFrame";
import { Section, StatementRow } from "./ui";

export type SeaRecord =
  | { kind: "aisOff"; record: AisOffEvent }
  | { kind: "hotspot"; record: AisOffHotspot }
  | { kind: "turnOn"; record: CoordinatedTurnOn }
  | { kind: "slick"; record: OilSlick }
  | { kind: "fishing"; record: ProtectedFishingEvent };

const coords = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
const km = (v: number | null) => (v == null ? "unknown" : `${Math.round(v).toLocaleString()} km`);
const SOURCE_NOTE = {
  aisOff: "Global Fishing Watch events (AIS gaps classed as likely intentional).",
  hotspot: "Global Fishing Watch events (AIS gaps classed as likely intentional), last 180 days.",
  turnOn: "Global Fishing Watch AIS gap events. Detected by joint dark operational analysis: vessels that turned off AIS on entering the area, operated dark together inside, and restored AIS upon exiting.",
  slick: "SkyTruth Cerulean, a machine-learning model run on Sentinel-1 radar.",
  fishing: "Global Fishing Watch apparent-fishing events tagged inside a no-take marine protected area.",
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
  }
}

function title(item: SeaRecord): string {
  switch (item.kind) {
    case "aisOff": return `${item.record.vesselName ?? "Unnamed vessel"} went dark`;
    case "hotspot": return `Where ships go dark: ${item.record.place}`;
    case "turnOn": return `Joint dark operation: ${item.record.place} (${item.record.count} vessels)`;
    case "slick": return `Possible oil slick, ${item.record.place}`;
    case "fishing": return `${item.record.vesselName ?? "Unnamed vessel"}: apparent fishing in a no-take area`;
  }
}

export function SeaDrawer({ item, onClose, onOpenVessel }: { item: SeaRecord; onClose: () => void; onOpenVessel: (vesselId: string) => void }) {
  const vesselId = item.kind === "aisOff" || item.kind === "fishing" ? item.record.vesselId : null;
  const statements: Statement[] = item.record.statements;
  const seen = statements.filter((s) => s.label === "OBSERVATION" || s.label === "INFERENCE");
  const might = statements.filter((s) => s.label === "HYPOTHESIS");
  const next = statements.filter((s) => s.label === "RECOMMENDATION");
  return (
    <DrawerFrame title={title(item)} onClose={onClose}>
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
      {item.kind === "turnOn" && (
        <Section title={`Vessels in this joint operation (${item.record.count})`}
          hint="Each vessel turned off AIS while entering, operated dark inside with the others, and turned AIS on while exiting. Click to inspect full track.">
          <ul className="feed">
            {item.record.vessels.map((v, i) => (
              <li key={i}>
                <button type="button" className="feed-btn"
                  style={{ cursor: v.vesselId ? "pointer" : "default" }}
                  onClick={() => v.vesselId && onOpenVessel(v.vesselId)}>
                  <div className="feed-title">
                    <span>{v.vesselName ?? "Unnamed vessel"}</span>
                    <span className="feed-figure muted">Dark for {formatSpan(v.durationHours)}</span>
                  </div>
                  <div className="feed-meta">
                    {vesselWord(v.vesselType)}, flag {v.flag ?? "unknown"}.
                  </div>
                  <div className="feed-meta" style={{ fontSize: "var(--fs-xs)", marginTop: "2px" }}>
                    • Entered: {coords(v.enterLat, v.enterLon)}{v.start ? ` at ${formatDateTime(v.start)}` : ""} (AIS off)
                  </div>
                  <div className="feed-meta" style={{ fontSize: "var(--fs-xs)" }}>
                    • Exited: {coords(v.exitLat, v.exitLon)}{v.end ? ` at ${formatDateTime(v.end)}` : ""} (AIS on)
                    {v.vesselId ? " • Open track →" : ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="What might have happened"
        hint="These are possibilities drawn from the context: the kind of vessel, protected areas, distance from shore and known high-risk waters. None is a finding.">
        {might.map((s) => <StatementRow key={s.text} statement={s} />)}
      </Section>
      {next.length > 0 && (
        <Section title="Next step">{next.map((s) => <StatementRow key={s.text} statement={s} />)}</Section>
      )}
      <Section title="Source">
        <p className="muted">{SOURCE_NOTE[item.kind]}</p>
        {item.kind === "slick" && item.record.url && (
          <p><a href={item.record.url} target="_blank" rel="noreferrer">Open the radar image of this slick on Cerulean</a></p>
        )}
        <p className="muted">A lead to check, never by itself evidence of wrongdoing.</p>
      </Section>
    </DrawerFrame>
  );
}
