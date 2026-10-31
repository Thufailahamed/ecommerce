import { and, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import { schema } from "@convertflow/database";
import {
  checkSite, parseDocument, RESERVED_SLUGS, slugify, starterDocument, THEME_PRESETS, type SiteDocument,
} from "@convertflow/store-builder";
import { HttpError, type Deps } from "../../deps.js";
import { newId, randomToken } from "../../lib/crypto.js";
import { decrypt, encrypt } from "../../lib/aes.js";
import { authorizeOrganization, type ActorContext } from "../authz.js";
import { getPlan, usageSummary } from "../entitlements.js";
import { recordAudit } from "../audit.js";
import type { OrganizationPermission } from "@convertflow/contracts";

const { sites, siteVersions } = schema;
export type SiteRow = typeof sites.$inferSelect;

/** How many versions a store keeps. Older AI and manual snapshots are pruned; publish snapshots are always kept. */
const KEEP_VERSIONS = 150;
/** Manual edits within this window update one checkpoint instead of creating a version per keystroke batch. */
const CHECKPOINT_MS = 5 * 60_000;
/** A chat turn that has not finished after this long is assumed dead (a crashed isolate) and the lock is released. */
const BUSY_MS = 3 * 60_000;

export const PUBLIC_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

/**
 * Site gate: the site id comes from the URL, so it is never trusted. Missing, archived and foreign sites are all 404;
 * a member without the permission gets 403 (from authorizeOrganization).
 */
export async function authorizeSite(d: Deps, actor: ActorContext, siteId: string, permission: OrganizationPermission): Promise<{ site: SiteRow; role: string }> {
  const [site] = siteId ? await d.db.select().from(sites).where(eq(sites.id, siteId)).limit(1) : [];
  if (!site || site.status === "archived") throw new HttpError(404, "not_found", "Store not found");
  try {
    const { role } = await authorizeOrganization(d, actor, site.organizationId, permission);
    return { site, role };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) throw new HttpError(404, "not_found", "Store not found");
    throw e;
  }
}

export function draftOf(site: SiteRow): SiteDocument {
  const r = parseDocument(site.draft);
  if (!r.ok) throw new HttpError(500, "corrupt_draft", "This store's draft could not be read");
  return r.doc;
}

/* ---------- listing and creation ---------- */

export async function listSites(d: Deps, organizationId: string) {
  const rows = await d.db.select().from(sites).where(and(eq(sites.organizationId, organizationId), ne(sites.status, "archived"))).orderBy(desc(sites.updatedAt));
  return rows.map((s) => {
    const r = parseDocument(s.draft);
    const doc = r.ok ? r.doc : null;
    const hero = doc?.pages.find((p) => p.slug === "")?.sections.find((x) => x.type === "hero");
    return {
      id: s.id, name: s.name, slug: s.slug, status: s.status, updatedAt: s.updatedAt, publishedAt: s.publishedAt, prompt: s.prompt,
      preview: doc ? {
        palette: doc.theme.palette, headingFont: doc.theme.fonts.heading, tagline: doc.brand.tagline,
        heroImage: hero?.type === "hero" ? hero.image?.src ?? "" : "",
        products: doc.products.length, pages: doc.pages.length,
      } : null,
    };
  });
}

