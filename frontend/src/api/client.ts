import type {
  AisOffResponse, ProtectedFishingResponse, SlicksResponse, VesselResponse, VesselSearchResponse,
  ApiErrorBody, CellDetailResponse, CellsResponse, DetectionsResponse, DisproofResponse, DisproofVariant,
  EventDetailResponse, EventsResponse, MetaResponse,
} from "./types";

const BASE = import.meta.env?.VITE_API_BASE ?? "";

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
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the analysis server. Is the backend running?");
  }
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export const api = {
  meta: () => request<MetaResponse>("/api/meta"),
  cells: () => request<CellsResponse>("/api/cells"),
  detections: (month: string) => request<DetectionsResponse>(`/api/detections?month=${encodeURIComponent(month)}`),
  cell: (id: string) => request<CellDetailResponse>(`/api/cells/${encodeURIComponent(id)}`),
  events: (page = 1, pageSize = 50) => request<EventsResponse>(`/api/events?page=${page}&pageSize=${pageSize}`),
  event: (id: string) => request<EventDetailResponse>(`/api/events/${encodeURIComponent(id)}`),
  disproof: (id: string, variants?: DisproofVariant[]) =>
    request<DisproofResponse>(`/api/events/${encodeURIComponent(id)}/disproof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(variants ? { variants } : {}),
    }),
  aisOff: (start: string, end: string) => request<AisOffResponse>(`/api/sea/ais-off?start=${start}&end=${end}`),
  slicks: (start: string, end: string) => request<SlicksResponse>(`/api/sea/slicks?start=${start}&end=${end}`),
  protectedFishing: (start: string, end: string) => request<ProtectedFishingResponse>(`/api/sea/protected-fishing?start=${start}&end=${end}`),
  vessel: (id: string, start: string, end: string) => request<VesselResponse>(`/api/sea/vessels/${encodeURIComponent(id)}?start=${start}&end=${end}`),
  searchVessels: (q: string) => request<VesselSearchResponse>(`/api/sea/vessels/search?q=${encodeURIComponent(q)}`),
  /** MapLibre needs an absolute tile URL template. */
  laneTiles: (month?: string) => `${BASE || window.location.origin}/api/sea/lanes/{z}/{x}/{y}.png${month ? `?month=${month}` : ""}`,
  caseFileUrl: (id: string, format: "json" | "geojson") =>
    `${BASE}/api/events/${encodeURIComponent(id)}/case-file?format=${format}`,
};

export { request as _request };
