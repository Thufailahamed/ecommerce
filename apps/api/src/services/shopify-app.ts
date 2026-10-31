import { and, eq, ne, sql } from "drizzle-orm";
import { schema } from "@convertflow/database";
import type { NormalizedProduct } from "@convertflow/integrations";
import { decrypt, encrypt } from "../lib/aes.js";
import { newId, randomToken, sha256Hex } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";
import { recordAudit } from "./audit.js";
import { authorizeOrganization, authorizeStore } from "./authz.js";
import { announceCatalogChange, upsertProducts } from "./catalog.js";
import { loadCredentials, saveCredentials } from "./credentials.js";
import { publishDomainEvent } from "./domain-events.js";
import { getPlan } from "./entitlements.js";
import { publishConfig } from "./campaigns.js";
import { createStore } from "./stores.js";
import type { SessionUser } from "./auth.js";

/**
 * The Shopify app: installation (OAuth authorization code grant, offline token), linking a shop to a workspace's store,
 * and Admin GraphQL access for catalog sync, health checks and billing (shopify-billing.ts).
 *
 * VERIFICATION STATUS: written to Shopify's documented OAuth and Admin GraphQL API and tested against a fake Shopify
 * (request shapes, HMACs, error and throttle replies). It has NEVER run against a real Shopify store: no Partner account
 * was available. See docs/shopify.md for the steps that verify it on a development store.
 */

type Store = typeof schema.stores.$inferSelect;
const { shopifyInstallations: si, stores } = schema;

export const SHOPIFY_API_VERSION = "2026-10";
/**
 * Products and inventory for the catalog; orders because Shopify only delivers orders/* webhooks to apps holding
 * read_orders (orders become observed purchases and attribution; no customer fields are stored); read_themes to tell the
 * merchant whether the theme app embed is switched on; write_pixels + read_customer_events because an app's web pixel
 * exists only once the app creates it (webPixelCreate). Nothing writes to products, orders or themes. Must match shopify.app.toml.
 */
export const DEFAULT_SCOPES = ["read_products", "read_inventory", "read_orders", "read_themes", "write_pixels", "read_customer_events"];
/** The theme app embed's block handle (its file name in extensions/theme-app-extension/blocks). */
export const EMBED_HANDLE = "convertflow-embed";
/** App-data metafields the theme app embed reads, so the merchant never pastes the site key. */
export const METAFIELD_NAMESPACE = "convertflow";
const STATE_TTL_S = 600;
const CLAIM_TTL_MS = 30 * 60_000;
/** A launch or install link older than this is refused: it limits how long a leaked, signed URL can be replayed. */
const MAX_LINK_AGE_S = 3600;

export interface ShopifyConfig { apiKey: string; apiSecret: string; scopes: string[]; apiVersion: string; apiOrigin: string; webOrigin: string; adminBaseUrl?: string | undefined }

/** Null when the deployment is not set up as a Shopify app: every install route then answers 503, never half-works. */
export function shopifyConfig(d: Deps): ShopifyConfig | null {
  const s = d.secrets;
  if (!s?.shopifyApiKey || !s.shopifyApiSecret || !s.apiOrigin || !s.webOrigin || !s.credentialKey) return null;
  return {
    apiKey: s.shopifyApiKey, apiSecret: s.shopifyApiSecret, apiOrigin: s.apiOrigin.replace(/\/+$/, ""), webOrigin: s.webOrigin.replace(/\/+$/, ""),
    scopes: s.shopifyScopes?.length ? s.shopifyScopes : DEFAULT_SCOPES, apiVersion: s.shopifyApiVersion ?? SHOPIFY_API_VERSION, adminBaseUrl: s.shopifyAdminBaseUrl,
  };
}
const requireConfig = (d: Deps): ShopifyConfig => {
  const c = shopifyConfig(d);
  if (!c) throw new HttpError(503, "not_configured", "The Shopify app is not configured on this deployment");
  return c;
};

/** The permanent shop domain. Anything else (a custom domain, a URL, a path) is refused, so no request is ever sent to an arbitrary host. */
export const SHOP_RE = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;
export function normalizeShop(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return SHOP_RE.test(s) ? s : null;
}

