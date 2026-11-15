import { api } from "../api/client";
import type { OilSlick, SlickCandidate } from "../api/types";
import { useResource } from "../hooks/useResource";

const TYPE_WORD: Record<SlickCandidate["type"], string> = {
  VESSEL: "Ship on AIS", DARK_VESSEL: "Ship seen on radar, not on AIS", INFRASTRUCTURE: "Offshore structure", UNKNOWN: "Unidentified source",
};

/** One AIS candidate: looked up by MMSI on Global Fishing Watch so it can be opened with its path. */
function VesselCandidate({ c, onOpen }: { c: SlickCandidate; onOpen: (vesselId: string, c: SlickCandidate) => void }) {
  const res = useResource(`search:${c.ref}`, () => api.searchVessels(c.ref));
  const hit = res.data?.results.find((v) => v.mmsi === c.ref) ?? res.data?.results[0];
  const name = hit?.name ?? c.vesselName;
  return (
    <button type="button" className="feed-btn" disabled={!hit} onClick={() => hit && onOpen(hit.vesselId, c)}>
      <span className="feed-title">#{c.rank} {name ?? `MMSI ${c.ref}`}{c.wentDark && <span className="feed-figure"> AIS off</span>}</span>
      <span className="feed-meta">
        {TYPE_WORD[c.type]}{hit?.flag ? `, flag ${hit.flag}` : ""}, MMSI {c.ref}.
        {c.wentDark ? " Switched AIS off within 48 hours of the slick." : ""}
        {res.status === "loading" ? " Looking it up…" : hit ? " Open its path on the map →" : " Not found on Global Fishing Watch."}
      </span>
    </button>
  );
}

/** Cerulean's ranked candidate sources for a slick. */
export function SlickCandidates({ slick, onOpenVessel, available = true }: {
  slick: OilSlick; onOpenVessel: (vesselId: string, c: SlickCandidate) => void; available?: boolean;
}) {
  if (!available) return <p className="muted">Cerulean's source matching could not be reached just now; try again later.</p>;
  if (!slick.candidates.length) return <p className="muted">Cerulean matched no candidate source to this slick.</p>;
  return (
    <ol className="feed" aria-label="Candidate sources, best match first">
      {slick.candidates.map((c) => (
        <li key={`${c.rank}:${c.ref}`}>
          {c.type === "VESSEL" ? <VesselCandidate c={c} onOpen={onOpenVessel} /> : (
            <div className="feed-more">
              <b>#{c.rank} {TYPE_WORD[c.type]}</b>, {c.type === "INFRASTRUCTURE" ? `structure ${c.ref}` : `radar detection ${c.ref}`}.
              {c.type === "DARK_VESSEL" ? " No identity: it was not broadcasting AIS." : ""}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
