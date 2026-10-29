import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { CampaignGroupInput, CampaignTemplateInput, ConsentText, EventBatch, GroupMembersInput, SafeUrl, Tool } from "@convertflow/contracts";
import { eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { HttpError, type Deps } from "./deps.js";
import * as auth from "./services/auth.js";
import * as stores from "./services/stores.js";
import * as camp from "./services/campaigns.js";
import * as catalog from "./services/catalog.js";
import { processEvents } from "./services/events.js";
import { getAnalytics, getToolAnalytics } from "./services/analytics.js";
import { generateCampaignDraft } from "./services/ai.js";
import { PLANS } from "./plans.js";
import * as stripe from "./services/stripe.js";
import { handleShopifyWebhook, verifyShopifyHmac } from "./services/shopify.js";
import { deleteAccount } from "./services/privacy.js";
import { newId, sha256Hex, verifyPassword } from "./lib/crypto.js";
import { buildOpenApi } from "./openapi.js";
import { resolveSite } from "./services/sites.js";
import * as account from "./services/account.js";
import * as team from "./services/team.js";
import * as sync from "./services/sync.js";
import { confirmSubscription, notifyRestock, subscribeRestock, unsubscribe } from "./services/restock.js";
import * as contactSvc from "./services/contacts.js";
import * as recs from "./services/recommendations.js";
import * as providerSvc from "./services/providers.js";
import * as groups from "./services/groups.js";

async function verifyTurnstile(d: Deps, token: string | undefined, ip: string | undefined) {
  if (!token) throw new HttpError(400, "captcha_required", "Please complete the verification challenge");
  const res = await (d.fetchFn ?? fetch)("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: d.secrets?.turnstileSecret ?? "", response: token, ...(ip ? { remoteip: ip } : {}) }).toString(),
  });
  const j = (await res.json().catch(() => null)) as { success?: boolean } | null;
  if (!j?.success) throw new HttpError(400, "captcha_failed", "Verification failed. Please try again.");
}

type Vars = { user: auth.SessionUser; requestId: string; token: string };
type Ctx = Context<{ Variables: Vars }>;

const COOKIE = "cf_session";
const MAX_EVENT_BODY = 64 * 1024;

export interface AppOptions { allowedOrigin: string; secureCookies: boolean }

/** Best-effort per-isolate limiter. Production must also set a Cloudflare rate-limiting rule; this only blunts bursts. */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string, now = Date.now()): boolean => {
    const h = hits.get(key);
    if (!h || h.reset <= now) { hits.set(key, { n: 1, reset: now + windowMs }); if (hits.size > 5000) hits.clear(); return true; }
    return ++h.n <= max;
  };
}

const MAX_JSON_BODY = 512 * 1024;

