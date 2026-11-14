import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";

export type Resource<T> =
  | { status: "idle"; data?: undefined; error?: undefined }
  | { status: "loading"; data?: T; error?: undefined }
  | { status: "success"; data: T; error?: undefined }
  | { status: "error"; data?: T; error: ApiError };

const cache = new Map<string, unknown>();

/**
 * Minimal server-state hook: cached by key, ignores stale responses, exposes refetch.
 * Pass key = null to stay idle (e.g. nothing selected yet).
 */
export function useResource<T>(key: string | null, fetcher: () => Promise<T>) {
  const [state, setState] = useState<Resource<T>>(() =>
    key && cache.has(key) ? { status: "success", data: cache.get(key) as T } : { status: key ? "loading" : "idle" });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seq = useRef(0);

  const load = useCallback((force = false) => {
    if (!key) {
      setState({ status: "idle" });
      return;
    }
    if (!force && cache.has(key)) {
      setState({ status: "success", data: cache.get(key) as T });
      return;
    }
    const id = ++seq.current;
    setState((s) => ({ status: "loading", data: s.data }));
    fetcherRef.current().then(
      (data) => {
        cache.set(key, data);
        if (id === seq.current) setState({ status: "success", data });
      },
      (err: unknown) => {
        if (id !== seq.current) return;
        const e = err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", String(err));
        setState({ status: "error", error: e });
      },
    );
  }, [key]);

  useEffect(() => load(), [load]);
  return { ...state, refetch: () => load(true) };
}
