// The map's layers, in the order they are listed in the rail. Every one is free, public data.
export type LayerId = "lanes" | "borders" | "aisOff" | "hotspots" | "turnOns" | "encounters" | "loitering" | "fishing" | "closures"
  | "slicks" | "infra" | "effort" | "changes" | "nightLights" | "chlorophyll";

export interface LayerDef { id: LayerId; name: string; about: string; source: string; on: boolean }

export const LAYERS: LayerDef[] = [
  { id: "lanes", name: "Shipping lanes", on: true,
    about: "Where ships spend their time: the density of AIS positions over the last month of the period. The dark threads are the routes most ships follow.",
    source: "Global Fishing Watch, AIS vessel presence" },
  { id: "borders", name: "Sea borders", on: true,
    about: "Each country's exclusive economic zone (EEZ): the waters, usually out to 200 nautical miles, where it alone may license fishing. Click the sea to see whose waters it is. Lines between neighbours include disputed and provisional ones.",
    source: "Marine Regions EEZ boundaries (Flanders Marine Institute), via Global Fishing Watch" },
  { id: "aisOff", name: "AIS switched off", on: true,
    about: "Vessels whose AIS signal stopped during the period while reception was good, which Global Fishing Watch classes as likely switched off on purpose. Fishing-gear buoys are left out. Open one to see the ship and its path.",
    source: "Global Fishing Watch events" },
  { id: "hotspots", name: "Where ships go dark most", on: true,
    about: "The places where AIS was switched off most often during the period, with what the pattern there suggests.",
    source: "Global Fishing Watch events" },
  { id: "turnOns", name: "Simultaneous AIS turn-ons", on: true,
    about: "Areas where vessels switched off AIS while entering, operated dark together inside the area, and switched AIS back on while exiting. Coordinated dark operations indicate fleet-level coordination, transshipment (meeting a reefer/bunker), or joint sweeps.",
    source: "Global Fishing Watch AIS gaps" },
  { id: "encounters", name: "Meetings at sea", on: true,
    about: "Fishing vessels that held station beside a refrigerated carrier or bunker tanker for hours: how catch and fuel are moved at sea (transshipment). Meetings where either vessel switched AIS off within 48 hours, or that involve a vessel with no public licence on record, are listed first.",
    source: "Global Fishing Watch encounter events, cross-checked with AIS gaps and public RFMO authorisation lists" },
  { id: "loitering", name: "Carriers waiting offshore", on: false,
    about: "Refrigerated carriers and bunker tankers idling more than 20 nautical miles from shore, the wait that often comes before a transshipment. Those that met a vessel within a day are listed first.",
    source: "Global Fishing Watch loitering events" },
  { id: "fishing", name: "Possible unauthorised fishing", on: true,
    about: "Vessels that moved as if fishing inside a no-take marine protected area during the period. A lead to check against the area\u2019s permit list, never a finding.",
    source: "Global Fishing Watch events" },
  { id: "closures", name: "Fishing during seasonal bans", on: false,
    about: "Where AIS-broadcasting vessels fished during seasonal fishing bans (India, Bangladesh, Pakistan), compared with the weeks before and after. Bans change by season and some vessels are exempt, so each spot is a lead to check, never a finding.",
    source: "Global Fishing Watch fishing effort; ban dates from official notices" },
  { id: "slicks", name: "Possible oil slicks", on: true,
    about: "The largest slicks a machine-learning model found on Sentinel-1 radar during the period. Where Cerulean matched candidate source ships (an ink edge on the map), open a slick to see them ranked and follow a ship's path back to it. Not checked by a person; a match is a lead, not proof.",
    source: "SkyTruth Cerulean" },
  { id: "infra", name: "Offshore platforms", on: false,
    about: "Oil and gas platforms and wind turbines found on satellite radar and optical images. A possible source for nearby oil slicks, and a place where service vessels gather.",
    source: "Global Fishing Watch offshore fixed infrastructure (Sentinel-1, Sentinel-2)" },
  { id: "effort", name: "Fishing effort", on: false,
    about: "Where AIS-broadcasting fishing vessels appeared to fish during the period, by hours. Brighter orange means more hours. Compare it with the sea borders and with seasonal bans.",
    source: "Global Fishing Watch apparent fishing effort (AIS)" },
  { id: "changes", name: "Lasting changes since 2020", on: false,
    about: "Places where vessels seen by radar but not on AIS have risen or fallen for years, after allowing for satellite coverage, AIS reception, season and wind. Always computed over 2020 to now, whatever period is chosen.",
    source: "Ghost Fleet X trend scan" },
  { id: "nightLights", name: "Lights at night", on: false,
    about: "Night-time light seen from space on the last day of the period. Bright clusters far from land are usually fishing fleets working under lamps.",
    source: "NASA VIIRS day/night band (NOAA-20 satellite), via NASA GIBS" },
  { id: "chlorophyll", name: "Ocean productivity", on: false,
    about: "Chlorophyll in surface water on the last day of the period: where the sea is rich in plankton, and fish and fishing fleets tend to gather. Gaps are cloud.",
    source: "NASA MODIS-Aqua, via NASA GIBS" },
];

export const DEFAULT_VISIBLE = Object.fromEntries(LAYERS.map((l) => [l.id, l.on])) as Record<LayerId, boolean>;

export type SeaKind = "aisOff" | "hotspot" | "turnOn" | "slick" | "fishing" | "encounter" | "loitering" | "closure";
export type Selection = { kind: "event" | "cell" | "vessel" | SeaKind; id: string } | null;

// ---------- the period every dated layer is filtered to ----------
export interface Period { start: string; end: string }   // inclusive days, "YYYY-MM-DD" (UTC)
export const EARLIEST = "2020-01-01";
export const MAX_SPAN_DAYS = 366;

const iso = (d: Date) => d.toISOString().slice(0, 10);
export function daysAgo(n: number, now = new Date()): string {
  return iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n)));
}
export function spanDays(p: Period): number {
  return Math.round((Date.parse(p.end) - Date.parse(p.start)) / 86400000) + 1;
}
export function lastDays(n: number, now = new Date()): Period {
  return { start: daysAgo(n, now), end: daysAgo(0, now) };
}
/** Why a period cannot be used, or null if it can. */
export function periodProblem(p: Period, now = new Date()): string | null {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(p.start) || !day.test(p.end) || Number.isNaN(Date.parse(p.start)) || Number.isNaN(Date.parse(p.end))) return "Pick both dates.";
  if (p.start > p.end) return "The first day is after the last day.";
  if (p.end > daysAgo(0, now)) return "The last day is in the future.";
  if (p.start < EARLIEST) return "Data starts on 1 Jan 2020.";
  if (spanDays(p) > MAX_SPAN_DAYS) return "Pick a year or less.";
  return null;
}
/** Months ("YYYY-MM") of `available` that overlap the period; the newest available month if none does. */
export function monthsIn(p: Period, available: string[]): string[] {
  const hit = available.filter((m) => m >= p.start.slice(0, 7) && m <= p.end.slice(0, 7));
  return hit.length || !available.length ? hit : [available[available.length - 1]];
}

/** NASA GIBS tile template for a daily layer on the given day. */
export function gibsTiles(layer: string, level: number, date: string): string {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.png`;
}
/** The day NASA imagery is shown for: the period's last day, but never newer than `lag` days ago (not published yet). */
export function imageDay(p: Period, lag: number, now = new Date()): string {
  const newest = daysAgo(lag, now);
  return p.end < newest ? p.end : newest;
}