async function body<T extends z.ZodType>(c: Ctx, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  const text = await c.req.text();
  if (text.length > MAX_JSON_BODY) throw new HttpError(413, "too_large", "Request body too large");
  try { json = JSON.parse(text); } catch { throw new HttpError(400, "invalid_json", "Request body must be valid JSON"); }
  const r = schema.safeParse(json);
  if (!r.success) throw new HttpError(422, "validation_failed", "Request validation failed", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return r.data;
}

export function createApp(d: Deps, opts: AppOptions) {
  const app = new Hono<{ Variables: Vars }>();
  const authLimit = limiter(10, 60_000);
  const forgotLimit = limiter(5, 60_000);
  const restockLimit = limiter(10, 60_000);
  const subscribeLimit = limiter(10, 60_000);
  const providerLimit = limiter(20, 60_000); // each of these calls the provider's API with the merchant's key
  const aiLimit = limiter(10, 60_000);
  const eventLimit = limiter(120, 60_000);
  const recLimit = limiter(120, 60_000);

  app.use("*", async (c, next) => {
    const id = c.req.header("cf-ray") ?? crypto.randomUUID();
    c.set("requestId", id);
    c.header("x-request-id", id);
    c.header("x-content-type-options", "nosniff");
    const t0 = Date.now();
    await next();
    // One structured line per request (no query strings or bodies: they can carry tokens). Feeds Workers Logs.
    if (c.req.path !== "/health") console.log(JSON.stringify({ level: "info", requestId: id, method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - t0 }));
  });

  // Public, credential-less endpoints used by storefronts on arbitrary domains.
  app.use("/sdk/*", cors({ origin: "*", allowMethods: ["GET"], maxAge: 600 }));
  app.use("/api/v1/events/*", cors({ origin: "*", allowMethods: ["POST", "OPTIONS"], allowHeaders: ["content-type"], maxAge: 600 }));

  // Authenticated app API: only the merchant web origin, with credentials.
  // exposeHeaders: without it a browser hides these from the web app (the export notice and the erasure notice read them).
  const appCors = cors({ origin: opts.allowedOrigin, credentials: true, allowHeaders: ["content-type"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"], exposeHeaders: ["x-export-truncated", "x-provider-cleanup-failed"] });
  // Notifications are called by storefront browsers (cross-origin, no credentials) and by links in emails.
  app.use("/api/v1/notifications/*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["content-type"], maxAge: 600 }));
  // Recommendations are read by storefront browsers on arbitrary domains, without credentials.
  app.use("/api/v1/recommendations", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"], allowHeaders: ["content-type"], maxAge: 600 }));
  const serverToServer = (p: string) => p.startsWith("/api/v1/events/") || p.startsWith("/api/v1/webhooks/") || p.startsWith("/api/v1/notifications/") || p === "/api/v1/recommendations";
  app.use("/api/v1/*", async (c, next) => (serverToServer(c.req.path) ? next() : appCors(c, next)));

  // CSRF defence for cookie auth: state-changing app requests must come from the app origin.
  // Webhooks authenticate by signature instead; the events endpoint is public and credential-less.
  app.use("/api/v1/*", async (c, next) => {
    if (serverToServer(c.req.path) || ["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
    if (c.req.header("origin") !== opts.allowedOrigin) throw new HttpError(403, "bad_origin", "Cross-origin request blocked");
    return next();
  });

  app.onError((err, c) => {
    const requestId = c.get("requestId");
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message, details: err.details, requestId } }, err.status);
    console.error(JSON.stringify({ level: "error", requestId, message: err instanceof Error ? err.message : String(err) }));
    return c.json({ error: { code: "internal_error", message: "Something went wrong", requestId } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found", requestId: c.get("requestId") } }, 404));

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/api/v1/openapi.json", (c) => c.json(buildOpenApi()));

  /* ---------- public SDK surface ---------- */

  app.get("/sdk/v1/config/:file", async (c) => {
    const siteKey = c.req.param("file").replace(/\.json$/, "");
    if (!/^cf_[A-Za-z0-9_-]{8,40}$/.test(siteKey)) throw new HttpError(404, "not_found", "Unknown site");
    let cfg = await d.kv.get(`config:${siteKey}`);
    if (!cfg) { // KV miss: rebuild once from the database
      const [s] = await d.db.select().from(schema.stores).where(eq(schema.stores.siteKey, siteKey)).limit(1);
      if (!s) throw new HttpError(404, "not_found", "Unknown site");
      cfg = JSON.stringify(await camp.publishConfig(d, s.id));
    }
    return new Response(cfg, { headers: { "content-type": "application/json", "cache-control": "public, max-age=60, stale-while-revalidate=600", "access-control-allow-origin": "*" } });
  });

  app.post("/api/v1/events/batch", async (c) => {
    const len = Number(c.req.header("content-length") ?? 0);
    if (len > MAX_EVENT_BODY) throw new HttpError(413, "too_large", "Batch too large");
    const text = await c.req.text();
    if (text.length > MAX_EVENT_BODY) throw new HttpError(413, "too_large", "Batch too large");
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new HttpError(400, "invalid_json", "Invalid JSON"); }
    const parsed = EventBatch.safeParse(json); // consent: literal(true) is enforced by the schema
    if (!parsed.success) throw new HttpError(422, "validation_failed", "Invalid event batch");
    const siteIds = new Set(parsed.data.events.map((e) => e.siteId));
    if (siteIds.size !== 1) throw new HttpError(422, "validation_failed", "A batch must target one site");
    const siteKey = parsed.data.events[0]!.siteId;
    if (!eventLimit(`${siteKey}:${c.req.header("cf-connecting-ip") ?? "x"}`)) throw new HttpError(429, "rate_limited", "Too many requests");
    const site = await resolveSite(d, siteKey); // KV, not D1: this is the hottest path (see sites.ts)
    if (!site?.active) return c.body(null, 204); // don't reveal which keys exist
    const msg = { storeId: site.id, events: parsed.data.events };
    if (d.enqueueEvents) await d.enqueueEvents(msg); else await processEvents(d, msg);
    return c.body(null, 202);
  });

  /**
   * Upsell recommendations. The campaign's options come from what is live, so the browser sends only which campaign it is
   * asking for and what page it is on. Every way of having nothing to show returns the same empty list.
   */
  app.get("/api/v1/recommendations", async (c) => {
    const q = z.object({
      siteId: z.string().min(1).max(64), campaignId: z.string().min(1).max(64),
      productId: z.string().max(100).optional(), cart: z.string().max(2200).optional(), subtotal: z.string().max(20).optional(),
    }).safeParse(c.req.query());
    if (!q.success) throw new HttpError(422, "validation_failed", "Invalid request");
    if (!recLimit(`rec:${q.data.siteId}:${c.req.header("cf-connecting-ip") ?? "x"}`)) throw new HttpError(429, "rate_limited", "Too many requests");
    const r = await recs.recommendationsForSite(d, { siteKey: q.data.siteId, campaignId: q.data.campaignId, ctx: recs.parseContext(q.data) });
    // Availability changes: a stale answer could show something that just sold out, so nothing is cached.
    return c.json(r, 200, { "cache-control": "no-store" });
  });

  /* ---------- auth ---------- */

  const cookieOpts = { httpOnly: true, secure: opts.secureCookies, sameSite: "Lax" as const, path: "/", maxAge: 14 * 86_400 };
  const Creds = z.object({ email: z.email().max(254), password: z.string().min(10).max(200) });

  app.post("/api/v1/auth/register", async (c) => {
    if (!authLimit(`reg:${c.req.header("cf-connecting-ip") ?? "x"}`)) throw new HttpError(429, "rate_limited", "Too many attempts");
    const b = await body(c, Creds.extend({ name: z.string().max(100).optional(), organizationName: z.string().max(100).optional(), turnstileToken: z.string().max(4096).optional() }));
    if (d.secrets?.turnstileSecret) await verifyTurnstile(d, b.turnstileToken, c.req.header("cf-connecting-ip"));
    const { turnstileToken: _t, ...reg } = b;
    const r = await auth.register(d, reg);
    setCookie(c, COOKIE, r.token, cookieOpts);
    return c.json({ data: { userId: r.userId, organizationId: r.organizationId } }, 201);
  });

  app.post("/api/v1/auth/login", async (c) => {
    if (!authLimit(`log:${c.req.header("cf-connecting-ip") ?? "x"}`)) throw new HttpError(429, "rate_limited", "Too many attempts");
    const b = await body(c, z.object({ email: z.string().max(254), password: z.string().max(200), code: z.string().max(32).optional() }));
    const r = await auth.login(d, b.email, b.password, b.code);
    setCookie(c, COOKIE, r.token, cookieOpts);
    return c.json({ data: { userId: r.userId } });
  });

  /* ---------- password reset & email verification (public) ---------- */

  const NewPassword = z.string().min(10).max(200);
  app.post("/api/v1/auth/forgot-password", async (c) => {
    if (!forgotLimit(`fp:${c.req.header("cf-connecting-ip") ?? "x"}`)) throw new HttpError(429, "rate_limited", "Too many attempts");
    const b = await body(c, z.object({ email: z.string().max(254) }));
    await account.requestPasswordReset(d, b.email);
    // Identical response whether or not the account exists.
    return c.json({ data: { ok: true } }, 202);
  });
  app.post("/api/v1/auth/reset-password", async (c) => {
    if (!forgotLimit(`rp:${c.req.header("cf-connecting-ip") ?? "x"}`)) throw new HttpError(429, "rate_limited", "Too many attempts");
    const b = await body(c, z.object({ token: z.string().min(20).max(200), password: NewPassword }));
    await account.resetPassword(d, b.token, b.password);
    return c.json({ data: { ok: true } });
  });
  app.post("/api/v1/auth/verify-email", async (c) => {
    const b = await body(c, z.object({ token: z.string().min(20).max(200) }));
    await account.verifyEmail(d, b.token);
    return c.json({ data: { ok: true } });
  });

  // Everything below requires a valid session.
  const requireAuth = async (c: Ctx, next: () => Promise<void>) => {
    const token = getCookie(c, COOKIE);
    const user = token ? await auth.getSessionUser(d, token) : null;
    if (!user || !token) throw new HttpError(401, "unauthenticated", "Please sign in");
    c.set("user", user); c.set("token", token);
    await next();
  };
  app.use("/api/v1/auth/me", requireAuth);
  app.use("/api/v1/auth/logout", requireAuth);
  app.use("/api/v1/auth/account", requireAuth);
  app.use("/api/v1/auth/security", requireAuth);
  app.use("/api/v1/auth/mfa/*", requireAuth);
  app.use("/api/v1/auth/resend-verification", requireAuth);
  app.use("/api/v1/organizations", requireAuth);
  app.use("/api/v1/organizations/*", requireAuth);
  app.use("/api/v1/invitations/*", requireAuth);
  app.use("/api/v1/billing/portal", requireAuth);
  app.use("/api/v1/stores/*", requireAuth);
  app.use("/api/v1/stores", requireAuth);
  // /billing/plans is public (it is the pricing table); everything else about billing is per-account.
  app.use("/api/v1/billing/subscription", requireAuth);
  app.use("/api/v1/billing/checkout", requireAuth);

  app.post("/api/v1/auth/logout", async (c) => { await auth.logout(d, c.get("token")); deleteCookie(c, COOKIE, { path: "/" }); return c.body(null, 204); });
  app.get("/api/v1/auth/me", async (c) => {
    const u = c.get("user");
    return c.json({ data: { ...u, organizations: await auth.organizationsFor(d, u.userId) } });
  });

  /* ---------- stores ---------- */

  app.get("/api/v1/stores", async (c) => c.json({ data: await stores.listStores(d, c.get("user")) }));
  app.post("/api/v1/stores", async (c) => {
    const b = await body(c, z.object({
      organizationId: z.string(), platform: z.enum(["shopify", "woocommerce", "bigcommerce", "magento", "custom"]),
      name: z.string().trim().min(1).max(100), domain: z.string().min(3).max(253), currency: z.string().length(3).default("USD"),
    }));
    const s = await stores.createStore(d, c.get("user"), b);
    return c.json({ data: { id: s.id, siteKey: s.siteKey, domain: s.domain, platform: s.platform } }, 201);
  });

  const access = (c: Ctx, min: auth.Role) => auth.requireStore(d, c.get("user"), c.req.param("storeId") ?? "", min);

  app.get("/api/v1/stores/:storeId", async (c) => {
    const { store, role } = await access(c, "viewer");
    return c.json({ data: { id: store.id, name: store.name, platform: store.platform, domain: store.domain, siteKey: store.siteKey, currency: store.currency, deliveryEnabled: store.deliveryEnabled, role } });
  });
  app.patch("/api/v1/stores/:storeId/delivery", async (c) => {
    const { store } = await access(c, "admin");
    const b = await body(c, z.object({ enabled: z.boolean() }));
    await stores.setDelivery(d, c.get("user"), store.id, b.enabled);
    return c.body(null, 204);
  });
  app.delete("/api/v1/stores/:storeId", async (c) => {
    const { store } = await access(c, "owner");
    await stores.disconnectStore(d, c.get("user"), store.id);
    return c.body(null, 204);
  });
  app.get("/api/v1/stores/:storeId/integration", async (c) => {
    const { store } = await access(c, "viewer");
    const cfg = await d.kv.get(`config:${store.siteKey}`);
    const [{ n } = { n: 0 }] = [{ n: (await catalog.listProducts(d, store.id, 1)).length }];
    return c.json({ data: {
      siteKey: store.siteKey, configPublished: cfg !== null, hasCatalog: n > 0, platform: store.platform,
      connection: await sync.connectionStatus(d, store.id), maxDiscountPercent: store.maxDiscountPercent,
      snippet: `<script async src="{SDK_URL}/cf.js" data-site="${store.siteKey}" data-api="{API_URL}"></script>`,
    } });
  });

  // Margin guardrail: null turns promotions off for the store; a number caps any campaign's discount.
  app.patch("/api/v1/stores/:storeId/settings", async (c) => {
    const { store } = await access(c, "admin");
    const b = await body(c, z.object({ maxDiscountPercent: z.number().int().min(1).max(90).nullable() }));
    await d.db.update(schema.stores).set({ maxDiscountPercent: b.maxDiscountPercent, updatedAt: d.now().toISOString() }).where(eq(schema.stores.id, store.id));
    await d.db.insert(schema.auditLogs).values({ id: newId("aud"), storeId: store.id, actorId: c.get("user").userId, action: "store.max_discount_set", targetType: "store", targetId: store.id, createdAt: d.now().toISOString() });
    return c.body(null, 204);
  });

  app.post("/api/v1/stores/:storeId/integration/connect", async (c) => {
    const { store } = await access(c, "admin");
    const b = await body(c, z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("woocommerce"), consumerKey: z.string().min(8).max(200), consumerSecret: z.string().min(8).max(200) }),
      z.object({ kind: z.literal("bigcommerce"), storeHash: z.string().min(3).max(20), accessToken: z.string().min(8).max(300) }),
    ]));
    await sync.connectCatalog(d, store, b);
    return c.json({ data: await sync.connectionStatus(d, store.id) });
  });
  app.post("/api/v1/stores/:storeId/integration/sync", async (c) => {
    const { store } = await access(c, "editor");
    const b = await body(c, z.object({ page: z.number().int().min(1).max(200).default(1) }));
    const r = await sync.syncCatalogPage(d, store, b.page);
    if (r.restocked.length) await notifyRestock(d, store.id, r.restocked);
    return c.json({ data: { imported: r.imported, created: r.created, updated: r.updated, nextPage: r.nextPage } });
  });

  /* ---------- catalog ---------- */

  app.get("/api/v1/stores/:storeId/products", async (c) => {
    const { store } = await access(c, "viewer");
    return c.json({ data: await catalog.listProducts(d, store.id) });
  });
  app.post("/api/v1/stores/:storeId/products/import", async (c) => {
    const { store } = await access(c, "editor");
    const b = await body(c, z.object({ products: z.array(catalog.CatalogProductInput).min(1).max(catalog.MAX_IMPORT) }));
    const r = await catalog.upsertProducts(d, store.id, b.products);
    const alerts = r.restocked.length ? await notifyRestock(d, store.id, r.restocked) : { sent: 0 };
    return c.json({ data: { created: r.created, updated: r.updated, restocked: r.restocked.length, alertsSent: alerts.sent } });
  });

  /* ---------- product relationships (upsell) ---------- */

  app.get("/api/v1/stores/:storeId/relationships", async (c) => {
    const { store } = await access(c, "viewer");
    return c.json({ data: await recs.listRelationships(d, store.id, c.req.query("productId") || undefined) });
  });
  app.post("/api/v1/stores/:storeId/relationships", async (c) => {
    const { store } = await access(c, "editor");
    const b = await body(c, z.object({
      productId: z.string().min(1).max(100), relatedProductId: z.string().min(1).max(100),
      kind: z.enum(["complement", "alternative"]), weight: z.number().int().min(0).max(1000).default(0),
    }));
    const r = await recs.setRelationship(d, store.id, c.get("user").userId, b);
    return c.json({ data: r }, r.created ? 201 : 200);
  });
  app.delete("/api/v1/stores/:storeId/relationships/:id", async (c) => {
    const { store } = await access(c, "editor");
    if (!(await recs.removeRelationship(d, store.id, c.get("user").userId, c.req.param("id")))) throw new HttpError(404, "not_found", "Link not found");
    return c.body(null, 204);
  });

  /* ---------- campaigns ---------- */

  app.get("/api/v1/stores/:storeId/campaigns", async (c) => {
    const { store } = await access(c, "viewer");
    const q = z.object({ tool: Tool.optional() }).safeParse(c.req.query());
    if (!q.success) throw new HttpError(422, "validation_failed", "tool must be one of toast, feed, upsell, sms, email");
    return c.json({ data: await camp.listCampaigns(d, store.id, q.data.tool) });
  });
  app.post("/api/v1/stores/:storeId/campaigns", async (c) => {
    const { store } = await access(c, "editor");
    return c.json({ data: await camp.createCampaign(d, store.id, c.get("user").userId, await body(c, z.unknown())) }, 201);
  });
  app.get("/api/v1/stores/:storeId/campaigns/:id", async (c) => { const { store } = await access(c, "viewer"); return c.json({ data: await camp.getCampaign(d, store.id, c.req.param("id")) }); });
  app.put("/api/v1/stores/:storeId/campaigns/:id", async (c) => {
    const { store } = await access(c, "editor");
    return c.json({ data: await camp.updateDraft(d, store.id, c.req.param("id"), await body(c, z.unknown())) });
  });
  app.post("/api/v1/stores/:storeId/campaigns/validate", async (c) => {
    await access(c, "viewer");
    const r = camp.validateDraft(await body(c, z.unknown()));
    return c.json({ data: { valid: r.valid, issues: r.issues, warnings: r.warnings } });
  });
  app.post("/api/v1/stores/:storeId/campaigns/:id/publish", async (c) => {
    const { store } = await access(c, "admin");
    await account.requireVerifiedEmail(d, c.get("user").userId);
    const b = await body(c, z.object({ approve: z.literal(true), approvedUpdatedAt: z.string() }));
    return c.json({ data: await camp.publish(d, store.id, c.req.param("id"), c.get("user").userId, b.approvedUpdatedAt) });
  });
  app.post("/api/v1/stores/:storeId/campaigns/:id/pause", async (c) => { const { store } = await access(c, "editor"); await camp.pause(d, store.id, c.req.param("id"), c.get("user").userId); return c.body(null, 204); });
  app.post("/api/v1/stores/:storeId/campaigns/:id/resume", async (c) => { const { store } = await access(c, "admin"); await camp.resume(d, store.id, c.req.param("id"), c.get("user").userId); return c.body(null, 204); });
  app.post("/api/v1/stores/:storeId/campaigns/:id/archive", async (c) => { const { store } = await access(c, "admin"); await camp.archive(d, store.id, c.req.param("id"), c.get("user").userId); return c.body(null, 204); });
  app.post("/api/v1/stores/:storeId/campaigns/:id/duplicate", async (c) => { const { store } = await access(c, "editor"); return c.json({ data: await camp.duplicate(d, store.id, c.req.param("id"), c.get("user").userId) }, 201); });
  app.get("/api/v1/stores/:storeId/campaigns/:id/versions", async (c) => { const { store } = await access(c, "viewer"); return c.json({ data: await camp.listVersions(d, store.id, c.req.param("id")) }); });
  app.post("/api/v1/stores/:storeId/campaigns/:id/rollback", async (c) => {
    const { store } = await access(c, "admin");
    const b = await body(c, z.object({ versionId: z.string() }));
    return c.json({ data: await camp.rollback(d, store.id, c.req.param("id"), c.get("user").userId, b.versionId) });
  });

  app.post("/api/v1/stores/:storeId/campaigns/ai-generate", async (c) => {
    const { store } = await access(c, "editor");
    await account.requireVerifiedEmail(d, c.get("user").userId);
    if (!aiLimit(`ai:${c.get("user").userId}`)) throw new HttpError(429, "rate_limited", "Too many AI requests");
    const b = await body(c, z.object({
      objective: z.string().trim().min(10).max(500),
      campaignId: z.string().min(1).max(100).optional(),
      format: z.enum(["popup", "slide_in", "announcement_bar"]).optional(),
      constraints: z.string().max(500).optional(), allowedPromotion: z.string().max(200).optional(), feedback: z.string().max(500).optional(),
      /** "auto" (or omitted) lets the model choose among the available tools. */
      tool: z.union([z.literal("auto"), Tool]).optional(),
      /** Facts only the merchant can supply; the AI may not invent them. */
      freeShippingThreshold: z.number().positive().max(1_000_000).optional(),
      consentText: ConsentText.optional(), privacyUrl: SafeUrl.optional(),
    }));
    const { tool, ...rest } = b;
    const clean = Object.fromEntries(Object.entries({ ...rest, ...(tool && tool !== "auto" ? { tool } : {}) }).filter(([, v]) => v !== undefined)) as typeof rest & { tool?: Tool };
    return c.json({ data: await generateCampaignDraft(d, store, c.get("user").userId, clean) }, 201);
  });

  /* ---------- campaign groups and saved templates ---------- */

  app.get("/api/v1/stores/:storeId/campaign-groups", async (c) => {
    const { store } = await access(c, "viewer");
    return c.json({ data: await groups.listGroups(d, store.id) });
  });
  app.post("/api/v1/stores/:storeId/campaign-groups", async (c) => {
    const { store } = await access(c, "editor");
    const b = await body(c, CampaignGroupInput);
    return c.json({ data: await groups.createGroup(d, store.id, b.name) }, 201);
  });
  app.patch("/api/v1/stores/:storeId/campaign-groups/:groupId", async (c) => {
    const { store } = await access(c, "editor");
    const b = await body(c, CampaignGroupInput);
    return c.json({ data: await groups.renameGroup(d, store.id, c.req.param("groupId"), b.name) });
  });
  app.delete("/api/v1/stores/:storeId/campaign-groups/:groupId", async (c) => {
    const { store } = await access(c, "editor");
    await groups.deleteGroup(d, store.id, c.req.param("groupId"));
    return c.body(null, 204);
  });
  app.post("/api/v1/stores/:storeId/campaign-groups/:groupId/members", async (c) => {
    const { store } = await access(c, "editor");
    const b = await body(c, GroupMembersInput);
    return c.json({ data: await groups.addMembers(d, store.id, c.req.param("groupId"), b.campaignIds) });
  });
  app.delete("/api/v1/stores/:storeId/campaign-groups/:groupId/members/:campaignId", async (c) => {
    const { store } = await access(c, "editor");
    await groups.removeMember(d, store.id, c.req.param("groupId"), c.req.param("campaignId"));
    return c.body(null, 204);
  });
  app.get("/api/v1/stores/:storeId/campaign-templates", async (c) => {
    const { store } = await access(c, "viewer");
    return c.json({ data: await groups.listTemplates(d, store.id) });
  });
  app.post("/api/v1/stores/:storeId/campaign-templates", async (c) => {
    const { store } = await access(c, "editor");
    const b = await body(c, CampaignTemplateInput);
    return c.json({ data: await groups.saveTemplate(d, store.id, c.get("user").userId, b) }, 201);
  });
  app.delete("/api/v1/stores/:storeId/campaign-templates/:templateId", async (c) => {
    const { store } = await access(c, "editor");
    await groups.deleteTemplate(d, store.id, c.req.param("templateId"));
    return c.body(null, 204);
  });
  app.post("/api/v1/stores/:storeId/campaign-templates/:templateId/campaigns", async (c) => {
    const { store } = await access(c, "editor");
    return c.json({ data: await groups.campaignFromTemplate(d, store.id, c.get("user").userId, c.req.param("templateId")) }, 201);
  });

  /* ---------- analytics & billing ---------- */

  app.get("/api/v1/stores/:storeId/analytics", async (c) => {
    const { store } = await access(c, "viewer");
    const q = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(c.req.query());
    if (!q.success) throw new HttpError(422, "validation_failed", "from and to must be YYYY-MM-DD");
    return c.json({ data: await getAnalytics(d, store.id, q.data.from, q.data.to) });
  });
  app.get("/api/v1/stores/:storeId/analytics/tools", async (c) => {
    const { store } = await access(c, "viewer");
    const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "not a date");
    const q = z.object({ from: day, to: day }).safeParse(c.req.query());
    if (!q.success) throw new HttpError(422, "validation_failed", "from and to must be YYYY-MM-DD");
    if (q.data.from > q.data.to || Date.parse(q.data.to) - Date.parse(q.data.from) > 366 * 86_400_000) throw new HttpError(422, "validation_failed", "from must not be after to, and the range is at most 366 days");
    return c.json({ data: await getToolAnalytics(d, store.id, q.data.from, q.data.to) });
  });
  app.get("/api/v1/stores/:storeId/audit", async (c) => {
    const { store } = await access(c, "admin");
    const rows = await d.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.storeId, store.id)).limit(100);
    return c.json({ data: rows });
  });

  /* ---------- contacts (shared by the email and SMS tools) ---------- */

  const ContactQuery = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(), cursor: z.string().max(200).optional(),
    email: z.string().max(254).optional(), phone: z.string().max(40).optional(),
    channel: z.enum(["email", "sms"]).optional(), status: z.enum(schema.CONSENT_STATUSES).optional(),
  });
  app.get("/api/v1/stores/:storeId/contacts", async (c) => {
    const { store } = await access(c, "editor");
    const q = ContactQuery.safeParse(c.req.query());
    if (!q.success) throw new HttpError(422, "validation_failed", "Invalid query");
    const r = await contactSvc.listContacts(d, store.id, q.data);
    return c.json({ data: r.data, nextCursor: r.nextCursor });
  });
  // Registered before /:contactId so "export" is never read as an id.
  app.get("/api/v1/stores/:storeId/contacts/export", async (c) => {
    const { store } = await access(c, "admin");
    const r = await contactSvc.exportSubscribers(d, store.id);
    await d.db.insert(schema.auditLogs).values({ id: newId("aud"), storeId: store.id, actorId: c.get("user").userId, action: "contacts.exported", targetType: "store", targetId: store.id, createdAt: d.now().toISOString() });
    return new Response(r.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="subscribers.csv"', "cache-control": "no-store", ...(r.truncated ? { "x-export-truncated": "true" } : {}) } });
  });
  app.get("/api/v1/stores/:storeId/contacts/:contactId", async (c) => {
    const { store } = await access(c, "editor");
    const contact = await contactSvc.getContact(d, store.id, c.req.param("contactId"));
    if (!contact) throw new HttpError(404, "not_found", "Contact not found");
    return c.json({ data: contact });
  });
  app.delete("/api/v1/stores/:storeId/contacts/:contactId", async (c) => {
    const { store } = await access(c, "admin");
    const id = c.req.param("contactId");
    const r = await contactSvc.eraseContact(d, store.id, id);
    if (!r.erased) throw new HttpError(404, "not_found", "Contact not found");
    await d.db.insert(schema.auditLogs).values({ id: newId("aud"), storeId: store.id, actorId: c.get("user").userId, action: "contact.erased", targetType: "contact", targetId: id, createdAt: d.now().toISOString() });
    // Erased locally either way. A provider that could not be reached is named so the merchant can remove that copy themselves.
    if (r.providerFailures.length) c.header("x-provider-cleanup-failed", r.providerFailures.join(","));
    return c.body(null, 204);
  });

  /* ---------- list providers (Klaviyo, Mailchimp): connect, choose a list, see sync status ---------- */

  const ProviderParam = z.enum(schema.PROVIDERS);
  const providerOf = (c: Ctx) => {
    const p = ProviderParam.safeParse(c.req.param("provider"));
    if (!p.success) throw new HttpError(404, "not_found", "Unknown provider");
    return p.data;
  };
  const providerAudit = (c: Ctx, storeId: string, action: string, provider: string) =>
    d.db.insert(schema.auditLogs).values({ id: newId("aud"), storeId, actorId: c.get("user").userId, action, targetType: "provider", targetId: provider, createdAt: d.now().toISOString() });

  app.get("/api/v1/stores/:storeId/providers", async (c) => {
    const { store } = await access(c, "editor");
    return c.json({ data: await providerSvc.listProviders(d, store.id) });
  });
  // Connect (apiKey) and/or choose the list (listId). The key is checked against the provider before it is stored and is never returned.
  app.put("/api/v1/stores/:storeId/providers/:provider", async (c) => {
    const { store } = await access(c, "admin");
    const provider = providerOf(c);
    if (!providerLimit(`prv:${store.id}`)) throw new HttpError(429, "rate_limited", "Too many requests");
    const b = await body(c, z.object({ apiKey: z.string().max(200).optional(), listId: z.string().min(1).max(100).optional(), syncExisting: z.boolean().optional() }).refine((x) => x.apiKey !== undefined || x.listId !== undefined, "Send an apiKey, a listId, or both"));
    let lists: Awaited<ReturnType<typeof providerSvc.connectProvider>> | undefined;
    if (b.apiKey !== undefined) { lists = await providerSvc.connectProvider(d, store.id, provider, b.apiKey); await providerAudit(c, store.id, "provider.connected", provider); }
    let queued = 0;
    if (b.listId !== undefined) { queued = await providerSvc.chooseList(d, store.id, provider, b.listId, b.syncExisting === true); await providerAudit(c, store.id, "provider.list_chosen", provider); }
    const view = (await providerSvc.listProviders(d, store.id)).find((p) => p.provider === provider);
    return c.json({ data: { provider: view, ...(lists ? { lists } : {}), queued } });
  });
  app.get("/api/v1/stores/:storeId/providers/:provider/lists", async (c) => {
    const { store } = await access(c, "admin");
    if (!providerLimit(`prv:${store.id}`)) throw new HttpError(429, "rate_limited", "Too many requests");
    return c.json({ data: await providerSvc.checkProvider(d, store.id, providerOf(c)) });
  });
  app.post("/api/v1/stores/:storeId/providers/:provider/check", async (c) => {
    const { store } = await access(c, "admin");
    const provider = providerOf(c);
    if (!providerLimit(`prv:${store.id}`)) throw new HttpError(429, "rate_limited", "Too many requests");
    await providerSvc.checkProvider(d, store.id, provider);
    return c.json({ data: (await providerSvc.listProviders(d, store.id)).find((p) => p.provider === provider) });
  });
  app.post("/api/v1/stores/:storeId/providers/:provider/retry", async (c) => {
    const { store } = await access(c, "admin");
    return c.json({ data: { retried: await providerSvc.retryFailed(d, store.id, providerOf(c)) } });
  });
  app.delete("/api/v1/stores/:storeId/providers/:provider", async (c) => {
    const { store } = await access(c, "admin");
    const provider = providerOf(c);
    if (!(await providerSvc.disconnectProvider(d, store.id, provider))) throw new HttpError(404, "not_found", "Not connected");
    await providerAudit(c, store.id, "provider.disconnected", provider);
    return c.body(null, 204);
  });

  app.get("/api/v1/billing/plans", (c) => c.json({ data: Object.values(PLANS) }));

  app.get("/api/v1/billing/subscription", async (c) => {
    const orgId = z.string().min(1).parse(c.req.query("organizationId") ?? "");
    const org = (await auth.organizationsFor(d, c.get("user").userId)).find((o) => o.id === orgId);
    if (!org) throw new HttpError(404, "not_found", "Workspace not found");
    const [sub] = await d.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, orgId)).limit(1);
    const period = d.now().toISOString().slice(0, 7);
    const usage = await d.db.select().from(schema.usageRecords).where(eq(schema.usageRecords.organizationId, orgId));
    const used = (m: string) => usage.find((u) => u.metric === m && u.period === period)?.count ?? 0;
    return c.json({ data: { plan: sub?.plan ?? "free", status: sub?.status ?? "active", currentPeriodEnd: sub?.currentPeriodEnd ?? null, usage: { pageviews: used("pageviews"), aiGenerations: used("ai_generations") }, billingConfigured: Boolean(d.secrets?.stripeSecretKey) } });
  });
  app.post("/api/v1/billing/checkout", async (c) => {
    const b = await body(c, z.object({ organizationId: z.string(), plan: z.enum(["starter", "growth", "scale"]) }));
    const org = (await auth.organizationsFor(d, c.get("user").userId)).find((o) => o.id === b.organizationId);
    if (!org || org.role !== "owner") throw new HttpError(org ? 403 : 404, org ? "forbidden" : "not_found", "Only the workspace owner can change the plan");
    return c.json({ data: { url: await stripe.createCheckout(d, b.organizationId, b.plan, c.get("user").email) } });
  });

  app.delete("/api/v1/auth/account", async (c) => {
    const b = await body(c, z.object({ password: z.string().max(200) }));
    const [u] = await d.db.select().from(schema.users).where(eq(schema.users.id, c.get("user").userId)).limit(1);
    if (!u?.passwordHash || !(await verifyPassword(b.password, u.passwordHash))) throw new HttpError(403, "forbidden", "Password is incorrect");
    await deleteAccount(d, u.id);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  /* ---------- account security ---------- */

  app.get("/api/v1/auth/security", async (c) => c.json({ data: await account.mfaStatus(d, c.get("user").userId) }));
  app.post("/api/v1/auth/resend-verification", async (c) => {
    if (!forgotLimit(`rv:${c.get("user").userId}`)) throw new HttpError(429, "rate_limited", "Too many attempts");
    await account.sendVerification(d, c.get("user").userId);
    return c.json({ data: { ok: true } }, 202);
  });
  app.post("/api/v1/auth/mfa/start", async (c) => c.json({ data: await account.startMfa(d, c.get("user").userId, c.get("user").email) }));
  app.post("/api/v1/auth/mfa/confirm", async (c) => {
    const b = await body(c, z.object({ code: z.string().regex(/^\d{6}$/) }));
    return c.json({ data: { recoveryCodes: await account.confirmMfa(d, c.get("user").userId, b.code, c.get("token")) } });
  });
  app.post("/api/v1/auth/mfa/disable", async (c) => {
    const b = await body(c, z.object({ password: z.string().max(200), code: z.string().max(32) }));
    await account.disableMfa(d, c.get("user").userId, b.password, b.code, c.get("token"));
    return c.body(null, 204);
  });

  /* ---------- workspaces & team ---------- */

  app.post("/api/v1/organizations", async (c) => {
    const b = await body(c, z.object({ name: z.string().trim().min(2).max(80) }));
    return c.json({ data: await auth.createOrganization(d, c.get("user").userId, b.name) }, 201);
  });
  app.get("/api/v1/organizations/:orgId/team", async (c) => c.json({ data: await team.listTeam(d, c.get("user"), c.req.param("orgId")) }));
  app.post("/api/v1/organizations/:orgId/invites", async (c) => {
    await team.requireOrgRole(d, c.get("user"), c.req.param("orgId"), "admin"); // 404/403 first, so outsiders learn nothing
    await account.requireVerifiedEmail(d, c.get("user").userId);
    const b = await body(c, z.object({ email: z.email().max(254), role: z.enum(["admin", "editor", "viewer"]) }));
    return c.json({ data: await team.invite(d, c.get("user"), c.req.param("orgId"), b.email, b.role) }, 201);
  });
  app.delete("/api/v1/organizations/:orgId/invites/:inviteId", async (c) => { await team.revokeInvite(d, c.get("user"), c.req.param("orgId"), c.req.param("inviteId")); return c.body(null, 204); });
  app.patch("/api/v1/organizations/:orgId/members/:userId", async (c) => {
    const b = await body(c, z.object({ role: z.enum(["admin", "editor", "viewer"]) }));
    await team.changeRole(d, c.get("user"), c.req.param("orgId"), c.req.param("userId"), b.role);
    return c.body(null, 204);
  });
  app.delete("/api/v1/organizations/:orgId/members/:userId", async (c) => { await team.removeMember(d, c.get("user"), c.req.param("orgId"), c.req.param("userId")); return c.body(null, 204); });
  app.post("/api/v1/invitations/accept", async (c) => {
    const b = await body(c, z.object({ token: z.string().min(20).max(200) }));
    return c.json({ data: await team.acceptInvite(d, c.get("user"), b.token) });
  });

  app.post("/api/v1/billing/portal", async (c) => {
    const b = await body(c, z.object({ organizationId: z.string() }));
    const org = (await auth.organizationsFor(d, c.get("user").userId)).find((o) => o.id === b.organizationId);
    if (!org || org.role !== "owner") throw new HttpError(org ? 403 : 404, org ? "forbidden" : "not_found", "Only the workspace owner can manage billing");
    return c.json({ data: { url: await stripe.createPortal(d, b.organizationId) } });
  });

  /* ---------- back-in-stock notifications (public; double opt-in) ---------- */

  app.post("/api/v1/notifications/restock", async (c) => {
    const text = await c.req.text();
    if (text.length > 4096) throw new HttpError(413, "too_large", "Request too large");
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new HttpError(400, "invalid_json", "Invalid JSON"); }
    const p = z.object({ siteId: z.string().max(64), productId: z.string().min(1).max(100), email: z.string().max(254) }).safeParse(json);
    if (!p.success) throw new HttpError(422, "validation_failed", "Invalid request");
    if (!restockLimit(`rs:${p.data.siteId}:${c.req.header("cf-connecting-ip") ?? "x"}`)) throw new HttpError(429, "rate_limited", "Too many requests");
    await subscribeRestock(d, { siteKey: p.data.siteId, productId: p.data.productId, email: p.data.email });
    return c.json({ ok: true }, 202); // same answer regardless of plan, suppression or existing subscription
  });
  const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
  /** Title and message are inserted as HTML: callers pass trusted constants, or build the message from `escapeHtml`-ed parts. */
  const page = (title: string, msg: string) => new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;background:#f7f5f0;color:#16181a;display:grid;place-items:center;min-height:100vh;margin:0"><main style="max-width:28rem;padding:2rem;background:#fffefb;border:1px solid #e4e0d6;border-radius:12px"><h1 style="font-size:1.25rem;margin:0 0 .5rem">${title}</h1><p style="margin:0;color:#454a4d">${msg}</p></main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  app.get("/api/v1/notifications/confirm", async (c) => (await confirmSubscription(d, c.req.query("token") ?? "")) ? page("You're confirmed", "We'll email you once when the item is available again. You can unsubscribe from that email.") : page("Link not valid", "This confirmation link is invalid or was already used."));
  const unsub = async (c: Ctx) => (await unsubscribe(d, c.req.query("token") ?? "")) ? page("You're unsubscribed", "You won't receive any more emails about this.") : page("Link not valid", "This unsubscribe link is invalid.");
  app.get("/api/v1/notifications/unsubscribe", unsub);
  app.post("/api/v1/notifications/unsubscribe", unsub); // RFC 8058 one-click

  /* ---------- marketing email sign-up (public; double opt-in; not collected until the email tool ships) ---------- */

  app.post("/api/v1/notifications/subscribe", async (c) => {
    const text = await c.req.text();
    if (text.length > 4096) throw new HttpError(413, "too_large", "Request too large");
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new HttpError(400, "invalid_json", "Invalid JSON"); }
    // `consent` is the ticked checkbox. What it was ticked for is read from the published form on the server, not sent by the browser.
    const p = z.object({ siteId: z.string().max(64), campaignId: z.string().min(1).max(64), email: z.string().max(254), firstName: z.string().max(100).optional(), consent: z.literal(true) }).safeParse(json);
    if (!p.success) throw new HttpError(422, "validation_failed", "Invalid request");
    if (!subscribeLimit(`sub:${p.data.siteId}:${c.req.header("cf-connecting-ip") ?? "x"}`)) throw new HttpError(429, "rate_limited", "Too many requests");
    await contactSvc.subscribeEmail(d, { siteKey: p.data.siteId, campaignId: p.data.campaignId, email: p.data.email, firstName: p.data.firstName });
    return c.json({ ok: true }, 202); // same answer regardless of plan, suppression or existing subscription
  });
  app.get("/api/v1/notifications/subscribe/confirm", async (c) => {
    const r = await contactSvc.confirmOptIn(d, c.req.query("token") ?? "");
    if (!r) return page("Link not valid", "This confirmation link is invalid, expired or was already used.");
    // The code the form promised is shown only now. It is also emailed, because this single-use link will not show it twice.
    if (r.incentive) {
      await contactSvc.sendIncentive(d, r); // best effort: it never throws
      const code = `<strong style="font:600 1.1rem ui-monospace,Menlo,monospace;border:1px dashed #16181a;border-radius:6px;padding:.15rem .5rem">${escapeHtml(r.incentive.code)}</strong>`;
      return page("You're subscribed", `Thanks for confirming. ${escapeHtml(r.incentive.label ?? "Your code")}: ${code} for ${r.incentive.percentOff}% off. We have also emailed it to you. You can unsubscribe at any time from any email we send.`);
    }
    return page("You're subscribed", "Thanks for confirming. You can unsubscribe at any time from any email we send.");
  });
  const unsubContact = async (c: Ctx) => (await contactSvc.unsubscribeByToken(d, c.req.query("token") ?? "")) ? page("You're unsubscribed", "You won't receive any more marketing emails from this store.") : page("Link not valid", "This unsubscribe link is invalid.");
  app.get("/api/v1/notifications/subscribe/unsubscribe", unsubContact);
  app.post("/api/v1/notifications/subscribe/unsubscribe", unsubContact); // RFC 8058 one-click

  /* ---------- inbound webhooks (signature-authenticated) ---------- */

  app.post("/api/v1/webhooks/shopify", async (c) => {
    const secret = d.secrets?.shopifyApiSecret;
    if (!secret) throw new HttpError(503, "not_configured", "Shopify is not configured");
    const raw = await c.req.text();
    if (raw.length > 1024 * 1024) throw new HttpError(413, "too_large", "Payload too large");
    if (!(await verifyShopifyHmac(raw, c.req.header("x-shopify-hmac-sha256"), secret))) throw new HttpError(401, "invalid_signature", "Invalid signature");
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new HttpError(400, "invalid_json", "Invalid JSON"); }
    const outcome = await handleShopifyWebhook(d, {
      topic: c.req.header("x-shopify-topic") ?? "", shop: c.req.header("x-shopify-shop-domain") ?? "",
      webhookId: c.req.header("x-shopify-webhook-id") ?? c.req.header("x-shopify-event-id") ?? `hash:${await sha256Hex(raw)}`, body: parsed,
    });
    return c.json({ ok: true, outcome });
  });

  app.post("/api/v1/webhooks/stripe", async (c) => {
    const secret = d.secrets?.stripeWebhookSecret;
    if (!secret) throw new HttpError(503, "not_configured", "Billing is not configured");
    const raw = await c.req.text();
    if (!(await stripe.verifyStripeSignature(raw, c.req.header("stripe-signature"), secret, d.now().getTime()))) throw new HttpError(401, "invalid_signature", "Invalid signature");
    const ev = JSON.parse(raw) as Parameters<typeof stripe.handleStripeEvent>[1];
    return c.json({ ok: true, outcome: await stripe.handleStripeEvent(d, ev) });
  });

  return app;
}
