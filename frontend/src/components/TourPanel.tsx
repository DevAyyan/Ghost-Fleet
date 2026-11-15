import type { Lead } from "../lib/leads";
import type { Tour } from "../lib/tour";

/** The guided tours, in a panel on the right of the map: the top case first, then one tour per question. */
export function TourPanel({ topLead, leadsLoading, tours, active, onTopCase, onStart, onEnd, onClose }: {
  topLead: Lead | undefined; leadsLoading: boolean; tours: Tour[]; active: string | null;
  onTopCase: () => void; onStart: (t: Tour) => void; onEnd: () => void; onClose: () => void;
}) {
  return (
    <aside className="map-overlay tour-panel" aria-labelledby="tour-panel-title">
      <div className="tour-panel-head">
        <h2 id="tour-panel-title">Guided tours</h2>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close guided tours">×</button>
      </div>
      <p className="tour-panel-note">Each tour turns on the layers it needs, moves the map to what it shows, and puts your layers back when it ends.</p>

      <button type="button" className="tour-pick tour-pick-main" onClick={onTopCase} disabled={!topLead} aria-current={active === "top-case"}>
        <span className="tour-pick-name">Follow the top case, step by step</span>
        <span className="tour-pick-blurb">
          {topLead ? `${topLead.title}: ${topLead.what}.` : leadsLoading ? "Finding the strongest lead…" : "Nothing stands out in this period."}
        </span>
      </button>

      <h3 className="tour-panel-sub">Tours by theme</h3>
      <ul className="tour-list">
        {tours.map((t) => (
          <li key={t.id}>
            <button type="button" className="tour-pick" onClick={() => onStart(t)} aria-current={active === t.id}>
              <span className="tour-pick-name">{t.name}</span>
              <span className="tour-pick-blurb">{t.blurb}</span>
              <span className="tour-pick-steps">{t.steps.length} steps</span>
            </button>
          </li>
        ))}
      </ul>
      {active && <p className="tour-panel-resume">The map is too narrow for the tour&rsquo;s card beside this panel. Close the panel to carry on.</p>}
      {active && <button type="button" className="btn btn-sm tour-panel-end" onClick={onEnd}>End the current tour</button>}
    </aside>
  );
}
