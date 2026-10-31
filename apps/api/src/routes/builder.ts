import type { Hono } from "hono";
import { z } from "zod";
import { THEME_PRESETS, imagePrompt, sseFrame, type ChatEvent } from "@convertflow/store-builder";
import type { OrganizationPermission } from "@convertflow/contracts";
import { HttpError, type Deps } from "../deps.js";
import { body, limiter, type Ctx, type Vars } from "../lib/http.js";
import { requireCapability, requireQuota } from "../services/entitlements.js";
import { requireVerifiedEmail } from "../services/account.js";
import * as sites from "../services/builder/sites.js";
import { listMessages, runChatTurn } from "../services/builder/agent.js";
import { generateImage, listAssets, MAX_UPLOAD_BYTES, readAsset, storeAsset } from "../services/builder/assets.js";
import * as commerce from "../services/builder/commerce.js";

/** The document can be larger than an ordinary request body. */
const MAX_DOCUMENT_BODY = 800 * 1024;

const Selection = z.object({ sectionId: z.string().min(1).max(60) }).nullable().optional();

/**
 * AI store builder routes. Merchant routes (`/api/v1/sites…`) are session-authenticated and authorised against the
 * site's workspace; storefront routes (`/api/v1/storefront…`) are public and credential-less, and only ever read the
 * published version.
 */
