import maplibregl, { type GeoJSONSource, type RasterTileSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type {
  AisOffEvent, AisOffResponse, CellSummary, Closure, CoordinatedTurnOn, Encounter, EventSummary, Loitering, OilSlick, ProtectedFishingEvent, VesselResponse,
} from "../api/types";
import { directionGlyph, directionWord, formatDateTime, formatDay, formatPct, formatSpan, vesselWord } from "../lib/format";
import { bearing, chaikin, clusterShape, convexHull, pointInRing, scaleRing, unwrapLon, type Pt } from "../lib/geometry";
import { BORDER, CLOSURE, ENCOUNTER, FISHING, ICONS, INK, LOITER, MAGENTA, NOTAKE, OIL, PAPER, SLICK, TURNON, UNCLASSED, WIND, drawSilhouette, hullPath, iconSvg, type IconName } from "../lib/icons";
import { gibsTiles, type LayerId, type Period, type Selection } from "../lib/layers";
import { TRACK_RAMP, trackFeatures } from "../lib/track";
import { sdfImage } from "../lib/sdf";
import { shipRadius, shipSvg, type ShipOptions } from "../lib/ship3d";
import { markIcon, shapeOf, vesselClass } from "../lib/vessel";

interface Props {
  visible: Record<LayerId, boolean>;
  aisOff?: AisOffResponse;
  slicks: OilSlick[];
  fishing: ProtectedFishingEvent[];
  cells: CellSummary[];              // used for change-area geometry only; never drawn as a grid
  events: EventSummary[];
  selection: Selection;
  focus: { lon: number; lat: number; key: string } | null;   // fly here when the key changes
  onSelect: (sel: Selection) => void;
  lanesMonth: string | null;         // month of the shipping-lane tiles
  nightDay: string;                  // day of the NASA night-lights image
  chlDay: string;                    // day of the NASA chlorophyll image
  track?: VesselResponse;            // the ship open in the drawer: its path through its recorded events
  showNoTakeAreas?: boolean;          // outline and label the no-take areas the records fall in
  noTakeOnly?: boolean;              // only records in areas where all fishing is banned
  encounters: Encounter[];
  loitering: Loitering[];
  closures: Closure[];
  period: Period;                    // fishing-effort tiles follow it
  slickLink?: OilSlick | null;       // the slick the open ship is a candidate source of
}

const DIR_COLOR = { INCREASING: "#a3166f", DECREASING: "#2d6a9f", NONE: "#566676" } as const;   // chart magenta / shelf blue
const INFRA_ICON = ["match", ["get", "label"], "oil", "platform", "wind", "turbine", "structure"] as maplibregl.ExpressionSpecification;
/** How large a ship's mark is drawn: small on a world view, a little larger closer in (where the 3D ships take over). */
const markSize = (k = 1): maplibregl.ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], 1, 0.62 * k, 4.5, 1 * k, 8, 1.4 * k];
/** The symbols that are not ships. Like the ship marks, the map draws them from distance fields: nothing on the chart is a
 *  stretched picture, so nothing on it can blur. */
const SYMBOLS: IconName[] = ["slick", "fleet", "platform", "turbine", "structure", "anchor", "reticle"];
/** Ship marks for a wide view, as distance fields: a short hull, a long hull, and a long hull with a short one alongside. */
const MARKS = {
  "mark-fishing": hullPath(16, 16, 15.5, 8.2),
  "mark-ship": hullPath(16, 16, 21, 7.2),
  "mark-pair": `${hullPath(11.6, 16, 20.5, 6.6)}${hullPath(21.4, 17.6, 12.5, 5.8)}`,
};

// ---------- ships as 3D models, once you are close enough to read them ----------
const NEAR_ZOOM = 4.4;      // from here in, ships in view are drawn as 3D models
const MAX_SHIPS = 170;      // at most this many at once, nearest the middle of the view first; the rest keep their marks
const SHIP_PX = 5.3;        // screen pixels per model unit at scale 1: a cargo ship is about 58 px long
const PARKED = 60;          // heading given to ships whose record has none: meetings, waiting carriers, fishing events
const turn15 = (deg: number) => (Math.round(deg / 15) * 15) % 360;
/** How much bigger the models get as you zoom in. */
const shipScale = (zoom: number) => (zoom <= 4.4 ? 0.74 : zoom <= 6 ? 0.74 + (zoom - 4.4) * 0.1625 : zoom <= 9 ? 1 + (zoom - 6) * 0.14 : 1.42);
interface NearShip {
  key: string; layer: string; sel: NonNullable<Selection>; lon: number; lat: number;
  ship: ShipOptions; tip: string; tipText: string; wake?: GeoJSON.Feature[];
}

/** The ring under a stronger lead: it fits the small mark on a wide view, then grows with the 3D ship (about `r` px at zoom 6). */
const ringRadius = (r: number): maplibregl.ExpressionSpecification =>
  ["interpolate", ["linear"], ["zoom"], 1, 7, 4.3, 12, 4.5, r * 0.76, 6, r, 9, r * 1.42];
const INFRA_WORD: Record<string, string> = { oil: "Oil or gas platform", wind: "Wind turbine" };

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean";
const nightTiles = (day: string) => gibsTiles("VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance", 8, day);   // the Suomi-NPP layer stopped updating
const chlTiles = (day: string) => gibsTiles("MODIS_Aqua_L2_Chlorophyll_A", 7, day);
const MAX_GAP_LABELS = 30;
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    // Bathymetric ocean basemap: keyless, ~15 KB/tile. Shows the continental shelves, where vessels concentrate.
    base: { type: "raster", tileSize: 256, maxzoom: 13, tiles: [`${ESRI}/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}`],
            attribution: "Esri, GEBCO, NOAA, National Geographic, Garmin, HERE" },
    labels: { type: "raster", tileSize: 256, maxzoom: 13, tiles: [`${ESRI}/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}`] },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#c9dbe6" } },
    // quieted so the data reads first
    { id: "base", type: "raster", source: "base", paint: { "raster-saturation": -0.35, "raster-contrast": -0.1, "raster-brightness-min": 0.12 } },
  ],
};

const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const points = <T extends { lat: number; lon: number }>(rows: T[], props: (r: T) => GeoJSON.GeoJsonProperties): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: rows.map((r) => ({ type: "Feature", geometry: { type: "Point", coordinates: [r.lon, r.lat] }, properties: props(r) })),
});

/** One no-take protected area that records fall in: where to label it and what happened there. */
interface NoTakeArea { id: string; full: boolean; fishing: number; vessels: number; lon: number; lat: number }

/** What a no-take area means, and what the records show there, in plain words. A lead, never a finding. */
function noTakeWords(full: boolean, a: NoTakeArea | undefined, desig: unknown): string {
  const rule = full ? "No-take area: all fishing is banned here."
                    : "Partly no-take: fishing is banned in a zone inside this protected area, and may be allowed in the rest.";
  const kind = desig ? ` Designated ${String(desig)}.` : "";
  const seen = a ? ` ${a.vessels} ${a.vessels === 1 ? "vessel" : "vessels"} moved as if fishing here in this period`
    + ` (${a.fishing} ${a.fishing === 1 ? "record" : "records"}). Each is a lead to check against the area's permits.` : "";
  return rule + kind + seen;
}

/** Diagonal hatching, the chart convention for "restricted": the fill of areas where all fishing is banned. */
function hatchImage(color: string, size = 16): ImageData {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = "square"; ctx.globalAlpha = 0.55;
  for (const o of [-size, 0, size]) { ctx.beginPath(); ctx.moveTo(o, size); ctx.lineTo(o + size, 0); ctx.stroke(); }
  return ctx.getImageData(0, 0, size, size);
}

/** Polygons connecting entry (AIS off) and exit (AIS on) points for each joint dark operation. */
function turnOnZones(clusters: CoordinatedTurnOn[] = []): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const c of clusters) {
    if (!c.vessels || c.vessels.length < 2) continue;
    const pts: Pt[] = c.vessels.flatMap((v) => [
      [v.enterLon, v.enterLat] as Pt,
      [v.exitLon, v.exitLat] as Pt,
    ]);
    if (pts.length < 3) {
      const [p1, p2] = pts;
      const midLon = (p1[0] + p2[0]) / 2, midLat = (p1[1] + p2[1]) / 2;
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      const r = Math.max(0.6, dist * 0.7);
      const ring: Pt[] = [];
      for (let a = 0; a < 24; a++) {
        const theta = (a / 24) * 2 * Math.PI;
        ring.push([midLon + r * Math.cos(theta), midLat + r * Math.sin(theta)]);
      }
      ring.push(ring[0]);
      features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { id: c.id, count: c.count } });
    } else {
      const hull = convexHull(pts);
      if (hull.length >= 4) {
        const expanded = scaleRing(hull, 1.25);
        const smooth = chaikin(expanded, 3);
        features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [smooth] }, properties: { id: c.id, count: c.count } });
      }
    }
  }
  return { type: "FeatureCollection", features };
}

