import { eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { normalizeBigCommerceProduct, type NormalizedProduct } from "@convertflow/integrations";
import { HttpError, type Deps } from "../deps.js";
import { loadCredentials, saveCredentials } from "./credentials.js";
import { newId } from "../lib/crypto.js";
import { announceCatalogChange, upsertProducts } from "./catalog.js";
import { connectWithKeys, syncWooPage } from "./woocommerce.js";
import type { SessionUser } from "./auth.js";

type Store = typeof schema.stores.$inferSelect;
export type ConnectorInput =
  | { kind: "woocommerce"; consumerKey: string; consumerSecret: string }
  | { kind: "bigcommerce"; storeHash: string; accessToken: string };

const PAGE_SIZE = 50;
const MAX_PAGE = 200;

/**
 * Credentials are stored encrypted. WooCommerce keys are checked against the store first and its webhooks are set up
 * (services/woocommerce.ts); requests only go to the store's registered domain, never a user-supplied URL (no SSRF).
 */
export async function connectCatalog(d: Deps, user: SessionUser, store: Store, input: ConnectorInput) {
  if (input.kind === "woocommerce" && store.platform !== "woocommerce") throw new HttpError(409, "wrong_platform", "This store is not registered as WooCommerce");
  if (input.kind === "bigcommerce" && store.platform !== "bigcommerce") throw new HttpError(409, "wrong_platform", "This store is not registered as BigCommerce");
  if (input.kind === "woocommerce") return connectWithKeys(d, user, store, { consumerKey: input.consumerKey, consumerSecret: input.consumerSecret });
  if (!/^[a-z0-9]{3,20}$/.test(input.storeHash)) throw new HttpError(422, "validation_failed", "Store hash looks wrong. It is the short code in your API path, e.g. abc123.");
  await saveCredentials(d, store.id, { accessToken: JSON.stringify(input), scopes: input.kind });
}

async function request(d: Deps, url: string, headers: Record<string, string>) {
  let res: Response;
  try { res = await (d.fetchFn ?? fetch)(url, { headers: { accept: "application/json", ...headers } }); }
  catch { throw new HttpError(502, "catalog_unreachable", "Could not reach your store. Check that it is online."); }
  if (res.status === 401 || res.status === 403) throw new HttpError(422, "credentials_rejected", "Your store rejected the credentials. Check the keys and their permissions (read access to products).");
  if (!res.ok) throw new HttpError(502, "catalog_error", `Your store returned an error (${res.status}).`);
  try { return { json: (await res.json()) as unknown, headers: res.headers }; }
  catch { throw new HttpError(502, "catalog_error", "Your store returned an unreadable response."); }
}

/** Imports one page. The caller loops until `nextPage` is null, so no single request exceeds Worker limits. */
export async function syncCatalogPage(d: Deps, store: Store, page: number) {
  if (store.platform === "woocommerce") return syncWooPage(d, store, page);
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) throw new HttpError(422, "validation_failed", "Invalid page");
  const stored = await loadCredentials(d, store.id);
  if (!stored) throw new HttpError(409, "not_connected", "Connect your catalog credentials first");
  let cfg: ConnectorInput;
  try { cfg = JSON.parse(stored.accessToken) as ConnectorInput; } catch { throw new HttpError(409, "not_connected", "Stored credentials are unreadable. Reconnect."); }
  if (cfg.kind !== "bigcommerce") throw new HttpError(409, "not_connected", "Unsupported connector");

  const { json } = await request(d, `https://api.bigcommerce.com/stores/${cfg.storeHash}/v3/catalog/products?limit=${PAGE_SIZE}&page=${page}&include=images`, { "x-auth-token": cfg.accessToken });
  const body = (json ?? {}) as { data?: unknown[]; meta?: { pagination?: { total_pages?: number } } };
  const items = (body.data ?? []).map(normalizeBigCommerceProduct).filter((p): p is NormalizedProduct => p !== null);
  const total = body.meta?.pagination?.total_pages ?? page;
  const nextPage = page < total ? page + 1 : null;

  const r = items.length ? await upsertProducts(d, store.id, items) : { created: 0, updated: 0, restocked: [] as string[] };
  await announceCatalogChange(d, store.id, "sync", newId("syn"), r);
  return { imported: items.length, created: r.created, updated: r.updated, restocked: r.restocked, nextPage };
}

export async function connectionStatus(d: Deps, storeId: string) {
  const [c] = await d.db.select({ scopes: schema.integrationCredentials.scopes, updatedAt: schema.integrationCredentials.updatedAt }).from(schema.integrationCredentials).where(eq(schema.integrationCredentials.storeId, storeId)).limit(1);
  return { connected: Boolean(c), kind: c?.scopes ?? null, updatedAt: c?.updatedAt ?? null };
}
