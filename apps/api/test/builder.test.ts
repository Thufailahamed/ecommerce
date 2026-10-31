import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FakeChatModel, FakeImageModel, type ChatRequest } from "@convertflow/ai";
import { schema } from "@convertflow/database";
import { SseDecoder, type ChatEvent, type SiteDocument } from "@convertflow/store-builder";
import { KEY, makeEnv, setPlan, signup, type Env } from "./helpers.js";

/* ---------- a scripted model: answers each build step, and edit turns from a queue ---------- */

const BRIEF = { brand: { name: "Ember & Oak", tagline: "Small-batch candles for slow evenings" }, summary: "Hand-poured soy candles", voice: "warm, calm", theme: { palette: { background: "#fbf8f3", surface: "#f1ebe1", text: "#22201c", muted: "#6f685d", primary: "#2f3b2f", primaryText: "#fbf8f3", accent: "#b5683c", border: "#e3dbcd" }, fonts: { heading: "Playfair Display", body: "dm_sans" }, radius: "sm" }, categories: ["Candles", "Gift sets"], imageStyle: "warm candlelight, linen" };
const CATALOG = {
  collections: [{ id: "candles", title: "Candles", description: "Hand-poured." }, { id: "gift_sets", title: "Gift sets", description: "Ready to give." }],
  products: [
    { id: "cedar", title: "Cedar Smoke", description: "Woody.\n\nBurns 50 hours.", price: "34", category: "Candles", collection: "candles", featured: true, imagePrompt: "amber jar candle" },
    { id: "fig", title: "Fig Leaf", description: "Green.", price: 32, category: "Candles", collection: "candles", options: [{ name: "Size", values: ["8oz", "12oz"] }], featured: true, imagePrompt: "green candle" },
    { id: "trio", title: "Evening Trio", description: "Three minis.", price: 48, category: "Gift sets", collection: "gift_sets", imagePrompt: "three candles in a box" },
  ],
};
const HOME = { sections: [
  { type: "hero", heading: "Light the slow evening", subheading: "Small batches, poured by hand.", primaryCta: { label: "Shop candles", href: "/collections/candles" }, image: { alt: "Candle", prompt: "candle on a linen table" }, layout: "split" },
  { type: "featured_products", heading: "Bestsellers", source: "featured", limit: 4 },
  { type: "collection_list", heading: "Shop by collection" },
  { type: "testimonials", items: [{ quote: "Best candle ever", author: "Sam" }] },
  { type: "newsletter", heading: "Join the list" },
] };
const PAGES = {
  about: { sections: [{ type: "image_with_text", heading: "Our story", body: "We started in a kitchen.", image: { alt: "Workshop", prompt: "candle workshop" } }] },
  faq: { sections: [{ type: "faq", items: [{ question: "Do you ship?", answer: "Shipping options are shown at checkout." }] }] },
  contact: { sections: [{ type: "contact", heading: "Say hello", showForm: true }] },
  announcement: { enabled: true, text: "New autumn scents are here" },
  footerNote: "Poured in small batches.",
  seo: { title: "Ember & Oak candles", description: "Hand-poured soy candles." },
};

function scripted(edits: string[] = []) {
  return new FakeChatModel((req: ChatRequest) => {
    const sys = req.messages[0]!.content;
    if (sys.includes("creative director")) return JSON.stringify(BRIEF);
    if (sys.includes("merchandiser")) return "Here you go:\n```json\n" + JSON.stringify(CATALOG) + "\n```";
    if (sys.includes("laying out the home page")) return JSON.stringify(HOME);
    if (sys.includes("supporting pages")) return JSON.stringify(PAGES);
    return edits.shift() ?? "<message>Nothing to change.</message><ops>[]</ops>";
  });
}

async function setup(chat = scripted(), images: FakeImageModel | null = new FakeImageModel(), email = "builder@example.com") {
  const env = await makeEnv(undefined, { secrets: { credentialKey: KEY, webOrigin: "http://localhost:3000" } });
  env.deps.builderChat = chat;
  if (images) env.deps.builderImages = images;
  const u = await signup(env, email);
  const created = await u.c.post("/api/v1/sites", { organizationId: u.orgId, name: "New store", currency: "USD" });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  return { env, ...u, siteId: created.json.data.id as string, chat, images };
}