const enc = new TextEncoder();
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message))), (b) => b.toString(16).padStart(2, "0")).join("");
}
const sameString = (a: string, b: string) => a.length === b.length && [...a].reduce((acc, ch, i) => acc | (ch.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

/**
 * Shopify signs install, launch and OAuth callback URLs: hex HMAC-SHA256 of every other query parameter, sorted by name and
 * form-encoded. The timestamp must be recent, so an old signed link cannot be replayed indefinitely.
 */
export async function verifyQueryHmac(query: Record<string, string>, secret: string, nowMs: number): Promise<boolean> {
  const given = query["hmac"];
  if (!given || !/^[0-9a-f]{64}$/i.test(given)) return false;
  const ts = Number(query["timestamp"]);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > MAX_LINK_AGE_S) return false;
  const rest = new URLSearchParams();
  for (const k of Object.keys(query).filter((x) => x !== "hmac" && x !== "signature").sort()) rest.append(k, query[k]!);
  return sameString(await hmacHex(secret, rest.toString()), given.toLowerCase());
}

/* ---------- Admin API client ---------- */

export type ShopifyErrorKind = "auth" | "throttled" | "transient" | "rejected";
export class ShopifyApiError extends Error {
  constructor(readonly kind: ShopifyErrorKind, message: string, readonly retryAfterMs?: number) { super(message); }
}

/** The origin requests for a shop go to: always the shop's own myshopify domain, or the configured mock in tests. */
const adminOrigin = (cfg: ShopifyConfig, shop: string) => (cfg.adminBaseUrl ? cfg.adminBaseUrl.replace("{shop}", shop).replace(/\/+$/, "") : `https://${shop}`);
const fetchOf = (d: Deps): typeof fetch => d.fetchFn ?? ((...a) => fetch(...a)); // never call fetch as a method: Workers throws "Illegal invocation"

/** One Admin GraphQL call. Errors are classified; Shopify's own messages are not passed on (they can include shop data). */
export async function adminGraphql<T>(d: Deps, shop: string, token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const cfg = requireConfig(d);
  let res: Response;
  try {
    res = await fetchOf(d)(`${adminOrigin(cfg, shop)}/admin/api/${cfg.apiVersion}/graphql.json`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json", "x-shopify-access-token": token }, body: JSON.stringify({ query, variables }),
    });
  } catch { throw new ShopifyApiError("transient", "Could not reach Shopify"); }
  if (res.status === 401 || res.status === 403) throw new ShopifyApiError("auth", `HTTP ${res.status}`);
  if (res.status === 429) throw new ShopifyApiError("throttled", "HTTP 429", (Number(res.headers.get("retry-after")) || 2) * 1000);
  if (res.status >= 500 || res.status === 408) throw new ShopifyApiError("transient", `HTTP ${res.status}`);
  if (!res.ok) throw new ShopifyApiError("rejected", `HTTP ${res.status}`);
  const j = (await res.json().catch(() => null)) as { data?: T; errors?: { extensions?: { code?: string } }[] } | null;
  if (!j) throw new ShopifyApiError("transient", "Unreadable response");
  if (j.errors?.length) {
    const code = j.errors[0]?.extensions?.code;
    if (code === "THROTTLED") throw new ShopifyApiError("throttled", "THROTTLED", 2000);
    if (code === "ACCESS_DENIED") throw new ShopifyApiError("auth", "ACCESS_DENIED");
    throw new ShopifyApiError("rejected", typeof code === "string" && /^[A-Z_]{1,40}$/.test(code) ? code : "GraphQL error");
  }
  if (j.data === undefined) throw new ShopifyApiError("transient", "Empty response");
  return j.data;
}

/** What a merchant is told when a Shopify call fails. */
export function shopifyHttpError(e: unknown): HttpError {
  if (!(e instanceof ShopifyApiError)) return new HttpError(502, "shopify_unavailable", "Could not reach Shopify. Try again in a moment.");
  if (e.kind === "auth") return new HttpError(409, "shopify_reauthorize", "Shopify refused the stored access. Reconnect the app to this store.");
  if (e.kind === "throttled") return new HttpError(429, "shopify_throttled", "Shopify is limiting requests right now. Try again in a few seconds.");
  if (e.kind === "transient") return new HttpError(502, "shopify_unavailable", "Could not reach Shopify. Try again in a moment.");
  return new HttpError(502, "shopify_error", "Shopify rejected the request.");
}

/** The stored token for a linked Shopify store, or a 409 telling the merchant to connect. */
export async function shopifyAccess(d: Deps, store: Store): Promise<{ shop: string; token: string }> {
  if (store.platform !== "shopify") throw new HttpError(409, "wrong_platform", "This store is not registered as Shopify");
  const c = await loadCredentials(d, store.id);
  let parsed: { kind?: string; shop?: string; accessToken?: string } | undefined;
  try { parsed = c ? JSON.parse(c.accessToken) as typeof parsed : undefined; } catch { parsed = undefined; }
  if (!parsed || parsed.kind !== "shopify" || !parsed.shop || !parsed.accessToken) throw new HttpError(409, "not_connected", "Install the Shopify app for this store first");
  return { shop: parsed.shop, token: parsed.accessToken };
}

