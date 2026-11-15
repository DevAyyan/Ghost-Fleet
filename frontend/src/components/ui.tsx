import type { ReactNode } from "react";
import type { ApiError } from "../api/client";
import type { Direction, Statement } from "../api/types";
import { LABEL_MARK, LABEL_MEANING, LABEL_NAMES, LABEL_WORD } from "../lib/constants";
import { WithTerms } from "./Term";
import { directionGlyph, directionWord, formatPct } from "../lib/format";

export function TrendChip({ direction, pct }: { direction: Direction; pct: number | null }) {
  return (
    <span className="trend-chip" data-dir={direction}>
      <span aria-hidden="true">{directionGlyph(direction)}</span>
      <span className="sr-only">{directionWord(direction)}</span>
      {formatPct(pct)}
    </span>
  );
}

export function StatementRow({ statement }: { statement: Statement }) {
  return (
    <div className="statement">
      <EpistemicTag label={statement.label} />
      <p><WithTerms text={statement.text} /></p>
    </div>
  );
}

/** The epistemic label of a statement: the same mark, word and colour in every case file. */
export function EpistemicTag({ label }: { label: Statement["label"] }) {
  return (
    <span className="tag" data-label={label} title={`${LABEL_NAMES[label]}: ${LABEL_MEANING[label]}`}>
      <span className="tag-mark" aria-hidden="true">{LABEL_MARK[label]}</span>
      <span aria-hidden="true">{LABEL_WORD[label]}</span>
      <span className="sr-only">{LABEL_NAMES[label]}:</span>
    </span>
  );
}

/** How to read a case file: what each of the four labels promises. */
export function ReadingGuide() {
  const labels = Object.keys(LABEL_MEANING) as Statement["label"][];
  return (
    <details className="read-guide">
      <summary>How to read this case</summary>
      <ul>{labels.map((l) => <li key={l}><EpistemicTag label={l} /><span>{LABEL_MEANING[l]}</span></li>)}</ul>
      <p className="muted">Every case is a lead to check, never an accusation.</p>
    </details>
  );
}

export function DemoBadge() {
  return (
    <span className="demo-badge" role="status" title="Synthetic data with planted effects — not a real observation">
      DEMO DATA
    </span>
  );
}

export function Skeleton({ lines = 3, height = "2.75rem", label }: { lines?: number; height?: string; label: string }) {
  return (
    <div className="state stretch" aria-busy="true" aria-label={label}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "Something went wrong" }: { error: ApiError; onRetry?: () => void; title?: string }) {
  return (
    <div className="state" role="alert">
      <h3>{title}</h3>
      <p className="error-text">{error.message}</p>
      {import.meta.env.DEV && error.code === "NETWORK_ERROR" && (
        <p className="muted">Start it with <code className="mono">python3 -m uvicorn ghostfleet.api.main:app</code> in <code className="mono">backend/</code>.</p>
      )}
      {onRetry && <button type="button" className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className="section" aria-label={title}>
      <h3>{title}</h3>
      {children}
      {hint && <p className="hint">{typeof hint === "string" ? <WithTerms text={hint} /> : hint}</p>}
    </section>
  );
}