// What each kind of record looks like as a 3D ship: an empty hull for a ship that went dark, a red fishing vessel for
// fishing in a protected area, a carrier or tanker with a fishing vessel alongside for a meeting, a carrier or tanker alone
// for one waiting offshore (on a teal disc once it is recorded meeting a vessel). Stronger leads keep their ring underneath.
const ghostShip = (type: string | null | undefined, heading: number): ShipOptions => ({ kind: shapeOf(vesselClass(type)), heading: turn15(heading), look: "ghost" });
const fishingShip = (): ShipOptions => ({ kind: "fishing", heading: PARKED, hull: FISHING });
const meetingShip = (type: string | null | undefined): ShipOptions => ({ kind: type?.startsWith("bunker") ? "tanker" : "carrier", consort: "fishing", heading: PARKED });
const waitingShip = (type: string | null | undefined, met: boolean): ShipOptions =>
  ({ kind: vesselClass(type) === "bunker" ? "tanker" : "carrier", heading: PARKED, ...(met ? { plate: LOITER } : {}) });

/** From where a ship's signal stopped to where it came back: a line, and a dot at the far end. */
function wakeOf(e: AisOffEvent | undefined): GeoJSON.Feature[] {
  if (!e || e.onLat == null || e.onLon == null) return [];
  const back: Pt = [unwrapLon(e.onLon, e.lon), e.onLat];
  return [
    { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[e.lon, e.lat], back] } },
    { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: back } },
  ];
}

const POINT_LAYERS = [["fishing-pt", "fishing"], ["encounter-pt", "encounter"], ["closure-pt", "closure"], ["aisoff-pt", "aisOff"],
  ["turnon-pt", "turnOn"], ["loiter-pt", "loitering"], ["slick-pt", "slick"]] as const;
/** Record layers and their resting opacity. They fade while one ship's path is open, so the path reads first. */
const FADE: [layer: string, prop: "icon-opacity" | "circle-opacity" | "circle-stroke-opacity" | "heatmap-opacity", rest: number][] = [
  ["heat", "heatmap-opacity", 0.85], ["slick-pt", "icon-opacity", 0.9], ["aisoff-pt", "icon-opacity", 1],
  ["closure-pt", "circle-opacity", 0.75], ["loiter-pt", "icon-opacity", 1], ["encounter-pt", "icon-opacity", 1], ["encounter-ring", "circle-stroke-opacity", 1],
  ["fishing-pt", "icon-opacity", 1], ["turnon-pt", "icon-opacity", 1], ["turnon-halo", "circle-opacity", 1],
];
const SOURCE_TIP = { VESSEL: "a vessel on AIS", INFRASTRUCTURE: "an offshore structure", DARK_VESSEL: "a vessel not on AIS",
                     NATURAL: "a natural seep", UNKNOWN: "no source matched" } as const;

/** A GFW date property (epoch ms, epoch s, or ISO) -> "2019". */
function yearOf(v: unknown): string | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e11 ? n * 1000 : n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : String(d.getUTCFullYear());
}

