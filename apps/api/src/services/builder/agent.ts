import { asc, desc, eq, sql } from "drizzle-orm";
import { schema } from "@convertflow/database";
import type { ChatMessage, ChatModel } from "@convertflow/ai";
import {
  applyOps, BUILD_STEPS, briefPrompt, catalogPrompt, checkSite, editPrompt, extractJson, findSectionById, homePrompt, imagePrompt,
  isObj, pagesPrompt, parseEditResponse, sectionLabel, TaggedStream,
  type AppliedOp, type Brief, type ChatEvent, type ChatMessageView, type ChatTurn, type FailedOp, type SiteDocument,
} from "@convertflow/store-builder";
import { HttpError, type Deps } from "../../deps.js";
import { newId } from "../../lib/crypto.js";
import { estimateCostUsd } from "../ai-tasks.js";
import { quota, recordUsage } from "../entitlements.js";
import { addVersion, draftOf, extendBusy, releaseBusy, uniquePublicSlug, writeDraft, type SiteRow } from "./sites.js";
import { generateImage } from "./assets.js";

const { siteMessages, sites } = schema;

/** One model call. Generous: a 70B model writing a dozen products takes a while. */
const CALL_TIMEOUT_MS = 90_000;
/** Images made during a first build, and during one edit turn. Each is metered separately. */
const BUILD_IMAGES = 16;
const EDIT_IMAGES = 4;
const IMAGE_CONCURRENCY = 4;

export interface ChatInput { message: string; selection?: { sectionId: string } | null; path?: string; mode?: "auto" | "build" | "edit" }

interface Turn {
  d: Deps;
  chat: ChatModel;
  site: SiteRow;
  userId: string;
  emit: (e: ChatEvent) => void;
  signal: AbortSignal;
  doc: SiteDocument;
  revision: number;
  tokens: { input: number; output: number };
  changes: AppliedOp[];
  failed: FailedOp[];
  steps: NonNullable<ChatMessageView["steps"]>;
}

interface TurnResult { message: string; suggestions: string[] }

class Cancelled extends Error {}

const now = (d: Deps) => d.now().toISOString();

function messageView(row: typeof siteMessages.$inferSelect): ChatMessageView {
  const meta = row.meta as Partial<ChatMessageView>;
  return { id: row.id, role: row.role, content: row.content, createdAt: row.createdAt, versionId: row.versionId, ...meta };
}

export async function listMessages(d: Deps, siteId: string): Promise<ChatMessageView[]> {
  // rowid breaks ties between messages written in the same millisecond (a reply right after its question).
  const rows = await d.db.select().from(siteMessages).where(eq(siteMessages.siteId, siteId)).orderBy(asc(siteMessages.createdAt), asc(sql`rowid`)).limit(400);
  return rows.map(messageView);
}

/**
 * Runs one chat turn and reports progress through `emit`. The caller has already authorised the member, checked the
 * monthly allowance and claimed the site's lock; this releases the lock when it finishes, whatever happens.
 *
 * A first message on a fresh store runs the full build (brief, catalogue, home page, supporting pages, images);
 * every other message is an edit turn that streams the reply and applies operations. Every write goes through the
 * operation engine and the document schema, so model output can never put an invalid or unsafe store on disk.
 */