/* ---------- install ---------- */

interface InstallState { shop: string; storeId?: string; userId?: string }

async function authorizeUrl(d: Deps, cfg: ShopifyConfig, state: InstallState): Promise<string> {
  const nonce = randomToken(24);
  await d.kv.put(`shopify:state:${nonce}`, JSON.stringify(state), { expirationTtl: STATE_TTL_S });
  const q = new URLSearchParams({ client_id: cfg.apiKey, scope: cfg.scopes.join(","), redirect_uri: `${cfg.apiOrigin}/api/v1/shopify/callback`, state: nonce });
  return `https://${state.shop}/admin/oauth/authorize?${q.toString()}`; // the merchant's browser goes here, never a configured mock
}

/** From the dashboard: connect this store to a shop. The callback will only link it for the same signed-in user. */
export async function beginInstallForStore(d: Deps, user: SessionUser, store: Store, rawShop: string): Promise<string> {
  const cfg = requireConfig(d);
  if (store.platform !== "shopify") throw new HttpError(409, "wrong_platform", "This store is not registered as Shopify");
  const shop = normalizeShop(rawShop);
  if (!shop) throw new HttpError(422, "invalid_shop", "Enter the store's myshopify.com address, for example your-store.myshopify.com");
  return authorizeUrl(d, cfg, { shop, storeId: store.id, userId: user.userId });
}

/**
 * The app URL Shopify opens on install from the App Store and on every launch from the Shopify admin. A shop that is
 * installed and linked goes straight to the dashboard; anything else starts authorization.
 */
export async function handleAppLaunch(d: Deps, query: Record<string, string>): Promise<string> {
  const cfg = requireConfig(d);
  if (!(await verifyQueryHmac(query, cfg.apiSecret, d.now().getTime()))) throw new HttpError(401, "invalid_signature", "This link is not signed by Shopify or has expired");
  const shop = normalizeShop(query["shop"]);
  if (!shop) throw new HttpError(422, "invalid_shop", "Invalid shop");
  const [inst] = await d.db.select().from(si).where(eq(si.shop, shop)).limit(1);
  if (inst?.status === "installed" && inst.storeId && hasScopes(inst.scopes, cfg.scopes)) return `${cfg.webOrigin}/app?store=${encodeURIComponent(inst.storeId)}`;
  return authorizeUrl(d, cfg, { shop });
}

const hasScopes = (granted: string, wanted: string[]) => {
  const g = new Set(granted.split(",").map((s) => s.trim()).filter(Boolean));
  // write_x implies read_x at Shopify.
  return wanted.every((w) => g.has(w) || (w.startsWith("read_") && g.has(`write_${w.slice(5)}`)));
};

/**
 * Shopify redirects the merchant here after they approve the app. Verifies the signature, the single-use state and the shop,
 * exchanges the code for an offline token, then links the store (dashboard flow, same signed-in user only) or holds the
 * install for the merchant to claim. Returns where to send the browser.
 */
