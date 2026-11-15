import maplibregl, { type GeoJSONSource, type RasterTileSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type {
  AisOffResponse, CellSummary, Closure, CoordinatedTurnOn, Encounter, EventSummary, Loitering, OilSlick, ProtectedFishingEvent, VesselResponse,
} from "../api/types";
import { directionGlyph, directionWord, formatDateTime, formatDay, formatPct } from "../lib/format";
import { chaikin, clusterShape, convexHull, pointInRing, scaleRing, type Pt } from "../lib/geometry";
import { gibsTiles, type LayerId, type Period, type Selection } from "../lib/layers";
import { TRACK_RAMP, trackFeatures } from "../lib/track";

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
  highlightIllegalZones?: boolean;
  noTakeOnly?: boolean;
  encounters: Encounter[];
  loitering: Loitering[];
  closures: Closure[];
  period: Period;                    // fishing-effort tiles follow it
  slickLink?: OilSlick | null;       // the slick the open ship is a candidate source of
}

const DIR_COLOR = { INCREASING: "#a3166f", DECREASING: "#2d6a9f", NONE: "#566676" } as const;   // chart magenta / shelf blue
const MAGENTA = "#a3166f", INK = "#13263b", PAPER = "#f3f6f5", SLICK = "#8a5a00", FISHING = "#a3271b", TURNON = "#0284c7";
const ENCOUNTER = "#c2410c", LOITER = "#0f766e", CLOSURE = "#6d28d9", BORDER = "#3d4f63";
const INFRA_COLOR = ["match", ["get", "label"], "oil", "#5a3e1b", "wind", "#1f6b4a", "#7a8794"] as maplibregl.ExpressionSpecification;
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