export function registerBuilderRoutes(app: Hono<{ Variables: Vars }>, d: Deps, h: { orgAccess: (c: Ctx, organizationId: string, p: OrganizationPermission) => Promise<unknown> }) {
  const chatLimit = limiter(20, 60_000);
  const imageLimit = limiter(20, 60_000);
  const checkoutLimit = limiter(20, 60_000);
  const formLimit = limiter(10, 60_000);
  const orderLimit = limiter(60, 60_000);

  const actor = (c: Ctx) => ({ type: "user" as const, userId: c.get("user").userId, email: c.get("user").email });
  const siteAccess = (c: Ctx, p: OrganizationPermission) => sites.authorizeSite(d, actor(c), c.req.param("siteId") ?? "", p);
  const ip = (c: Ctx) => c.req.header("cf-connecting-ip") ?? "x";

  /* ---------- sites ---------- */

  app.get("/api/v1/sites", async (c) => {
    const orgId = c.req.query("organizationId") ?? "";
    await h.orgAccess(c, orgId, "sites.read");
    return c.json({ data: await sites.listSites(d, orgId) });
  });
  app.post("/api/v1/sites", async (c) => {
    const b = await body(c, z.object({
      organizationId: z.string().min(1).max(100), name: z.string().trim().max(80).optional(), prompt: z.string().trim().max(2000).optional(),
      currency: z.string().regex(/^[A-Za-z]{3}$/).default("USD").transform((s) => s.toUpperCase()), preset: z.enum(THEME_PRESETS.map((p) => p.key) as [string, ...string[]]).optional(),
    }));
    await requireCapability(d, b.organizationId, "sites.build");
    const row = await sites.createSite(d, actor(c), b);
    return c.json({ data: { id: row.id, slug: row.slug, name: row.name } }, 201);
  });
  app.get("/api/v1/sites/:siteId", async (c) => {
    const { site, role } = await siteAccess(c, "sites.read");
    return c.json({ data: await sites.siteView(d, site, role) });
  });
  app.patch("/api/v1/sites/:siteId", async (c) => {
    const b = await body(c, z.object({ name: z.string().trim().min(1).max(80).optional(), slug: z.string().max(60).optional(), notifyEmail: z.email().max(254).nullable().optional() }));
    const { site } = await siteAccess(c, b.slug !== undefined || b.notifyEmail !== undefined ? "sites.publish" : "sites.write");
    const next = await sites.updateSite(d, site, c.get("user").userId, b);
    return c.json({ data: { name: next.name, slug: next.slug, notifyEmail: next.notifyEmail } });
  });
  app.delete("/api/v1/sites/:siteId", async (c) => {
    const { site } = await siteAccess(c, "sites.publish");
    await sites.archiveSite(d, site, c.get("user").userId);
    return c.body(null, 204);
  });

  app.put("/api/v1/sites/:siteId/draft", async (c) => {
    const { site } = await siteAccess(c, "sites.write");
    const b = await body(c, z.object({ document: z.unknown(), revision: z.number().int().min(1), label: z.string().max(120).optional() }), MAX_DOCUMENT_BODY);
    return c.json({ data: await sites.saveDraft(d, site, c.get("user").userId, b.document, b.revision, b.label) });
  });

  app.get("/api/v1/sites/:siteId/versions", async (c) => {
    const { site } = await siteAccess(c, "sites.read");
    return c.json({ data: await sites.listVersions(d, site.id) });
  });
  app.get("/api/v1/sites/:siteId/versions/:versionId", async (c) => {
    const { site } = await siteAccess(c, "sites.read");
    const v = await sites.getVersion(d, site.id, c.req.param("versionId"));
    return c.json({ data: { id: v.id, number: v.number, kind: v.kind, label: v.label, createdAt: v.createdAt, document: v.document } });
  });
  app.post("/api/v1/sites/:siteId/versions/:versionId/restore", async (c) => {
    const { site } = await siteAccess(c, "sites.write");
    const b = await body(c, z.object({ revision: z.number().int().min(1) }));
    return c.json({ data: await sites.restoreVersion(d, site, c.get("user").userId, c.req.param("versionId"), b.revision) });
  });

  app.post("/api/v1/sites/:siteId/publish", async (c) => {
    const { site } = await siteAccess(c, "sites.publish");
    await requireVerifiedEmail(d, c.get("user").userId);
    const b = await body(c, z.object({ approve: z.literal(true), revision: z.number().int().min(1) }));
    return c.json({ data: await sites.publishSite(d, site, c.get("user").userId, b.revision) });
  });
  app.post("/api/v1/sites/:siteId/unpublish", async (c) => {
    const { site } = await siteAccess(c, "sites.publish");
    await sites.unpublishSite(d, site, c.get("user").userId);
    return c.body(null, 204);
  });
  app.put("/api/v1/sites/:siteId/payments", async (c) => {
    const { site } = await siteAccess(c, "sites.publish");
    const b = await body(c, z.object({ stripeSecretKey: z.string().trim().max(300).nullable() }));
    await sites.setStripeKey(d, site, c.get("user").userId, b.stripeSecretKey);
    return c.json({ data: { paymentsConnected: b.stripeSecretKey !== null } });
  });

  /* ---------- AI chat (server-sent events) ---------- */

  app.get("/api/v1/sites/:siteId/messages", async (c) => {
    const { site } = await siteAccess(c, "sites.read");
    return c.json({ data: await listMessages(d, site.id) });
  });

  app.post("/api/v1/sites/:siteId/chat", async (c) => {
    const { site } = await siteAccess(c, "sites.write");
    const userId = c.get("user").userId;
    await requireVerifiedEmail(d, userId);
    if (!d.builderChat) throw new HttpError(503, "ai_unavailable", "The AI builder is not configured. Set the AI Gateway variables on the API (see docs/store-builder.md).");
    if (!chatLimit(`chat:${userId}`)) throw new HttpError(429, "rate_limited", "Too many messages. Wait a moment and try again.");
    const b = await body(c, z.object({ message: z.string().trim().min(1).max(4000), selection: Selection, path: z.string().max(200).optional(), mode: z.enum(["auto", "build", "edit"]).default("auto") }));
    await requireQuota(d, site.organizationId, "builder_messages", (q) => `You've used all ${q.limit} AI builder messages this month. Upgrade for more.`);
    if (!(await sites.claimBusy(d, site.id))) throw new HttpError(409, "busy", "The AI is already working on this store. Wait for it to finish.");

    const enc = new TextEncoder();
    const ctl = new AbortController();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (e: ChatEvent) => { if (!closed) { try { controller.enqueue(enc.encode(sseFrame(e))); } catch { closed = true; } } };
        // Keeps proxies from closing a quiet connection while a long model call runs.
        const ping = setInterval(() => { if (!closed) { try { controller.enqueue(enc.encode(": ping\n\n")); } catch { closed = true; } } }, 15_000);
        runChatTurn(d, site, userId, { message: b.message, selection: b.selection ?? null, ...(b.path ? { path: b.path } : {}), mode: b.mode }, emit, ctl.signal)
          .catch((e: unknown) => emit({ type: "error", code: e instanceof HttpError ? e.code : "internal_error", message: e instanceof HttpError ? e.message : "Something went wrong" }))
          .finally(() => { clearInterval(ping); if (!closed) { closed = true; controller.close(); } });
      },
      // The merchant pressed stop or closed the tab: stop the model and keep what was already saved.
      cancel() { closed = true; ctl.abort(); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  });

  /* ---------- assets ---------- */

  app.get("/api/v1/sites/:siteId/assets", async (c) => {
    const { site } = await siteAccess(c, "sites.read");
    return c.json({ data: (await listAssets(d, site.id)).map((a) => ({ id: a.id, ref: `asset:${a.id}`, source: a.source, contentType: a.contentType, bytes: a.bytes, alt: a.alt, createdAt: a.createdAt })) });
  });
  // Raw image bytes in the body (content-type image/*). The type is sniffed from the bytes, not trusted from the header.
  app.post("/api/v1/sites/:siteId/assets", async (c) => {
    const { site } = await siteAccess(c, "sites.write");
    const len = Number(c.req.header("content-length") ?? 0);
    if (len > MAX_UPLOAD_BYTES) throw new HttpError(413, "too_large", "Images can be up to 4 MB.");
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length === 0) throw new HttpError(400, "empty", "No image was sent.");
    const alt = (c.req.query("alt") ?? "").slice(0, 160);
    return c.json({ data: await storeAsset(d, site.id, bytes, "upload", { alt }) }, 201);
  });
  app.post("/api/v1/sites/:siteId/assets/generate", async (c) => {
    const { site } = await siteAccess(c, "sites.write");
    if (!imageLimit(`img:${c.get("user").userId}`)) throw new HttpError(429, "rate_limited", "Too many image requests. Wait a moment.");
    const b = await body(c, z.object({ prompt: z.string().trim().min(3).max(600), alt: z.string().trim().max(160).default("") }));
    const style = typeof site.brief?.["imageStyle"] === "string" ? site.brief["imageStyle"] : "";
    return c.json({ data: await generateImage(d, site, imagePrompt(b.prompt, style), b.alt || b.prompt.slice(0, 160)) }, 201);
  });

  /* ---------- orders and submissions ---------- */

  app.get("/api/v1/sites/:siteId/orders", async (c) => {
    const { site } = await siteAccess(c, "sites.orders");
    return c.json({ data: await commerce.listOrders(d, site.id) });
  });
  app.patch("/api/v1/sites/:siteId/orders/:orderId", async (c) => {
    const { site } = await siteAccess(c, "sites.orders");
    const b = await body(c, z.object({ status: z.enum(["paid", "fulfilled", "cancelled"]) }));
    await commerce.setOrderStatus(d, site.id, c.req.param("orderId"), b.status);
    return c.body(null, 204);
  });
  app.get("/api/v1/sites/:siteId/submissions", async (c) => {
    const { site } = await siteAccess(c, "sites.orders");
    return c.json({ data: await commerce.listSubmissions(d, site.id) });
  });

  /* ---------- public storefront ---------- */

  app.get("/api/v1/storefront/assets/:assetId", async (c) => {
    const a = await readAsset(d, c.req.param("assetId"));
    if (!a) throw new HttpError(404, "not_found", "Image not found");
    // Asset ids are random and contents never change, so they cache forever. nosniff + CSP keep them inert.
    return new Response(a.bytes, { headers: { "content-type": a.contentType, "cache-control": "public, max-age=31536000, immutable", "content-security-policy": "default-src 'none'", "x-content-type-options": "nosniff", "access-control-allow-origin": "*" } });
  });
  app.get("/api/v1/storefront/:slug", async (c) => {
    const pub = await sites.getPublished(d, c.req.param("slug"));
    if (!pub) throw new HttpError(404, "not_found", "Store not found");
    return c.json({ data: { slug: pub.slug, versionId: pub.versionId, publishedAt: pub.publishedAt, payments: pub.payments, document: pub.doc } }, 200, { "cache-control": "public, max-age=15, stale-while-revalidate=60" });
  });
  app.post("/api/v1/storefront/:slug/checkout", async (c) => {
    if (!checkoutLimit(`co:${c.req.param("slug")}:${ip(c)}`)) throw new HttpError(429, "rate_limited", "Too many attempts. Wait a moment.");
    const b = await body(c, commerce.CheckoutInput, 64 * 1024);
    return c.json({ data: await commerce.placeOrder(d, c.req.param("slug"), b) }, 201);
  });
  app.get("/api/v1/storefront/:slug/orders/:orderId", async (c) => {
    if (!orderLimit(`ord:${ip(c)}`)) throw new HttpError(429, "rate_limited", "Too many requests");
    return c.json({ data: await commerce.getOrder(d, c.req.param("slug"), c.req.param("orderId"), c.req.query("token") ?? "") }, 200, { "cache-control": "no-store" });
  });
  app.post("/api/v1/storefront/:slug/forms", async (c) => {
    if (!formLimit(`form:${c.req.param("slug")}:${ip(c)}`)) throw new HttpError(429, "rate_limited", "Too many attempts. Wait a moment.");
    const b = await body(c, commerce.FormInput, 16 * 1024);
    await commerce.submitForm(d, c.req.param("slug"), b);
    return c.json({ data: { ok: true } }, 202);
  });
}
