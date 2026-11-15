import { spanQuery, type ChangeSpan } from "../lib/span";
import type {
  AisOffResponse, ClosuresResponse, EncountersResponse, LoiteringResponse, VesselInsights, ProtectedFishingResponse, SlicksResponse, VesselResponse, VesselSearchResponse,
  ApiErrorBody, SharesStatements, StatementTable, CellDetailResponse, DetectionPoint, PackedDetection, CellsResponse, DetectionsResponse, DisproofResponse, DisproofVariant,
  EventDetailResponse, EventsResponse, MetaResponse,
} from "./types";

const BASE = import.meta.env?.VITE_API_BASE ?? "";

export function unpackDetections(rows: PackedDetection[]): DetectionPoint[] {
  return rows.map(([lat, lon, unmatched, matched]) => ({ lat, lon, unmatched, matched }));
}

/** Undo `?compact=true`: give every record its statements back from the response's statementTable, in order. */
export function expandStatements<R extends StatementTable, K extends keyof R>(r: R, key: K): R {
  const table = r.statementTable;
  if (!table) return r;
  const records = (r[key] as unknown as SharesStatements[]).map(({ statementIds, ...rec }) =>
    statementIds ? { ...rec, statements: statementIds.map((i) => table[i]) } : rec);
  const { statementTable: _, ...rest } = r;
  return { ...rest, [key]: records } as unknown as R;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** Parse the backend's single error shape; fall back gracefully for proxies/HTML errors. */
export async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    if (body?.error?.code) return new ApiError(res.status, body.error.code, body.error.message);
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, res.status >= 500 ? "SERVER_UNAVAILABLE" : "HTTP_ERROR",
    res.status >= 500 ? "The analysis server is not responding." : `Request failed (${res.status}).`);
}

async function request<T>(path: string, init?: RequestInit, fetchImpl: typeof fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${BASE}${path}`, init);
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the analysis server. Check your connection and try again.");
  }
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export const api = {
  meta: () => request<MetaResponse>("/api/meta"),
  /** Only the cells that belong to a change event: all the map draws, and a fraction of the full list. */
  cells: (span: ChangeSpan | null = null) => request<CellsResponse>(`/api/cells?only=events${spanQuery(span, "&")}`),
  /** Asked for in packed form (a worldwide month is over 5 MB as objects) and unpacked here. */
  detections: async (month: string): Promise<DetectionsResponse> => {
    const r = await request<DetectionsResponse>(`/api/detections?month=${encodeURIComponent(month)}&compact=true`);
    return r.packed ? { ...r, points: unpackDetections(r.packed), packed: null } : r;
  },
  // The change endpoints take the span of months the trend scan runs over; event ids belong to their span.
  cell: (id: string, span: ChangeSpan | null = null) => request<CellDetailResponse>(`/api/cells/${encodeURIComponent(id)}${spanQuery(span)}`),
  events: (span: ChangeSpan | null = null, page = 1, pageSize = 50) =>
    request<EventsResponse>(`/api/events?page=${page}&pageSize=${pageSize}${spanQuery(span, "&")}`),
  event: (id: string, span: ChangeSpan | null = null) => request<EventDetailResponse>(`/api/events/${encodeURIComponent(id)}${spanQuery(span)}`),
  disproof: (id: string, variants?: DisproofVariant[], span: ChangeSpan | null = null) =>
    request<DisproofResponse>(`/api/events/${encodeURIComponent(id)}/disproof${spanQuery(span)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(variants ? { variants } : {}),
    }),
  // The list layers are asked for in compact form (each distinct statement once) and expanded here.
  // .github/workflows/warm-cdn.yml requests these exact URLs to keep the CDN warm: keep the two in step.
  aisOff: async (start: string, end: string) =>
    expandStatements(await request<AisOffResponse>(`/api/sea/ais-off?start=${start}&end=${end}&compact=true`), "events"),
  slicks: async (start: string, end: string) =>
    expandStatements(await request<SlicksResponse>(`/api/sea/slicks?start=${start}&end=${end}&compact=true`), "slicks"),
  protectedFishing: async (start: string, end: string) =>
    expandStatements(await request<ProtectedFishingResponse>(`/api/sea/protected-fishing?start=${start}&end=${end}&compact=true`), "events"),
  vessel: (id: string, start: string, end: string) => request<VesselResponse>(`/api/sea/vessels/${encodeURIComponent(id)}?start=${start}&end=${end}`),
  encounters: async (start: string, end: string) =>
    expandStatements(await request<EncountersResponse>(`/api/sea/encounters?start=${start}&end=${end}&compact=true`), "events"),
  loitering: async (start: string, end: string) =>
    expandStatements(await request<LoiteringResponse>(`/api/sea/loitering?start=${start}&end=${end}&compact=true`), "events"),
  closures: () => request<ClosuresResponse>("/api/sea/closures"),
  insights: (id: string, start: string, end: string) =>
    request<VesselInsights>(`/api/sea/vessels/${encodeURIComponent(id)}/insights?start=${start}&end=${end}`),
  /** Vector tiles of sea borders ("eez") or offshore platforms ("infra"), proxied from Global Fishing Watch. */
  contextTiles: (layer: "eez" | "infra" | "mpa") => `${BASE || window.location.origin}/api/sea/context/${layer}/{z}/{x}/{y}.pbf`,
  effortTiles: (start: string, end: string) => `${BASE || window.location.origin}/api/sea/effort/{z}/{x}/{y}.png?start=${start}&end=${end}`,
  searchVessels: (q: string) => request<VesselSearchResponse>(`/api/sea/vessels/search?q=${encodeURIComponent(q)}`),
  /** MapLibre needs an absolute tile URL template. */
  laneTiles: (month?: string) => `${BASE || window.location.origin}/api/sea/lanes/{z}/{x}/{y}.png${month ? `?month=${month}` : ""}`,
  caseFileUrl: (id: string, format: "json" | "geojson", span: ChangeSpan | null = null) =>
    `${BASE}/api/events/${encodeURIComponent(id)}/case-file?format=${format}${spanQuery(span, "&")}`,
};

export { request as _request };
