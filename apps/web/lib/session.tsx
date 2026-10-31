"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@convertflow/contracts";
import { api, ApiError, type Me, type Security, type Store } from "./api";

interface Ctx {
  me: Me;
  stores: Store[];
  store: Store | null;
  security: Security | null;
  /** Capabilities the selected store's workspace holds (plan + preview flags), from the server. Empty until loaded. */
  capabilities: ReadonlySet<string>;
  selectStore(id: string): void;
  reload(): Promise<void>;
}
const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside provider");
  return c;
};

/** The member's role in the store's workspace. Unknown: viewer (least privilege). */
export function useStoreRole(store: Store): Role {
  const { me } = useSession();
  const r = me.organizations.find((o) => o.id === store.organizationId)?.role;
  return r === "owner" || r === "admin" || r === "editor" ? r : "viewer";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [security, setSecurity] = useState<Security | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<ReadonlySet<string>>(new Set());

  const reload = useCallback(async () => {
    try {
      const [m, s, sec] = await Promise.all([api<Me>("/api/v1/auth/me"), api<Store[]>("/api/v1/stores"), api<Security>("/api/v1/auth/security")]);
      setMe(m); setStores(s); setSecurity(sec);
      let saved: string | null = null;
      try { saved = localStorage.getItem("cf:store"); } catch { /* storage unavailable */ }
      // A link that names a store (Shopify sends merchants to /app?store=<id> when they open the app) selects it.
      let asked: string | null = null;
      try { asked = new URLSearchParams(window.location.search).get("store"); } catch { /* no URL */ }
      // ...and becomes the remembered choice, so the next page does not fall back to a previously selected store.
      if (asked && s.some((x) => x.id === asked)) { try { localStorage.setItem("cf:store", asked); } catch { /* storage unavailable */ } }
      setStoreId((cur) => s.find((x) => x.id === asked)?.id ?? (cur && s.some((x) => x.id === cur) ? cur : s.find((x) => x.id === saved)?.id ?? s[0]?.id ?? null));
    } catch (e) {
      // Back to where the merchant was going once they sign in (the login page only follows same-site paths).
      if (e instanceof ApiError && e.status === 401) router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      else setFailed(e instanceof Error ? e.message : "Could not reach the server");
    }
  }, [router]);

  useEffect(() => { void reload(); }, [reload]);

  // What the workspace may use decides which preview modules appear. A failure only hides previews.
  const orgId = stores.find((s) => s.id === storeId)?.organizationId ?? null;
  useEffect(() => {
    if (!orgId) { setCapabilities(new Set()); return; }
    let live = true;
    api<{ capabilities?: { capability: string; granted: boolean }[] }>(`/api/v1/billing/subscription?organizationId=${encodeURIComponent(orgId)}`)
      .then((r) => { if (live) setCapabilities(new Set((r.capabilities ?? []).filter((c) => c.granted).map((c) => c.capability))); })
      .catch(() => { if (live) setCapabilities(new Set()); });
    return () => { live = false; };
  }, [orgId]);

  const value = useMemo<Ctx | null>(() => me ? ({
    me, stores, security, capabilities, store: stores.find((s) => s.id === storeId) ?? null, reload,
    selectStore: (id) => { setStoreId(id); try { localStorage.setItem("cf:store", id); } catch { /* ignore */ } },
  }) : null, [me, stores, security, capabilities, storeId, reload]);

  if (failed) return <div className="p-10 text-sm text-danger" role="alert">{failed}. Check that the API is running, then refresh.</div>;
  if (!value) return <div className="p-10 text-sm text-ink-3">Loading…</div>;
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
