import { api } from "../api/client";
import { SeriesChart } from "../charts/SeriesChart";
import { WaterfallChart } from "../charts/WaterfallChart";
import { useResource } from "../hooks/useResource";
import { humanCellId } from "../lib/format";
import { DrawerFrame } from "./DrawerFrame";
import { CaseFileActions, CauseLens, ConfidencePanel, DisproofPanel, OppositeNeighbors } from "./panels";
import { DemoBadge, ErrorState, Section, Skeleton, StatementRow, TrendChip } from "./ui";

interface Props { eventId: string; alpha: number; onClose: () => void; onOpenCell: (id: string) => void }

export function EventDrawer({ eventId, alpha, onClose, onOpenCell }: Props) {
  const res = useResource(`event:${eventId}`, () => api.event(eventId));

  if (res.status !== "success") {
    return (
      <DrawerFrame title={eventId} onClose={onClose}>
        {res.status === "error"
          ? <ErrorState error={res.error} onRetry={res.refetch} title="Could not load this event" />
          : <Skeleton label="Loading event" lines={5} height="4rem" />}
      </DrawerFrame>
    );
  }

  const d = res.data;
  const e = d.event;
  return (
    <DrawerFrame title={`Change near ${humanCellId(e.leadCellId)}`} onClose={onClose}
      extra={<><TrendChip direction={e.direction} pct={e.pctPerYear} />{d.isDemoData && <DemoBadge />}</>}>
      <Section title="What changed">
        <StatementRow statement={e.headline} />
        {d.statements.map((s) => <StatementRow key={s.text} statement={s} />)}
      </Section>

      <Section title="What each correction removes">
        <WaterfallChart steps={d.waterfall} alpha={alpha} />
      </Section>

      <Section title="Month by month">
        <SeriesChart series={d.series} finalTrend={d.waterfall[d.waterfall.length - 1].trend} />
      </Section>

      <Section title="Neighbours moving the other way" hint="An opposite change next door suggests activity moved rather than appeared or vanished.">
        <OppositeNeighbors neighbors={d.oppositeNeighbors} onOpenCell={onOpenCell} />
      </Section>

      <Section title="Competing explanations" hint="CauseLens: the share of the apparent change each explanation accounts for. The rules are listed under Method and limits.">
        <CauseLens explanations={d.explanations} />
      </Section>

      <Section title="Try to disprove" hint="Re-runs the test under seven alternative, defensible analysis choices.">
        <DisproofPanel key={eventId} eventId={eventId} />
      </Section>

      <Section title="How sure we are">
        <ConfidencePanel confidence={d.confidence} />
      </Section>

      <Section title="Recommended next step">
        <StatementRow statement={d.recommendedAction} />
        <CaseFileActions eventId={eventId} />
      </Section>
    </DrawerFrame>
  );
}
