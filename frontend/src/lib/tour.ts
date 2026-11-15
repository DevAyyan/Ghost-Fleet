// "Follow a case": one lead walked through in a few steps, each opening what it talks about.
import type { Statement } from "../api/types";
import type { Lead } from "./leads";
import type { Selection } from "./layers";

export interface TourStep { title: string; text: string; sel: NonNullable<Selection> }

const first = (statements: Statement[], label: Statement["label"]) => statements.find((s) => s.label === label)?.text;

/** The steps for one lead, from its record's own statements: where, the ship (when there is one), what it might mean, what to check. */
export function buildTour(lead: Lead, statements: Statement[]): TourStep[] {
  const record = { kind: lead.kind, id: lead.id };
  const steps: TourStep[] = [{
    title: "Where it happened",
    text: first(statements, "OBSERVATION") ?? `${lead.title}: ${lead.what}.`,
    sel: record,
  }];
  if (lead.vesselId) {
    steps.push({
      title: "The ship and its path",
      text: "Its recorded path for the period is now on the map. Dark stretches are where it stopped broadcasting AIS; "
        + "the timeline in the panel lists its fishing, port calls and meetings.",
      sel: { kind: "vessel", id: lead.vesselId },
    });
  }
  steps.push({
    title: "What it might mean",
    text: [first(statements, "HYPOTHESIS"), first(statements, "INFERENCE")].find(Boolean)
      ?? `It stands out because: ${lead.why.join("; ")}. That is a reason to look, not a finding.`,
    sel: record,
  });
  steps.push({
    title: "What to check next",
    text: first(statements, "RECOMMENDATION") ?? "Check the vessel against the permits and licences for the area before drawing any conclusion.",
    sel: record,
  });
  return steps;
}
