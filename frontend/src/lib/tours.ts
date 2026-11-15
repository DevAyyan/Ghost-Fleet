// The themed guided tours: one question each, walked across the layers that answer it. Each step picks the strongest
// record of the period for what it shows; when the period has none, the step says so instead of showing a stand-in.
import type { AisOffEvent, CoordinatedTurnOn, EventSummary, OilSlick } from "../api/types";
import { rankLeads } from "./leads";
import { WORLD, around, boundsOf, first, km, type Bounds, type StepShown, type Tour, type TourData, type TourView } from "./tour";

const hours = (h: number | null | undefined) => (h == null ? "some time" : h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h)} hours`);
const named = (n: string | null | undefined) => n?.trim() || "an unnamed vessel";
const failed = (what: string): StepShown => ({ text: `The ${what} could not be loaded, so this step has nothing to show. The layer's own panel says why.` });

// ---------- Fisheries ----------
function topFishing(d: TourData) {
  const lead = rankLeads({ fishing: d.fishing ?? [] }, 1)[0];
  return lead ? d.fishing?.find((f) => f.id === lead.id) ?? null : null;
}
const noFishing: StepShown = {
  text: "No apparent fishing inside a protected area was found in this period. A longer period may show some.",
};

const fisheries: Tour = {
  id: "fisheries", name: "Fisheries & livelihoods",
  blurb: "Rich water, fleets lit at night, and fishing where it is banned.",
  steps: [
    {
      title: "Where the sea is rich, and lit at night",
      layers: ["chlorophyll", "nightLights"],
      show: (d) => {
        if (!d.fishing && d.loading.fishing) return "loading";
        const f = topFishing(d);
        return {
          text: "Observation: yellow on the chlorophyll layer (NASA MODIS-Aqua) is water rich in plankton, where fish gather; "
            + "gaps are cloud. The white points far from land are lights seen at night by NASA VIIRS. "
            + "Hypothesis: where the two meet, fleets may be working under lamps, as squid boats do. Lights can also be platforms or ships at anchor.",
          view: f ? { bounds: around(f.lon, f.lat, 1200), maxZoom: 5 } : WORLD,
        };
      },
    },
    {
      title: "Fishing inside a protected area",
      layers: ["chlorophyll", "nightLights", "fishing"], noTakeOnly: false,
      show: (d) => {
        if (!d.fishing) return d.loading.fishing ? "loading" : failed("fishing records");
        const f = topFishing(d);
        if (!f) return noFishing;
        return {
          text: first(f.statements, "OBSERVATION") ?? `${named(f.vesselName)} moved as if fishing inside ${f.place} for ${hours(f.durationHours)}.`,
          sel: { kind: "fishing", id: f.id }, view: { bounds: around(f.lon, f.lat, 150), maxZoom: 7 },
        };
      },
    },
    {
      title: "The ship and its path",
      layers: ["chlorophyll", "nightLights", "fishing"],
      show: (d) => {
        if (!d.fishing) return d.loading.fishing ? "loading" : failed("fishing records");
        const f = topFishing(d);
        if (!f) return noFishing;
        if (!f.vesselId) return { text: "This record has no ship identity to follow, so its path cannot be drawn.", sel: { kind: "fishing", id: f.id } };
        return {
          text: "Its recorded path for the period is now on the map. The timeline in the panel lists where it fished, called at port and went dark.",
          sel: { kind: "vessel", id: f.vesselId },
        };
      },
    },
    {
      title: "What it might mean, and what to check",
      layers: ["chlorophyll", "nightLights", "fishing"],
      show: (d) => {
        if (!d.fishing) return d.loading.fishing ? "loading" : failed("fishing records");
        const f = topFishing(d);
        if (!f) return noFishing;
        const meaning = first(f.statements, "HYPOTHESIS") ?? first(f.statements, "INFERENCE");
        const check = first(f.statements, "RECOMMENDATION") ?? "Check the vessel against the area's permit list before drawing any conclusion.";
        return { text: meaning ? `${meaning} ${check}` : check, sel: { kind: "fishing", id: f.id }, view: { bounds: around(f.lon, f.lat, 150), maxZoom: 7 } };
      },
    },
  ],
};