async function chat(env: Env, cookie: string, siteId: string, b: Record<string, unknown>) {
  const res = await env.app.request(`/api/v1/sites/${siteId}/chat`, { method: "POST", headers: { origin: "http://localhost:3000", cookie, "content-type": "application/json" }, body: JSON.stringify(b) });
  if (!res.headers.get("content-type")?.includes("event-stream")) return { status: res.status, events: [] as ChatEvent[], json: await res.json() };
  const events = new SseDecoder().push(await res.text());
  return { status: res.status, events, json: null };
}

const draftOf = async (env: Env, siteId: string) => (await env.deps.db.select().from(schema.sites).where(eq(schema.sites.id, siteId)))[0]!;

describe("AI store builder: first build", () => {
  it("builds a complete store step by step, streams progress and generates images", async () => {
    const { env, c, siteId, images } = await setup();
    const r = await chat(env, c.cookie, siteId, { message: "A candle shop called Ember & Oak with cosy autumn vibes" });
    expect(r.status).toBe(200);
    const types = r.events.map((e) => e.type);
    expect(types[0]).toBe("start");
    expect(types.at(-1)).toBe("done");
    expect(r.events.filter((e) => e.type === "doc").length).toBeGreaterThan(3);
    const done = r.events.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.message.steps?.map((s) => [s.key, s.state])).toEqual([["brief", "done"], ["catalog", "done"], ["home", "done"], ["pages", "done"], ["images", "done"], ["finish", "done"]]);

    const site = await draftOf(env, siteId);
    const doc = site.draft as SiteDocument;
    expect(site.name).toBe("Ember & Oak");
    expect(site.slug).toBe("ember-and-oak");
    expect(doc.brand.name).toBe("Ember & Oak");
    expect(doc.theme.fonts.heading).toBe("playfair");
    expect(doc.products.map((p) => [p.title, p.price])).toEqual([["Cedar Smoke", 34], ["Fig Leaf", 32], ["Evening Trio", 48]]);
    expect(doc.collections.find((x) => x.id === "candles")?.productIds).toEqual(["cedar", "fig"]);
    const home = doc.pages.find((p) => p.slug === "")!;
    expect(home.sections.map((s) => s.type)).toEqual(["hero", "featured_products", "collection_list", "testimonials", "newsletter"]);
    // Model-written testimonials are always samples until the merchant confirms them.
    expect(home.sections.find((s) => s.type === "testimonials")).toMatchObject({ sample: true });
    expect(doc.settings.announcement).toMatchObject({ enabled: true, text: "New autumn scents are here" });
    expect(doc.navigation.header.map((l) => l.href)).toEqual(["/shop", "/collections/candles", "/collections/gift-sets", "/about", "/contact"]);
    // Hero, about image and three products.
    expect(images!.prompts).toHaveLength(5);
    expect(images!.prompts[0]).toContain("warm candlelight, linen");
    expect((home.sections[0] as { image: { src: string } }).image.src).toMatch(/^asset:ast_[a-f0-9]{20}$/);
    expect(doc.products.every((p) => p.images[0]!.src.startsWith("asset:"))).toBe(true);

    const usage = await env.deps.db.select().from(schema.usageRecords);
    expect(usage.find((u) => u.metric === "builder_messages")?.count).toBe(1);
    expect(usage.find((u) => u.metric === "ai_images")?.count).toBe(5);
    const msgs = await c.get(`/api/v1/sites/${siteId}/messages`);
    expect(msgs.json.data.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs.json.data[1].versionId).toBeTruthy();
    expect(site.busyUntil).toBeNull();
  });

  it("still produces a usable store when the model fails and images are off", async () => {
    const broken = new FakeChatModel(() => "I'm sorry, I can't help with JSON today.");
    const { env, c, siteId } = await setup(broken, null);
    const r = await chat(env, c.cookie, siteId, { message: "A plant shop" });
    const done = r.events.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.type).toBe("done");
    expect(done.message.steps?.find((s) => s.key === "brief")?.state).toBe("error");
    expect(done.message.content).toMatch(/couldn't draft products/);
    const doc = (await draftOf(env, siteId)).draft as SiteDocument;
    expect(doc.pages.map((p) => p.slug)).toContain("");
    // Two attempts per JSON step: the corrective retry happens.
    expect(broken.requests.length).toBe(8);
  });
});