export async function runChatTurn(d: Deps, site: SiteRow, userId: string, input: ChatInput, emit: (e: ChatEvent) => void, signal: AbortSignal): Promise<void> {
  const chat = d.builderChat;
  if (!chat) throw new HttpError(503, "ai_unavailable", "The AI builder is not configured.");
  const started = Date.now();
  const t: Turn = { d, chat, site, userId, emit, signal, doc: draftOf(site), revision: site.revision, tokens: { input: 0, output: 0 }, changes: [], failed: [], steps: [] };

  const selected = input.selection?.sectionId ? findSectionById(t.doc, input.selection.sectionId) : null;
  const selection = selected ? { pageId: selected.pageId, sectionId: selected.section.id, label: sectionLabel(selected.section) } : null;
  const userRow = { id: newId("msg"), siteId: site.id, role: "user" as const, content: input.message, meta: selection ? { selection } : {}, versionId: null, createdBy: userId, createdAt: now(d) };
  await d.db.insert(siteMessages).values(userRow);

  const [{ n } = { n: 0 }] = await d.db.select({ n: sql<number>`count(*)` }).from(siteMessages).where(eq(siteMessages.siteId, site.id));
  // The first message on an empty store builds it; everything after edits it.
  const mode = input.mode === "build" || input.mode === "edit" ? input.mode : Number(n) <= 1 && t.doc.products.length === 0 ? "build" : "edit";
  emit({ type: "start", userMessage: messageView(userRow), mode });

  let status: "ok" | "error" | "cancelled" = "ok";
  let result: TurnResult;
  let errorInfo: { code: string; message: string } | null = null;
  try {
    result = mode === "build" ? await build(t, input.message) : await edit(t, input, selected);
  } catch (e) {
    if (e instanceof Cancelled || signal.aborted) {
      status = "cancelled";
      result = { message: t.changes.length ? "Stopped. I kept the changes made so far." : "Stopped.", suggestions: [] };
    } else {
      status = "error";
      const msg = e instanceof HttpError ? e.message : "Something went wrong while I was working on that.";
      console.error(JSON.stringify({ level: "error", where: "builder.chat", siteId: site.id, message: e instanceof Error ? e.message : String(e) }));
      errorInfo = { code: e instanceof HttpError ? e.code : "ai_failed", message: msg };
      result = { message: t.changes.length ? `${msg} I kept the changes I had already made.` : `${msg} Please try again.`, suggestions: [] };
    }
  }

  try {
    const versionId = t.changes.length ? await addVersion(d, site.id, "ai", input.message.slice(0, 120), t.doc, userId) : null;
    const meta: Partial<ChatMessageView> = {
      status, ...(selection ? { selection } : {}),
      changes: t.changes.map((c) => ({ summary: c.summary, target: c.target })),
      ...(t.failed.length ? { failed: t.failed.slice(0, 10) } : {}),
      ...(t.steps.length ? { steps: t.steps } : {}),
      ...(result.suggestions.length ? { suggestions: result.suggestions } : {}),
    };
    const assistantRow = { id: newId("msg"), siteId: site.id, role: "assistant" as const, content: result.message, meta, versionId, createdBy: null, createdAt: now(d) };
    await d.db.insert(siteMessages).values(assistantRow);
    // The attempt is counted even when it fails: the model cost was incurred.
    await recordUsage(d, site.organizationId, "builder_messages");
    await d.db.insert(schema.aiGenerations).values({
      id: newId("gen"), storeId: site.id, organizationId: site.organizationId, requestedBy: userId, task: mode === "build" ? "site.build" : "site.edit",
      provider: "ai_gateway", model: chat.model, prompt: input.message.slice(0, 1000), status: status === "error" ? "failed" : "succeeded",
      durationMs: Date.now() - started, inputTokens: t.tokens.input || null, outputTokens: t.tokens.output || null,
      estimatedCostUsd: estimateCostUsd(d, { model: chat.model, inputTokens: t.tokens.input, outputTokens: t.tokens.output }),
      error: errorInfo?.message.slice(0, 300) ?? null, createdAt: now(d),
    });
    await d.db.update(sites).set({ updatedAt: now(d) }).where(eq(sites.id, site.id));
    const q = await quota(d, site.organizationId, "builder_messages");
    if (errorInfo) emit({ type: "error", ...errorInfo, message_: messageView(assistantRow) });
    else emit({ type: "done", message: messageView(assistantRow), revision: t.revision, usage: { used: q.used, limit: q.limit } });
  } finally {
    await releaseBusy(d, site.id);
  }
}