// ---------- Dark fleet ----------
function topCluster(d: TourData): CoordinatedTurnOn | null {
  const clusters = d.aisOff?.turnOnClusters ?? [];
  const lead = rankLeads({ turnOns: clusters }, 1)[0];
  return lead ? clusters.find((t) => t.id === lead.id) ?? null : null;
}
function clusterView(t: CoordinatedTurnOn): TourView {
  const pts: [number, number][] = [[t.enterLon, t.enterLat], [t.exitLon, t.exitLat], [t.lon, t.lat],
    ...t.vessels.flatMap((v): [number, number][] => [[v.enterLon, v.enterLat], [v.exitLon, v.exitLat]])];
  return { bounds: boundsOf(pts, Math.max(150, t.radiusKm * 2))!, maxZoom: 7 };
}
const noCluster: StepShown = { text: "No group of ships went dark together in this period. A longer period may show some." };

const darkFleet: Tour = {
  id: "dark-fleet", name: "Dark fleet & smuggling leads",
  blurb: "Where ships switch AIS off, and flotillas that go dark together.",
  steps: [
    {
      title: "Where ships go dark most",
      layers: ["hotspots", "aisOff"],
      show: (d) => {
        if (!d.aisOff) return d.loading.aisOff ? "loading" : failed("AIS-off records");
        const spots = d.aisOff.hotspots;
        if (!spots.length) return { text: "No place stood out for ships switching AIS off in this period.", view: WORLD };
        const top = [...spots].sort((a, b) => b.count - a.count)[0];
        return {
          text: `The heat marks where ships switched AIS off most often this period. The most was ${top.place}: ${top.count} switch-offs. `
            + (first(top.statements, "INFERENCE") ?? first(top.statements, "OBSERVATION") ?? ""),
          sel: { kind: "hotspot", id: top.id },
          view: { bounds: boundsOf(spots.map((s) => [s.lon, s.lat]), 2000)!, maxZoom: 4 },
        };
      },
    },
    {
      title: "Ships that went dark together",
      layers: ["turnOns", "hotspots", "aisOff"],
      show: (d) => {
        if (!d.aisOff) return d.loading.aisOff ? "loading" : failed("AIS-off records");
        const t = topCluster(d);
        if (!t) return noCluster;
        return {
          text: `Observation: ${t.count} vessels switched AIS off entering ${t.place}, were dark there together for about ${hours(t.sharedHours)}, `
            + "and switched it back on as they left. The lines join where each went dark to where it came back.",
          sel: { kind: "turnOn", id: t.id }, view: clusterView(t),
        };
      },
    },
    {
      title: "One ship from the group",
      layers: ["turnOns", "aisOff"],
      show: (d) => {
        if (!d.aisOff) return d.loading.aisOff ? "loading" : failed("AIS-off records");
        const t = topCluster(d);
        if (!t) return noCluster;
        const v = t.vessels.find((x) => x.vesselId);
        if (!v?.vesselId) return { text: "None of these vessels has a ship identity to follow, so no path can be drawn.", sel: { kind: "turnOn", id: t.id } };
        return {
          text: `${named(v.vesselName)}: its path for the period is on the map, and its timeline in the panel shows its port calls and every stretch it was dark.`,
          sel: { kind: "vessel", id: v.vesselId },
        };
      },
    },
    {
      title: "What it might mean, and what to check",
      layers: ["turnOns", "hotspots", "aisOff"],
      show: (d) => {
        if (!d.aisOff) return d.loading.aisOff ? "loading" : failed("AIS-off records");
        const t = topCluster(d);
        if (!t) return noCluster;
        const meaning = first(t.statements, "HYPOTHESIS") ?? first(t.statements, "INFERENCE")
          ?? "Hypothesis: a fleet working together, a meeting to move catch or fuel, or simply poor reception in one area.";
        const check = first(t.statements, "RECOMMENDATION") ?? "Check whether a carrier or tanker was in the area, and the vessels' licences.";
        return { text: `${meaning} ${check}`, sel: { kind: "turnOn", id: t.id }, view: clusterView(t) };
      },
    },
  ],
};

// ---------- Trade & ports ----------
/** The Red Sea, the Arabian Sea and the Gulf of Oman. */
export const ARABIAN_SEA: Bounds = [[32, 8], [78, 31]];
const inside = (b: Bounds, lon: number, lat: number) => lon >= b[0][0] && lon <= b[1][0] && lat >= b[0][1] && lat <= b[1][1];