describe("AI store builder: edit turns", () => {
  it("streams the reply, applies operations to the selected section and records a version", async () => {
    const reply = `<message>Made the hero headline punchier.</message><ops>[{"op":"update_section","section":"hero","props":{"heading":"Evenings, slowed down"}}]</ops><suggestions>["Add a gift guide"]</suggestions>`;
    const model = scripted([reply]);
    const { env, c, siteId } = await setup(model, null);
    // Skip the build: an edit on the starter store.
    const r = await chat(env, c.cookie, siteId, { message: "Make this punchier", selection: { sectionId: "hero" }, mode: "edit" });
    const text = r.events.filter((e): e is Extract<ChatEvent, { type: "delta" }> => e.type === "delta").map((e) => e.text).join("");
    expect(text).toBe("Made the hero headline punchier.");
    const done = r.events.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.message.changes).toEqual([{ summary: "Edited hero", target: "hero" }]);
    expect(done.message.suggestions).toEqual(["Add a gift guide"]);
    expect(done.message.selection?.sectionId).toBe("hero");
    const prompt = model.requests[0]!.messages[1]!.content;
    expect(prompt).toContain("<selected_section>");
    const doc = (await draftOf(env, siteId)).draft as SiteDocument;
    expect((doc.pages[0]!.sections[0] as { heading: string }).heading).toBe("Evenings, slowed down");
    const versions = await c.get(`/api/v1/sites/${siteId}/versions`);
    expect(versions.json.data[0]).toMatchObject({ kind: "ai", label: "Make this punchier" });
  });

  it("retries once when the operations are malformed, and explains when nothing could be applied", async () => {
    const model = scripted([
      `<message>Removing it.</message><ops>[{"op":"remove_section", section: oops}]</ops>`,
      `<message>Removing it.</message><ops>[{"op":"remove_page","page":"home"}]</ops>`,
    ]);
    const { env, c, siteId } = await setup(model, null);
    const r = await chat(env, c.cookie, siteId, { message: "Delete the home page", mode: "edit" });
    const done = r.events.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(model.requests).toHaveLength(2);
    expect(done.message.content).toMatch(/couldn't apply it.*home page cannot be removed/);
    expect(done.message.versionId).toBeNull();
  });

  it("refuses a second turn while one is running, and when AI is not configured", async () => {
    const { env, c, siteId } = await setup();
    await env.deps.db.update(schema.sites).set({ busyUntil: new Date(Date.parse("2026-10-27T12:01:00Z")).toISOString() }).where(eq(schema.sites.id, siteId));
    expect((await chat(env, c.cookie, siteId, { message: "hi" })).status).toBe(409);
    delete env.deps.builderChat;
    expect((await chat(env, c.cookie, siteId, { message: "hi" })).status).toBe(503);
  });

  it("stops at the monthly allowance", async () => {
    const { env, c, siteId, orgId } = await setup(scripted(), null);
    await env.deps.db.insert(schema.usageRecords).values({ organizationId: orgId, metric: "builder_messages", period: "2026-10", count: 30 });
    const r = await chat(env, c.cookie, siteId, { message: "hi" });
    expect(r.status).toBe(402);
  });
});

