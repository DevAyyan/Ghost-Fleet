// Mirrors backend/ghostfleet/api/schemas.py (contract: docs/api.md).
// When network allows, regenerate with: npx openapi-typescript ../docs/openapi.json

export type Direction = "INCREASING" | "DECREASING" | "NONE";
export type EpistemicLabel = "OBSERVATION" | "INFERENCE" | "HYPOTHESIS" | "RECOMMENDATION";
export type ConfidenceLevel = "LOW" | "MODERATE" | "HIGH";
export type StepId = "RAW" | "COVERAGE" | "AIS_RECEPTION" | "SEASON" | "ENVIRONMENT";
export type DisproofVariant =
  | "SEASONAL_MK" | "TRIM_START" | "TRIM_END" | "STRICT_COVERAGE"
  | "COARSER_CELLS" | "NEIGHBOR_CONTROL" | "STRICT_ALPHA";
export type LonLat = [number, number];

export interface Envelope { isDemoData: boolean }
export interface Statement { label: EpistemicLabel; text: string }

export interface Trend {
  direction: Direction;
  pctPerYear: number | null;
  slopePerMonth: number | null;
  slopeCi: [number | null, number | null];
  p: number | null;
  z: number | null;
  n: number;
}

export interface WaterfallStep { step: StepId; label: string; trend: Trend; q: number | null }

export interface MetaResponse extends Envelope {
  sourceNote: string;
  months: string[];
  alpha: number;
  steps: { step: StepId; label: string }[];
  alertsByStep: Record<StepId, number>;
  cellCount: number;
  eventCount: number;
  sensors: string[];
  disclaimer: string;
  fetchedAt: string | null;
  cellSizeDeg: number | null;
}

export interface DetectionPoint { lat: number; lon: number; unmatched: number; matched: number }
export interface DetectionsResponse extends Envelope {
  month: string;
  points: DetectionPoint[];
  packed?: PackedDetection[] | null;   // with ?compact=true: the points as rows, and `points` is empty
  totalUnmatched: number;
  totalMatched: number;
  fetchedAt: string | null;
  source: string;
}

export interface CellSummary {
  cellId: string;
  boundary: LonLat[];
  center: [number | null, number | null];
  trend: Trend;
  q: number | null;
  isSignificant: boolean;
  eventId: string | null;
  msdiSeries: (number | null)[];
}
export interface CellsResponse extends Envelope { months: string[]; cells: CellSummary[] }

export interface MonthPoint {
  month: string;
  unmatched: number | null;
  matched: number | null;
  opportunities: number | null;
  aisReception: number | null;
  wind: number | null;
  chl: number | null;
  raw: number | null;
  msdi: number | null;
  aisCorrected: number | null;
  seasonAdjusted: number | null;
  environmentAdjusted: number | null;
}

export interface CellDetailResponse extends Envelope {
  cell: CellSummary;
  waterfall: WaterfallStep[];
  series: MonthPoint[];
  neighborIds: string[];
}

export interface EventSummary {
  eventId: string;
  rank: number;
  direction: Direction;
  leadCellId: string;
  cellIds: string[];
  pctPerYear: number | null;
  q: number | null;
  maxAbsZ: number;
  headline: Statement;
  place?: string | null;
}
export interface Pagination { page: number; pageSize: number; totalItems: number; totalPages: number }
export interface EventsResponse extends Envelope { data: EventSummary[]; pagination: Pagination }

export interface Explanation { code: string; text: string; share: number; label: EpistemicLabel }
export interface Confidence { level: ConfidenceLevel; reasons: string[] }
export interface OppositeNeighbor { cellId: string; direction: Direction; pctPerYear: number | null; q: number | null }

export interface EventDetailResponse extends Envelope {
  event: EventSummary;
  waterfall: WaterfallStep[];
  series: MonthPoint[];
  oppositeNeighbors: OppositeNeighbor[];
  explanations: Explanation[];
  confidence: Confidence;
  recommendedAction: Statement;
  statements: Statement[];
}

export interface VariantOutcome { variant: DisproofVariant; description: string; trend: Trend; alpha: number; survived: boolean }
export interface DisproofResponse extends Envelope {
  eventId: string;
  cellId: string;
  baseline: Trend;
  variants: VariantOutcome[];
  survived: number;
  total: number;
  survivalRate: number | null;
  verdict: Statement;
}

