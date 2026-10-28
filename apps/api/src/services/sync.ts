import { eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { normalizeBigCommerceProduct, normalizeWooProduct, type NormalizedProduct } from "@convertflow/integrations";
import { HttpError, type Deps } from "../deps.js";
import { loadCredentials, saveCredentials } from "./credentials.js";
import { upsertProducts } from "./catalog.js";

type Store = typeof schema.stores.$inferSelect;
export type ConnectorInput =
  | { kind: "woocommerce"; consumerKey: string; consumerSecret: string }
  | { kind: "bigcommerce"; storeHash: string; accessToken: string };

const PAGE_SIZE = 50;
const MAX_PAGE = 200;

/**
 * Credentials are stored encrypted. For WooCommerce the request URL is always the store's own registered
 * domain (never a user-supplied URL), which removes the SSRF risk of server-side fetching.
 */
export async function connectCatalog(d: Deps, store: Store, input: ConnectorInput) {
  if (input.kind === "woocommerce" && store.platform !== "woocommerce") throw new HttpError(409, "wrong_platform", "This store is not registered as WooCommerce");
  if (input.kind === "bigcommerce" && store.platform !== "bigcommerce") throw new HttpError(409, "wrong_platform", "This store is not registered as BigCommerce");
  if (input.kind === "bigcommerce" && !/^[a-z0-9]{3,20}$/.test(input.storeHash)) throw new HttpError(422, "validation_failed", "Store hash looks wrong. It is the short code in your API path, e.g. abc123.");
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
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) throw new HttpError(422, "validation_failed", "Invalid page");
  const stored = await loadCredentials(d, store.id);
  if (!stored) throw new HttpError(409, "not_connected", "Connect your catalog credentials first");
  let cfg: ConnectorInput;
  try { cfg = JSON.parse(stored.accessToken) as ConnectorInput; } catch { throw new HttpError(409, "not_connected", "Stored credentials are unreadable. Reconnect."); }

  let items: NormalizedProduct[] = [];
  let nextPage: number | null = null;
  if (cfg.kind === "woocommerce") {
    const auth = btoa(`${cfg.consumerKey}:${cfg.consumerSecret}`);
    const { json } = await request(d, `https://${store.domain}/wp-json/wc/v3/products?per_page=${PAGE_SIZE}&page=${page}&status=any`, { authorization: `Basic ${auth}` });
    const rows = Array.isArray(json) ? json : [];
    items = rows.map(normalizeWooProduct).filter((p): p is NormalizedProduct => p !== null);
    nextPage = rows.length === PAGE_SIZE ? page + 1 : null;
  } else if (cfg.kind === "bigcommerce") {
    const { json } = await request(d, `https://api.bigcommerce.com/stores/${cfg.storeHash}/v3/catalog/products?limit=${PAGE_SIZE}&page=${page}&include=images`, { "x-auth-token": cfg.accessToken });
    const body = (json ?? {}) as { data?: unknown[]; meta?: { pagination?: { total_pages?: number } } };
    items = (body.data ?? []).map(normalizeBigCommerceProduct).filter((p): p is NormalizedProduct => p !== null);
    const total = body.meta?.pagination?.total_pages ?? page;
    nextPage = page < total ? page + 1 : null;
  } else throw new HttpError(409, "not_connected", "Unsupported connector");

  const r = items.length ? await upsertProducts(d, store.id, items) : { created: 0, updated: 0, restocked: [] as string[] };
  return { imported: items.length, created: r.created, updated: r.updated, restocked: r.restocked, nextPage };
}

export async function connectionStatus(d: Deps, storeId: string) {
  const [c] = await d.db.select({ scopes: schema.integrationCredentials.scopes, updatedAt: schema.integrationCredentials.updatedAt }).from(schema.integrationCredentials).where(eq(schema.integrationCredentials.storeId, storeId)).limit(1);
  return { connected: Boolean(c), kind: c?.scopes ?? null, updatedAt: c?.updatedAt ?? null };
}