/** The strongest lasting change whose lead cell lies in the region, or the strongest anywhere when none does. */
export function pickChange(events: EventSummary[], cells: { cellId: string; center: [number | null, number | null] }[], region: Bounds) {
  const centre = new Map(cells.map((c) => [c.cellId, c.center]));
  const ranked = [...events].sort((a, b) => a.rank - b.rank);
  const local = ranked.find((e) => {
    const [lon, lat] = centre.get(e.leadCellId) ?? [null, null];
    return lon != null && lat != null && inside(region, lon, lat);
  });
  return local ? { event: local, local: true } : ranked[0] ? { event: ranked[0], local: false } : null;
}
function changeShown(d: TourData): { event: EventSummary; local: boolean; view: TourView } | "loading" | null {
  if (!d.events || !d.cells) return d.loading.changes ? "loading" : null;
  const hit = pickChange(d.events, d.cells, ARABIAN_SEA);
  if (!hit) return null;
  const ids = new Set(hit.event.cellIds);
  const pts = d.cells.filter((c) => ids.has(c.cellId)).flatMap((c) => c.boundary);
  return { ...hit, view: { bounds: boundsOf(pts, 300) ?? ARABIAN_SEA, maxZoom: 7 } };
}
const noChange: StepShown = { text: "The trend scan found no lasting change for the months chosen, so there is nothing to open here.", view: { bounds: ARABIAN_SEA } };

const trade: Tour = {
  id: "trade", name: "Trade & port economics",
  blurb: "The shipping highways of the Arabian Sea, and how they shift over years.",
  steps: [
    {
      title: "The shipping highways",
      layers: ["lanes"],
      show: () => ({
        text: "The darker threads are where ships spent most time in the last month of the period, from their AIS positions. "
          + "Here they run from the Red Sea through Bab-el-Mandeb, across the Arabian Sea and into the Gulf of Oman towards Hormuz.",
        view: { bounds: ARABIAN_SEA, maxZoom: 5 },
      }),
    },
    {
      title: "A lasting change",
      layers: ["lanes", "changes"],
      show: (d) => {
        const c = changeShown(d);
        if (c === "loading") return "loading";
        if (!c) return noChange;
        return {
          text: `${c.local ? "" : "No lasting change was found in this region, so here is the strongest anywhere. "}${c.event.headline.text} `
            + "The panel's waterfall tests the trend again after each correction in turn: satellite passes, AIS reception, season, then wind and chlorophyll. "
            + "A trend that survives them all is unlikely to come from how the data was collected.",
          sel: { kind: "event", id: c.event.eventId }, view: c.view,
        };
      },
    },
    {
      title: "Moved, or appeared?",
      layers: ["lanes", "changes"],
      show: (d) => {
        const c = changeShown(d);
        if (c === "loading") return "loading";
        if (!c) return noChange;
        return {
          text: "In the panel, \"Neighbours moving the other way\" lists cells next door that changed in the opposite direction. "
            + "Inference: a fall beside a rise is consistent with traffic moving from one route to another rather than appearing or vanishing. "
            + "Recommendation: check it against port calls and route notices before reading it as a shift in trade.",
          sel: { kind: "event", id: c.event.eventId }, view: c.view,
        };
      },
    },
  ],
};

// ---------- Environment ----------
export interface SlickLead { slick: OilSlick; gap: AisOffEvent | null; distanceKm: number | null; candidateRank: number | null }
const NEAR_KM = 250, NEAR_DAYS = 7;

/** The slick to look at: one whose candidate source ship went dark (and is in the AIS-off records), else the one with
 *  an AIS switch-off closest to it in place and time, else the largest. */
export function pickSlick(slicks: OilSlick[], gaps: AisOffEvent[]): SlickLead | null {
  if (!slicks.length) return null;
  const withShip = gaps.filter((g) => g.vesselId);
  for (const s of [...slicks].sort((a, b) => b.areaKm2 - a.areaKm2)) {
    for (const c of s.candidates.filter((x) => x.type === "VESSEL" && x.wentDark)) {
      const g = withShip.find((x) => x.mmsi === c.ref);
      if (g) return { slick: s, gap: g, distanceKm: km(s.lon, s.lat, g.lon, g.lat), candidateRank: c.rank };
    }
  }
  let best: SlickLead | null = null;
  for (const s of slicks) {
    for (const g of withShip) {
      if (s.time && g.start && Math.abs(Date.parse(s.time) - Date.parse(g.start)) > NEAR_DAYS * 86400000) continue;
      const dist = km(s.lon, s.lat, g.lon, g.lat);
      if (dist <= NEAR_KM && (!best || dist < best.distanceKm!)) best = { slick: s, gap: g, distanceKm: dist, candidateRank: null };
    }
  }
  return best ?? { slick: [...slicks].sort((a, b) => b.areaKm2 - a.areaKm2)[0], gap: null, distanceKm: null, candidateRank: null };
}
function slickShown(d: TourData): SlickLead | "loading" | "failed" | null {
  if (!d.slicks || !d.aisOff) return d.loading.slicks || d.loading.aisOff ? "loading" : "failed";
  return pickSlick(d.slicks, d.aisOff.events);
}
const slickView = (p: SlickLead): TourView => ({
  bounds: boundsOf(p.gap ? [[p.slick.lon, p.slick.lat], [p.gap.lon, p.gap.lat]] : [[p.slick.lon, p.slick.lat]], 120)!, maxZoom: 8,
});
const noSlick: StepShown = { text: "No possible oil slick was found in this period." };

