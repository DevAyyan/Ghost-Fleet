import type { WaterfallStep } from "../api/types";
import { directionGlyph, formatP, formatPct } from "../lib/format";

/**
 * Correction waterfall: the same trend test after each correction step.
 * Bars diverge from zero; solid = significant after FDR, hollow = not significant.
 */
export function WaterfallChart({ steps, alpha }: { steps: WaterfallStep[]; alpha: number }) {
  const limit = Math.max(5, ...steps.map((s) => Math.abs(s.trend.pctPerYear ?? 0)));
  return (
    <div>
      <table className="table">
        <caption className="sr-only">Trend after each correction step, in percent per year</caption>
        <thead>
          <tr><th scope="col">Step</th><th scope="col" className="wf-col">Change</th><th scope="col">%/yr</th><th scope="col">q</th></tr>
        </thead>
        <tbody>
          {steps.map((s) => {
            const v = s.trend.pctPerYear ?? 0;
            const sig = s.q != null && s.q < alpha;
            const w = (Math.abs(v) / limit) * 50;
            const color = s.trend.direction === "INCREASING" ? "var(--trend-up)" : s.trend.direction === "DECREASING" ? "var(--trend-down)" : "var(--trend-none)";
            return (
              <tr key={s.step}>
                <th scope="row" className="wf-label">{s.label}</th>
                <td>
                  <div className="wf-track" aria-hidden="true">
                    <div className="wf-zero" />
                    <div className="wf-bar" style={{
                      left: v >= 0 ? "50%" : `${50 - w}%`, width: `${w}%`,
                      background: sig ? color : "transparent", borderColor: color,
                    }} />
                  </div>
                </td>
                <td className="num nowrap" style={{ color }}>
                  <span aria-hidden="true">{directionGlyph(s.trend.direction)} </span>{formatPct(s.trend.pctPerYear)}
                </td>
                <td className="num nowrap">
                  {formatP(s.q)}
                  <span className="sr-only">{sig ? " significant" : " not significant"}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint wf-hint">
        Solid bar = significant after false-discovery correction (q &lt; {alpha}); outlined = not significant.
        Each row removes one more explanation.
      </p>
    </div>
  );
}
