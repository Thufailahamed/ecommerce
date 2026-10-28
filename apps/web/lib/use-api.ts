"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

/** Minimal data hook: explicit loading/error states and a manual refetch. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true); setError(null);
    try { setData(await api<T>(path)); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not load data"); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const pct = (n: number | null) => (n === null ? "–" : `${(n * 100).toFixed(1)}%`);
export const int = (n: number) => new Intl.NumberFormat("en-US").format(n);
