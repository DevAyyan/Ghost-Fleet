import { useEffect, useRef } from "react";
import type { TourStep } from "../lib/tour";
import { WithTerms } from "./Term";

/** The card that walks through one case on the map: what this step shows, and the way on. */
export function CaseTour({ steps, at, onStep, onEnd }: { steps: TourStep[]; at: number; onStep: (i: number) => void; onEnd: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  // after the case panel has drawn this step's case, so the tour keeps the keyboard
  useEffect(() => { const t = window.setTimeout(() => heading.current?.focus(), 0); return () => window.clearTimeout(t); }, [at]);
  const step = steps[at];
  const last = at === steps.length - 1;
  return (
    <section className="map-overlay case-tour" aria-labelledby="tour-title" aria-live="polite">
      <p className="tour-count">Following a case · step {at + 1} of {steps.length}</p>
      <h2 id="tour-title" ref={heading} tabIndex={-1}>{step.title}</h2>
      <p className="tour-text"><WithTerms text={step.text} /></p>
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