export async function completeInstall(d: Deps, query: Record<string, string>, sessionUser: SessionUser | null): Promise<string> {
  const cfg = requireConfig(d);
  const fail = (code: string) => `${cfg.webOrigin}/connect/shopify?error=${code}`;
  if (!(await verifyQueryHmac(query, cfg.apiSecret, d.now().getTime()))) return fail("invalid_signature");
  const shop = normalizeShop(query["shop"]);
  const nonce = query["state"] ?? "";
  if (!shop || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !query["code"]) return fail("invalid_request");
  const raw = await d.kv.get(`shopify:state:${nonce}`);
  if (!raw || raw === "used") return fail("expired");
  await d.kv.put(`shopify:state:${nonce}`, "used", { expirationTtl: STATE_TTL_S }); // single use
  let state: InstallState;
  try { state = JSON.parse(raw) as InstallState; } catch { return fail("expired"); }
  if (state.shop !== shop) return fail("shop_mismatch");
  if (state.storeId && (!sessionUser || sessionUser.userId !== state.userId)) return fail("signed_out"); // only the merchant who started it can finish it

  let token: string, scopes: string;
  try { ({ token, scopes } = await exchangeCode(d, cfg, shop, query["code"])); }
  catch { return fail("token_exchange_failed"); }
  if (!hasScopes(scopes, cfg.scopes)) return fail("missing_scopes");

  if (state.storeId) {
    try {
      const { store } = await authorizeStore(d, { type: "user", userId: state.userId! }, state.storeId, "integrations.manage");
      await linkStore(d, store, shop, token, scopes, state.userId!);
      // Name the store: the merchant may have several, and must land on the one they just connected.
      return `${cfg.webOrigin}/app/settings?shopify=connected&store=${encodeURIComponent(store.id)}`;
    } catch (e) { return fail(e instanceof HttpError ? e.code : "link_failed"); }
  }

  // Started in Shopify: hold the token until a signed-in merchant attaches the shop to one of their workspaces.
  const claim = randomToken(24);
  const now = d.now().toISOString();
  const pending = { status: "pending" as const, scopes, encryptedPendingToken: await encrypt(token, d.secrets!.credentialKey!), claimTokenHash: await sha256Hex(claim), claimExpiresAt: new Date(d.now().getTime() + CLAIM_TTL_MS).toISOString(), installedAt: now, uninstalledAt: null, updatedAt: now };
  const [existing] = await d.db.select().from(si).where(eq(si.shop, shop)).limit(1);
  if (existing?.status === "installed" && existing.storeId) {
    // A reinstall (or re-authorization) of a shop already linked to a store: refresh that store's token in place.
    const [store] = await d.db.select().from(stores).where(eq(stores.id, existing.storeId)).limit(1);
    if (store) { await linkStore(d, store, shop, token, scopes, null); return `${cfg.webOrigin}/app?store=${encodeURIComponent(store.id)}`; }
  }
  await d.db.insert(si).values({ id: newId("shi"), shop, storeId: existing?.storeId ?? null, ...pending }).onConflictDoUpdate({ target: si.shop, set: pending });
  return `${cfg.webOrigin}/connect/shopify?claim=${encodeURIComponent(claim)}`;
}

async function exchangeCode(d: Deps, cfg: ShopifyConfig, shop: string, code: string): Promise<{ token: string; scopes: string }> {
  const res = await fetchOf(d)(`${adminOrigin(cfg, shop)}/admin/oauth/access_token`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ client_id: cfg.apiKey, client_secret: cfg.apiSecret, code }),
  });
  const j = (await res.json().catch(() => null)) as { access_token?: unknown; scope?: unknown } | null;
  if (!res.ok || typeof j?.access_token !== "string" || typeof j.scope !== "string") throw new ShopifyApiError("rejected", `token exchange HTTP ${res.status}`);
  return { token: j.access_token, scopes: j.scope };
}

/**
 * Attaches a shop to a store and stores the token. A shop belongs to one active store: an active store elsewhere is a
 * conflict; a disconnected one (uninstalled earlier, data waiting for Shopify's shop/redact) is detached first.
 */
async function linkStore(d: Deps, store: Store, shop: string, token: string, scopes: string, actorId: string | null): Promise<void> {
  const [other] = await d.db.select().from(stores).where(and(eq(stores.platform, "shopify"), eq(stores.externalId, shop), ne(stores.id, store.id))).limit(1);
  if (other) {
    if (other.status === "active") throw new HttpError(409, "shop_in_use", "This Shopify store is already connected to another store in ConvertFlow. Disconnect it there first.");
    await d.db.update(stores).set({ externalId: null, updatedAt: d.now().toISOString() }).where(eq(stores.id, other.id));
    await recordAudit(d, { action: "shopify.shop_detached", actorId: null, actorType: "system", storeId: other.id, organizationId: other.organizationId, targetType: "store", targetId: other.id });
  }
  const now = d.now().toISOString();
  const reactivating = store.status !== "active";
  await d.db.update(stores).set({ externalId: shop, status: "active", ...(reactivating ? { deliveryEnabled: true } : {}), updatedAt: now }).where(eq(stores.id, store.id));
  await saveCredentials(d, store.id, { accessToken: JSON.stringify({ kind: "shopify", shop, accessToken: token }), scopes: "shopify" });
  const row = { storeId: store.id, status: "installed" as const, scopes, encryptedPendingToken: null, claimTokenHash: null, claimExpiresAt: null, uninstalledAt: null, updatedAt: now };
  await d.db.insert(si).values({ id: newId("shi"), shop, installedAt: now, ...row }).onConflictDoUpdate({ target: si.shop, set: { ...row, installedAt: now } });
  await publishConfig(d, store.id);
  await recordAudit(d, { action: "shopify.installed", actorId, actorType: actorId ? "user" : "platform", storeId: store.id, organizationId: store.organizationId, targetType: "store", targetId: store.id, summary: { scopes, reactivated: reactivating } });
  await publishDomainEvent(d, { type: "store.connected", payload: { storeId: store.id, platform: "shopify" }, idempotencyKey: `shopify.installed:${shop}:${now}`, storeId: store.id, organizationId: store.organizationId, source: "shopify_webhook" });
  // Pixel and embed settings: best effort, so a Shopify hiccup never fails the install. The dashboard shows the outcome and can retry.
  await runStorefrontSetup(d, { ...store, externalId: shop, status: "active" }).catch(() => undefined);
}

