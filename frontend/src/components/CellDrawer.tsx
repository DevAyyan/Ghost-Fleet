import { api } from "../api/client";
import { SeriesChart } from "../charts/SeriesChart";
import { WaterfallChart } from "../charts/WaterfallChart";
import { useResource } from "../hooks/useResource";
import { humanCellId } from "../lib/format";
import { DrawerFrame } from "./DrawerFrame";
import { ErrorState, Section, Skeleton, TrendChip } from "./ui";

interface Props { cellId: string; alpha: number; onClose: () => void; onOpenEvent: (eventId: string) => void }

export function CellDrawer({ cellId, alpha, onClose, onOpenEvent }: Props) {
  const res = useResource(`cell:${cellId}`, () => api.cell(cellId));
  const title = humanCellId(cellId);

  if (res.status !== "success") {
    return (
      <DrawerFrame title={title} onClose={onClose}>
        {res.status === "error"
          ? <ErrorState error={res.error} onRetry={res.refetch} title="Could not load this cell" />
          : <Skeleton label="Loading cell" lines={4} height="4rem" />}
      </DrawerFrame>
    );
  }
  const { cell, waterfall, series } = res.data;
  return (
    <DrawerFrame title={title} onClose={onClose} extra={<TrendChip direction={cell.trend.direction} pct={cell.trend.pctPerYear} />}>
      <Section title="Status">
        {cell.eventId ? (
          <div className="actions">
            <p>This cell is part of a significant change event.</p>
            <button type="button" className="btn btn-primary" onClick={() => onOpenEvent(cell.eventId!)}>Open {cell.eventId}</button>
          </div>
        ) : (
          <p className="muted">
            No significant change after all corrections. The waterfall shows which explanations absorbed any apparent trend.
          </p>
        )}
      </Section>
      <Section title="What each correction removes"><WaterfallChart steps={waterfall} alpha={alpha} /></Section>
      <Section title="Month by month"><SeriesChart series={series} finalTrend={waterfall[waterfall.length - 1].trend} /></Section>
    </DrawerFrame>
  );
}