/* ---------- shared helpers ---------- */

function check(t: Turn) { if (t.signal.aborted) throw new Cancelled(); }

function step(t: Turn, key: string, label: string, state: "active" | "done" | "error" | "skipped", detail?: string) {
  t.emit({ type: "status", step: key, label, state, ...(detail ? { detail } : {}) });
  if (state !== "active") {
    const i = t.steps.findIndex((s) => s.key === key);
    const entry = { key, label, state };
    if (i >= 0) t.steps[i] = entry; else t.steps.push(entry);
  }
}

/** Applies operations, saves the draft and shows the merchant the result. */
async function apply(t: Turn, ops: unknown[]): Promise<AppliedOp[]> {
  if (!ops.length) return [];
  const r = applyOps(t.doc, ops);
  t.failed.push(...r.failed);
  if (r.applied.length) await commit(t, r.doc, r.applied);
  return r.applied;
}

async function commit(t: Turn, doc: SiteDocument, applied: AppliedOp[] = []) {
  t.revision = await writeDraft(t.d, t.site.id, doc, t.revision);
  t.doc = doc;
  t.changes.push(...applied);
  t.emit({ type: "doc", doc, revision: t.revision });
  if (applied.length) t.emit({ type: "ops", applied, failed: [] });
  await extendBusy(t.d, t.site.id);
}

function linked(t: Turn): AbortSignal {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS);
  t.signal.addEventListener("abort", () => ctl.abort(), { once: true });
  ctl.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return ctl.signal;
}

function count(t: Turn, u: { inputTokens?: number; outputTokens?: number }) {
  t.tokens.input += u.inputTokens ?? 0;
  t.tokens.output += u.outputTokens ?? 0;
}

/** A JSON-answering model call, with one corrective retry when the answer is not JSON. */
async function askJson(t: Turn, p: { system: string; user: string }, maxTokens: number): Promise<Record<string, unknown>> {
  const messages: ChatMessage[] = [{ role: "system", content: p.system }, { role: "user", content: p.user }];
  for (let attempt = 0; attempt < 2; attempt++) {
    check(t);
    const r = await t.chat.complete({ messages, maxTokens, json: true, temperature: 0.7 }, linked(t));
    count(t, r.usage);
    try {
      const j = extractJson(r.text);
      if (isObj(j)) return j;
    } catch { /* retry below */ }
    messages.push({ role: "assistant", content: r.text.slice(0, 4000) }, { role: "user", content: "That was not a valid JSON object. Reply again with only the JSON object, no prose." });
  }
  throw new Error("model did not return JSON");
}

const str = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strings = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 60)).slice(0, max) : []);
const objects = (v: unknown, max: number) => (Array.isArray(v) ? v.filter(isObj).slice(0, max) : []);

/* ---------- first build ---------- */