const environment: Tour = {
  id: "environment", name: "Environmental protection",
  blurb: "Oil slicks seen on radar, cross-checked against ships that went dark nearby.",
  steps: [
    {
      title: "Slicks against the shipping lanes",
      layers: ["slicks", "lanes"],
      show: (d) => {
        if (!d.slicks) return d.loading.slicks ? "loading" : failed("oil slicks");
        if (!d.slicks.length) return { ...noSlick, view: WORLD };
        return {
          text: `${d.slicks.length} possible oil slicks are drawn: the largest SkyTruth's Cerulean model found this period on Sentinel-1 radar, `
            + "not checked by a person. Compare where they lie with the darker shipping lanes.",
          view: { bounds: boundsOf(d.slicks.map((s) => [s.lon, s.lat]), 2000)!, maxZoom: 4 },
        };
      },
    },
    {
      title: "A slick with a ship that went dark nearby",
      layers: ["slicks", "lanes", "aisOff"],
      show: (d) => {
        const p = slickShown(d);
        if (p === "loading") return "loading";
        if (p === "failed") return failed("slicks or AIS-off records");
        if (!p) return noSlick;
        const obs = first(p.slick.statements, "OBSERVATION") ?? `A possible slick of ${Math.round(p.slick.areaKm2)} km², ${p.slick.place}.`;
        const link = !p.gap ? " No ship switched AIS off near any slick this period, so this is the largest slick."
          : p.candidateRank != null ? ` Cerulean's candidate source #${p.candidateRank}, ${named(p.gap.vesselName)}, also switched AIS off ${Math.round(p.distanceKm!)} km away.`
          : ` The nearest AIS switch-off within a week was ${named(p.gap.vesselName)}, ${Math.round(p.distanceKm!)} km away.`;
        return { text: obs + link, sel: { kind: "slick", id: p.slick.id }, view: slickView(p) };
      },
    },
    {
      title: "The ship that went dark",
      layers: ["slicks", "lanes", "aisOff"],
      show: (d) => {
        const p = slickShown(d);
        if (p === "loading") return "loading";
        if (p === "failed") return failed("slicks or AIS-off records");
        if (!p) return noSlick;
        if (!p.gap?.vesselId) return { text: "No ship that switched AIS off was found near a slick in this period, so there is no path to follow.", sel: { kind: "slick", id: p.slick.id } };
        return {
          text: `${named(p.gap.vesselName)}: its path for the period is on the map${p.candidateRank != null ? ", with a dashed line to the slick" : ""}. `
            + "Compare when it went dark with when the radar image was taken. Being nearby is a reason to look, not proof of who released the oil.",
          sel: { kind: "vessel", id: p.gap.vesselId }, slick: p.candidateRank != null ? { slick: p.slick, rank: p.candidateRank } : undefined,
        };
      },
    },
    {
      title: "What to check next",
      layers: ["slicks", "lanes", "aisOff"],
      show: (d) => {
        const p = slickShown(d);
        if (p === "loading") return "loading";
        if (p === "failed") return failed("slicks or AIS-off records");
        if (!p) return noSlick;
        return {
          text: first(p.slick.statements, "RECOMMENDATION")
            ?? "Ask the coastguard or environment agency for a later radar or aerial look, and request the ship's AIS from coastal receivers for the hours it was dark.",
          sel: { kind: "slick", id: p.slick.id }, view: slickView(p),
        };
      },
    },
  ],
};

export const THEMED_TOURS: Tour[] = [fisheries, darkFleet, trade, environment];
