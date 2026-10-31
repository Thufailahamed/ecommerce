"use client";

import { createContext, useContext } from "react";
import type { SiteDocument } from "@convertflow/store-builder";

export type StoreMode = "live" | "edit" | "preview";

export interface StoreContext {
  doc: SiteDocument;
  mode: StoreMode;
  basePath: string;
  assetBase: string;
  slug: string | undefined;
  apiUrl: string | undefined;
  payments: boolean;
  /** Store-relative path to a URL the browser can open. */
  url: (path: string) => string;
  /** Goes to a store-relative path: a real navigation when live, a callback to the editor otherwise. */
  navigate: (path: string) => void;
  money: (amount: number) => string;
  image: (src: string) => string;
}

const Ctx = createContext<StoreContext | null>(null);
export const StoreProvider = Ctx.Provider;

export function useStore(): StoreContext {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStore outside <Storefront>");
  return c;
}

/** Joins a base path and a store path without doubling or dropping slashes ("/s/x" + "/" → "/s/x"). */
export function joinPath(basePath: string, path: string): string {
  const joined = basePath.replace(/\/$/, "") + (path === "/" ? "" : path);
  return joined || "/";
}

/** POSTs JSON to the public storefront API and returns the parsed body or a typed failure. */
export async function postStore<T>(ctx: Pick<StoreContext, "apiUrl" | "slug">, path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; code: string; message: string; details?: unknown }> {
  try {
    const res = await fetch(`${ctx.apiUrl}/api/v1/storefront/${encodeURIComponent(ctx.slug ?? "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { data?: T; error?: { code: string; message: string; details?: unknown } } | null;
    if (res.ok) return { ok: true, data: json?.data as T };
    return { ok: false, status: res.status, code: json?.error?.code ?? "error", message: json?.error?.message ?? "Something went wrong. Please try again.", details: json?.error?.details };
  } catch {
    return { ok: false, status: 0, code: "network", message: "We couldn't reach the store. Check your connection and try again." };
  }
}