async function build(t: Turn, request: string): Promise<TurnResult> {
  const { d, site } = t;
  const currency = t.doc.settings.currency;
  const label = (k: string) => BUILD_STEPS.find((s) => s.key === k)!.label;
  const notes: string[] = [];

  // 1. Brand and visual identity.
  step(t, "brief", label("brief"), "active");
  let brief: Brief = { brand: { name: site.name, tagline: "" }, summary: request.slice(0, 200), voice: "warm, clear", categories: [], imageStyle: "soft natural light, clean neutral backdrop, true-to-life colour" };
  try {
    const j = await askJson(t, briefPrompt(request, currency), 1400);
    const brand = isObj(j["brand"]) ? j["brand"] : {};
    brief = {
      brand: { name: str(brand["name"], 60) || site.name, tagline: str(brand["tagline"], 140) },
      summary: str(j["summary"], 300) || brief.summary, voice: str(j["voice"], 120) || brief.voice,
      categories: strings(j["categories"], 4), imageStyle: str(j["imageStyle"], 300) || brief.imageStyle,
    };
    await apply(t, [{ op: "set_brand", brand: brief.brand }, ...(isObj(j["theme"]) ? [{ op: "set_theme", theme: j["theme"] }] : [])]);
    step(t, "brief", label("brief"), "done");
  } catch (e) {
    if (e instanceof Cancelled) throw e;
    notes.push("I used a default visual style; ask me to change the colours or fonts any time.");
    step(t, "brief", label("brief"), "error", "Used a default style");
  }
  const name = brief.brand.name;
  // A store created from a prompt takes the brand's name, and its address with it while it has never been published.
  const rename = site.name === "New store" && !site.publishedAt && name !== site.name;
  await d.db.update(sites).set({
    brief: { summary: brief.summary, voice: brief.voice, imageStyle: brief.imageStyle },
    ...(rename ? { name, slug: await uniquePublicSlug(d, name) } : {}),
  }).where(eq(sites.id, site.id));

  // 2. Catalogue.
  step(t, "catalog", label("catalog"), "active");
  try {
    const j = await askJson(t, catalogPrompt(brief, request, currency), 4000);
    const collections = objects(j["collections"], 6).map((c) => ({ op: "add_collection", collection: { id: c["id"], title: c["title"], description: c["description"] ?? "" } }));
    await apply(t, collections);
    const products = objects(j["products"], 16).map((p) => ({
      op: "add_product",
      product: {
        id: p["id"], title: p["title"], description: p["description"] ?? "", price: p["price"], compareAtPrice: null,
        category: p["category"], collection: p["collection"], tags: p["tags"] ?? [], options: p["options"] ?? [], featured: p["featured"] === true,
        images: [{ src: "", alt: str(p["title"], 160), prompt: str(p["imagePrompt"], 300) || str(p["title"], 160) }],
      },
    }));
    await apply(t, products);
    // Collections the model listed products for by name rather than id still get them.
    const fixes = t.doc.collections.filter((c) => c.productIds.length === 0).map((c) => ({
      op: "update_collection", collection: c.id,
      props: { productIds: t.doc.products.filter((p) => p.category?.toLowerCase() === c.title.toLowerCase()).map((p) => p.id) },
    })).filter((o) => o.props.productIds.length > 0);
    await apply(t, fixes);
    if (t.doc.products.length === 0) throw new Error("no products");
    step(t, "catalog", label("catalog"), "done");
  } catch (e) {
    if (e instanceof Cancelled) throw e;
    notes.push("I couldn't draft products this time; add them from the Products tab or ask me again.");
    step(t, "catalog", label("catalog"), "error", "No products drafted");
  }

  // 3. Home page.
  step(t, "home", label("home"), "active");
  try {
    const catalog = { collections: t.doc.collections.map((c) => ({ id: c.id, title: c.title, slug: c.slug })), products: t.doc.products.map((p) => ({ id: p.id, title: p.title })) };
    const j = await askJson(t, homePrompt(brief, catalog), 3500);
    const sections = objects(j["sections"], 10);
    if (sections.length < 2) throw new Error("too few sections");
    const home = t.doc.pages.find((p) => p.slug === "")!;
    const before = applyOps(t.doc, home.sections.map((s) => ({ op: "remove_section", section: s.id })));
    const after = applyOps(before.doc, sections.map((s) => ({ op: "add_section", page: home.id, section: s })));
    t.failed.push(...after.failed);
    if (after.applied.length < 2) throw new Error("sections did not validate");
    let doc = after.doc;
    // Every store home page sells: add a product row if the model forgot one.
    if (!doc.pages.find((p) => p.slug === "")!.sections.some((s) => s.type === "featured_products" || s.type === "product_grid")) {
      doc = applyOps(doc, [{ op: "add_section", page: home.id, after: doc.pages.find((p) => p.slug === "")!.sections[0]?.id, section: { type: "featured_products", heading: "Shop the collection", source: "featured" } }]).doc;
    }
    await commit(t, doc, after.applied);
    step(t, "home", label("home"), "done");
  } catch (e) {
    if (e instanceof Cancelled) throw e;
    const hero = t.doc.pages.find((p) => p.slug === "")?.sections.find((s) => s.type === "hero");
    if (hero) await apply(t, [{ op: "update_section", section: hero.id, props: { heading: name, subheading: brief.brand.tagline || brief.summary, image: { src: "", alt: name, prompt: `${brief.summary}, hero image` } } }]);
    notes.push("The home page uses a simple starter layout; ask me to redesign it.");
    step(t, "home", label("home"), "error", "Used a starter layout");
  }

  // 4. Supporting pages, navigation and settings.
  step(t, "pages", label("pages"), "active");
  try {
    const j = await askJson(t, pagesPrompt(brief), 3500);
    const ops: unknown[] = [];
    for (const key of ["about", "faq", "contact"] as const) {
      const sections = isObj(j[key]) ? objects((j[key] as Record<string, unknown>)["sections"], 6) : [];
      const page = t.doc.pages.find((p) => p.id === key);
      if (!page || sections.length === 0) continue;
      ops.push(...page.sections.map((s) => ({ op: "remove_section", section: s.id })), ...sections.map((s) => ({ op: "add_section", page: key, section: s })));
    }
    const settings: Record<string, unknown> = {};
    if (isObj(j["announcement"]) && str(j["announcement"]["text"], 140)) settings["announcement"] = { enabled: true, text: str(j["announcement"]["text"], 140) };
    if (isObj(j["seo"])) settings["seo"] = { title: str(j["seo"]["title"], 70) || undefined, description: str(j["seo"]["description"], 170) || undefined };
    if (Object.keys(settings).length) ops.push({ op: "set_settings", settings });
    ops.push({ op: "set_navigation", navigation: standardNavigation(t.doc, str(j["footerNote"], 200)) });
    await apply(t, ops);
    step(t, "pages", label("pages"), "done");
  } catch (e) {
    if (e instanceof Cancelled) throw e;
    await apply(t, [{ op: "set_navigation", navigation: standardNavigation(t.doc, "") }]);
    step(t, "pages", label("pages"), "error", "Kept the starter pages");
  }

  // 5. Images.
  const made = await fillImages(t, brief.imageStyle, BUILD_IMAGES, label("images"));
  if (made.skipped) notes.push(made.skipped);

  // 6. Checks.
  step(t, "finish", label("finish"), "active");
  const { errors, warnings } = checkSite(t.doc);
  step(t, "finish", label("finish"), "done");

  const products = t.doc.products.length;
  const collections = t.doc.collections.length;
  const parts = [
    `${name} is ready to review: ${products} product${products === 1 ? "" : "s"}${collections ? ` in ${collections} collection${collections === 1 ? "" : "s"}` : ""}, a home page, and About, FAQ, Contact and Shop pages.`,
    "Prices and descriptions are drafts, so check them before you publish.",
    ...notes,
    errors.length ? `Before publishing: ${errors[0]!.message}` : warnings.length ? `${warnings.length} thing${warnings.length === 1 ? "" : "s"} to tidy up before launch are listed under Publish.` : "",
  ].filter(Boolean);
  return {
    message: parts.join(" "),
    suggestions: ["Make the hero more dramatic", "Add a gift guide page", "Try a warmer colour palette"],
  };
}

