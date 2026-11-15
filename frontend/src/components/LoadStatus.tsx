import type { ApiError } from "../api/client";

export interface Loadable { name: string; status: string; error?: ApiError; refetch?: () => void }

/** What the map is still waiting for, and what failed, so an empty map is never mistaken for "nothing found". */
export function LoadStatus({ items }: { items: Loadable[] }) {
  const loading = items.filter((r) => r.status === "loading");
  const failed = items.filter((r) => r.status === "error");
  if (!loading.length && !failed.length) return null;
  return (
    <div className="map-overlay load-status" role="status" aria-live="polite">
      {loading.length > 0 && (
        <p><span className="load-spin" aria-hidden="true" />Loading {loading.map((r) => r.name).join(", ")}…</p>
      )}
      {failed.map((r) => (
        <p key={r.name} className="load-failed">
          {r.error?.code === "DATA_UNAVAILABLE" ? `${cap(r.name)}: not available yet.` : `Could not load ${r.name}.`}
          {r.refetch && r.error?.code !== "DATA_UNAVAILABLE" && <button type="button" className="btn btn-sm" onClick={r.refetch}>Try again</button>}
        </p>
      ))}
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