describe("AI store builder: drafts, versions, publishing", () => {
  it("saves with optimistic concurrency and validates the document", async () => {
    const { c, siteId } = await setup();
    const site = (await c.get(`/api/v1/sites/${siteId}`)).json.data;
    const doc = { ...site.draft, brand: { ...site.draft.brand, tagline: "Hand-poured" } };
    const ok = await c.put(`/api/v1/sites/${siteId}/draft`, { document: doc, revision: site.revision });
    expect(ok.status).toBe(200);
    expect(ok.json.data.revision).toBe(site.revision + 1);
    expect((await c.put(`/api/v1/sites/${siteId}/draft`, { document: doc, revision: site.revision })).status).toBe(409);
    const bad = await c.put(`/api/v1/sites/${siteId}/draft`, { document: { ...doc, pages: [] }, revision: site.revision + 1 });
    expect(bad.status).toBe(422);
  });

  it("restores an earlier version into the draft", async () => {
    const { c, siteId } = await setup();
    const site = (await c.get(`/api/v1/sites/${siteId}`)).json.data;
    await c.put(`/api/v1/sites/${siteId}/draft`, { document: { ...site.draft, brand: { ...site.draft.brand, name: "Renamed" } }, revision: site.revision });
    const versions = (await c.get(`/api/v1/sites/${siteId}/versions`)).json.data as { id: string; kind: string }[];
    const initial = versions.find((v) => v.kind === "initial")!;
    const r = await c.post(`/api/v1/sites/${siteId}/versions/${initial.id}/restore`, { revision: site.revision + 1 });
    expect(r.status).toBe(200);
    expect(r.json.data.draft.brand.name).toBe("New store");
  });

  it("blocks publishing until the checklist passes, then serves the published version only", async () => {
    const { env, c, siteId } = await setup();
    let site = (await c.get(`/api/v1/sites/${siteId}`)).json.data;
    const blocked = await c.post(`/api/v1/sites/${siteId}/publish`, { approve: true, revision: site.revision });
    expect(blocked.status).toBe(422);
    expect(blocked.json.error.details.map((i: { code: string }) => i.code)).toContain("no_products");

    await chat(env, c.cookie, siteId, { message: "A candle shop" });
    site = (await c.get(`/api/v1/sites/${siteId}`)).json.data;
    const sample = await c.post(`/api/v1/sites/${siteId}/publish`, { approve: true, revision: site.revision });
    expect(sample.json.error.details.map((i: { code: string }) => i.code)).toEqual(["sample_testimonials"]);

    // The merchant hides the sample quotes.
    const doc = structuredClone(site.draft) as SiteDocument;
    const t = doc.pages[0]!.sections.find((s) => s.type === "testimonials")!;
    t.hidden = true;
    const saved = await c.put(`/api/v1/sites/${siteId}/draft`, { document: doc, revision: site.revision });
    expect((await c.post(`/api/v1/sites/${siteId}/publish`, { approve: true, revision: site.revision })).status).toBe(409);
    const pub = await c.post(`/api/v1/sites/${siteId}/publish`, { approve: true, revision: saved.json.data.revision });
    expect(pub.status, JSON.stringify(pub.json)).toBe(200);

    const slug = pub.json.data.slug as string;
    const live = await env.app.request(`/api/v1/storefront/${slug}`);
    expect(live.status).toBe(200);
    expect(live.headers.get("access-control-allow-origin")).toBe("*");
    const liveDoc = ((await live.json()) as { data: { document: SiteDocument } }).data.document;
    expect(liveDoc.products).toHaveLength(3);

    // Later draft edits do not reach shoppers until published again.
    const next = structuredClone(saved.json.data.draft) as SiteDocument;
    next.brand.tagline = "Draft only";
    await c.put(`/api/v1/sites/${siteId}/draft`, { document: next, revision: saved.json.data.revision });
    const again = ((await (await env.app.request(`/api/v1/storefront/${slug}`)).json()) as { data: { document: SiteDocument } }).data.document;
    expect(again.brand.tagline).not.toBe("Draft only");

    expect((await c.post(`/api/v1/sites/${siteId}/unpublish`)).status).toBe(204);
    expect((await env.app.request(`/api/v1/storefront/${slug}`)).status).toBe(404);
  });
});