/** The claim page shows which shop is waiting, so the merchant knows what they are attaching. */
export async function pendingInstall(d: Deps, claimToken: string) {
  const [inst] = await d.db.select().from(si).where(eq(si.claimTokenHash, await sha256Hex(claimToken))).limit(1);
  if (!inst || inst.status !== "pending" || !inst.claimExpiresAt || Date.parse(inst.claimExpiresAt) < d.now().getTime()) return null;
  return inst;
}

/**
 * A signed-in merchant attaches a pending install to a workspace: the shop's existing store there is reactivated, or a new
 * store is created (subject to the plan's store limit) from what Shopify says about the shop.
 */
export async function claimInstallation(d: Deps, user: SessionUser, claimToken: string, organizationId: string): Promise<{ storeId: string; created: boolean }> {
  requireConfig(d);
  await authorizeOrganization(d, { type: "user", userId: user.userId }, organizationId, "stores.create");
  const inst = await pendingInstall(d, claimToken);
  if (!inst?.encryptedPendingToken) throw new HttpError(404, "not_found", "This installation link is invalid or has expired. Open the app from your Shopify admin again.");
  const token = await decrypt(inst.encryptedPendingToken, d.secrets!.credentialKey!);

  const [existing] = await d.db.select().from(stores).where(and(eq(stores.platform, "shopify"), eq(stores.externalId, inst.shop))).limit(1);
  let store: Store | undefined = existing && existing.organizationId === organizationId ? existing : undefined;
  let created = false;
  if (store && store.status !== "active") {
    const plan = await getPlan(d, organizationId);
    const [{ n } = { n: 0 }] = await d.db.select({ n: sql<number>`count(*)` }).from(stores).where(and(eq(stores.organizationId, organizationId), eq(stores.status, "active")));
    if (n >= plan.maxStores) throw new HttpError(402, "plan_limit", `Your plan allows ${plan.maxStores} connected store(s)`);
  }
  if (!store) {
    let info: { shop: { name: string; currencyCode: string; primaryDomain: { host: string } } };
    try { info = await adminGraphql(d, inst.shop, token, "query { shop { name currencyCode primaryDomain { host } } }"); }
    catch (e) { throw shopifyHttpError(e); }
    const row = await createStore(d, user, { organizationId, platform: "shopify", name: info.shop.name.slice(0, 100) || inst.shop, domain: info.shop.primaryDomain.host || inst.shop, currency: /^[A-Z]{3}$/.test(info.shop.currencyCode) ? info.shop.currencyCode : "USD" });
    store = { ...row, maxDiscountPercent: null } as Store;
    created = true;
  }
  await linkStore(d, store, inst.shop, token, inst.scopes, user.userId);
  return { storeId: store.id, created };
}

/** Installation state for the dashboard. Never includes the token. */
export async function installationStatus(d: Deps, store: Store) {
  const cfg = shopifyConfig(d);
  const [inst] = await d.db.select().from(si).where(eq(si.storeId, store.id)).limit(1);
  const connected = inst?.status === "installed" && !!(await loadCredentials(d, store.id).catch(() => null));
  return {
    configured: Boolean(cfg), shop: inst?.shop ?? null, status: inst?.status ?? "not_installed", connected,
    scopes: inst?.scopes.split(",").filter(Boolean) ?? [], missingScopes: cfg && inst ? cfg.scopes.filter((w) => !hasScopes(inst.scopes, [w])) : [],
    installedAt: inst?.installedAt ?? null, uninstalledAt: inst?.uninstalledAt ?? null,
    setup: {
      pixelActive: connected && Boolean(inst?.webPixelId), embedSettingsSavedAt: connected ? inst?.appMetafieldsSetAt ?? null : null, error: connected ? inst?.setupError ?? null : null,
      themeEditorUrl: cfg && inst?.shop ? themeEditorUrl(cfg, inst.shop) : null,
    },
  };
}

/** Opens the live theme's editor with the app embed switched on, ready for the merchant to save. */
export const themeEditorUrl = (cfg: ShopifyConfig, shop: string) =>
  `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${encodeURIComponent(`${cfg.apiKey}/${EMBED_HANDLE}`)}`;

/* ---------- storefront setup: web pixel and theme embed settings ---------- */

