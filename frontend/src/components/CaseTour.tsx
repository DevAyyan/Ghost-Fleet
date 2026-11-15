import { useEffect, useRef } from "react";
import type { StepShown, Tour } from "../lib/tour";
import { WithTerms } from "./Term";

/** The card that walks through a tour on the map: what this step shows, and the way on. */
export function CaseTour({ tour, at, shown, onStep, onEnd, besidePanel = false }: {
  tour: Tour; at: number; shown: StepShown | "loading"; onStep: (i: number) => void; onEnd: () => void;
  besidePanel?: boolean;   // the tours panel is open on the right: keep clear of it
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // after the case panel has drawn this step's case, so the tour keeps the keyboard
  useEffect(() => { const t = window.setTimeout(() => heading.current?.focus(), 0); return () => window.clearTimeout(t); }, [at, tour.id]);
  const step = tour.steps[at];
  const last = at === tour.steps.length - 1;
  return (
    <section className={`map-overlay case-tour${besidePanel ? " beside-panel" : ""}`} aria-labelledby="tour-title" aria-live="polite">
      <p className="tour-count">{tour.name} · step {at + 1} of {tour.steps.length}</p>
      <h2 id="tour-title" ref={heading} tabIndex={-1}>{step.title}</h2>
      <p className="tour-text">
        {shown === "loading" ? <span className="muted">Loading what this step shows…</span> : <WithTerms text={shown.text} />}
      </p>
      <div className="tour-actions">
        <button type="button" className="btn btn-sm" onClick={() => onStep(at - 1)} disabled={at === 0}>Back</button>
        {last
          ? <button type="button" className="btn btn-sm btn-primary" onClick={onEnd}>Done</button>
          : <button type="button" className="btn btn-sm btn-primary" onClick={() => onStep(at + 1)}>Next</button>}
        <button type="button" className="btn btn-sm btn-ghost tour-end" onClick={onEnd}>End tour</button>
      </div>
    </section>
  );
}