async function publishedStore(opts: { stripe?: boolean } = {}) {
  const calls: { url: string; body?: string }[] = [];
  const stripe = { paid: false, ref: "" };
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    if (url.endsWith("/v1/balance")) return Response.json({ available: [] });
    if (url.endsWith("/v1/checkout/sessions")) { stripe.ref = new URLSearchParams(String(init?.body)).get("client_reference_id") ?? ""; return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }); }
    if (url.includes("/v1/checkout/sessions/")) return Response.json({ payment_status: stripe.paid ? "paid" : "unpaid", client_reference_id: stripe.ref });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  const s = await setup(scripted(), new FakeImageModel());
  s.env.deps.fetchFn = fetchFn;
  await chat(s.env, s.c.cookie, s.siteId, { message: "A candle shop" });
  let site = (await s.c.get(`/api/v1/sites/${s.siteId}`)).json.data;
  const doc = structuredClone(site.draft) as SiteDocument;
  doc.pages[0]!.sections = doc.pages[0]!.sections.filter((x) => x.type !== "testimonials");
  doc.settings.shipping = { flatRate: 5, freeOver: 100 };
  const saved = await s.c.put(`/api/v1/sites/${s.siteId}/draft`, { document: doc, revision: site.revision });
  if (opts.stripe) expect((await s.c.put(`/api/v1/sites/${s.siteId}/payments`, { stripeSecretKey: "sk_test_abcdefghijklmnop" })).status).toBe(200);
  site = (await s.c.get(`/api/v1/sites/${s.siteId}`)).json.data;
  const pub = await s.c.post(`/api/v1/sites/${s.siteId}/publish`, { approve: true, revision: saved.json.data.revision });
  expect(pub.status, JSON.stringify(pub.json)).toBe(200);
  return { ...s, slug: pub.json.data.slug as string, calls, stripe };
}

