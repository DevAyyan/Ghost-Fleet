import { api } from "../api/client";
import { useResource } from "../hooks/useResource";
import type { Period } from "../lib/layers";
import { ErrorState, Skeleton, StatementRow } from "./ui";

/** Licence and blacklist checks for one ship (GFW vessel insights): IUU lists, fishing without a known authorisation. */
export function InsightsPanel({ vesselId, period }: { vesselId: string; period: Period }) {
  const res = useResource(`insights:${vesselId}:${period.start}:${period.end}`, () => api.insights(vesselId, period.start, period.end));
  if (res.status === "error") return <ErrorState error={res.error} onRetry={res.refetch} title="Could not check licences" />;
  if (res.status !== "success") return <Skeleton label="Checking licences and blacklists" lines={2} height="2rem" />;
  const d = res.data;
  const n = (v: number | null) => (v == null ? "unknown" : v.toLocaleString());
  return (
    <>
      <dl className="facts">
        <div><dt>IUU vessel list</dt><dd className={d.iuuListedInPeriod ? "error-text" : undefined}>
          {d.iuuListedInPeriod ? "Listed in this period" : d.iuuTimesListed ? `Listed ${d.iuuTimesListed} time(s) before` : "Not listed"}
        </dd></div>
        <div><dt>Fishing, no known licence</dt><dd>{n(d.fishingInRfmoWithoutKnownAuthorisation)} of {n(d.fishingEvents)} fishing events</dd></div>
        <div><dt>In no-take areas</dt><dd>{n(d.fishingInNoTakeMpas)} fishing events</dd></div>
        <div><dt>AIS switched off</dt><dd>{n(d.aisOffEvents)} times</dd></div>
        <div><dt>Seen on AIS</dt><dd>{d.coveragePct == null ? "unknown" : `${Math.round(d.coveragePct)}% of the period`}</dd></div>
      </dl>
      {d.statements.map((s) => <StatementRow key={s.text} statement={s} />)}
    </>
  );
}