function standardNavigation(doc: SiteDocument, footerNote: string) {
  const has = (slug: string) => doc.pages.some((p) => p.slug === slug);
  const header = [
    { label: "Shop all", href: "/shop" },
    ...doc.collections.slice(0, 2).map((c) => ({ label: c.title.slice(0, 40), href: `/collections/${c.slug}` })),
    ...(has("about") ? [{ label: "About", href: "/about" }] : []),
    ...(has("contact") ? [{ label: "Contact", href: "/contact" }] : []),
  ];
  return {
    header,
    footer: [
      { title: "Shop", links: [{ label: "All products", href: "/collections/all" }, ...doc.collections.slice(0, 5).map((c) => ({ label: c.title.slice(0, 40), href: `/collections/${c.slug}` }))] },
      { title: "Help", links: [...(has("faq") ? [{ label: "FAQ", href: "/faq" }] : []), ...(has("contact") ? [{ label: "Contact us", href: "/contact" }] : [])] },
      ...(has("about") ? [{ title: "Company", links: [{ label: "Our story", href: "/about" }] }] : []),
    ].filter((g) => g.links.length > 0),
    footerNote,
  };
}

/* ---------- images ---------- */

type Slot = { key: string; prompt: string; alt: string; set: (doc: SiteDocument, ref: string) => void };