/** Build smooth highlighted polygon zones around clusters of unauthorized fishing in protected areas. */
function illegalFishingZones(events: ProtectedFishingEvent[], noTakeOnly = false, radiusDeg = 1.5): GeoJSON.FeatureCollection {
  const filtered = noTakeOnly ? events.filter((e) => e.fullNoTake) : events;
  if (!filtered.length) return empty;

  const groups = new Map<string, ProtectedFishingEvent[]>();
  for (let i = 0; i < filtered.length; i++) {
    const e = filtered[i];
    const key = e.place || `${Math.floor(e.lon / radiusDeg)},${Math.floor(e.lat / radiusDeg)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const features: GeoJSON.Feature[] = [];
  for (const [key, evs] of groups) {
    const lons = evs.map((e) => e.lon), lats = evs.map((e) => e.lat);
    const centerLon = lons.reduce((a, b) => a + b, 0) / lons.length;
    const centerLat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const totalHours = Math.round(evs.reduce((a, b) => a + (b.durationHours || 0), 0));
    const fullNoTake = evs.some((e) => e.fullNoTake);

    if (evs.length < 3) {
      const r = Math.max(0.6, Math.min(1.8, 0.4 + Math.log10(Math.max(evs.length, 1)) * 0.5));
      const ring: Pt[] = [];
      for (let a = 0; a < 24; a++) {
        const theta = (a / 24) * 2 * Math.PI;
        ring.push([centerLon + r * Math.cos(theta), centerLat + r * Math.sin(theta)]);
      }
      ring.push(ring[0]);
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { areaId: key, place: evs[0].place, count: evs.length, totalHours, fullNoTake },
      });
    } else {
      const bPts: Pt[] = evs.map((e) => [e.lon, e.lat]);
      const hull = convexHull(bPts);
      if (hull.length >= 4) {
        const expanded = scaleRing(hull, 1.25);
        const smooth = chaikin(expanded, 3);
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [smooth] },
          properties: { areaId: key, place: evs[0].place, count: evs.length, totalHours, fullNoTake },
        });
      }
    }
  }
  return { type: "FeatureCollection", features };
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

const POINT_LAYERS = [["fishing-pt", "fishing"], ["encounter-pt", "encounter"], ["closure-pt", "closure"], ["aisoff-pt", "aisOff"],
  ["turnon-pt", "turnOn"], ["loiter-pt", "loitering"], ["slick-pt", "slick"]] as const;

/** A GFW date property (epoch ms, epoch s, or ISO) -> "2019". */
function yearOf(v: unknown): string | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e11 ? n * 1000 : n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : String(d.getUTCFullYear());
}

export function MapView({ visible, aisOff, slicks, fishing, cells, events, selection, focus, onSelect,
                          lanesMonth, nightDay, chlDay, track, highlightIllegalZones = true, noTakeOnly = false,
                          encounters, loitering, closures, period, slickLink = null }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [basemapDown, setBasemapDown] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const hullsRef = useRef<{ id: string; ring: Pt[] }[]>([]);
  const labelMarkers = useRef<maplibregl.Marker[]>([]);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const initial = useRef({ lanesMonth, nightDay, chlDay, period });
  const popup = useRef<maplibregl.Popup | null>(null);
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

  const illegalZonesGeo = useMemo(() => illegalFishingZones(fishing, noTakeOnly), [fishing, noTakeOnly]);
  const filteredFishing = useMemo(() => noTakeOnly ? fishing.filter((f) => f.fullNoTake) : fishing, [fishing, noTakeOnly]);
  const fishingGeo = useMemo(() => points(filteredFishing, (f) => ({ id: f.id, fullNoTake: f.fullNoTake })), [filteredFishing]);

  const turnOnsGeo = useMemo(() =>
    points(aisOff?.turnOnClusters ?? [], (t) => ({ id: t.id, count: t.count, place: t.place, spanHours: t.spanHours, flags: t.topFlags.join(", ") })),
    [aisOff?.turnOnClusters]
  );
  const turnOnZonesGeo = useMemo(() => turnOnZones(aisOff?.turnOnClusters ?? []), [aisOff?.turnOnClusters]);

  const heatGeo = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: (aisOff?.heat ?? []).map(([lat, lon]) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: {} })),
  }), [aisOff]);
  const aisOffGeo = useMemo(() => points(aisOff?.events ?? [], (e) => ({ id: e.id, noTake: e.inNoTake })), [aisOff]);
  const slickGeo = useMemo(() => points(slicks, (s) => ({ id: s.id, area: s.areaKm2, ship: s.candidates[0]?.type === "VESSEL" })), [slicks]);
  const encounterGeo = useMemo(() => points(encounters, (e) => ({ id: e.id, dark: e.darkLink,
    noLicence: e.vessels.some((v) => v.authorisation === "NOT_FOUND") })), [encounters]);
  const loiterGeo = useMemo(() => points(loitering, (l) => ({ id: l.id, met: l.metVessel })), [loitering]);
  // each ban's spots for one year: the year open in the drawer, otherwise the latest one
  const closureGeo = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: closures.flatMap((c) => {
      const season = c.seasons.find((s) => selection?.kind === "closure" && s.id === selection.id) ?? c.seasons[c.seasons.length - 1];
      return season ? season.cells.map((x) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [x.lon, x.lat] },
                                                 properties: { id: season.id, hours: x.hours } })) : [];
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
      const bySize = (k: number): maplibregl.ExpressionSpecification =>
        ["interpolate", ["linear"], ["sqrt", ["get", "area"]], 2, 3 * k, 18, 9 * k];
      // NASA imagery and shipping lanes sit under everything else
      const first = initial.current;
      m.addSource("night", { type: "raster", tileSize: 256, maxzoom: 8, tiles: [nightTiles(first.nightDay)], attribution: "NASA GIBS (VIIRS, MODIS-Aqua)" });
      m.addSource("chl", { type: "raster", tileSize: 256, maxzoom: 7, tiles: [chlTiles(first.chlDay)] });
      m.addLayer({ id: "night", type: "raster", source: "night", layout: { visibility: "none" }, paint: { "raster-opacity": 0.9 } });
      m.addLayer({ id: "chl", type: "raster", source: "chl", layout: { visibility: "none" }, paint: { "raster-opacity": 0.85 } });
      // zoom 3 is the deepest lane tile asked for: deeper tiles are speckled with single ships and take ~10 s each
      m.addSource("lanes", { type: "raster", tileSize: 256, maxzoom: 3, tiles: [api.laneTiles(first.lanesMonth ?? undefined)], attribution: "Global Fishing Watch" });
      // lanes are a world-scale picture: they fade as you zoom in, where the coarse tiles would turn into grey blocks
      m.addLayer({ id: "lanes", type: "raster", source: "lanes",
                   paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 3.5, 0.7, 6.5, 0.2] } });
      m.addSource("effort", { type: "raster", tileSize: 256, maxzoom: 6, tiles: [api.effortTiles(first.period.start, first.period.end)],
                              attribution: "Global Fishing Watch" });
      m.addLayer({ id: "effort", type: "raster", source: "effort", layout: { visibility: "none" }, paint: { "raster-opacity": 0.85 } });
      // sea borders: EEZ polygons, drawn as a dashed edge only (no click popup)
      m.addSource("eez", { type: "vector", tiles: [api.contextTiles("eez")], maxzoom: 9, attribution: "Marine Regions (VLIZ)" });
      m.addLayer({ id: "eez-line", type: "line", source: "eez", "source-layer": "main",
                   paint: { "line-color": BORDER, "line-opacity": 0.75, "line-dasharray": [3, 2],
                            "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 6, 1.4] } });
      m.addSource("infra", { type: "vector", tiles: [api.contextTiles("infra")], minzoom: 3, maxzoom: 9, attribution: "Global Fishing Watch" });
      m.addLayer({ id: "infra-pt", type: "circle", source: "infra", "source-layer": "main", minzoom: 3, layout: { visibility: "none" },
                   paint: { "circle-color": INFRA_COLOR, "circle-stroke-color": PAPER, "circle-stroke-width": 0.75,
                            "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 1.8, 8, 5] } });

      for (const id of ["heat", "slick", "aisoff", "fishing", "illegal-zones", "turnons", "turnon-zones", "hulls", "picked", "track-line", "track-pt",
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
      m.addLayer({   // possible oil slicks: translucent brown, sized by area
        id: "slick-pt", type: "circle", source: "slick",
        // an ink edge when Cerulean matched a ship on AIS as the best candidate source
        paint: { "circle-color": SLICK, "circle-opacity": 0.8, "circle-stroke-color": ["case", ["get", "ship"], INK, PAPER],
                 "circle-stroke-width": ["case", ["get", "ship"], 2, 1],
                 // zoom must be the outermost interpolation, so the size-by-area ramp is repeated at both zoom stops
                 "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, bySize(1), 7, bySize(2.6)] },
      });
      m.addLayer({   // AIS switched off: an open ring, "a light that went out"
        id: "aisoff-pt", type: "circle", source: "aisoff",
        paint: { "circle-color": PAPER, "circle-opacity": 0.9, "circle-stroke-color": MAGENTA,
                 "circle-stroke-width": zoomScale(1.25, 2.25), "circle-radius": zoomScale(2.4, 6.5) },
      });

      m.addLayer({   // fishing during a seasonal ban: violet discs sized by hours
        id: "closure-pt", type: "circle", source: "closure",
        paint: { "circle-color": CLOSURE, "circle-opacity": 0.75, "circle-stroke-color": PAPER, "circle-stroke-width": 0.75,
                 "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "hours"]], 1, 2.5, 30, 11] },
      });
      m.addLayer({   // carriers waiting offshore: teal ring, solid when it met a vessel
        id: "loiter-pt", type: "circle", source: "loiter",
        paint: { "circle-color": ["case", ["get", "met"], LOITER, PAPER], "circle-stroke-color": LOITER, "circle-stroke-width": 2,
                 "circle-radius": zoomScale(3, 7) },
      });
      m.addLayer({   // meetings at sea: burnt orange; a magenta ring when AIS went off nearby
        id: "encounter-pt", type: "circle", source: "encounter",
        paint: { "circle-color": ENCOUNTER, "circle-stroke-color": ["case", ["get", "dark"], MAGENTA, PAPER],
                 "circle-stroke-width": ["case", ["get", "dark"], 3, 1.25],
                 // zoom must be the outermost interpolation: the bigger size for strong leads is repeated at each stop
                 "circle-radius": ["interpolate", ["linear"], ["zoom"],
                   1, ["case", ["any", ["get", "dark"], ["get", "noLicence"]], 4.5, 3.5],
                   7, ["case", ["any", ["get", "dark"], ["get", "noLicence"]], 10.5, 8]] },
      });

      // Illegal fishing highlighted zones
      m.addLayer({
        id: "illegal-zone-fill", type: "fill", source: "illegal-zones",
        paint: { "fill-color": FISHING, "fill-opacity": 0.18 },
      });
      m.addLayer({
        id: "illegal-zone-line", type: "line", source: "illegal-zones",
        paint: { "line-color": FISHING, "line-width": 2, "line-dasharray": [4, 2] },
      });
      m.addLayer({   // apparent fishing inside marine protected areas: solid red with an ink edge
        id: "fishing-pt", type: "circle", source: "fishing",
        paint: { "circle-color": FISHING, "circle-stroke-color": PAPER, "circle-stroke-width": 1.5, "circle-radius": zoomScale(4, 8) },
      });

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
          "circle-radius": ["interpolate", ["linear"], ["get", "count"], 2, 10, 8, 22],
        },
      });
      m.addLayer({
        id: "turnon-pt", type: "circle", source: "turnons",
        paint: {
          "circle-color": TURNON, "circle-stroke-color": PAPER, "circle-stroke-width": 2,
          "circle-radius": ["interpolate", ["linear"], ["get", "count"], 2, 5.5, 8, 12],
        },
      });

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
      m.addLayer({ id: "track-casing", type: "line", source: "track-line", filter: ["!", ["get", "dark"]], layout: round,
                   paint: { "line-color": PAPER, "line-opacity": 0.95,
                            "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 1, 2.6, 4, 4.6, 8, 8, 12, 12.5] } });
      m.addLayer({ id: "track-seen", type: "line", source: "track-line", filter: ["!", ["get", "dark"]], layout: round,
                   paint: { "line-color": ramp(TRACK_RAMP.seen), "line-width": width(1) } });
      m.addLayer({ id: "track-dark", type: "line", source: "track-line", filter: ["get", "dark"],
                   paint: { "line-color": ramp(TRACK_RAMP.dark), "line-width": width(1.05), "line-dasharray": [1.5, 1.5] } });
      const dot = (k: number): maplibregl.ExpressionSpecification =>
        ["*", k, ["match", ["get", "kind"], "gap_off", 6.5, "gap_on", 4.5, "port_visit", 5, 2.75]];
      m.addLayer({
        id: "track-pt", type: "circle", source: "track-pt",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, dot(0.45), 5, dot(0.9), 9, dot(1.5)],
          "circle-color": ["match", ["get", "kind"], "gap_off", PAPER, "gap_on", MAGENTA, "port_visit", INK, "fishing", FISHING, PAPER],
          "circle-stroke-color": ["match", ["get", "kind"], "gap_off", MAGENTA, "gap_on", PAPER, INK],
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 1, ["match", ["get", "kind"], "gap_off", 1.5, 0.75],
                                  6, ["match", ["get", "kind"], "gap_off", 2.5, 1.25]],
        },
      });
      // the two ends of the path, drawn over everything: an open ring where it started, a solid ink disc where it was last seen
      m.addSource("track-ends", { type: "geojson", data: empty });
      m.addLayer({
        id: "track-ends", type: "circle", source: "track-ends",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 5, 6, 8, 10, 11],
          "circle-color": ["match", ["get", "end"], "latest", INK, PAPER],
          "circle-stroke-color": ["match", ["get", "end"], "latest", PAPER, TRACK_RAMP.seen[1]],
          "circle-stroke-width": ["match", ["get", "end"], "latest", 2.5, 3],
        },
      });
      m.addLayer({ id: "slick-link-line", type: "line", source: "slick-link", filter: ["==", ["geometry-type"], "LineString"],
                   paint: { "line-color": SLICK, "line-width": 2.5, "line-dasharray": [2, 1.5] } });
      m.addLayer({ id: "slick-link-pt", type: "circle", source: "slick-link", filter: ["==", ["geometry-type"], "Point"],
                   paint: { "circle-color": SLICK, "circle-opacity": 0.85, "circle-stroke-color": PAPER, "circle-stroke-width": 2,
                            "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 6, 8, 12] } });
      m.addLayer({   // ring around whatever is open in the drawer
        id: "picked", type: "circle", source: "picked",
        paint: { "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": INK, "circle-stroke-width": 2.5, "circle-radius": zoomScale(11, 16) },
      });
      for (const layer of ["infra-pt"]) {
        m.on("mouseenter", layer, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", layer, () => { m.getCanvas().style.cursor = ""; });
      }
      for (const [layer] of POINT_LAYERS) {
        m.on("mouseenter", layer, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", layer, () => { m.getCanvas().style.cursor = ""; });
      }
      m.on("mouseenter", "illegal-zone-fill", () => {
        m.getCanvas().style.cursor = "pointer";
      });
      m.on("mouseleave", "illegal-zone-fill", () => {
        m.getCanvas().style.cursor = "";
      });
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

        if (m.getLayoutProperty("illegal-zone-fill", "visibility") !== "none") {
          const hitZone = m.queryRenderedFeatures([[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]], { layers: ["illegal-zone-fill"] })[0];
          if (hitZone) {
            m.easeTo({ center: [e.lngLat.lng, e.lngLat.lat], zoom: Math.max(m.getZoom(), 5.5), duration: 800 });
            return;
          }
        }
      });
      setReady(true);
    };
    // from far away the "Dark 9 Jul" notes would pile up on a path a few pixels wide: they appear once you zoom in
    const markFar = () => { if (el.current) el.current.dataset.far = String(m.getZoom() < 4); };
    m.on("zoom", markFar);
    markFar();
    m.once("style.load", init);
    if ((m as unknown as { style?: { _loaded?: boolean } }).style?._loaded) init();
    if (import.meta.env.DEV) (window as unknown as { __gfxMap?: maplibregl.Map }).__gfxMap = m;   // debugging/e2e
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  // data
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const set = (id: string, data: GeoJSON.FeatureCollection) => (m.getSource(id) as GeoJSONSource).setData(data);
    set("heat", heatGeo); set("aisoff", aisOffGeo); set("slick", slickGeo); set("fishing", fishingGeo);
    set("illegal-zones", illegalZonesGeo); set("turnons", turnOnsGeo); set("turnon-zones", turnOnZonesGeo);
    set("encounter", encounterGeo); set("loiter", loiterGeo); set("closure", closureGeo); set("slick-link", linkGeo.geo);
    set("hulls", hullGeo); set("track-line", trackGeo.lines); set("track-pt", trackGeo.pts);
    set("track-ends", {
      type: "FeatureCollection",
      features: ([["start", trackGeo.start], ["latest", trackGeo.latest]] as const).flatMap(([end, e]) => (e
        ? [{ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: e.at }, properties: { end } }] : [])),
    });
  }, [ready, heatGeo, aisOffGeo, slickGeo, fishingGeo, illegalZonesGeo, turnOnsGeo, turnOnZonesGeo, hullGeo, trackGeo,
      encounterGeo, loiterGeo, closureGeo, linkGeo]);

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
    show("heat", visible.hotspots); show("slick-pt", visible.slicks); show("aisoff-pt", visible.aisOff);
    show("fishing-pt", visible.fishing);
    show("illegal-zone-fill", visible.fishing && highlightIllegalZones);
    show("illegal-zone-line", visible.fishing && highlightIllegalZones);
    show("turnon-pt", visible.turnOns);
    show("turnon-halo", visible.turnOns);
    show("turnon-zone-fill", visible.turnOns);
    show("turnon-zone-line", visible.turnOns);
    show("hull-fill", visible.changes); show("hull-line", visible.changes);
    show("effort", visible.effort); show("eez-line", visible.borders);
    show("infra-pt", visible.infra); show("encounter-pt", visible.encounters); show("loiter-pt", visible.loitering);
    show("closure-pt", visible.closures);
  }, [ready, visible, highlightIllegalZones]);

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
        btn.textContent = `⚡ ${t.count} ships (${t.sharedHours}h dark together)`;
        add(btn, [t.exitLon ?? t.lon, t.exitLat ?? t.lat], { kind: "turnOn", id: t.id });
      }
    }
    if (visible.fishing && highlightIllegalZones) {
      for (const feat of illegalZonesGeo.features) {
        const props = feat.properties;
        if (!props) continue;
        const geom = feat.geometry as GeoJSON.Polygon;
        if (!geom.coordinates?.[0]?.length) continue;
        const ring = geom.coordinates[0];
        let cLon = 0, cLat = 0;
        for (let i = 0; i < ring.length - 1; i++) {
          cLon += ring[i][0];
          cLat += ring[i][1];
        }
        const n = ring.length - 1;
        cLon /= n;
        cLat /= n;
        const tag = document.createElement("span");
        tag.className = "illegal-zone-label";
        tag.textContent = `⚠️ ${props.fullNoTake ? "Strict No-Take" : "MPA"}: ${props.count} fish evs`;
        labelMarkers.current.push(new maplibregl.Marker({ element: tag, anchor: "bottom", offset: [0, -6] }).setLngLat([cLon, cLat]).addTo(m));
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
      labelMarkers.current.push(new maplibregl.Marker({ element: tag, anchor: above ? "bottom" : "top", offset: [0, above ? -12 : 12] }).setLngLat(e.at).addTo(m));
    }
  }, [ready, hulls, aisOff, visible.changes, visible.hotspots, visible.turnOns, visible.fishing, highlightIllegalZones, illegalZonesGeo, selectedEventId, selection, track, trackGeo, linkGeo, slickLink]);

  return (
    <>
      <div ref={el} className="map" role="region"
        aria-label="World map of activity at sea. Every layer is also listed, with its records, in the panel beside the map." />
      {basemapDown && <div className="map-overlay map-status" role="status">Basemap offline. Data layers are unaffected.</div>}
    </>
  );
}