const customer = { email: "Shopper@Example.com", name: "Alex Shopper", address1: "1 Main St", city: "Springfield", postalCode: "12345", country: "US" };
const shop = (env: Env, path: string, b?: unknown) => env.app.request(path, b === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

describe("AI store builder: storefront commerce", () => {
  it("prices orders on the server, ignores prices sent by the browser, and guards order lookup", async () => {
    const { env, c, siteId, slug } = await publishedStore();
    const res = await shop(env, `/api/v1/storefront/${slug}/checkout`, { lines: [{ productId: "cedar", quantity: 2, price: 0.01 }], customer });
    expect(res.status).toBe(201);
    const o = ((await res.json()) as { data: { orderId: string; token: string; redirectUrl: null } }).data;
    expect(o.redirectUrl).toBeNull();
    const view = await shop(env, `/api/v1/storefront/${slug}/orders/${o.orderId}?token=${o.token}`);
    const order = ((await view.json()) as { data: { total: number; shipping: number; status: string; email: string; number: number } }).data;
    expect(order).toMatchObject({ total: 73, shipping: 5, status: "unpaid", email: "shopper@example.com", number: 1001 });
    expect((await shop(env, `/api/v1/storefront/${slug}/orders/${o.orderId}?token=wrong`)).status).toBe(404);

    // Missing option, unknown product.
    expect((await shop(env, `/api/v1/storefront/${slug}/checkout`, { lines: [{ productId: "fig", quantity: 1 }], customer })).status).toBe(422);
    expect((await shop(env, `/api/v1/storefront/${slug}/checkout`, { lines: [{ productId: "cedar", quantity: 1 }, { productId: "ghost", quantity: 1 }], customer })).status).toBe(409);

    const orders = await c.get(`/api/v1/sites/${siteId}/orders`);
    expect(orders.json.data).toHaveLength(1);
    expect((await c.patch(`/api/v1/sites/${siteId}/orders/${o.orderId}`, { status: "fulfilled" })).status).toBe(204);
  });

  it("sends card payments to Stripe Checkout on the merchant's key and confirms only this order's session", async () => {
    const { env, slug, calls, stripe } = await publishedStore({ stripe: true });
    const res = await shop(env, `/api/v1/storefront/${slug}/checkout`, { lines: [{ productId: "fig", quantity: 1, options: { Size: "12oz" } }], customer });
    const o = ((await res.json()) as { data: { orderId: string; token: string; redirectUrl: string } }).data;
    expect(o.redirectUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    const form = new URLSearchParams(calls.find((x) => x.url.endsWith("/v1/checkout/sessions"))!.body);
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("3200");
    expect(form.get("line_items[0][price_data][product_data][name]")).toBe("Fig Leaf · 12oz");
    expect(form.get("line_items[1][price_data][product_data][name]")).toBe("Shipping");

    const status = async () => ((await (await shop(env, `/api/v1/storefront/${slug}/orders/${o.orderId}?token=${o.token}`)).json()) as { data: { status: string } }).data.status;
    expect(await status()).toBe("pending_payment");
    stripe.paid = true;
    expect(await status()).toBe("paid");
  });

  it("takes the store and its images offline when the account is deleted", async () => {
    const { env, c, siteId, slug } = await publishedStore();
    const doc = ((await (await env.app.request(`/api/v1/storefront/${slug}`)).json()) as { data: { document: SiteDocument } }).data.document;
    const asset = doc.products[0]!.images[0]!.src.replace("asset:", "");
    expect((await c.del("/api/v1/auth/account", { password: "correct-horse-battery" })).status).toBe(204);
    expect((await env.app.request(`/api/v1/storefront/${slug}`)).status).toBe(404);
    expect((await env.app.request(`/api/v1/storefront/assets/${asset}`)).status).toBe(404);
    expect(await env.deps.db.select().from(schema.sites).where(eq(schema.sites.id, siteId))).toHaveLength(0);
  });

  it("collects newsletter sign-ups once and contact messages", async () => {
    const { env, c, siteId, slug } = await publishedStore();
    for (let i = 0; i < 2; i++) expect((await shop(env, `/api/v1/storefront/${slug}/forms`, { kind: "newsletter", email: "a@b.co" })).status).toBe(202);
    expect((await shop(env, `/api/v1/storefront/${slug}/forms`, { kind: "contact", email: "a@b.co", name: "A", message: "Do you ship to Canada?" })).status).toBe(202);
    expect((await shop(env, `/api/v1/storefront/${slug}/forms`, { kind: "newsletter", email: "nope" })).status).toBe(422);
    const subs = await c.get(`/api/v1/sites/${siteId}/submissions`);
    expect(subs.json.data.map((s: { kind: string }) => s.kind).sort()).toEqual(["contact", "newsletter"]);
  });
});

describe("AI store builder: assets, tenancy and plan limits", () => {
  it("accepts real images only, sniffed from the bytes, and serves them publicly", async () => {
    const { env, c, siteId } = await setup();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const up = await env.app.request(`/api/v1/sites/${siteId}/assets?alt=Logo`, { method: "POST", headers: { origin: "http://localhost:3000", cookie: c.cookie, "content-type": "image/png" }, body: png });
    expect(up.status).toBe(201);
    const { id } = ((await up.json()) as { data: { id: string } }).data;
    const svg = await env.app.request(`/api/v1/sites/${siteId}/assets`, { method: "POST", headers: { origin: "http://localhost:3000", cookie: c.cookie, "content-type": "image/png" }, body: "<svg onload=alert(1)>" });
    expect(svg.status).toBe(415);
    const got = await env.app.request(`/api/v1/storefront/assets/${id}`);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(got.headers.get("cache-control")).toContain("immutable");
  });

  it("hides other workspaces' stores and enforces the plan's store count", async () => {
    const { env, c, siteId, orgId } = await setup();
    const other = await signup(env, "other@example.com");
    expect((await other.c.get(`/api/v1/sites/${siteId}`)).status).toBe(404);
    expect((await other.c.put(`/api/v1/sites/${siteId}/draft`, { document: {}, revision: 1 })).status).toBe(404);
    expect((await other.c.get(`/api/v1/sites?organizationId=${orgId}`)).status).toBe(404);
    expect((await c.post("/api/v1/sites", { organizationId: orgId, currency: "USD" })).status).toBe(402);
    await setPlan(env, orgId, "starter");
    expect((await c.post("/api/v1/sites", { organizationId: orgId, currency: "EUR" })).status).toBe(201);
    expect((await c.get(`/api/v1/sites?organizationId=${orgId}`)).json.data).toHaveLength(2);
  });

  it("refuses a public address that is taken or reserved", async () => {
    const { env, c, siteId, orgId } = await setup();
    await setPlan(env, orgId, "starter");
    const second = (await c.post("/api/v1/sites", { organizationId: orgId, name: "Second" })).json.data;
    expect((await c.patch(`/api/v1/sites/${siteId}`, { slug: second.slug })).status).toBe(409);
    expect((await c.patch(`/api/v1/sites/${siteId}`, { slug: "checkout" })).status).toBe(422);
    expect((await c.patch(`/api/v1/sites/${siteId}`, { slug: "ember-and-oak" })).json.data.slug).toBe("ember-and-oak");
  });
});