/** Every image in the document that has a prompt but no picture yet, most visible first. */
function imageSlots(doc: SiteDocument): Slot[] {
  const slots: Slot[] = [];
  const home = doc.pages.find((p) => p.slug === "");
  const pages = home ? [home, ...doc.pages.filter((p) => p !== home)] : doc.pages;
  for (const page of pages) {
    for (const s of page.sections) {
      if ("image" in s && s.image && !s.image.src && s.image.prompt) {
        const id = s.id;
        slots.push({ key: `s:${id}`, prompt: s.image.prompt, alt: s.image.alt, set: (d, ref) => { for (const p of d.pages) for (const x of p.sections) if (x.id === id && "image" in x && x.image) x.image.src = ref; } });
      }
      if (s.type === "gallery") s.images.forEach((img, i) => {
        if (!img.src && img.prompt) { const id = s.id; slots.push({ key: `g:${id}:${i}`, prompt: img.prompt, alt: img.alt, set: (d, ref) => { for (const p of d.pages) for (const x of p.sections) if (x.id === id && x.type === "gallery" && x.images[i]) x.images[i].src = ref; } }); }
      });
    }
  }
  // Featured products first: they are what the home page shows.
  const products = [...doc.products].sort((a, b) => Number(b.featured) - Number(a.featured));
  for (const p of products) {
    const img = p.images[0];
    if (img && !img.src && img.prompt) { const id = p.id; slots.push({ key: `p:${id}`, prompt: img.prompt, alt: img.alt || p.title, set: (d, ref) => { const x = d.products.find((q) => q.id === id); if (x?.images[0]) x.images[0].src = ref; } }); }
  }
  return slots;
}

async function fillImages(t: Turn, style: string, max: number, label: string, onlyKeys?: Set<string>): Promise<{ made: number; skipped?: string }> {
  let slots = imageSlots(t.doc);
  if (onlyKeys) slots = slots.filter((s) => onlyKeys.has(s.key));
  if (slots.length === 0) return { made: 0 };
  if (!t.d.builderImages) {
    step(t, "images", label, "skipped", "Image generation is not configured");
    return { made: 0, skipped: "Images are placeholders for now: upload your own photos, or turn on image generation." };
  }
  const q = await quota(t.d, t.site.organizationId, "ai_images");
  const budget = Math.min(max, slots.length, q.remaining);
  if (budget <= 0) {
    step(t, "images", label, "skipped", "Monthly image allowance used");
    return { made: 0, skipped: "You've used this month's AI images, so the photos are placeholders. Upload your own from the editor." };
  }
  step(t, "images", label, "active", `0 of ${budget}`);
  let made = 0;
  const queue = slots.slice(0, budget);
  for (let i = 0; i < queue.length; i += IMAGE_CONCURRENCY) {
    check(t);
    const batch = queue.slice(i, i + IMAGE_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((s) => generateImage(t.d, t.site, imagePrompt(s.prompt, style), s.alt, linked(t))));
    const doc = structuredClone(t.doc);
    let changed = false;
    results.forEach((r, j) => { if (r.status === "fulfilled") { batch[j]!.set(doc, r.value.ref); made++; changed = true; } });
    if (changed) await commit(t, doc);
    step(t, "images", label, "active", `${made} of ${budget}`);
  }
  step(t, "images", label, made > 0 ? "done" : "error", made > 0 ? `${made} image${made === 1 ? "" : "s"}` : "Image generation failed");
  return made < slots.length ? { made, skipped: made === 0 ? "I couldn't create images this time; the photos are placeholders you can replace." : undefined } : { made };
}