export function MapView({ visible, aisOff, slicks, fishing, cells, events, selection, focus, onSelect,
                          lanesMonth, nightDay, chlDay, track, showNoTakeAreas = true, noTakeOnly = false,
                          encounters, loitering, closures, period, slickLink = null }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [basemapDown, setBasemapDown] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const hullsRef = useRef<{ id: string; ring: Pt[] }[]>([]);
  const noTakeRef = useRef(new Map<string, NoTakeArea>());   // the areas outlined, by WDPA id, for the hover card
  const [areaNames, setAreaNames] = useState<Record<string, string>>({});   // WDPA id -> official name, read from the tiles
  const labelMarkers = useRef<maplibregl.Marker[]>([]);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const initial = useRef({ lanesMonth, nightDay, chlDay, period });
  const popup = useRef<maplibregl.Popup | null>(null);
  /** The hover card, shared by the map's own layers and the 3D ships placed over it. */
  const tipApi = useRef<{
    show: (key: string, at: [number, number], title: string, text: string, art: { ship?: ShipOptions; icon?: string }) => void;
    hide: () => void;
  } | null>(null);
  const shipMarkers = useRef(new Map<string, { marker: maplibregl.Marker; el: HTMLButtonElement }>());
  const ownShip = useRef<maplibregl.Marker | null>(null);
  // The stretch a ship sailed unseen, drawn for the one under the pointer and the one open in the drawer.
  const aisByIdRef = useRef(new Map<string, AisOffEvent>());
  const wake = useRef<{ open: GeoJSON.Feature[]; hover: GeoJSON.Feature[] }>({ open: [], hover: [] });
  const drawWake = () => (map.current?.getSource("aisoff-wake") as GeoJSONSource | undefined)
    ?.setData({ type: "FeatureCollection", features: [...wake.current.open, ...wake.current.hover] });
  const trackGeo = useMemo(() => trackFeatures(track), [track]);
  /** The slick joined to the open ship's recorded position nearest in time to the radar image. */
  const linkGeo = useMemo<{ geo: GeoJSON.FeatureCollection; at: Pt | null }>(() => {
    if (!slickLink || !track?.points.length) return { geo: empty, at: null };
    const t = Date.parse(slickLink.time && !/[zZ]|[+-]\d\d:\d\d$/.test(slickLink.time) ? `${slickLink.time}Z` : slickLink.time ?? "");
    let best = 0;
    track.points.forEach((p, i) => { if (Math.abs(Date.parse(p.time) - t) < Math.abs(Date.parse(track.points[best].time) - t)) best = i; });
    const ship = trackGeo.coords[best];
    let lon = slickLink.lon;                                  // same side of the antimeridian as the track
    while (lon - ship[0] > 180) lon -= 360;
    while (lon - ship[0] < -180) lon += 360;
    const at: Pt = [lon, slickLink.lat];
    return { at, geo: { type: "FeatureCollection", features: [
      { type: "Feature", geometry: { type: "LineString", coordinates: [at, ship] }, properties: {} },
      { type: "Feature", geometry: { type: "Point", coordinates: at }, properties: { slick: true } },
    ] } };
  }, [slickLink, track, trackGeo]);

  const filteredFishing = useMemo(() => noTakeOnly ? fishing.filter((f) => f.fullNoTake) : fishing, [fishing, noTakeOnly]);
  const fishingGeo = useMemo(() => points(filteredFishing, (f) => ({ id: f.id, fullNoTake: f.fullNoTake, tipShip: JSON.stringify(fishingShip()),
    tip: f.vesselName ?? "Unnamed vessel",
    tipText: `Flag ${f.flag ?? "unknown"}. Moved as if fishing in ${f.fullNoTake ? "a no-take area" : "a protected area"}, ${formatDay(f.start)}${f.durationHours ? `, about ${formatSpan(f.durationHours)}` : ""}.` })),
    [filteredFishing]);

  const turnOnsGeo = useMemo(() =>
    points(aisOff?.turnOnClusters ?? [], (t) => ({ id: t.id, count: t.count, place: t.place, spanHours: t.spanHours, flags: t.topFlags.join(", "), tipIcon: "fleet",
      tip: `${t.count} ships dark together`,
      tipText: `${t.place}, ${formatDay(t.coPresenceStart)}. All unseen at once for ${formatSpan(t.sharedHours)}${t.topFlags.length ? `; mostly flagged ${t.topFlags.join(", ")}` : ""}.` })),
    [aisOff?.turnOnClusters]
  );
  const turnOnZonesGeo = useMemo(() => turnOnZones(aisOff?.turnOnClusters ?? []), [aisOff?.turnOnClusters]);

  const heatGeo = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: (aisOff?.heat ?? []).map(([lat, lon]) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: {} })),
  }), [aisOff]);
  // Each ship that went dark is an empty hull, its bow turned toward where it reappeared.
  const aisOffGeo = useMemo(() => points(aisOff?.events ?? [], (e) => ({
    id: e.id, mark: markIcon(vesselClass(e.vesselType)), tipShip: JSON.stringify(ghostShip(e.vesselType, 0)),
    bearing: (e.onLat != null && e.onLon != null ? bearing([e.lon, e.lat], [e.onLon, e.onLat]) : null) ?? 0,
    tip: e.vesselName ?? "Unnamed vessel",
    tipText: `${vesselWord(e.vesselType)}, flag ${e.flag ?? "unknown"}. Dark for ${formatSpan(e.durationHours)} from ${formatDay(e.start)}`
      + `${e.distanceKm != null && e.end ? `; reappeared ${Math.round(e.distanceKm).toLocaleString()} km away` : ""}.${e.inNoTake ? " Inside a no-take area." : ""}`,
  })), [aisOff]);
  // The no-take protected areas the records fall in, by WDPA id. GFW tags each event with them; the WDPA tiles carry no
  // no-take flag of their own, so these ids pick which outlines to draw.
  const noTakeIds = useMemo(() => {
    const full = new Set<string>(), part = new Set<string>();
    for (const e of aisOff?.events ?? []) { e.noTakeAreaIds?.forEach((id) => full.add(id)); e.partNoTakeAreaIds?.forEach((id) => part.add(id)); }
    for (const f of fishing) f.areaIds?.forEach((id) => (f.fullNoTake ? full : part).add(id));
    for (const id of full) part.delete(id);
    return { full: [...full], part: noTakeOnly ? [] : [...part] };
  }, [aisOff, fishing, noTakeOnly]);
  // Each area with apparent fishing in it, labelled where its records are (the WDPA tiles give outlines, not label points).
  const noTakeIdsRef = useRef(noTakeIds);
  noTakeIdsRef.current = noTakeIds;
  const noTakeAreas = useMemo(() => {
    const by = new Map<string, { full: boolean; evs: ProtectedFishingEvent[] }>();
    for (const f of filteredFishing) {
      const id = f.areaIds?.[0];
      if (!id) continue;
      const a = by.get(id) ?? { full: f.fullNoTake, evs: [] };
      a.full ||= f.fullNoTake;
      a.evs.push(f);
      by.set(id, a);
    }
    const out: NoTakeArea[] = [...by].map(([id, { full, evs }]) => ({
      id, full, fishing: evs.length, vessels: new Set(evs.map((e) => e.vesselId ?? e.vesselName ?? e.id)).size,
      lon: evs.reduce((t, e) => t + e.lon, 0) / evs.length, lat: evs.reduce((t, e) => t + e.lat, 0) / evs.length,
    }));
    return out.sort((a, b) => b.fishing - a.fishing);
  }, [filteredFishing]);
  noTakeRef.current = new Map(noTakeAreas.map((x) => [x.id, x]));
  const aisById = useMemo(() => new Map((aisOff?.events ?? []).map((e) => [e.id, e])), [aisOff]);
  aisByIdRef.current = aisById;
  const slickGeo = useMemo(() => points(slicks, (s) => {
    const best = s.candidates[0];
    const who = !best ? SOURCE_TIP[s.possibleSource]
      : best.type === "VESSEL" ? best.vesselName ?? `the ship with MMSI ${best.ref}`
      : best.type === "DARK_VESSEL" ? "a vessel not on AIS" : best.type === "INFRASTRUCTURE" ? "an offshore structure" : "unidentified";
    return { id: s.id, area: s.areaKm2, ship: best?.type === "VESSEL", tipIcon: best?.type === "VESSEL" ? "slick-ship" : "slick", tip: `Possible oil slick, ${Math.round(s.areaKm2).toLocaleString()} km²`,
             tipText: `${s.place}, ${formatDay(s.time)}. Best-matching source: ${who}.` };
  }), [slicks]);
  const encounterGeo = useMemo(() => points(encounters, (e) => {
    const noLicence = e.vessels.some((v) => v.authorisation === "NOT_FOUND");
    return { id: e.id, dark: e.darkLink, noLicence, tipShip: JSON.stringify(meetingShip(e.type)), tip: e.vessels.map((v) => v.name ?? "Unnamed").join(" + "),
             tipText: `${e.place}, ${formatDay(e.start)}. Alongside for ${formatSpan(e.durationHours)}.`
               + `${e.darkLink ? " AIS was switched off nearby." : ""}${noLicence ? " No public licence on record for one vessel." : ""}` };
  }), [encounters]);
  const loiterGeo = useMemo(() => points(loitering, (l) => {
    return { id: l.id, met: l.metVessel, tipShip: JSON.stringify(waitingShip(l.vesselType, l.metVessel)), tip: l.vesselName ?? "Unnamed vessel",
    tipText: `${vesselWord(l.vesselType)}, flag ${l.flag ?? "unknown"}. Waited ${formatSpan(l.durationHours)} from ${formatDay(l.start)}${l.metVessel ? "; met a vessel within a day" : ""}.` };
  }), [loitering]);
  // each ban's spots for one year: the year open in the drawer, otherwise the latest one
  const closureGeo = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: closures.flatMap((c) => {
      const season = c.seasons.find((s) => selection?.kind === "closure" && s.id === selection.id) ?? c.seasons[c.seasons.length - 1];
      return season ? season.cells.map((x) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [x.lon, x.lat] },
                                                 properties: { id: season.id, hours: x.hours, tip: `${c.name} ${season.year}`,
                                                               tipText: `${Math.round(x.hours).toLocaleString()} fishing hours here during the ban, ${x.vessels} vessel(s).` } })) : [];
    }),
  }), [closures, selection]);

  /** One smooth region per change event (touching significant areas, same direction). */
  const hulls = useMemo(() => {
    const byId = new Map(cells.map((c) => [c.cellId, c]));
    return events.map((e) => {
      const rings = e.cellIds.map((id) => byId.get(id)?.boundary).filter((b): b is [number, number][] => !!b);
      const ring = clusterShape(rings as Pt[][]);
      const lead = byId.get(e.leadCellId);
      const anchor: Pt = lead?.center[0] != null && lead.center[1] != null ? [lead.center[0], lead.center[1]] : ring[0];
      return { event: e, ring, anchor };
    }).filter((c) => c.ring.length >= 4);
  }, [cells, events]);
  hullsRef.current = visible.changes ? hulls.map((c) => ({ id: c.event.eventId, ring: c.ring })) : [];

  const selectedEventId = selection?.kind === "event" ? selection.id : null;
  const hullGeo = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: hulls.map((c) => ({
      type: "Feature", geometry: { type: "Polygon", coordinates: [c.ring] },
      properties: { eventId: c.event.eventId, color: DIR_COLOR[c.event.direction], selected: c.event.eventId === selectedEventId },
    })),
  }), [hulls, selectedEventId]);

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({ container: el.current, style: STYLE, center: [40, 18], zoom: 1.6, attributionControl: false });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    m.on("error", (e) => {
      if ((e as { sourceId?: string }).sourceId === "base") setBasemapDown(true);
      else if (import.meta.env.DEV && !(e as { sourceId?: string }).sourceId) console.error("map:", e.error?.message ?? e);   // style mistakes are otherwise silent
    });

    // Not "load": that waits for basemap tiles, which may be slow or offline at the venue.
    let initialised = false;
    const init = () => {
      if (initialised) return;
      initialised = true;
      const zoomScale = (a: number, b: number): maplibregl.ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], 1, a, 7, b];
      // a slick's symbol grows with the square root of its area, so its drawn area tracks the real one
      const bySize = (k: number): maplibregl.ExpressionSpecification =>
        ["interpolate", ["linear"], ["sqrt", ["get", "area"]], 2, 0.3 * k, 18, 0.78 * k];
      // Every symbol is a distance field of its silhouette, in a 32-unit box (the 24-unit drawings sit in its middle)
      for (const [name, path] of Object.entries(MARKS)) m.addImage(name, sdfImage((ctx) => ctx.fill(new Path2D(path)), 32, 64), { pixelRatio: 2, sdf: true });
      for (const name of SYMBOLS) m.addImage(name, sdfImage((ctx) => { ctx.translate(4, 4); drawSilhouette(ctx, name); }, 32, 64), { pixelRatio: 2, sdf: true });
      /** A layer of chart symbols. They may overlap freely: hiding one behind another would hide a record. */
      const symbols = (id: string, source: string, layout: maplibregl.SymbolLayerSpecification["layout"],
                       more: Partial<maplibregl.SymbolLayerSpecification> = {}) =>
        m.addLayer({ id, type: "symbol", source, ...more,
                     layout: { "icon-allow-overlap": true, "icon-ignore-placement": true, ...layout } } as maplibregl.SymbolLayerSpecification);
      /** A ring under a symbol: the mark for a stronger lead. */
      const ring = (id: string, source: string, filter: maplibregl.FilterSpecification, color: string, radius: maplibregl.ExpressionSpecification) =>
        m.addLayer({ id, type: "circle", source, filter,
                     paint: { "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": color, "circle-stroke-width": zoomScale(1.25, 2.25), "circle-radius": radius } });
      // NASA imagery and shipping lanes sit under everything else
      const first = initial.current;
      m.addSource("night", { type: "raster", tileSize: 256, maxzoom: 8, tiles: [nightTiles(first.nightDay)], attribution: "NASA GIBS (VIIRS, MODIS-Aqua)" });
      m.addSource("chl", { type: "raster", tileSize: 256, maxzoom: 7, tiles: [chlTiles(first.chlDay)] });
      m.addLayer({ id: "night", type: "raster", source: "night", layout: { visibility: "none" }, paint: { "raster-opacity": 0.9 } });
      m.addLayer({ id: "chl", type: "raster", source: "chl", layout: { visibility: "none" }, paint: { "raster-opacity": 0.85 } });
      // zoom 3 is the deepest lane tile asked for: deeper tiles are speckled with single ships and take ~10 s each
      m.addSource("lanes", { type: "raster", tileSize: 256, maxzoom: 3, tiles: [api.laneTiles(first.lanesMonth ?? undefined)], attribution: "Global Fishing Watch" });
      // lanes are a world-scale picture: they are gone by zoom 5.4, before the coarse tiles are stretched into a grey smear
      m.addLayer({ id: "lanes", type: "raster", source: "lanes",
                   paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 3.2, 0.7, 4.6, 0.3, 5.4, 0] } });
      m.addSource("effort", { type: "raster", tileSize: 256, maxzoom: 6, tiles: [api.effortTiles(first.period.start, first.period.end)],
                              attribution: "Global Fishing Watch" });
      m.addLayer({ id: "effort", type: "raster", source: "effort", layout: { visibility: "none" }, paint: { "raster-opacity": 0.85 } });
      // sea borders: EEZ polygons, drawn as a dashed edge only (no click popup)
      m.addSource("eez", { type: "vector", tiles: [api.contextTiles("eez")], maxzoom: 9, attribution: "Marine Regions (VLIZ)" });
      m.addLayer({ id: "eez-line", type: "line", source: "eez", "source-layer": "main",
                   paint: { "line-color": BORDER, "line-opacity": 0.75, "line-dasharray": [3, 2],
                            "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 6, 1.4] } });
      // no-take marine protected areas (WDPA via GFW): only those a record falls in, picked by id once the data is in.
      // Wholly no-take: a solid green edge; partly no-take (only a zone inside is): a dashed one, fainter.
      m.addSource("mpa", { type: "vector", tiles: [api.contextTiles("mpa")], maxzoom: 9, attribution: "Protected Planet WDPA" });
      const none: maplibregl.FilterSpecification = ["==", ["literal", 0], 1];
      m.addLayer({ id: "notake-fill", type: "fill", source: "mpa", "source-layer": "main", filter: none,
                   paint: { "fill-color": NOTAKE, "fill-opacity": 0.1 } });
      // wholly no-take: hatched as well, so "no fishing at all" reads at a glance, without a legend
      m.addImage("hatch-notake", hatchImage(NOTAKE), { pixelRatio: 2 });
      m.addLayer({ id: "notake-hatch", type: "fill", source: "mpa", "source-layer": "main", filter: none,
                   paint: { "fill-pattern": "hatch-notake" } });
      m.addLayer({ id: "notake-line", type: "line", source: "mpa", "source-layer": "main", filter: none,
                   paint: { "line-color": NOTAKE, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1, 7, 2.2] } });
      m.addLayer({ id: "notake-line-part", type: "line", source: "mpa", "source-layer": "main", filter: none,
                   paint: { "line-color": NOTAKE, "line-opacity": 0.8, "line-dasharray": [3, 2],
                            "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.8, 7, 1.6] } });
      m.addSource("infra", { type: "vector", tiles: [api.contextTiles("infra")], minzoom: 3, maxzoom: 9, attribution: "Global Fishing Watch" });
      symbols("infra-pt", "infra", { visibility: "none", "icon-image": INFRA_ICON, "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.38, 8, 0.95] },
              { "source-layer": "main", minzoom: 3,
                paint: { "icon-color": ["match", ["get", "label"], "oil", OIL, "wind", WIND, UNCLASSED], "icon-halo-color": PAPER, "icon-halo-width": 2 } });

      for (const id of ["heat", "slick", "aisoff", "aisoff-wake", "fishing", "turnons", "turnon-zones", "hulls", "picked", "track-line", "track-pt",
                        "encounter", "loiter", "closure", "slick-link"]) {
        m.addSource(id, { type: "geojson", data: empty });
      }

      m.addLayer({   // where AIS is switched off most often
        id: "heat", type: "heatmap", source: "heat", maxzoom: 9,
        paint: {
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 1, 7, 4, 18, 8, 40],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 1, 0.35, 6, 1.2],
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(163,22,111,0)", 0.15, "rgba(163,22,111,0.18)",
            0.5, "rgba(163,22,111,0.45)", 1, "rgba(120,10,80,0.8)"],
          "heatmap-opacity": 0.85,
        },
      });
      // possible oil slicks: a brown patch sized by area, with an ink edge when Cerulean matched a ship on AIS as the best candidate source
      symbols("slick-pt", "slick", {
        "icon-image": "slick",
        // zoom must be the outermost interpolation, so the size-by-area ramp is repeated at both zoom stops
        "icon-size": ["interpolate", ["linear"], ["zoom"], 1, bySize(1), 7, bySize(2.7)],
      }, { paint: { "icon-color": SLICK, "icon-opacity": 0.9, "icon-halo-color": ["case", ["get", "ship"], INK, PAPER], "icon-halo-width": ["case", ["get", "ship"], 2.6, 1.6] } });
      // AIS switched off: an empty hull, bow toward where the ship reappeared, short for fishing vessels and long for the rest.
      // For the ship under the pointer or open in the drawer, a broken line runs to where its signal came back.
      const aisOffLayers = () => {
        m.addLayer({ id: "aisoff-wake", type: "line", source: "aisoff-wake", filter: ["==", ["geometry-type"], "LineString"],
                     paint: { "line-color": MAGENTA, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.2, 8, 2.2], "line-dasharray": [1.5, 1.5] } });
        m.addLayer({ id: "aisoff-wake-pt", type: "circle", source: "aisoff-wake", filter: ["==", ["geometry-type"], "Point"],
                     paint: { "circle-color": MAGENTA, "circle-stroke-color": PAPER, "circle-stroke-width": 1.25, "circle-radius": zoomScale(2.6, 4.5) } });
        symbols("aisoff-pt", "aisoff", { "icon-image": ["get", "mark"], "icon-size": markSize(), "icon-rotate": ["get", "bearing"], "icon-rotation-alignment": "map" },
                { paint: { "icon-color": "#ffffff", "icon-halo-color": MAGENTA, "icon-halo-width": 2.2 } });
      };

      m.addLayer({   // fishing during a seasonal ban: violet discs sized by hours
        id: "closure-pt", type: "circle", source: "closure",
        paint: { "circle-color": CLOSURE, "circle-opacity": 0.75, "circle-stroke-color": PAPER, "circle-stroke-width": 0.75,
                 "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "hours"]], 1, 2.5, 30, 11] },
      });
      // carriers waiting offshore: a long teal hull, open until the ship is recorded meeting a vessel
      symbols("loiter-pt", "loiter", { "icon-image": "mark-ship", "icon-size": markSize(0.95) },
              { paint: { "icon-color": ["case", ["get", "met"], LOITER, "#ffffff"], "icon-halo-color": ["case", ["get", "met"], PAPER, LOITER], "icon-halo-width": 2.2 } });
      // meetings at sea: two hulls alongside, with a magenta ring when AIS went off nearby
      ring("encounter-ring", "encounter", ["==", ["get", "dark"], true], MAGENTA, ringRadius(43));
      symbols("encounter-pt", "encounter", {
        "icon-image": "mark-pair",
        // zoom must be the outermost interpolation: the bigger size for strong leads is repeated at each stop
        "icon-size": ["interpolate", ["linear"], ["zoom"],
          1, ["case", ["any", ["get", "dark"], ["get", "noLicence"]], 0.76, 0.62],
          4.5, ["case", ["any", ["get", "dark"], ["get", "noLicence"]], 1.15, 1],
          8, ["case", ["any", ["get", "dark"], ["get", "noLicence"]], 1.6, 1.4]],
      }, { paint: { "icon-color": ENCOUNTER, "icon-halo-color": PAPER, "icon-halo-width": 2.4 } });
      aisOffLayers();

      // apparent fishing inside marine protected areas: a red fishing hull (the no-take area itself is outlined in green)
      symbols("fishing-pt", "fishing", { "icon-image": "mark-fishing", "icon-size": markSize(1.1) },
              { paint: { "icon-color": FISHING, "icon-halo-color": PAPER, "icon-halo-width": 2.4 } });

      // Coordinated turn-on zones and markers
      m.addLayer({
        id: "turnon-zone-fill", type: "fill", source: "turnon-zones",
        paint: { "fill-color": TURNON, "fill-opacity": 0.12 },
      });
      m.addLayer({
        id: "turnon-zone-line", type: "line", source: "turnon-zones",
        paint: { "line-color": TURNON, "line-width": 2, "line-dasharray": [3, 2] },
      });
      m.addLayer({
        id: "turnon-halo", type: "circle", source: "turnons",
        paint: {
          "circle-color": "rgba(2, 132, 199, 0.22)",
          "circle-radius": ["interpolate", ["linear"], ["get", "count"], 2, 17, 8, 30],
        },
      });
      // a small fleet, larger the more ships were dark together
      symbols("turnon-pt", "turnons", { "icon-image": "fleet", "icon-size": ["interpolate", ["linear"], ["get", "count"], 2, 1.1, 8, 1.8] },
              { paint: { "icon-color": TURNON, "icon-halo-color": PAPER, "icon-halo-width": 2 } });

      m.addLayer({ id: "labels", type: "raster", source: "labels" });   // place names above data
      m.addLayer({
        id: "hull-fill", type: "fill", source: "hulls",
        paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "selected"], 0.28, 0.16] },
      });
      m.addLayer({
        id: "hull-line", type: "line", source: "hulls",
        // dashed edge: the chart convention for a caution area
        paint: { "line-color": ["case", ["get", "selected"], INK, ["get", "color"]],
                 "line-width": ["case", ["get", "selected"], 2.5, 1.75], "line-dasharray": [3, 2] },
      });
      // The open ship. Lines thicken as you zoom in, and run from pale (start of the period) to dark (latest position):
      // blue to ink where it was recorded, dashed pink to deep magenta where it sailed unseen.
      const width = (k: number): maplibregl.ExpressionSpecification =>
        ["interpolate", ["exponential", 1.4], ["zoom"], 1, 1.1 * k, 4, 2.1 * k, 8, 4.5 * k, 12, 8 * k];
      const ramp = (c: readonly string[]): maplibregl.ExpressionSpecification =>
        ["interpolate", ["linear"], ["get", "t"], 0, c[0], 0.5, c[1], 1, c[2]];
      const round = { "line-cap": "round", "line-join": "round" } as const;
      const casingWidth: maplibregl.ExpressionSpecification = ["interpolate", ["exponential", 1.4], ["zoom"], 1, 2.6, 4, 4.6, 8, 8, 12, 12.5];
      // The whole path is one line whose colour runs continuously along its length, so the direction of travel reads
      // even when the ship has only a few recorded events (a per-stretch colour looked flat then).
      m.addSource("track-path", { type: "geojson", data: empty, lineMetrics: true });
      m.addLayer({ id: "track-casing", type: "line", source: "track-path", layout: round,
                   paint: { "line-color": PAPER, "line-opacity": 0.95, "line-width": casingWidth } });
      m.addLayer({ id: "track-seen", type: "line", source: "track-path", layout: round,
                   paint: { "line-gradient": ["interpolate", ["linear"], ["line-progress"],
                                              0, TRACK_RAMP.seen[0], 0.5, TRACK_RAMP.seen[1], 1, TRACK_RAMP.seen[2]],
                            "line-width": width(1) } });
      // stretches sailed unseen: the solid gradient is wiped there and redrawn dashed, pink to deep magenta
      m.addLayer({ id: "track-unseen-gap", type: "line", source: "track-line", filter: ["get", "dark"],
                   paint: { "line-color": PAPER, "line-width": casingWidth } });
      m.addLayer({ id: "track-dark", type: "line", source: "track-line", filter: ["get", "dark"],
                   paint: { "line-color": ramp(TRACK_RAMP.dark), "line-width": width(1.05), "line-dasharray": [1.5, 1.5] } });
      const dot = (k: number): maplibregl.ExpressionSpecification =>
        ["*", k, ["match", ["get", "kind"], "gap_off", 6.5, "gap_on", 4.5, "port_visit", 5, 2.75]];
      m.addLayer({
        id: "track-pt", type: "circle", source: "track-pt", filter: ["!", ["in", ["get", "kind"], ["literal", ["gap_off", "port_visit"]]]],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, dot(0.45), 5, dot(0.9), 9, dot(1.5)],
          "circle-color": ["match", ["get", "kind"], "gap_off", PAPER, "gap_on", MAGENTA, "port_visit", INK, "fishing", FISHING, PAPER],
          "circle-stroke-color": ["match", ["get", "kind"], "gap_off", MAGENTA, "gap_on", PAPER, INK],
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 1, ["match", ["get", "kind"], "gap_off", 1.5, 0.75],
                                  6, ["match", ["get", "kind"], "gap_off", 2.5, 1.25]],
        },
      });
      // where the open ship went dark (an empty hull, heading the way it sailed unseen) and where it called at port (an anchor)
      symbols("track-ghost", "track-pt", { "icon-image": ["get", "mark"], "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.8, 5, 1.2, 9, 1.7],
                                           "icon-rotate": ["get", "bearing"], "icon-rotation-alignment": "map" },
              { filter: ["==", ["get", "kind"], "gap_off"], paint: { "icon-color": "#ffffff", "icon-halo-color": MAGENTA, "icon-halo-width": 2.4 } });
      symbols("track-port", "track-pt", { "icon-image": "anchor", "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.75, 5, 1.15, 9, 1.75] },
              { filter: ["==", ["get", "kind"], "port_visit"], paint: { "icon-color": INK, "icon-halo-color": PAPER, "icon-halo-width": 2.4 } });
      // where its path starts: an open ring. Where it was last seen is the ship itself, a 3D model placed over the map.
      m.addSource("track-ends", { type: "geojson", data: empty });
      m.addLayer({
        id: "track-ends", type: "circle", source: "track-ends",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 5, 6, 8, 10, 11],
          "circle-color": PAPER, "circle-stroke-color": TRACK_RAMP.seen[1], "circle-stroke-width": 3,
        },
      });
      m.addLayer({ id: "slick-link-line", type: "line", source: "slick-link", filter: ["==", ["geometry-type"], "LineString"],
                   paint: { "line-color": SLICK, "line-width": 2.5, "line-dasharray": [2, 1.5] } });
      m.addLayer({ id: "slick-link-pt", type: "circle", source: "slick-link", filter: ["==", ["geometry-type"], "Point"],
                   paint: { "circle-color": SLICK, "circle-opacity": 0.85, "circle-stroke-color": PAPER, "circle-stroke-width": 2,
                            "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 6, 8, 12] } });
      // sights on whatever is open in the drawer
      symbols("picked", "picked", { "icon-image": "reticle", "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 1.5, 7, 2.6, 10, 3.4] },
              { paint: { "icon-color": INK, "icon-halo-color": PAPER, "icon-halo-width": 2 } });
      for (const layer of ["infra-pt"]) {
        m.on("mouseenter", layer, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", layer, () => { m.getCanvas().style.cursor = ""; });
      }
      // Pointing at a record names it: who, what and when, without opening the case file.
      const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "hover-tip", offset: 18, maxWidth: "360px" });
      const tipBody = document.createElement("div"), tipArt = document.createElement("div"), tipWords = document.createElement("div");
      const tipTitle = document.createElement("strong"), tipText = document.createElement("span");
      tipArt.className = "tip-art"; tipWords.className = "tip-words";
      tipWords.append(tipTitle, tipText);
      tipBody.append(tipArt, tipWords);
      tip.setDOMContent(tipBody);
      let tipFor: string | null = null;
      tipApi.current = {
        show(key, at, title, text, art) {
          if (key === tipFor) return;
          tipFor = key;
          tipTitle.textContent = title; tipText.textContent = text;
          // a ship is shown as its 3D model, turned the way it was heading; anything else as its chart symbol
          if (art.ship) tipArt.innerHTML = shipSvg({ ...art.ship, plate: undefined });
          else tipArt.replaceChildren(...(art.icon && art.icon in ICONS ? [iconSvg(art.icon as IconName, 48)] : []));
          tipArt.hidden = !tipArt.firstChild;
          tipArt.dataset.wide = String(!!art.ship?.consort);
          tip.setLngLat(at).addTo(m);
        },
        hide() { tipFor = null; tip.remove(); },
      };
      for (const [layer] of POINT_LAYERS) {
        m.on("mousemove", layer, (e) => {
          m.getCanvas().style.cursor = "pointer";
          const f = e.features?.[0], props = f?.properties as { id?: string; tip?: string; tipText?: string; tipIcon?: string; tipShip?: string } | undefined;
          if (!f || !props?.tip) return;
          const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
          let ship: ShipOptions | undefined;
          if (props.tipShip) { ship = JSON.parse(props.tipShip) as ShipOptions; if (layer === "aisoff-pt") ship.heading = turn15(Number((f.properties as { bearing?: number }).bearing ?? 0)); }
          const fresh = tipFor !== `${layer}:${props.id}`;
          tipApi.current?.show(`${layer}:${props.id}`, [unwrapLon(lon, e.lngLat.lng), lat], props.tip, props.tipText ?? "", { ship, icon: props.tipIcon });
          if (fresh && layer === "aisoff-pt") { wake.current.hover = wakeOf(aisByIdRef.current.get(String(props.id))); drawWake(); }
        });
        m.on("mouseleave", layer, () => {
          m.getCanvas().style.cursor = ""; tipApi.current?.hide();
          if (wake.current.hover.length) { wake.current.hover = []; drawWake(); }
        });
      }
      // Pointing at a no-take area says what the rule is and what happened there. Records drawn on top keep their own card.
      const areaTip = (e: maplibregl.MapMouseEvent) => {
        const hit = m.queryRenderedFeatures(e.point, { layers: ["notake-fill"] })[0];
        const onRecord = m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]],
          { layers: POINT_LAYERS.map(([l]) => l).filter((l) => m.getLayoutProperty(l, "visibility") !== "none") }).length;
        if (!hit || onRecord) return;
        const p = hit.properties as Record<string, unknown>;
        const id = String(p.SITE_PID), a = noTakeRef.current.get(id);
        const full = a ? a.full : !!noTakeIdsRef.current.full.includes(id);
        tipApi.current?.show(`mpa:${id}`, [e.lngLat.lng, e.lngLat.lat], `${p.NAME ?? "Marine protected area"}`, noTakeWords(full, a, p.DESIG), {});
      };
      m.on("mousemove", "notake-fill", areaTip);
      m.on("mouseleave", "notake-fill", () => tipApi.current?.hide());
      m.on("mouseenter", "turnon-zone-fill", () => {
        m.getCanvas().style.cursor = "pointer";
      });
      m.on("mouseleave", "turnon-zone-fill", () => {
        m.getCanvas().style.cursor = "";
      });
      const box = (e: maplibregl.MapMouseEvent): [maplibregl.PointLike, maplibregl.PointLike] =>
        [[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]];
      const say = (e: maplibregl.MapMouseEvent, text: string) => {
        popup.current?.remove();
        popup.current = new maplibregl.Popup({ closeButton: true, maxWidth: "260px" }).setLngLat(e.lngLat).setText(text).addTo(m);
      };
      m.on("click", (e) => {
        popup.current?.remove();
        for (const [layer, kind] of POINT_LAYERS) {
          if (m.getLayoutProperty(layer, "visibility") === "none") continue;
          const hit = m.queryRenderedFeatures([[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]], { layers: [layer] })[0];
          if (hit) return onSelectRef.current({ kind, id: String((hit.properties as { id: string }).id) });
        }
        const hull = hullsRef.current.find((c) => pointInRing([e.lngLat.lng, e.lngLat.lat], c.ring));
        if (hull) return onSelectRef.current({ kind: "event", id: hull.id });

        if (m.getLayoutProperty("turnon-zone-fill", "visibility") !== "none") {
          const hitTurnOn = m.queryRenderedFeatures([[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]], { layers: ["turnon-zone-fill"] })[0];
          if (hitTurnOn) {
            return onSelectRef.current({ kind: "turnOn", id: String((hitTurnOn.properties as { id: string }).id) });
          }
        }

        if (m.getLayoutProperty("infra-pt", "visibility") !== "none") {
          const p = m.queryRenderedFeatures(box(e), { layers: ["infra-pt"] })[0]?.properties as Record<string, unknown> | undefined;
          if (p) {
            const since = yearOf(p.structure_start_date), gone = yearOf(p.structure_end_date);
            return say(e, `${INFRA_WORD[String(p.label)] ?? "Offshore structure, type not classified"}`
              + `${p.label_confidence ? ` (${p.label_confidence} confidence)` : ""}. Seen on satellite images`
              + `${since ? ` from ${since}` : ""}${gone ? ` to ${gone}` : ""}.`);
          }
        }

        if (m.getLayoutProperty("notake-fill", "visibility") !== "none") {
          const p = m.queryRenderedFeatures(box(e), { layers: ["notake-fill"] })[0]?.properties as Record<string, unknown> | undefined;
          if (p) {
            const id = String(p.SITE_PID), a = noTakeRef.current.get(id);
            const full = a ? a.full : noTakeIdsRef.current.full.includes(id);
            return say(e, `${p.NAME ?? "Marine protected area"}. ${noTakeWords(full, a, p.DESIG)} Boundary: Protected Planet (WDPA).`);
          }
        }

      });
      setReady(true);
    };
    // from far away the "Dark 9 Jul" notes would pile up on a path a few pixels wide: they appear once you zoom in
    const markFar = () => { if (el.current) el.current.dataset.far = String(m.getZoom() < 4); };
    m.on("zoom", markFar);
    markFar();
    // 3D ships follow the view: placed when a move ends, and a few times a second while one is under way
    let lastSync = 0;
    m.on("move", () => { const now = performance.now(); if (now - lastSync > 220) { lastSync = now; syncShips.current(); } });
    m.on("moveend", () => syncShips.current());
    m.once("style.load", init);
    if ((m as unknown as { style?: { _loaded?: boolean } }).style?._loaded) init();
    if (import.meta.env.DEV) (window as unknown as { __gfxMap?: maplibregl.Map }).__gfxMap = m;   // debugging/e2e
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  // which no-take areas to outline
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const pid: maplibregl.ExpressionSpecification = ["to-string", ["get", "SITE_PID"]];
    const all = [...noTakeIds.full, ...noTakeIds.part];
    m.setFilter("notake-fill", ["in", pid, ["literal", all]]);
    m.setFilter("notake-hatch", ["in", pid, ["literal", noTakeIds.full]]);
    m.setFilter("notake-line", ["in", pid, ["literal", noTakeIds.full]]);
    m.setFilter("notake-line-part", ["in", pid, ["literal", noTakeIds.part]]);
    m.setPaintProperty("notake-fill", "fill-opacity", ["case", ["in", pid, ["literal", noTakeIds.full]], 0.1, 0.06]);
  }, [ready, noTakeIds]);

  // the official name of each labelled area, read from the WDPA tiles as they arrive
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !noTakeAreas.length) return;
    const want = new Set(noTakeAreas.map((a) => a.id));
    const read = () => {
      const found: Record<string, string> = {};
      for (const f of m.querySourceFeatures("mpa", { sourceLayer: "main" })) {
        const id = String(f.properties?.SITE_PID);
        if (want.has(id) && f.properties?.NAME) found[id] = String(f.properties.NAME);
      }
      setAreaNames((old) => Object.keys(found).some((k) => old[k] !== found[k]) ? { ...old, ...found } : old);
    };
    const onData = (e: maplibregl.MapSourceDataEvent) => { if (e.sourceId === "mpa" && e.isSourceLoaded) read(); };
    m.on("sourcedata", onData);
    read();
    return () => { m.off("sourcedata", onData); };
  }, [ready, noTakeAreas]);

  // data
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const set = (id: string, data: GeoJSON.FeatureCollection) => (m.getSource(id) as GeoJSONSource).setData(data);
    set("heat", heatGeo); set("aisoff", aisOffGeo); set("slick", slickGeo); set("fishing", fishingGeo);
    set("turnons", turnOnsGeo); set("turnon-zones", turnOnZonesGeo);
    set("encounter", encounterGeo); set("loiter", loiterGeo); set("closure", closureGeo); set("slick-link", linkGeo.geo);
    set("hulls", hullGeo); set("track-line", trackGeo.lines); set("track-path", trackGeo.path);
    // where the open ship went dark is marked with its own kind of hull
    const mark = markIcon(vesselClass(null, track?.identity.gear));
    set("track-pt", { type: "FeatureCollection", features: trackGeo.pts.features.map((f) => ({ ...f, properties: { ...f.properties, mark } })) });
    set("track-ends", { type: "FeatureCollection", features: trackGeo.start
      ? [{ type: "Feature", geometry: { type: "Point", coordinates: trackGeo.start.at }, properties: { end: "start" } }] : [] });
  }, [ready, heatGeo, aisOffGeo, slickGeo, fishingGeo, turnOnsGeo, turnOnZonesGeo, hullGeo, trackGeo, track,
      encounterGeo, loiterGeo, closureGeo, linkGeo]);

  // the unseen stretch of the AIS-off record open in the drawer
  useEffect(() => {
    if (!ready) return;
    wake.current.open = selection?.kind === "aisOff" ? wakeOf(aisById.get(selection.id)) : [];
    drawWake();
  }, [ready, selection, aisById]);

  // while one ship's path is open, every other record steps back
  const tracking = !!track;
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    for (const [layer, prop, rest] of FADE) m.setPaintProperty(layer, prop, tracking ? rest * 0.28 : rest);
  }, [ready, tracking]);

  // ---------- ships in view, as 3D models ----------
  // Every ship record the visible layers hold, with the model that draws it. The models are real vector drawings placed
  // over the map, so they are sharp on any screen; only those in view and nearest the middle are placed, up to MAX_SHIPS.
  const nearShips = useMemo<NearShip[]>(() => {
    const from = (geo: GeoJSON.FeatureCollection, layer: string, kind: NonNullable<Selection>["kind"], on: boolean): NearShip[] => (!on ? [] : geo.features.map((ft) => {
      const p = ft.properties as { id: string; tip: string; tipText: string; tipShip: string; bearing?: number };
      const [lon, lat] = (ft.geometry as GeoJSON.Point).coordinates;
      const ship = JSON.parse(p.tipShip) as ShipOptions;
      if (p.bearing != null) ship.heading = turn15(p.bearing);
      return { key: `${kind}:${p.id}`, layer, sel: { kind, id: p.id }, lon, lat, ship, tip: p.tip, tipText: p.tipText };
    }));
    return [...from(fishingGeo, "fishing-pt", "fishing", visible.fishing), ...from(aisOffGeo, "aisoff-pt", "aisOff", visible.aisOff),
            ...from(encounterGeo, "encounter-pt", "encounter", visible.encounters), ...from(loiterGeo, "loiter-pt", "loitering", visible.loitering)];
  }, [fishingGeo, aisOffGeo, encounterGeo, loiterGeo, visible.fishing, visible.aisOff, visible.encounters, visible.loitering]);
  const nearRef = useRef(nearShips);
  nearRef.current = nearShips;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const hiddenMarks = useRef<Record<string, string>>({});
  /** Place a model for each ship in view (when close enough), remove the ones that left, and hide the marks they replace. */
  const syncShips = useRef(() => {});
  syncShips.current = () => {
    const m = map.current;
    if (!m || !m.getLayer("aisoff-pt")) return;
    const zoom = m.getZoom();
    el.current?.style.setProperty("--ship-k", shipScale(zoom).toFixed(3));
    let want: NearShip[] = [];
    if (zoom >= NEAR_ZOOM) {
      const c = m.getCenter(), b = m.getBounds();
      const halfLon = Math.min(180, ((b.getEast() - b.getWest()) / 2) * 1.08), padLat = (b.getNorth() - b.getSouth()) * 0.06;
      const east = (s: NearShip) => unwrapLon(s.lon, c.lng) - c.lng;
      const seen = nearRef.current.filter((s) => s.lat >= b.getSouth() - padLat && s.lat <= b.getNorth() + padLat && Math.abs(east(s)) <= halfLon);
      const shrink = Math.cos((c.lat * Math.PI) / 180);
      want = seen.length <= MAX_SHIPS ? seen
        : seen.map((s) => ({ s, d: (east(s) * shrink) ** 2 + (s.lat - c.lat) ** 2 })).sort((a, z) => a.d - z.d).slice(0, MAX_SHIPS).map((x) => x.s);
    }
    const keep = new Set(want.map((s) => s.key));
    for (const [key, placed] of shipMarkers.current) if (!keep.has(key)) { placed.marker.remove(); shipMarkers.current.delete(key); }
    const open = selectionRef.current ? `${selectionRef.current.kind}:${selectionRef.current.id}` : null;
    for (const s of want) {
      let placed = shipMarkers.current.get(s.key);
      if (!placed) {
        const btn = document.createElement("button");
        btn.type = "button"; btn.className = "ship3d"; btn.tabIndex = -1;   // every record is also listed, and reachable by keyboard, in the rail
        btn.style.setProperty("--w", String(Math.round(2 * shipRadius(s.ship.kind, s.ship.consort) * SHIP_PX)));
        btn.style.zIndex = String(Math.round((90 - s.lat) * 60));           // a ship further south stands in front of one further north
        btn.innerHTML = shipSvg(s.ship);
        btn.setAttribute("aria-label", `${s.tip}. ${s.tipText} Open details.`);
        btn.addEventListener("click", (ev) => { ev.stopPropagation(); onSelectRef.current(s.sel); });
        btn.addEventListener("mouseenter", () => {
          const here = map.current?.getCenter().lng ?? s.lon;
          tipApi.current?.show(s.key, [unwrapLon(s.lon, here), s.lat], s.tip, s.tipText, { ship: s.ship });
          if (s.sel.kind === "aisOff") { wake.current.hover = wakeOf(aisByIdRef.current.get(s.sel.id)); drawWake(); }
        });
        btn.addEventListener("mouseleave", () => {
          tipApi.current?.hide();
          if (wake.current.hover.length) { wake.current.hover = []; drawWake(); }
        });
        placed = { el: btn, marker: new maplibregl.Marker({ element: btn, anchor: "center" }).setLngLat([s.lon, s.lat]).addTo(m) };
        shipMarkers.current.set(s.key, placed);
      }
      if (s.key === open) placed.el.setAttribute("aria-current", "true"); else placed.el.removeAttribute("aria-current");
    }
    // a ship drawn as a model does not also need its mark
    for (const layer of ["fishing-pt", "aisoff-pt", "encounter-pt", "loiter-pt"]) {
      const ids = want.filter((s) => s.layer === layer).map((s) => s.sel.id), sig = ids.join(",");
      if (hiddenMarks.current[layer] === sig) continue;
      hiddenMarks.current[layer] = sig;
      m.setFilter(layer, ids.length ? ["!", ["in", ["get", "id"], ["literal", ids]]] : null);
    }
  };
  useEffect(() => { if (ready) syncShips.current(); }, [ready, nearShips, selection]);
  useEffect(() => { if (el.current) el.current.dataset.tracking = String(tracking); }, [tracking]);

  // the open ship itself, where it was last seen, heading the way it last sailed
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !track || !trackGeo.latest) return;
    const kind = shapeOf(vesselClass(null, track.identity.gear));
    const art = document.createElement("div");
    art.className = "ship3d ship3d-own";
    art.style.setProperty("--w", String(Math.round(2 * shipRadius(kind) * SHIP_PX * 1.3)));
    art.innerHTML = shipSvg({ kind, heading: turn15(trackGeo.latest.bearing) });
    ownShip.current = new maplibregl.Marker({ element: art, anchor: "center" }).setLngLat(trackGeo.latest.at).addTo(m);
    return () => { ownShip.current?.remove(); ownShip.current = null; };
  }, [ready, track, trackGeo]);

  // dated image layers follow the chosen period
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource("lanes") as RasterTileSource).setTiles([api.laneTiles(lanesMonth ?? undefined)]);
  }, [ready, lanesMonth]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource("night") as RasterTileSource).setTiles([nightTiles(nightDay)]);
    (m.getSource("chl") as RasterTileSource).setTiles([chlTiles(chlDay)]);
  }, [ready, nightDay, chlDay]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource("effort") as RasterTileSource).setTiles([api.effortTiles(period.start, period.end)]);
  }, [ready, period.start, period.end]);

  // frame the open ship's whole path
  const trackKey = track ? `${track.identity.vesselId}:${track.start}:${track.end}:${slickLink?.id ?? ""}` : null;
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !trackGeo.coords.length) return;
    const all = linkGeo.at ? [...trackGeo.coords, linkGeo.at] : trackGeo.coords;   // keep the linked slick in view too
    const lons = all.map((c) => c[0]), lats = all.map((c) => c[1]);
    m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: { top: 70, bottom: 130, left: 60, right: 60 }, maxZoom: 8, duration: 900 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, trackKey]);

  // visibility
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const show = (layer: string, on: boolean) => m.setLayoutProperty(layer, "visibility", on ? "visible" : "none");
    show("night", visible.nightLights); show("chl", visible.chlorophyll); show("lanes", visible.lanes);
    show("heat", visible.hotspots); show("slick-pt", visible.slicks);
    show("aisoff-pt", visible.aisOff); show("aisoff-wake", visible.aisOff); show("aisoff-wake-pt", visible.aisOff);
    show("fishing-pt", visible.fishing);
    for (const id of ["notake-fill", "notake-hatch", "notake-line", "notake-line-part"]) show(id, (visible.aisOff || visible.fishing) && showNoTakeAreas);
    show("turnon-pt", visible.turnOns);
    show("turnon-halo", visible.turnOns);
    show("turnon-zone-fill", visible.turnOns);
    show("turnon-zone-line", visible.turnOns);
    show("hull-fill", visible.changes); show("hull-line", visible.changes);
    show("effort", visible.effort); show("eez-line", visible.borders);
    show("infra-pt", visible.infra); show("encounter-pt", visible.encounters); show("encounter-ring", visible.encounters);
    show("loiter-pt", visible.loitering);
    show("closure-pt", visible.closures);
  }, [ready, visible, showNoTakeAreas]);

  // ring around the open record
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const ringed = focus && selection && selection.kind !== "event" && selection.kind !== "cell" && selection.kind !== "vessel";
    (m.getSource("picked") as GeoJSONSource).setData(ringed ? points([focus], () => ({})) : empty);
  }, [ready, focus, selection]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !focus) return;
    m.easeTo({ center: [focus.lon, focus.lat], zoom: Math.max(m.getZoom(), 4.2), duration: 900 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focus?.key]);

  // Labels are real buttons: keyboard-focusable, screen-reader friendly, clickable.
  useEffect(() => {
    const m = map.current;
    labelMarkers.current.forEach((mk) => mk.remove());
    labelMarkers.current = [];
    if (!ready || !m) return;
    const add = (btn: HTMLButtonElement, at: [number, number], sel: Selection) => {
      btn.type = "button";
      btn.className = "cluster-label";
      btn.addEventListener("click", (ev) => { ev.stopPropagation(); onSelectRef.current(sel); });
      labelMarkers.current.push(new maplibregl.Marker({ element: btn, anchor: "center" }).setLngLat(at).addTo(m));
    };
    if (visible.changes) {
      for (const c of hulls) {
        const e = c.event, btn = document.createElement("button");
        btn.dataset.dir = e.direction;
        if (e.eventId === selectedEventId) btn.setAttribute("aria-current", "true");
        btn.setAttribute("aria-label", `${e.eventId}: ${directionWord(e.direction).toLowerCase()} ${formatPct(e.pctPerYear)}, ${e.cellIds.length} area(s). Open event.`);
        btn.textContent = `${directionGlyph(e.direction)} ${formatPct(e.pctPerYear)}`;
        add(btn, c.anchor, { kind: "event", id: e.eventId });
      }
    }
    if (visible.hotspots) {
      for (const h of aisOff?.hotspots ?? []) {
        const btn = document.createElement("button");
        btn.dataset.kind = "hotspot";
        if (selection?.kind === "hotspot" && selection.id === h.id) btn.setAttribute("aria-current", "true");
        btn.setAttribute("aria-label", `${h.count} vessels went dark near ${h.place}. Open details.`);
        btn.textContent = `${h.count} went dark`;
        add(btn, [h.lon, h.lat], { kind: "hotspot", id: h.id });
      }
    }
    if (visible.turnOns) {
      for (const t of aisOff?.turnOnClusters ?? []) {
        const btn = document.createElement("button");
        btn.dataset.kind = "turnOn";
        if (selection?.kind === "turnOn" && selection.id === t.id) btn.setAttribute("aria-current", "true");
        btn.setAttribute("aria-label", `${t.count} vessels operated dark together near ${t.place} from ${formatDateTime(t.coPresenceStart)} to ${formatDateTime(t.coPresenceEnd)}. Open details.`);
        btn.textContent = `${t.count} ships dark together, ${formatSpan(t.sharedHours)}`;
        add(btn, [t.exitLon ?? t.lon, t.exitLat ?? t.lat], { kind: "turnOn", id: t.id });
      }
    }
    if (visible.fishing && showNoTakeAreas) {
      for (const a of noTakeAreas) {
        const btn = document.createElement("button");
        btn.className = "zone-label";
        btn.dataset.full = String(a.full);
        const rule = document.createElement("b"), name = document.createElement("span"), what = document.createElement("span");
        rule.textContent = a.full ? "No fishing" : "No fishing in part";
        name.className = "zone-name"; name.textContent = areaNames[a.id] ?? "";
        what.className = "zone-what"; what.textContent = `${a.vessels} ${a.vessels === 1 ? "vessel" : "vessels"} appeared to fish here`;
        btn.append(rule, name, what);
        btn.setAttribute("aria-label", `${areaNames[a.id] ?? "Protected area"}: ${a.full ? "all fishing banned" : "fishing banned in part of it"}. `
          + `${a.vessels} ${a.vessels === 1 ? "vessel" : "vessels"} appeared to fish here. Zoom in.`);
        btn.type = "button";
        btn.addEventListener("click", (ev) => { ev.stopPropagation(); m.easeTo({ center: [a.lon, a.lat], zoom: Math.max(m.getZoom() + 2, 6), duration: 800 }); });
        labelMarkers.current.push(new maplibregl.Marker({ element: btn, anchor: "bottom", offset: [0, -14] }).setLngLat([a.lon, a.lat]).addTo(m));
      }
    }
    // where and when the open ship went dark, written on the chart
    const offs = (track?.points ?? []).map((p, i) => ({ p, at: trackGeo.coords[i] })).filter((x) => x.p.kind === "gap_off");
    for (const { p, at } of offs.slice(-MAX_GAP_LABELS)) {
      const tag = document.createElement("span");
      tag.className = "gap-label";
      tag.textContent = `Dark ${formatDay(p.time).replace(/ \d{4}$/, "")}`;
      labelMarkers.current.push(new maplibregl.Marker({ element: tag, anchor: "bottom", offset: [0, -9] }).setLngLat(at).addTo(m));
    }
    if (linkGeo.at && slickLink) {   // name the linked slick: colour alone never carries meaning
      const tag = document.createElement("span");
      tag.className = "end-label";
      tag.textContent = `Oil slick ${formatDay(slickLink.time).replace(/ \d{4}$/, "")}`;
      labelMarkers.current.push(new maplibregl.Marker({ element: tag, anchor: "top", offset: [0, 14] }).setLngLat(linkGeo.at).addTo(m));
    }
    // and its two ends, in words: direction is never shown by colour alone
    const short = (iso: string) => formatDay(iso).replace(/ \d{4}$/, "");
    for (const [cls, text, e] of [["end-start", "Start", trackGeo.start], ["end-latest", "Last seen", trackGeo.latest]] as const) {
      if (!e) continue;
      const tag = document.createElement("span");
      tag.className = `end-label ${cls}`;
      tag.textContent = `${text} ${short(e.time)}`;
      // "Start" sits above its point and "Last seen" below, so both stay readable when a ship ends where it began
      const above = cls === "end-start";
      labelMarkers.current.push(new maplibregl.Marker({ element: tag, anchor: above ? "bottom" : "top", offset: [0, above ? -12 : 26] }).setLngLat(e.at).addTo(m));
    }
  }, [ready, hulls, aisOff, visible.changes, visible.hotspots, visible.turnOns, visible.fishing, showNoTakeAreas, noTakeAreas, areaNames, selectedEventId, selection, track, trackGeo, linkGeo, slickLink]);

  return (
    <>
      <div ref={el} className="map" role="region"
        aria-label="World map of activity at sea. Every layer is also listed, with its records, in the panel beside the map." />
      {basemapDown && <div className="map-overlay map-status" role="status">Basemap offline. Data layers are unaffected.</div>}
    </>
  );
}
