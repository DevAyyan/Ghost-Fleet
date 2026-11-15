import { useRef } from "react";
import type { MetaResponse } from "../api/types";
import { formatFetched } from "../lib/format";
import { Glyph } from "./Glyph";
import { DemoBadge } from "./ui";

const LIMITS = [
  "An unmatched detection is never by itself evidence of wrongdoing. Many legitimate vessels are not required to carry AIS.",
  "Sentinel-1 SAR reliably sees vessels larger than about 15 m. Small artisanal boats are mostly invisible.",
  "Strong winds and rough seas hide small targets. This is corrected statistically, not removed.",
  "The AIS-reception correction can also absorb a real change that coincides with receiver upgrades.",
  "Every alert depends on analysis choices. Try-to-disprove shows how robust each one is.",
];

export function Header({ meta }: { meta?: MetaResponse }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <header className="header theme-navy">
      <div className="brand">
        <h1><Glyph name="ghost-cargo" size={30} className="brand-mark" />Ghost Fleet X</h1>
        <span className="tagline">where what satellites see and what ships report stop agreeing</span>
      </div>
      {meta?.isDemoData && <DemoBadge />}
      {meta && !meta.isDemoData && (
        <span className="live-badge" title={meta.sourceNote}>
          <span className="live-dot" aria-hidden="true" /><strong>Live data</strong>
          {meta.fetchedAt && <span className="live-time">pulled {formatFetched(meta.fetchedAt)}</span>}
        </span>
      )}
      <span className="spacer" />
      <button type="button" className="btn btn-ghost" onClick={() => dialog.current?.showModal()}>
        <span className="label-long">Method &amp; limits</span><span className="label-short" aria-hidden="true">Method</span>
      </button>
      <dialog ref={dialog} className="modal theme-light" aria-labelledby="limits-title">
        <div className="modal-body">
          <h2 id="limits-title">Method and limitations</h2>
          <p>
            The map layers come straight from free public sources: radar detections, AIS traffic, AIS-off events and
            apparent fishing from Global Fishing Watch, possible oil slicks from SkyTruth Cerulean, and night lights and
            ocean colour from NASA. The most recent data is days to weeks old; there is no free live feed of ships
            that are not broadcasting. The notes under “What might have happened” are possibilities drawn from each
            record’s context, never findings.
          </p>
          <p>
            <strong>Lasting changes</strong> are computed here.{" "}
            <strong>MSDI</strong> = unmatched SAR vessel detections ÷ Sentinel-1 passes over the cell that month.
            Each cell’s monthly series is corrected step by step (coverage → AIS reception → season → weather),
            then tested with Mann-Kendall (Hamed-Rao autocorrelation correction) and Sen’s slope.
            False-discovery correction (Benjamini-Hochberg) is applied across all cells.
          </p>
          <p className="muted">{meta?.disclaimer}</p>
          <h3>Limitations</h3>
          <ul>{LIMITS.map((l) => <li key={l}>{l}</li>)}</ul>
          {meta && <p className="muted">Data: {meta.sourceNote || meta.sensors.join(", ")}</p>}
          <form method="dialog"><button className="btn btn-primary" autoFocus>Close</button></form>
        </div>
      </dialog>
    </header>
  );
}
