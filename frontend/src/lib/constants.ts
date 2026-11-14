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
