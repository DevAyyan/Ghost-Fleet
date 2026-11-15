import { useEffect, useRef, type ReactNode } from "react";
import type { IconName } from "../lib/icons";
import { Glyph } from "./Glyph";
import { ReadingGuide } from "./ui";

/** Detail panel shell: focuses its heading on open, closes on Escape, labelled for screen readers. */
export function DrawerFrame({ title, onClose, children, extra, icon }: {
  title: string; onClose: () => void; children: ReactNode; extra?: ReactNode;
  icon?: IconName;   // the record's symbol on the map, shown beside its title
}) {
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
      <div className="drawer-head theme-navy">
        <h2 id="drawer-title" ref={heading} tabIndex={-1}>{icon && <Glyph name={icon} size={30} className="drawer-icon" />}{title}</h2>
        <button type="button" className="btn btn-ghost btn-sm drawer-close" onClick={onClose} aria-label="Close case file">✕</button>
        {extra && <div className="drawer-extra">{extra}</div>}
      </div>
      <ReadingGuide />
      {children}
    </aside>
  );
}