/* ---------- edit turns ---------- */

async function edit(t: Turn, input: ChatInput, selected: ReturnType<typeof findSectionById>): Promise<TurnResult> {
  const history = (await t.d.db.select().from(siteMessages).where(eq(siteMessages.siteId, t.site.id)).orderBy(desc(siteMessages.createdAt), desc(sql`rowid`)).limit(9))
    .reverse().slice(0, -1).map((m): ChatTurn => ({ role: m.role, content: m.content }));
  const p = editPrompt(t.doc, input.message, { history, selection: selected, ...(input.path ? { currentPath: input.path } : {}) });
  const messages: ChatMessage[] = [{ role: "system", content: p.system }, { role: "user", content: p.user }];

  step(t, "think", "Planning changes", "active");
  const tagged = new TaggedStream();
  let streamed = "";
  const r = await t.chat.stream({ messages, maxTokens: 4000, temperature: 0.5 }, (piece) => {
    const delta = tagged.push(piece);
    if (delta) { streamed += delta; t.emit({ type: "delta", text: delta }); }
  }, linked(t));
  count(t, r.usage);
  check(t);
  let parsed = parseEditResponse(r.text);
  if (parsed.opsParseError) {
    // One corrective retry for malformed operations; the merchant already read the message.
    const retry = await t.chat.complete({ messages: [...messages, { role: "assistant", content: r.text.slice(0, 6000) }, { role: "user", content: "The <ops> block was not valid JSON. Reply again in exactly the same format with valid JSON." }], maxTokens: 4000, temperature: 0.2 }, linked(t));
    count(t, retry.usage);
    const again = parseEditResponse(retry.text);
    parsed = { ...again, message: parsed.message || again.message };
  }
  step(t, "think", "Planning changes", "done");

  let applied: AppliedOp[] = [];
  if (parsed.ops.length) {
    step(t, "apply", "Updating your store", "active");
    const before = new Set(imageSlots(t.doc).map((s) => s.key));
    applied = await apply(t, parsed.ops);
    step(t, "apply", "Updating your store", applied.length ? "done" : "error");
    const fresh = new Set(imageSlots(t.doc).map((s) => s.key).filter((k) => !before.has(k)));
    if (fresh.size) {
      const [row] = await t.d.db.select({ brief: sites.brief }).from(sites).where(eq(sites.id, t.site.id)).limit(1);
      const style = str(row?.brief?.["imageStyle"], 300) || "soft natural light, clean backdrop, true-to-life colour";
      await fillImages(t, style, EDIT_IMAGES, "Creating images", fresh);
    }
  }

  let message = parsed.message;
  if (!message) message = applied.length ? `Done: ${applied.map((a) => a.summary.toLowerCase()).slice(0, 3).join(", ")}.` : "I wasn't sure what to change. Could you describe it another way?";
  if (parsed.ops.length && applied.length === 0) {
    message += ` I couldn't apply it, though: ${t.failed[0]?.error ?? "the change was not valid"}. Try rephrasing, or select the section you mean.`;
  } else if (parsed.opsParseError && applied.length === 0) {
    message += " I couldn't turn that into a change this time. Please try again.";
  }
  // The model replied without the <message> tags: show the final text now.
  if (!streamed) t.emit({ type: "delta", text: message });
  return { message, suggestions: parsed.suggestions };
}
