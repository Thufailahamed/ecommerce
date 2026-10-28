"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type Me, type Security, type Store } from "./api";

interface Ctx {
  me: Me;
  stores: Store[];
  store: Store | null;
  security: Security | null;
  selectStore(id: string): void;
  reload(): Promise<void>;
}
const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside provider");
  return c;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [security, setSecurity] = useState<Security | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [m, s, sec] = await Promise.all([api<Me>("/api/v1/auth/me"), api<Store[]>("/api/v1/stores"), api<Security>("/api/v1/auth/security")]);
      setMe(m); setStores(s); setSecurity(sec);
      let saved: string | null = null;
      try { saved = localStorage.getItem("cf:store"); } catch { /* storage unavailable */ }
      setStoreId((cur) => cur && s.some((x) => x.id === cur) ? cur : s.find((x) => x.id === saved)?.id ?? s[0]?.id ?? null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace("/login");
      else setFailed(e instanceof Error ? e.message : "Could not reach the server");
    }
  }, [router]);

  useEffect(() => { void reload(); }, [reload]);

  const value = useMemo<Ctx | null>(() => me ? ({
    me, stores, security, store: stores.find((s) => s.id === storeId) ?? null, reload,
    selectStore: (id) => { setStoreId(id); try { localStorage.setItem("cf:store", id); } catch { /* ignore */ } },
  }) : null, [me, stores, security, storeId, reload]);

  if (failed) return <div className="p-10 text-sm text-danger" role="alert">{failed}. Check that the API is running, then refresh.</div>;
  if (!value) return <div className="p-10 text-sm text-ink-3">Loading…</div>;
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
