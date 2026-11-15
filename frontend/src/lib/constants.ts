// Sentinel-1B failed on 23 Dec 2021; Sentinel-1C restored the two-satellite revisit in spring 2025.
// Months are inclusive start / first month back to normal (matches backend synthetic.py).
export const S1B_GAP = { start: "2022-01", end: "2025-04" } as const;

export const LABEL_NAMES = {
  OBSERVATION: "Observation",
  INFERENCE: "Inference",
  HYPOTHESIS: "Hypothesis",
  RECOMMENDATION: "Recommendation",
} as const;

/** Short margin words shown beside each statement in the case file. */
export const LABEL_WORD = {
  OBSERVATION: "Observed",
  INFERENCE: "Inferred",
  HYPOTHESIS: "Hypothesis",
  RECOMMENDATION: "Next step",
} as const;

/** A mark for each label, so the four read apart without relying on colour. */
export const LABEL_MARK = { OBSERVATION: "◉", INFERENCE: "∴", HYPOTHESIS: "?", RECOMMENDATION: "→" } as const;

/** What each label promises, in plain words: shown in every case file's reading guide and on the label itself. */
export const LABEL_MEANING = {
  OBSERVATION: "In the data itself: what a satellite or a ship's AIS recorded.",
  INFERENCE: "Worked out from what was observed, by a stated rule.",
  HYPOTHESIS: "One possible explanation. Not a finding.",
  RECOMMENDATION: "What an investigator could check next.",
} as const;
