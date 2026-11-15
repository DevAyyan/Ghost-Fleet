import { useContext, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Confidence, DisproofResponse, Explanation, OppositeNeighbor } from "../api/types";
import { formatP, formatPct, formatShare, humanCellId } from "../lib/format";
import { ChangeSpanContext } from "../lib/span";
import { ErrorState, StatementRow, TrendChip } from "./ui";

export function CauseLens({ explanations }: { explanations: Explanation[] }) {
  return (
    <div className="bars">
      {explanations.map((x) => (
        <div key={x.code} className="bar-row" title={x.text}>
          <span>
            {x.code === "UNEXPLAINED_CHANGE" ? "Unexplained change" : x.text.split(" (")[0]}
            <span className="sr-only">: {x.text} ({x.label.toLowerCase()})</span>
          </span>
          <span className="bar-track" aria-hidden="true">
            <span className={`bar-fill ${x.label === "HYPOTHESIS" ? "hyp" : ""}`} style={{ width: formatShare(x.share), display: "block" }} />
          </span>
          <span className="num">{formatShare(x.share)}</span>
        </div>
      ))}
    </div>
  );
}

export function ConfidencePanel({ confidence }: { confidence: Confidence }) {
  const on = { LOW: 1, MODERATE: 2, HIGH: 3 }[confidence.level];
  return (
    <div>
      <div className="confidence">
        <span className="conf-meter" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={i <= on ? "on" : ""} />)}</span>
        <span className="conf-level">{confidence.level.charAt(0) + confidence.level.slice(1).toLowerCase()}</span>
      </div>
      <ul className="reasons">{confidence.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
    </div>
  );
}

export function OppositeNeighbors({ neighbors, onOpenCell }: { neighbors: OppositeNeighbor[]; onOpenCell: (id: string) => void }) {
  if (!neighbors.length) return <p className="muted">No neighbouring cell changed significantly in the opposite direction.</p>;
  return (
    <ul className="neighbors">
      {neighbors.map((n) => (
        <li key={n.cellId}>
          <button type="button" className="btn btn-sm" onClick={() => onOpenCell(n.cellId)}>{humanCellId(n.cellId)}</button>
          <TrendChip direction={n.direction} pct={n.pctPerYear} />
          <span className="muted num">q {formatP(n.q)}</span>
        </li>
      ))}
    </ul>
  );
}

export function DisproofPanel({ eventId }: { eventId: string }) {
  const span = useContext(ChangeSpanContext);
  const [state, setState] = useState<{ status: "idle" } | { status: "loading" } | { status: "done"; data: DisproofResponse } | { status: "error"; error: ApiError }>({ status: "idle" });
  const run = () => {
    setState({ status: "loading" });
    api.disproof(eventId, undefined, span).then(
      (data) => setState({ status: "done", data }),
      (error: ApiError) => setState({ status: "error", error }),
    );
  };

  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={run} disabled={state.status === "loading"} aria-busy={state.status === "loading"}>
          {state.status === "loading" ? "Re-running analyses…" : "Try to disprove this alert"}
        </button>
      </div>
    );
  }
  if (state.status === "error") return <ErrorState error={state.error} onRetry={run} title="Disproof run failed" />;

  const d = state.data;
  return (
    <div className="disproof-result" aria-live="polite">
      <div className="verdict"><StatementRow statement={d.verdict} /></div>
      <table className="table">
        <caption className="sr-only">Alternative analyses and whether the alert survived each</caption>
        <thead><tr><th scope="col">Alternative analysis</th><th scope="col">Trend</th><th scope="col">Result</th></tr></thead>
        <tbody>
          {d.variants.map((v) => (
            <tr key={v.variant}>
              <td>{v.description}</td>
              <td className="num nowrap">{formatPct(v.trend.pctPerYear)}<br /><span className="muted">p {formatP(v.trend.p)}</span></td>
              <td>{v.survived ? <span className="survived">✓ Survived</span> : <span className="failed">✕ Failed</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CaseFileActions({ eventId }: { eventId: string }) {
  const span = useContext(ChangeSpanContext);
  return (
    <div className="actions">
      <a className="btn btn-primary" href={api.caseFileUrl(eventId, "json", span)} download>Download case file</a>
      <a className="btn" href={api.caseFileUrl(eventId, "geojson", span)} download>Download map area (GeoJSON)</a>
      <button type="button" className="btn" onClick={() => window.print()}>Print</button>
    </div>
  );
}
