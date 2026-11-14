import { useEffect, useRef, type ReactNode } from "react";

/** Detail panel shell: focuses its heading on open, closes on Escape, labelled for screen readers. */
export function DrawerFrame({ title, onClose, children, extra }: { title: string; onClose: () => void; children: ReactNode; extra?: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { heading.current?.focus(); }, [title]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="drawer" aria-labelledby="drawer-title">
      <div className="drawer-head">
        <h2 id="drawer-title" ref={heading} tabIndex={-1}>{title}</h2>
        <button type="button" className="btn btn-ghost btn-sm drawer-close" onClick={onClose} aria-label="Close case file">✕</button>
        {extra && <div className="drawer-extra">{extra}</div>}
      </div>
      {children}
    </aside>
  );
}