const PIXEL_CREATE = `mutation PixelCreate($settings: JSON!) { webPixelCreate(webPixel: { settings: $settings }) { userErrors { code field message } webPixel { id } } }`;
const PIXEL_UPDATE = `mutation PixelUpdate($id: ID!, $settings: JSON!) { webPixelUpdate(id: $id, webPixel: { settings: $settings }) { userErrors { code field message } webPixel { id } } }`;
const PIXEL_QUERY = `query { webPixel { id } }`;
const INSTALLATION_QUERY = `query { currentAppInstallation { id } }`;
const METAFIELDS_SET = `mutation SetAppData($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { key } userErrors { code field message } } }`;

type UserErrors = { userErrors: { code?: string | null; message?: string }[] };

/**
 * Creates (or updates) the app's web pixel with this store's site key, and writes the site key and origins into the
 * app-data metafields the theme app embed reads. Shopify runs an app pixel only after the app creates it: a merchant cannot
 * add it by hand. Records the outcome on the installation; safe to run again (Settings, "Retry setup").
 */
export async function runStorefrontSetup(d: Deps, store: Store) {
  const cfg = requireConfig(d);
  const { shop, token } = await shopifyAccess(d, store);
  const settings = JSON.stringify({ site_key: store.siteKey, api_url: cfg.apiOrigin });
  const errors: string[] = [];
  const now = d.now().toISOString();
  const [inst] = await d.db.select().from(si).where(eq(si.shop, shop)).limit(1);
  let pixelId = inst?.webPixelId ?? null;

  try {
    if (pixelId) {
      const r = await adminGraphql<{ webPixelUpdate: UserErrors & { webPixel: { id: string } | null } }>(d, shop, token, PIXEL_UPDATE, { id: pixelId, settings });
      if (r.webPixelUpdate.userErrors.length || !r.webPixelUpdate.webPixel) pixelId = null; // deleted at Shopify: create it again
    }
    if (!pixelId) {
      const r = await adminGraphql<{ webPixelCreate: UserErrors & { webPixel: { id: string } | null } }>(d, shop, token, PIXEL_CREATE, { settings });
      if (r.webPixelCreate.webPixel?.id) pixelId = r.webPixelCreate.webPixel.id;
      else if (r.webPixelCreate.userErrors.some((e) => e.code === "TAKEN")) {
        // One pixel per app per shop, created earlier (an older install): find it and give it this store's settings.
        const q = await adminGraphql<{ webPixel: { id: string } | null }>(d, shop, token, PIXEL_QUERY);
        if (q.webPixel?.id) {
          const u = await adminGraphql<{ webPixelUpdate: UserErrors & { webPixel: { id: string } | null } }>(d, shop, token, PIXEL_UPDATE, { id: q.webPixel.id, settings });
          pixelId = u.webPixelUpdate.webPixel?.id ?? null;
        }
      }
      if (!pixelId) errors.push("pixel_rejected");
    }
  } catch (e) { pixelId = null; errors.push(e instanceof ShopifyApiError ? `pixel_${e.kind}` : "pixel_failed"); }

  let metafieldsAt: string | null = inst?.appMetafieldsSetAt ?? null;
  try {
    const { currentAppInstallation: app } = await adminGraphql<{ currentAppInstallation: { id: string } }>(d, shop, token, INSTALLATION_QUERY);
    const field = (key: string, value: string) => ({ ownerId: app.id, namespace: METAFIELD_NAMESPACE, key, type: "single_line_text_field", value });
    const fields = [field("site_key", store.siteKey), field("api_url", cfg.apiOrigin), ...(d.secrets?.sdkOrigin ? [field("sdk_url", `${d.secrets.sdkOrigin}/cf.js`)] : [])];
    const r = await adminGraphql<{ metafieldsSet: UserErrors }>(d, shop, token, METAFIELDS_SET, { metafields: fields });
    if (r.metafieldsSet.userErrors.length) { metafieldsAt = null; errors.push("metafields_rejected"); } else metafieldsAt = now;
  } catch (e) { metafieldsAt = null; errors.push(e instanceof ShopifyApiError ? `metafields_${e.kind}` : "metafields_failed"); }

  await d.db.update(si).set({ webPixelId: pixelId, appMetafieldsSetAt: metafieldsAt, setupError: errors.join(",").slice(0, 200) || null, updatedAt: now }).where(eq(si.shop, shop));
  if (errors.length) await recordAudit(d, { action: "shopify.setup_incomplete", actorId: null, actorType: "system", storeId: store.id, organizationId: store.organizationId, targetType: "store", targetId: store.id, summary: { errors: errors.join(",") } });
  return { pixelActive: Boolean(pixelId), embedSettingsSavedAt: metafieldsAt, error: errors.join(",") || null };
}

