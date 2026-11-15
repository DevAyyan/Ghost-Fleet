// Plain-language meanings for the jargon the app cannot avoid. Text passed through `splitTerms` gets each term's
// first use marked, and the UI shows its meaning on hover or focus.

export interface TermDef { term: string; pattern: RegExp; meaning: string }

const word = (w: string, flags = "") => new RegExp(`\\b${w}\\b`, flags);

export const GLOSSARY: TermDef[] = [
  { term: "AIS", pattern: word("AIS"),
    meaning: "Automatic Identification System: the radio beacon ships broadcast with their name and position. Switched off, a ship disappears from trackers." },
  { term: "SAR", pattern: word("SAR"),
    meaning: "Synthetic aperture radar: satellite radar that sees ships through cloud and at night, whether or not they broadcast AIS." },
  { term: "Sentinel-1", pattern: /\bSentinel-1\b/,
    meaning: "The European Space Agency's radar satellites. Their images show ships and oil slicks." },
  { term: "IUU", pattern: word("IUU"),
    meaning: "Illegal, unreported and unregulated fishing. Fisheries bodies publish lists of vessels caught at it." },
  { term: "RFMO", pattern: /\bRFMOs?\b/,
    meaning: "Regional fisheries management organisation: the international body that licenses fishing in a region or for a species, such as tuna." },
  { term: "EEZ", pattern: /\bEEZs?\b/,
    meaning: "Exclusive economic zone: the waters, usually out to 200 nautical miles, where one country alone may license fishing." },
  { term: "MPA", pattern: /\bMPAs?\b/, meaning: "Marine protected area: a stretch of sea where some or all activity is restricted by law." },
  { term: "no-take", pattern: /\bno-take\b/i,
    meaning: "A protected area, or a zone inside one, where all fishing is banned." },
  { term: "transshipment", pattern: /\btransshipments?\b/i,
    meaning: "Moving catch or fuel between vessels at sea, out of sight of port inspectors. Legal with a licence; also how illegal catch is laundered." },
  { term: "bunker tanker", pattern: /\bbunker tankers?\b/i, meaning: "A tanker that refuels other ships at sea." },
  { term: "refrigerated carrier", pattern: /\brefrigerated carriers?\b/i,
    meaning: "A cargo ship with freezers (a reefer) that collects catch from fishing vessels at sea." },
  { term: "MSDI", pattern: word("MSDI"),
    meaning: "Ships seen by radar but not on AIS, divided by the number of satellite passes: a fair measure of dark activity over time." },
  { term: "VIIRS", pattern: word("VIIRS"), meaning: "A NASA/NOAA satellite sensor sensitive enough to see the lamps of fishing boats at night." },
  { term: "MODIS", pattern: word("MODIS"), meaning: "A NASA satellite sensor that measures ocean colour, from which plankton (chlorophyll) is estimated." },
  { term: "false-discovery", pattern: /\bfalse-discovery\b/i,
    meaning: "With thousands of places tested at once some look significant by chance. The q value is the chance this one is such a false alarm." },
];

export type Segment = string | { text: string; def: TermDef };

/** Split text into plain runs and glossary terms, marking only the first use of each term. */
export function splitTerms(text: string, glossary: TermDef[] = GLOSSARY): Segment[] {
  const hits: { start: number; end: number; def: TermDef }[] = [];
  for (const def of glossary) {
    const m = def.pattern.exec(text);
    if (m) hits.push({ start: m.index, end: m.index + m[0].length, def });
  }
  hits.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start < at) continue;   // overlaps a term already marked
    if (h.start > at) out.push(text.slice(at, h.start));
    out.push({ text: text.slice(h.start, h.end), def: h.def });
    at = h.end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
