// A ship's path as map features, coloured by time so the eye can tell where it started and where it was last seen.
import type { VesselResponse } from "../api/types";

/** Pale at the start of the period, darkest at the latest recorded position. Seen stretches are blue to ink, unseen ones pink to deep magenta. */
export const TRACK_RAMP = {
  seen: ["#bcd6ec", "#2d6a9f", "#13263b"],
  dark: ["#f0b3d8", "#a3166f", "#5e0b40"],
} as const;

export interface TrackGeo {
  lines: GeoJSON.FeatureCollection;      // one feature per stretch: { dark, t } with t = 0 (start) .. 1 (latest)
  pts: GeoJSON.FeatureCollection;        // one feature per recorded event: { kind, t }
  coords: [number, number][];
  start: { at: [number, number]; time: string } | null;
  latest: { at: [number, number]; time: string } | null;
}

export function trackFeatures(track: VesselResponse | undefined): TrackGeo {
  const pts = track?.points ?? [];
  // Longitudes are unwrapped so a path across the antimeridian does not circle the globe.
  const coords: [number, number][] = [];
  for (const p of pts) {
    let lon = p.lon;
    if (coords.length) {
      const prev = coords[coords.length - 1][0];
      while (lon - prev > 180) lon -= 360;
      while (lon - prev < -180) lon += 360;
    }
    coords.push([lon, p.lat]);
  }
  // Progress through the period by time; by position in the list if every event carries the same time.
  const times = pts.map((p) => Date.parse(p.time));
  const t0 = times[0], span = times.length ? times[times.length - 1] - t0 : 0;
  const frac = (i: number) => (span > 0 && Number.isFinite(times[i]) ? (times[i] - t0) / span : pts.length > 1 ? i / (pts.length - 1) : 1);

  const lines: GeoJSON.Feature[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    // the stretch after a "went dark" point, up to the point where the ship reappeared, was sailed unseen
    const dark = pts[i].kind === "gap_off" && pts[i + 1].kind === "gap_on" && pts[i].eventId === pts[i + 1].eventId;
    lines.push({ type: "Feature", geometry: { type: "LineString", coordinates: [coords[i], coords[i + 1]] },
                 properties: { dark, t: (frac(i) + frac(i + 1)) / 2 } });
  }
  const last = pts.length - 1;
  return {
    coords,
    lines: { type: "FeatureCollection", features: lines },
    pts: { type: "FeatureCollection", features: pts.map((p, i) => ({
      type: "Feature", geometry: { type: "Point", coordinates: coords[i] }, properties: { kind: p.kind, t: frac(i) },
    })) },
    start: pts.length ? { at: coords[0], time: pts[0].time } : null,
    latest: pts.length > 1 ? { at: coords[last], time: pts[last].time } : null,
  };
}
