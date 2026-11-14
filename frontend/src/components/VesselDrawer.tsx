import { api } from "../api/client";
import type { AisOffEvent, VesselPoint } from "../api/types";
import { useResource } from "../hooks/useResource";
import { formatDay, formatSpan } from "../lib/format";
import type { Period } from "../lib/layers";
import { DrawerFrame } from "./DrawerFrame";
import { ErrorState, Section, Skeleton, StatementRow } from "./ui";

interface Props {
  vesselId: string;
  period: Period;
  onClose: () => void;
  onFocus: (lat: number, lon: number, key: string) => void;
}

const coords = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
const KIND: Record<VesselPoint["kind"], string> = {
  fishing: "Apparent fishing", loitering: "Loitering", port_visit: "Port call", encounter: "Met another vessel",
  gap_off: "Stopped broadcasting", gap_on: "Broadcasting again",
};
const LOG_MAX = 80;

export function useVessel(vesselId: string | null, period: Period) {
  return useResource(vesselId ? `vessel:${vesselId}:${period.start}:${period.end}` : null,
    () => api.vessel(vesselId!, period.start, period.end));
}

function GapRow({ gap, n, onFocus }: { gap: AisOffEvent; n: number; onFocus: Props["onFocus"] }) {
  const back = gap.onLat != null && gap.onLon != null;
  return (
    <li className="gap-row">
      <button type="button" className="gap-where" onClick={() => onFocus(gap.lat, gap.lon, `gap:${gap.id}`)}>
        <span className="gap-n" aria-hidden="true">{n}</span>
        <span><b>{formatDay(gap.start)}</b>, {gap.place}</span>
        <span className="gap-coords num">{coords(gap.lat, gap.lon)}</span>
      </button>
      <p>
        Dark for {formatSpan(gap.durationHours)}.{" "}
        {back
          ? <>Reappeared {gap.end ? `on ${formatDay(gap.end)} ` : ""}at <span className="num">{coords(gap.onLat!, gap.onLon!)}</span>{gap.distanceKm != null ? `, ${Math.round(gap.distanceKm).toLocaleString()} km away` : ""}.</>
          : "It has not been seen broadcasting since."}
        {gap.likelyIntentional === false && " Probably a reception gap, not a switch-off."}
      </p>
      <details>
        <summary>What might have happened</summary>
        {gap.statements.filter((s) => s.label !== "OBSERVATION").map((s) => <StatementRow key={s.text} statement={s} />)}
      </details>
    </li>
  );
}

export function VesselDrawer({ vesselId, period, onClose, onFocus }: Props) {
  const res = useVessel(vesselId, period);
  if (res.status !== "success") {
    return (
      <DrawerFrame title="Ship" onClose={onClose}>
        {res.status === "error"
          ? <ErrorState error={res.error} onRetry={res.refetch} title="Could not load this ship" />
          : <Skeleton label="Loading ship" lines={5} height="3.5rem" />}
      </DrawerFrame>
    );
  }
  const v = res.data, id = v.identity;
  const log = v.points.filter((p) => p.kind !== "gap_on");
  const first = v.points[0], latest = v.points[v.points.length - 1];
  const facts: [string, string][] = [
    ["Flag", id.flag ?? "unknown"], ["MMSI", id.mmsi ?? "unknown"], ["IMO", id.imo ?? "not recorded"], ["Call sign", id.callsign ?? "not recorded"],
    ["Gear", id.gear.length ? id.gear.join(", ").replace(/_/g, " ").toLowerCase() : "not recorded"],
    ["Size", id.lengthM ? `${Math.round(id.lengthM)} m${id.tonnageGt ? `, ${Math.round(id.tonnageGt).toLocaleString()} gross tons` : ""}` : "not recorded"],
    ["Last heard on AIS", id.transmitsTo ? formatDay(id.transmitsTo) : "unknown"],
  ];
  return (
    <DrawerFrame title={id.name ?? "Unnamed vessel"} onClose={onClose}
      extra={<span className="muted">{formatDay(v.start)} to {formatDay(v.end)}</span>}>
      <Section title="In this period">
        {v.statements.map((s) => <StatementRow key={s.text} statement={s} />)}
        {first && latest && (
          <dl className="facts">
            <div><dt>Path starts</dt><dd>
              <button type="button" className="link-btn num" onClick={() => onFocus(first.lat, first.lon, "end:start")}>{coords(first.lat, first.lon)}</button>, {formatDay(first.time)}
            </dd></div>
            <div><dt>Last seen</dt><dd>
              <button type="button" className="link-btn num" onClick={() => onFocus(latest.lat, latest.lon, "end:latest")}>{coords(latest.lat, latest.lon)}</button>, {formatDay(latest.time)}
            </dd></div>
          </dl>
        )}
        {v.truncated && <p className="muted">This ship has more events in the period than can be fetched; the earliest 3,000 are shown.</p>}
        <div className="track-legend" aria-label="How the path is drawn">
          <span className="tl-wide"><i className="tl-ramp tl-ramp-seen" />Path between recorded events: pale where the period starts, darkest where the ship was last seen</span>
          <span className="tl-wide"><i className="tl-ramp tl-ramp-dark" />Sailed unseen, shaded the same way</span>
          <span><i className="tl-dot tl-start" />Start of the path</span>
          <span><i className="tl-dot tl-latest" />Last seen</span>
          <span><i className="tl-dot tl-off" />Went dark</span>
          <span><i className="tl-dot tl-on" />Reappeared</span>
          <span><i className="tl-dot tl-port" />Port call</span>
          <span><i className="tl-dot tl-fish" />Apparent fishing</span>
        </div>
      </Section>

      <Section title="Where and when it went invisible"
        hint={v.gaps.length ? "Select a line to move the map there. Positions are the last one before the signal stopped and the first one after." : undefined}>
        {v.gaps.length
          ? <ol className="gap-list">{v.gaps.map((g, i) => <GapRow key={g.id} gap={g} n={i + 1} onFocus={onFocus} />)}</ol>
          : <p className="muted">It kept broadcasting throughout the period, as far as the record shows.</p>}
      </Section>

      <Section title="What else it was recorded doing">
        {log.length ? (
          <table className="table">
            <thead><tr><th>When</th><th>What</th><th>Where</th></tr></thead>
            <tbody>
              {log.slice(-LOG_MAX).reverse().map((p, i) => (
                <tr key={`${p.time}:${i}`}>
                  <td className="nowrap num">{formatDay(p.time)}</td>
                  <td>{KIND[p.kind]}{p.label ? `: ${p.label}` : ""}</td>
                  <td>
                    <button type="button" className="link-btn num" onClick={() => onFocus(p.lat, p.lon, `pt:${p.time}`)}>{coords(p.lat, p.lon)}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">Nothing recorded in this period. Try a longer period.</p>}
        {log.length > LOG_MAX && <p className="muted">The newest {LOG_MAX} of {log.length} are listed; all of them are on the map.</p>}
      </Section>

      <Section title="This ship">
        <dl className="facts">{facts.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>
      </Section>

      <Section title="Source">
        <p className="muted">{v.source}</p>
        <p className="muted">A ship switching AIS off is never by itself evidence of wrongdoing.</p>
      </Section>
    </DrawerFrame>
  );
}
