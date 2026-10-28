import { eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import type { Deps } from "../deps.js";

export interface SiteEntry { id: string; active: boolean }
const key = (siteKey: string) => `site:${siteKey}`;

/**
 * Event ingestion is the hottest path and D1 is single-threaded: every D1 read there queues behind the queue
 * consumer's writes. So site key -> store id is served from KV. Entries are written whenever a store's
 * state changes (publish, disconnect, purge, uninstall); a miss falls back to D1 once and is cached.
 */
export const putSite = (d: Deps, siteKey: string, entry: SiteEntry) => d.kv.put(key(siteKey), JSON.stringify(entry));

export async function resolveSite(d: Deps, siteKey: string): Promise<SiteEntry | null> {
  const hit = await d.kv.get(key(siteKey));
  if (hit) { try { return JSON.parse(hit) as SiteEntry; } catch { /* fall through to D1 */ } }
  const [s] = await d.db.select({ id: schema.stores.id, status: schema.stores.status }).from(schema.stores).where(eq(schema.stores.siteKey, siteKey)).limit(1);
  const entry: SiteEntry = s ? { id: s.id, active: s.status === "active" } : { id: "", active: false };
  // Unknown keys are cached briefly so random-key scanning cannot hammer D1. (KV's minimum TTL is 60 s.)
  await d.kv.put(key(siteKey), JSON.stringify(entry), { expirationTtl: s ? 3600 : 60 });
  return entry;
}