const THEME_QUERY = `query { themes(first: 1, roles: [MAIN]) { nodes { name files(filenames: ["config/settings_data.json"], first: 1) { nodes { body { ... on OnlineStoreThemeFileBodyText { content } } } } } } }`;

/**
 * Whether the app embed is switched on in the live theme. Shopify keeps app embed state in the theme's settings_data.json:
 * a block whose type ends in "/blocks/convertflow-embed/<uuid>" and that is not disabled.
 */
export function embedStateFromSettings(content: string): "enabled" | "disabled" {
  let data: { current?: { blocks?: Record<string, { type?: string; disabled?: boolean }> } | string };
  try { data = JSON.parse(content.replace(/^\s*\/\*[\s\S]*?\*\//, "")) as typeof data; } catch { return "disabled"; }
  const blocks = typeof data.current === "object" && data.current?.blocks ? Object.values(data.current.blocks) : [];
  return blocks.some((b) => typeof b?.type === "string" && b.type.includes(`/blocks/${EMBED_HANDLE}/`) && b.disabled !== true) ? "enabled" : "disabled";
}

export async function themeEmbedStatus(d: Deps, store: Store): Promise<{ state: "enabled" | "disabled" | "unknown"; theme: string | null; themeEditorUrl: string }> {
  const cfg = requireConfig(d);
  const { shop, token } = await shopifyAccess(d, store);
  const url = themeEditorUrl(cfg, shop);
  let data: { themes: { nodes: { name: string; files: { nodes: { body: { content?: string } | null }[] } }[] } };
  try { data = await adminGraphql(d, shop, token, THEME_QUERY); }
  catch (e) {
    // An install from before read_themes was requested: say "unknown" rather than fail the page.
    if (e instanceof ShopifyApiError && e.kind === "auth") return { state: "unknown", theme: null, themeEditorUrl: url };
    throw shopifyHttpError(e);
  }
  const theme = data.themes.nodes[0];
  const content = theme?.files.nodes[0]?.body?.content;
  return { state: typeof content === "string" ? embedStateFromSettings(content) : "unknown", theme: theme?.name.slice(0, 100) ?? null, themeEditorUrl: url };
}

/* ---------- uninstall from the dashboard ---------- */

/**
 * Removes the app from the shop (Shopify's documented way to uninstall from an app: revoking its access). Shopify then sends
 * app/uninstalled, which the webhook handler treats as already done. Best effort: the shop may already have removed the app.
 */
export async function uninstallFromShop(d: Deps, store: Store): Promise<boolean> {
  const cfg = shopifyConfig(d);
  if (!cfg || store.platform !== "shopify") return false;
  let access: { shop: string; token: string };
  try { access = await shopifyAccess(d, store); } catch { return false; }
  let ok = false;
  try {
    const res = await fetchOf(d)(`${adminOrigin(cfg, access.shop)}/admin/api_permissions/current.json`, { method: "DELETE", headers: { accept: "application/json", "x-shopify-access-token": access.token } });
    ok = res.ok || res.status === 401; // 401: the token was already revoked, which is the outcome we want
  } catch { ok = false; }
  await markUninstalled(d, access.shop);
  return ok;
}

/* ---------- stock changes ---------- */

const INVENTORY_ITEM_QUERY = `query Item($id: ID!) { inventoryItem(id: $id) { variant { product {
  legacyResourceId title handle status onlineStoreUrl
  featuredMedia { preview { image { url } } }
  collections(first: 10) { nodes { legacyResourceId } }
  variants(first: 50) { pageInfo { hasNextPage } nodes { legacyResourceId title price availableForSale } }
} } } }`;

/**
 * inventory_levels/update names an inventory item and a location, not a product. Re-read the item's product from the Admin
 * API so availability is Shopify's own `availableForSale` across every location, then import it like a sync page.
 */
export async function refreshByInventoryItem(d: Deps, store: Store, inventoryItemId: string): Promise<{ created: number; updated: number; restocked: string[] } | null> {
  if (!/^\d{1,20}$/.test(inventoryItemId)) return null;
  const { shop, token } = await shopifyAccess(d, store);
  let data: { inventoryItem: { variant: { product: GqlProduct | null } | null } | null };
  try { data = await adminGraphql(d, shop, token, INVENTORY_ITEM_QUERY, { id: `gid://shopify/InventoryItem/${inventoryItemId}` }); }
  catch (e) { throw shopifyHttpError(e); }
  const p = data.inventoryItem?.variant?.product;
  const item = p ? normalizeAdminProduct(p) : null;
  if (!item) return null;
  const r = await upsertProducts(d, store.id, [item]);
  return r;
}

/** app/uninstalled: the token is dead. Keep the install record (for reinstalls) and the store's data (until shop/redact). */
export async function markUninstalled(d: Deps, shop: string): Promise<void> {
  const now = d.now().toISOString();
  await d.db.update(si).set({ status: "uninstalled", encryptedPendingToken: null, claimTokenHash: null, claimExpiresAt: null, uninstalledAt: now, updatedAt: now }).where(eq(si.shop, shop));
}

/* ---------- catalog sync (Admin GraphQL) ---------- */

/**
 * Ten products a page with up to 50 variants each keeps the query's calculated cost well under Shopify's single-query
 * limit. A product with more variants is imported with its first 50 (reported in `truncatedVariants`).
 */
const PRODUCTS_QUERY = `query Products($after: String) {
  products(first: 10, after: $after, sortKey: ID) {
    pageInfo { hasNextPage endCursor }
    nodes {
      legacyResourceId title handle status onlineStoreUrl
      featuredMedia { preview { image { url } } }
      collections(first: 10) { nodes { legacyResourceId } }
      variants(first: 50) { pageInfo { hasNextPage } nodes { legacyResourceId title price availableForSale } }
    }
  }
}`;

interface GqlProduct {
  legacyResourceId: string; title: string; handle: string | null; status: string; onlineStoreUrl: string | null;
  featuredMedia: { preview?: { image?: { url?: string } | null } | null } | null;
  collections: { nodes: { legacyResourceId: string }[] };
  variants: { pageInfo: { hasNextPage: boolean }; nodes: { legacyResourceId: string; title: string | null; price: string | null; availableForSale: boolean }[] };
}

/**
 * Maps one Admin API product into the catalog's neutral shape. Ids are Shopify's numeric (legacy) ids, the same ones the
 * product webhooks and the storefront's /cart.js use, so a product synced here and later updated by webhook is one row.
 * Availability is Shopify's own `availableForSale` (it accounts for tracking and overselling), never inferred.
 */
export function normalizeAdminProduct(p: GqlProduct): NormalizedProduct | null {
  if (!p.legacyResourceId || !p.title) return null;
  const status = p.status === "ACTIVE" ? "active" : p.status === "ARCHIVED" ? "archived" : "draft";
  const image = p.featuredMedia?.preview?.image?.url;
  return {
    externalId: p.legacyResourceId, title: p.title.slice(0, 300), status,
    ...(p.handle ? { handle: p.handle, url: `/products/${p.handle}` } : {}),
    ...(image && /^https:\/\//.test(image) ? { imageUrl: image } : {}),
    collectionIds: p.collections.nodes.map((c) => c.legacyResourceId).filter(Boolean).slice(0, 50),
    variants: p.variants.nodes.map((v) => {
      const price = v.price === null ? NaN : Number(v.price);
      return { externalId: v.legacyResourceId, ...(v.title ? { title: v.title.slice(0, 200) } : {}), ...(Number.isFinite(price) && price >= 0 ? { price } : {}), available: v.availableForSale };
    }),
  };
}

/** One page of the catalog. The caller passes `nextCursor` back until it is null, so no request exceeds Worker limits. */
export async function syncShopifyPage(d: Deps, store: Store, cursor: string | null) {
  const { shop, token } = await shopifyAccess(d, store);
  let data: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlProduct[] } };
  try { data = await adminGraphql(d, shop, token, PRODUCTS_QUERY, { after: cursor }); }
  catch (e) { throw shopifyHttpError(e); }
  const items = data.products.nodes.map(normalizeAdminProduct).filter((p): p is NormalizedProduct => p !== null);
  const truncatedVariants = data.products.nodes.filter((p) => p.variants.pageInfo.hasNextPage).length;
  const r = items.length ? await upsertProducts(d, store.id, items) : { created: 0, updated: 0, restocked: [] as string[] };
  await announceCatalogChange(d, store.id, "sync", newId("syn"), r);
  return { imported: items.length, created: r.created, updated: r.updated, restocked: r.restocked, truncatedVariants, nextCursor: data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null };
}

/** A read-only call proving the stored token still works. */
export async function shopifyHealth(d: Deps, store: Store): Promise<{ ok: boolean; detail: string }> {
  try {
    const { shop, token } = await shopifyAccess(d, store);
    await adminGraphql(d, shop, token, "query { shop { name } }");
    return { ok: true, detail: "Shopify accepted the stored access token" };
  } catch (e) {
    return { ok: false, detail: e instanceof HttpError ? e.message : shopifyHttpError(e).message };
  }
}
