import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { splitTerms, type TermDef } from "../lib/glossary";

/** A jargon term, underlined, whose plain meaning shows on hover or keyboard focus. The tip is drawn on the page itself so
 *  a scrolling panel never clips it; screen readers get the meaning as the term's description. */
export function Term({ def, children }: { def: TermDef; children: ReactNode }) {
  const id = useId();
  const el = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const show = () => {
    const r = el.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.bottom + 120 > window.innerHeight;
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - 296)), top: above ? r.top - 6 : r.bottom + 6, above });
  };
  const hide = () => setAt(null);
  return (
    <>
      <span ref={el} className="term" tabIndex={0} aria-describedby={id}
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>{children}</span>
      <span id={id} className="sr-only">{def.term}: {def.meaning}</span>
      {at && createPortal(
        <span className="term-tip" aria-hidden="true" data-above={at.above} style={{ left: at.left, top: at.top }}>
          <b>{def.term}</b> {def.meaning}
        </span>, document.body)}
    </>
  );
}

/** Text with the first use of each glossary term explained. */
export function WithTerms({ text }: { text: string }) {
  return <>{splitTerms(text).map((s, i) => (typeof s === "string" ? s : <Term key={i} def={s.def}>{s.text}</Term>))}</>;
}