// ---------- /api/sea/*: live awareness layers ----------
export interface AisOffEvent {
  id: string; lat: number; lon: number; start: string | null; end: string | null;
  durationHours: number | null; distanceKm: number | null;
  vesselName: string | null; flag: string | null; vesselType: string | null; shoreKm: number | null;
  place: string; inProtectedArea: boolean; inNoTake: boolean; highSeas: boolean; statements: Statement[];
  vesselId?: string | null; mmsi?: string | null; onLat?: number | null; onLon?: number | null; likelyIntentional?: boolean;
}
export interface AisOffHotspot {
  id: string; lat: number; lon: number; radiusKm: number; count: number; place: string;
  topVesselType: string | null; topVesselTypeShare: number; topFlags: string[];
  medianDurationHours: number | null; statements: Statement[];
}
export interface CoordinatedTurnOnVessel {
  vesselId?: string | null; vesselName: string | null; vesselType: string | null;
  flag: string | null; start?: string | null; end: string | null; durationHours: number | null;
  distanceKm: number | null; enterLat: number; enterLon: number; exitLat: number; exitLon: number;
  lat: number; lon: number;
}
export interface CoordinatedTurnOn {
  id: string; lat: number; lon: number; enterLat: number; enterLon: number; exitLat: number; exitLon: number;
  radiusKm: number; count: number; sharedHours: number; spanHours: number;
  coPresenceStart: string; coPresenceEnd: string;
  earliest: string; latest: string;
  earliestEnter?: string | null; latestEnter?: string | null; place: string;
  topFlags: string[]; vesselTypes: string[]; vessels: CoordinatedTurnOnVessel[];
  statements: Statement[];
}
export interface AisOffResponse extends Envelope {
  fetchedAt: string; windowDays: number; recentDays: number; total: number;
  events: AisOffEvent[]; hotspots: AisOffHotspot[]; turnOnClusters?: CoordinatedTurnOn[]; heat: [number, number][]; source: string;
  start?: string | null; end?: string | null; truncated?: boolean;
}
export type SlickSource = "VESSEL" | "INFRASTRUCTURE" | "DARK_VESSEL" | "NATURAL" | "UNKNOWN";
export interface OilSlick {
  id: string; lat: number; lon: number; time: string | null; areaKm2: number; lengthKm: number;
  confidence: number; possibleSource: SlickSource; place: string; url: string | null; statements: Statement[];
}
export interface SlicksResponse extends Envelope {
  fetchedAt: string; windowDays: number; totalMatched: number | null; slicks: OilSlick[]; source: string;
}
export interface ProtectedFishingEvent {
  id: string; lat: number; lon: number; start: string | null; end: string | null; durationHours: number | null;
  vesselName: string | null; flag: string | null; vesselType: string | null; shoreKm: number | null;
  fullNoTake: boolean; place: string; statements: Statement[]; vesselId?: string | null;
}
export interface ProtectedFishingResponse extends Envelope {
  fetchedAt: string; days: string[]; scanned: number; events: ProtectedFishingEvent[]; source: string;
}

// ---------- /api/sea/vessels: one ship ----------
export interface VesselIdentity {
  vesselId: string; name: string | null; flag: string | null; mmsi: string | null; imo: string | null; callsign: string | null;
  gear: string[]; lengthM: number | null; tonnageGt: number | null; transmitsFrom: string | null; transmitsTo: string | null;
}
export type VesselPointKind = "fishing" | "loitering" | "port_visit" | "encounter" | "gap_off" | "gap_on";
export interface VesselPoint { time: string; lat: number; lon: number; kind: VesselPointKind; label: string | null; eventId?: string | null }
export interface VesselResponse extends Envelope {
  fetchedAt: string; start: string; end: string; truncated: boolean; identity: VesselIdentity;
  points: VesselPoint[]; gaps: AisOffEvent[]; counts: Record<string, number>; statements: Statement[]; source: string;
}
export interface VesselSearchResponse extends Envelope { query: string; results: VesselIdentity[] }

export type PackedDetection = [number, number, number, number];   // lat, lon, unmatched, matched

export interface ApiErrorBody { error: { code: string; message: string; details?: unknown } }