export async function uniquePublicSlug(d: Deps, base: string): Promise<string> {
  let s = slugify(base, 40);
  if (s.length < 3) s = `${s}-store`.replace(/^-/, "");
  if (RESERVED_SLUGS.has(s)) s = `${s}-store`;
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? s : `${s.slice(0, 40)}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
    const [taken] = await d.db.select({ id: sites.id }).from(sites).where(eq(sites.slug, candidate)).limit(1);
    if (!taken) return candidate;
  }
  return `${s.slice(0, 30)}-${Date.now().toString(36)}`;
}

export async function createSite(d: Deps, actor: ActorContext, input: { organizationId: string; name?: string; prompt?: string; currency: string; preset?: string }) {
  await authorizeOrganization(d, actor, input.organizationId, "sites.write");
  const plan = await getPlan(d, input.organizationId);
  const [{ n } = { n: 0 }] = await d.db.select({ n: sql<number>`count(*)` }).from(sites).where(and(eq(sites.organizationId, input.organizationId), ne(sites.status, "archived")));
  if (n >= plan.maxSites) throw new HttpError(402, "plan_limit", `Your plan includes ${plan.maxSites} store${plan.maxSites === 1 ? "" : "s"}. Archive one or upgrade to build another.`);

  const name = input.name?.trim() || "New store";
  const preset = input.preset && THEME_PRESETS.some((p) => p.key === input.preset) ? input.preset : "minimal";
  const doc = starterDocument({ name, currency: input.currency, preset });
  const now = d.now().toISOString();
  const row = {
    id: newId("site").toLowerCase().replace(/[^a-z0-9_]/g, "x"), organizationId: input.organizationId, name, slug: await uniquePublicSlug(d, name),
    status: "draft" as const, draft: doc, revision: 1, prompt: input.prompt?.trim().slice(0, 2000) || null, createdBy: actor.userId, createdAt: now, updatedAt: now,
  };
  await d.db.insert(sites).values(row);
  await addVersion(d, row.id, "initial", "Blank store", doc, actor.userId);
  await recordAudit(d, { action: "site.created", actorId: actor.userId, organizationId: input.organizationId, targetType: "site", targetId: row.id, summary: { preset } });
  return row;
}

/** Everything the editor needs to open a store. */
export async function siteView(d: Deps, site: SiteRow, role: string) {
  const plan = await getPlan(d, site.organizationId);
  const usage = await usageSummary(d, site.organizationId, plan);
  return {
    id: site.id, organizationId: site.organizationId, name: site.name, slug: site.slug, status: site.status, revision: site.revision,
    draft: draftOf(site), publishedVersionId: site.publishedVersionId, publishedAt: site.publishedAt, prompt: site.prompt,
    notifyEmail: site.notifyEmail, paymentsConnected: Boolean(site.stripeSecretEnc), role,
    busy: Boolean(site.busyUntil && site.busyUntil > d.now().toISOString()),
    ai: { chat: Boolean(d.builderChat), images: Boolean(d.builderImages), model: d.builderChat?.model ?? null },
    usage: { messages: usage.builder_messages, images: usage.ai_images },
    updatedAt: site.updatedAt,
  };
}

/* ---------- draft writes (optimistic concurrency) ---------- */

/**
 * Replaces the draft if nobody wrote it since `expectedRevision`. Returns the new revision; 409 with the current one
 * when the merchant's copy is stale (another tab, a teammate, or an AI turn).
 */
export async function writeDraft(d: Deps, siteId: string, doc: SiteDocument, expectedRevision: number): Promise<number> {
  const r = parseDocument(doc);
  if (!r.ok) throw new HttpError(422, "invalid_document", "The store could not be saved", r.issues);
  const rows = await d.db.update(sites).set({ draft: r.doc, revision: sql`${sites.revision} + 1`, updatedAt: d.now().toISOString() })
    .where(and(eq(sites.id, siteId), eq(sites.revision, expectedRevision))).returning({ revision: sites.revision });
  if (!rows[0]) {
    const [cur] = await d.db.select({ revision: sites.revision }).from(sites).where(eq(sites.id, siteId)).limit(1);
    throw new HttpError(409, "stale_revision", "This store changed since you opened it. Reload to get the latest version.", { revision: cur?.revision ?? null });
  }
  return rows[0].revision;
}

export async function saveDraft(d: Deps, site: SiteRow, userId: string, raw: unknown, expectedRevision: number, label?: string) {
  if (site.busyUntil && site.busyUntil > d.now().toISOString()) throw new HttpError(409, "busy", "The AI is still working on this store. Wait for it to finish, then try again.");
  const r = parseDocument(raw);
  if (!r.ok) throw new HttpError(422, "invalid_document", "Some changes are not valid", r.issues);
  const revision = await writeDraft(d, site.id, r.doc, expectedRevision);
  await checkpoint(d, site.id, r.doc, userId, label ?? "Manual edits");
  return { revision, draft: r.doc };
}

/** Coalesces manual edits: the latest version is updated in place while it is a recent manual checkpoint by the same member. */
async function checkpoint(d: Deps, siteId: string, doc: SiteDocument, userId: string, label: string) {
  const [last] = await d.db.select().from(siteVersions).where(eq(siteVersions.siteId, siteId)).orderBy(desc(siteVersions.number)).limit(1);
  if (last && last.kind === "manual" && last.createdBy === userId && d.now().getTime() - Date.parse(last.createdAt) < CHECKPOINT_MS) {
    await d.db.update(siteVersions).set({ document: doc }).where(eq(siteVersions.id, last.id));
    return last.id;
  }
  return addVersion(d, siteId, "manual", label, doc, userId);
}

export async function addVersion(d: Deps, siteId: string, kind: "ai" | "manual" | "restore" | "publish" | "initial", label: string, doc: SiteDocument, userId: string | null): Promise<string> {
  const [{ max } = { max: 0 }] = await d.db.select({ max: sql<number>`coalesce(max(${siteVersions.number}), 0)` }).from(siteVersions).where(eq(siteVersions.siteId, siteId));
  const id = newId("ver");
  await d.db.insert(siteVersions).values({ id, siteId, number: Number(max) + 1, kind, label: label.slice(0, 120) || kind, document: doc, createdBy: userId, createdAt: d.now().toISOString() });
  // Prune, but never a published snapshot (rollback and audit need them).
  const cutoff = Number(max) + 1 - KEEP_VERSIONS;
  if (cutoff > 0) await d.db.delete(siteVersions).where(and(eq(siteVersions.siteId, siteId), lt(siteVersions.number, cutoff), ne(siteVersions.kind, "publish")));
  return id;
}

export async function listVersions(d: Deps, siteId: string) {
  return d.db.select({ id: siteVersions.id, number: siteVersions.number, kind: siteVersions.kind, label: siteVersions.label, createdAt: siteVersions.createdAt, createdBy: siteVersions.createdBy })
    .from(siteVersions).where(eq(siteVersions.siteId, siteId)).orderBy(desc(siteVersions.number)).limit(KEEP_VERSIONS);
}

export async function getVersion(d: Deps, siteId: string, versionId: string) {
  const [v] = await d.db.select().from(siteVersions).where(and(eq(siteVersions.siteId, siteId), eq(siteVersions.id, versionId))).limit(1);
  if (!v) throw new HttpError(404, "not_found", "Version not found");
  return v;
}

export async function restoreVersion(d: Deps, site: SiteRow, userId: string, versionId: string, expectedRevision: number) {
  if (site.busyUntil && site.busyUntil > d.now().toISOString()) throw new HttpError(409, "busy", "The AI is still working on this store.");
  const v = await getVersion(d, site.id, versionId);
  const r = parseDocument(v.document);
  if (!r.ok) throw new HttpError(422, "invalid_document", "That version can no longer be restored", r.issues);
  const revision = await writeDraft(d, site.id, r.doc, expectedRevision);
  await addVersion(d, site.id, "restore", `Restored version ${v.number}`, r.doc, userId);
  await recordAudit(d, { action: "site.version_restored", actorId: userId, organizationId: site.organizationId, targetType: "site", targetId: site.id, summary: { version: v.number } });
  return { revision, draft: r.doc };
}

/* ---------- settings ---------- */

export async function updateSite(d: Deps, site: SiteRow, userId: string, input: { name?: string; slug?: string; notifyEmail?: string | null }) {
  const set: Partial<typeof sites.$inferInsert> = { updatedAt: d.now().toISOString() };
  if (input.name !== undefined) set.name = input.name.trim().slice(0, 80) || site.name;
  if (input.notifyEmail !== undefined) set.notifyEmail = input.notifyEmail;
  if (input.slug !== undefined && input.slug !== site.slug) {
    const slug = input.slug.trim().toLowerCase();
    if (!PUBLIC_SLUG.test(slug) || RESERVED_SLUGS.has(slug)) throw new HttpError(422, "invalid_slug", "Use 3-48 lowercase letters, numbers and dashes.");
    const [taken] = await d.db.select({ id: sites.id }).from(sites).where(eq(sites.slug, slug)).limit(1);
    if (taken) throw new HttpError(409, "slug_taken", "That address is taken. Try another.");
    set.slug = slug;
  }
  await d.db.update(sites).set(set).where(eq(sites.id, site.id));
  const [next] = await d.db.select().from(sites).where(eq(sites.id, site.id)).limit(1);
  if (set.slug && site.status === "published") {
    await d.kv.put(pubKey(site.slug), JSON.stringify({ gone: true }));
    await cachePublished(d, next!);
  }
  await recordAudit(d, { action: "site.updated", actorId: userId, organizationId: site.organizationId, targetType: "site", targetId: site.id, summary: { renamed: input.name !== undefined, readdressed: Boolean(set.slug) } });
  return next!;
}

/* ---------- publishing ---------- */

const pubKey = (slug: string) => `site:pub:${slug}`;

export interface PublishedSite { siteId: string; slug: string; name: string; versionId: string; publishedAt: string; payments: boolean; doc: SiteDocument }

async function cachePublished(d: Deps, site: SiteRow): Promise<PublishedSite | null> {
  if (site.status !== "published" || !site.publishedVersionId) return null;
  const v = await getVersion(d, site.id, site.publishedVersionId);
  const r = parseDocument(v.document);
  if (!r.ok) return null;
  const pub: PublishedSite = { siteId: site.id, slug: site.slug, name: site.name, versionId: v.id, publishedAt: site.publishedAt ?? v.createdAt, payments: Boolean(site.stripeSecretEnc), doc: r.doc };
  await d.kv.put(pubKey(site.slug), JSON.stringify(pub));
  return pub;
}

/** The published store for a public address. KV first (the hot path); rebuilt from the database on a miss. */
export async function getPublished(d: Deps, slug: string): Promise<PublishedSite | null> {
  if (!PUBLIC_SLUG.test(slug)) return null;
  const cached = await d.kv.get(pubKey(slug));
  if (cached) {
    const j = JSON.parse(cached) as PublishedSite | { gone: true };
    return "gone" in j ? null : j;
  }
  const [site] = await d.db.select().from(sites).where(eq(sites.slug, slug)).limit(1);
  if (!site) return null;
  return cachePublished(d, site);
}

export async function publishSite(d: Deps, site: SiteRow, userId: string, approvedRevision: number) {
  if (site.revision !== approvedRevision) throw new HttpError(409, "stale_revision", "The store changed after you reviewed it. Review the latest version and publish again.", { revision: site.revision });
  if (site.busyUntil && site.busyUntil > d.now().toISOString()) throw new HttpError(409, "busy", "The AI is still working on this store.");
  const doc = draftOf(site);
  const { errors, warnings } = checkSite(doc);
  if (errors.length) throw new HttpError(422, "not_ready", "Fix these before publishing", errors);
  const versionId = await addVersion(d, site.id, "publish", "Published", doc, userId);
  const now = d.now().toISOString();
  await d.db.update(sites).set({ status: "published", publishedVersionId: versionId, publishedAt: now, updatedAt: now }).where(eq(sites.id, site.id));
  const [next] = await d.db.select().from(sites).where(eq(sites.id, site.id)).limit(1);
  await cachePublished(d, next!);
  await recordAudit(d, { action: "site.published", actorId: userId, organizationId: site.organizationId, targetType: "site", targetId: site.id, summary: { products: doc.products.length, warnings: warnings.length } });
  return { versionId, publishedAt: now, slug: site.slug, warnings };
}

export async function unpublishSite(d: Deps, site: SiteRow, userId: string) {
  await d.db.update(sites).set({ status: "draft", publishedVersionId: null, updatedAt: d.now().toISOString() }).where(eq(sites.id, site.id));
  await d.kv.put(pubKey(site.slug), JSON.stringify({ gone: true }));
  await recordAudit(d, { action: "site.unpublished", actorId: userId, organizationId: site.organizationId, targetType: "site", targetId: site.id });
}

export async function archiveSite(d: Deps, site: SiteRow, userId: string) {
  await d.db.update(sites).set({ status: "archived", publishedVersionId: null, stripeSecretEnc: null, updatedAt: d.now().toISOString() }).where(eq(sites.id, site.id));
  await d.kv.put(pubKey(site.slug), JSON.stringify({ gone: true }));
  await recordAudit(d, { action: "site.archived", actorId: userId, organizationId: site.organizationId, targetType: "site", targetId: site.id });
}

/* ---------- payments: the merchant's own Stripe account ---------- */

export async function setStripeKey(d: Deps, site: SiteRow, userId: string, key: string | null) {
  if (key === null) {
    await d.db.update(sites).set({ stripeSecretEnc: null, updatedAt: d.now().toISOString() }).where(eq(sites.id, site.id));
  } else {
    const credentialKey = d.secrets?.credentialKey;
    if (!credentialKey) throw new HttpError(503, "not_configured", "Payments cannot be connected: the encryption key is not configured.");
    if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,200}$/.test(key)) throw new HttpError(422, "invalid_key", "Paste a Stripe secret key (sk_live_… or sk_test_…) or a restricted key with Checkout write access.");
    // Prove the key works before storing it, so a typo never reaches a shopper's checkout.
    const res = await (d.fetchFn ?? fetch)("https://api.stripe.com/v1/balance", { headers: { authorization: `Bearer ${key}` } }).catch(() => null);
    if (!res || res.status === 401) throw new HttpError(422, "invalid_key", "Stripe did not accept this key.");
    await d.db.update(sites).set({ stripeSecretEnc: await encrypt(key, credentialKey), updatedAt: d.now().toISOString() }).where(eq(sites.id, site.id));
  }
  const [next] = await d.db.select().from(sites).where(eq(sites.id, site.id)).limit(1);
  if (next?.status === "published") await cachePublished(d, next);
  await recordAudit(d, { action: key ? "site.payments_connected" : "site.payments_disconnected", actorId: userId, organizationId: site.organizationId, targetType: "site", targetId: site.id, summary: { mode: key ? (key.includes("_test_") ? "test" : "live") : null } });
}

export async function stripeKeyOf(d: Deps, siteId: string): Promise<string | null> {
  const [s] = await d.db.select({ enc: sites.stripeSecretEnc }).from(sites).where(eq(sites.id, siteId)).limit(1);
  if (!s?.enc || !d.secrets?.credentialKey) return null;
  return decrypt(s.enc, d.secrets.credentialKey);
}

/* ---------- the chat lock ---------- */

/** Claims the site for one chat turn. False when another turn holds it. */
export async function claimBusy(d: Deps, siteId: string): Promise<boolean> {
  const now = d.now();
  const rows = await d.db.update(sites).set({ busyUntil: new Date(now.getTime() + BUSY_MS).toISOString() })
    .where(and(eq(sites.id, siteId), or(isNull(sites.busyUntil), lt(sites.busyUntil, now.toISOString())))).returning({ id: sites.id });
  return rows.length === 1;
}
export async function extendBusy(d: Deps, siteId: string) {
  await d.db.update(sites).set({ busyUntil: new Date(d.now().getTime() + BUSY_MS).toISOString() }).where(and(eq(sites.id, siteId), gt(sites.busyUntil, d.now().toISOString())));
}
export async function releaseBusy(d: Deps, siteId: string) {
  await d.db.update(sites).set({ busyUntil: null }).where(eq(sites.id, siteId));
}
