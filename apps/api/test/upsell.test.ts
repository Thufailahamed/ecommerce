import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { SHIPPED_TOOLS } from "@convertflow/contracts";
import { Client, makeEnv, setPlan, signup, validConfig, type Env } from "./helpers.js";

interface Item { externalId: string; title?: string; url?: string; handle?: string; imageUrl?: string; status?: "active" | "draft" | "archived"; collectionIds?: string[]; variants?: { externalId: string; price?: number; available?: boolean }[] }
/** An in-stock, single-variant product unless the test says otherwise. */
const item = (id: string, o: Partial<Item> = {}): Item => ({ externalId: id, title: `Item ${id}`, handle: id, status: "active", collectionIds: [], variants: [{ externalId: `${id}-v`, price: 20, available: true }], ...o });
const oos = (id: string, o: Partial<Item> = {}) => item(id, { variants: [{ externalId: `${id}-v`, price: 20, available: false }], ...o });

type Recommend = Record<string, unknown>;
const upsell = (recommend: Recommend, over: Record<string, unknown> = {}) => validConfig({
  tool: "upsell", format: "recommendation", recommend, goal: { type: "add_to_cart" }, trigger: { type: "immediate" },
  targeting: { match: "all", conditions: [] }, ...over,
});

async function shop(o: { products?: Item[]; recommend?: Recommend; plan?: "free" | "starter" | "growth" | "scale"; env?: Env; email?: string; config?: Record<string, unknown> } = {}) {
  const env = o.env ?? (await makeEnv());
  const u = await signup(env, o.email ?? `o${Math.random().toString(36).slice(2, 8)}@example.com`);
  await setPlan(env, u.orgId, "growth");
  const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "custom", name: "Shop", domain: "shop.example.com", currency: "EUR" });
  const storeId = s.json.data.id as string, siteKey = s.json.data.siteKey as string;
  if (o.products?.length) {
    const imp = await u.c.post(`/api/v1/stores/${storeId}/products/import`, { products: o.products });
    expect(imp.status, JSON.stringify(imp.json)).toBe(200);
  }
  const base = `/api/v1/stores/${storeId}`;
  let campaignId = "", versionId = "";
  if (o.recommend || o.config) {
    const c = await u.c.post(`${base}/campaigns`, o.config ?? upsell(o.recommend!));
    expect(c.status, JSON.stringify(c.json)).toBe(201);
    campaignId = c.json.data.id;
    const pub = await u.c.post(`${base}/campaigns/${campaignId}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt });
    expect(pub.status, JSON.stringify(pub.json)).toBe(200);
    versionId = pub.json.data.versionId;
  }
  if (o.plan && o.plan !== "growth") await setPlan(env, u.orgId, o.plan);
  const ask = async (q: Record<string, string> = {}, c = campaignId) => {
    const res = await env.app.request(`/api/v1/recommendations?${new URLSearchParams({ siteId: siteKey, campaignId: c, ...q })}`);
    return { status: res.status, headers: res.headers, json: (await res.json()) as { products: { id: string; title: string; url: string; imageUrl?: string; price?: number; variantId?: string; addable: boolean }[]; currency?: string } };
  };
  const ids = async (q: Record<string, string> = {}) => (await ask(q)).json.products.map((p) => p.id);
  return { env, ...u, storeId, siteKey, base, campaignId, versionId, ask, ids };
}
type Shop = Awaited<ReturnType<typeof shop>>;

const link = (t: Shop, productId: string, relatedProductId: string, kind: "complement" | "alternative" = "complement", weight = 0) =>
  t.c.post(`${t.base}/relationships`, { productId, relatedProductId, kind, weight });

describe("upsell is a shipped tool", () => {
  it("is in the shipped list and publishes on a plan that includes it", async () => {
    expect(SHIPPED_TOOLS.has("upsell")).toBe(true);
    const t = await shop({ recommend: { source: "manual", productIds: ["a"] } });
    expect(t.versionId).toMatch(/^ver_/);
  });

  it("is refused on a plan without it, with the plan message", async () => {
    const env = await makeEnv();
    const u = await signup(env, "free@example.com");
    const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "custom", name: "S", domain: "shop.example.com", currency: "USD" });
    const base = `/api/v1/stores/${s.json.data.id}`;
    const c = await u.c.post(`${base}/campaigns`, upsell({ source: "manual", productIds: ["a"] }));
    const r = await u.c.post(`${base}/campaigns/${c.json.data.id}/publish`, { approve: true, approvedUpdatedAt: c.json.data.updatedAt });
    expect(r.status).toBe(402);
  });

  it("is served in the storefront config as a recommendation campaign", async () => {
    const t = await shop({ recommend: { source: "manual", productIds: ["a"], placement: "cart" } });
    const cfg = await (await t.env.app.request(`/sdk/v1/config/${t.siteKey}.json`)).json() as { campaigns: { campaignId: string; config: { tool: string; format: string; recommend: { placement: string } } }[] };
    expect(cfg.campaigns[0]!.config).toMatchObject({ tool: "upsell", format: "recommendation", recommend: { placement: "cart" } });
  });
});

describe("which products are never recommended", () => {
  it("manual picks come back in the merchant's order, minus anything unavailable, draft, archived, unknown or missing", async () => {
    const t = await shop({
      products: [item("a"), item("b"), oos("sold"), item("draft", { status: "draft" }), item("old", { status: "archived" }),
        item("unk", { variants: [{ externalId: "unk-v", price: 5 }] }), item("noVariants", { variants: [] })],
      recommend: { source: "manual", productIds: ["b", "sold", "draft", "old", "unk", "noVariants", "ghost", "a"], maxProducts: 6 },
    });
    expect(await t.ids()).toEqual(["b", "a"]); // out of stock, draft, archived, unknown stock, no variants and a product that does not exist are all skipped
  });

  it("a product is in stock if any variant is, and shows its lowest in-stock price", async () => {
    const t = await shop({
      products: [item("m", { variants: [{ externalId: "m1", price: 50, available: false }, { externalId: "m2", price: 30, available: true }, { externalId: "m3", price: 40, available: true }] })],
      recommend: { source: "manual", productIds: ["m"] },
    });
    const [p] = (await t.ask()).json.products;
    expect(p).toMatchObject({ id: "m", price: 30, addable: false }); // several variants: the shopper must choose
    expect(p).not.toHaveProperty("variantId");
  });

  it("a single-variant product can be added directly and carries its variant id; a catalog with no price omits it", async () => {
    const t = await shop({
      products: [item("s", { variants: [{ externalId: "s-variant", available: true }] })],
      recommend: { source: "manual", productIds: ["s"] },
    });
    const [p] = (await t.ask()).json.products;
    expect(p).toMatchObject({ id: "s", variantId: "s-variant", addable: true });
    expect(p).not.toHaveProperty("price");
  });

  it("never returns the product being viewed, what is already in the cart, or what the merchant excluded", async () => {
    const t = await shop({
      products: [item("a"), item("b"), item("c"), item("d")],
      recommend: { source: "manual", productIds: ["a", "b", "c", "d"], excludeProductIds: ["d"], maxProducts: 6 },
    });
    expect(await t.ids({ productId: "a", cart: "b" })).toEqual(["c"]);
  });

  it("honours maxProducts", async () => {
    const t = await shop({ products: [item("a"), item("b"), item("c"), item("d")], recommend: { source: "manual", productIds: ["a", "b", "c", "d"], maxProducts: 2 } });
    expect(await t.ids()).toEqual(["a", "b"]);
  });

  it("only hands out links the browser can safely follow, and falls back to the product handle", async () => {
    const t = await shop({
      products: [
        item("js", { url: "javascript:alert(1)", handle: "js-handle", imageUrl: "javascript:alert(2)" }),
        item("http", { url: "http://shop.example.com/p/http", handle: undefined as unknown as string }),
        item("ok", { url: "https://shop.example.com/products/ok", imageUrl: "https://cdn.example.com/ok.png" }),
        item("rel", { url: "/products/rel" }),
        item("none", { url: undefined as unknown as string, handle: undefined as unknown as string }),
      ],
      recommend: { source: "manual", productIds: ["js", "http", "ok", "rel", "none"], maxProducts: 6 },
    });
    const by = Object.fromEntries((await t.ask()).json.products.map((p) => [p.id, p]));
    expect(by["js"]!.url).toBe("/products/js-handle");
    expect(by["js"]).not.toHaveProperty("imageUrl");
    expect(by["http"]).toBeUndefined(); // http, and no handle to fall back to
    expect(by["none"]).toBeUndefined(); // nothing to link to
    expect(by["ok"]).toMatchObject({ url: "https://shop.example.com/products/ok", imageUrl: "https://cdn.example.com/ok.png" });
    expect(by["rel"]!.url).toBe("/products/rel");
  });
});

describe("same collection", () => {
  const products = [
    item("shoe", { title: "Shoe", collectionIds: ["run"] }), item("zsock", { title: "zebra sock", collectionIds: ["run", "kids"] }), item("band", { title: "Band", collectionIds: ["run"] }),
    item("tee", { title: "Tee", collectionIds: ["apparel"] }), oos("gone", { title: "Gone", collectionIds: ["run"] }), item("hat", { title: "Hat", collectionIds: ["kids"] }),
  ];

  it("uses the viewed product's collections, sorted by title, without the viewed product", async () => {
    const t = await shop({ products, recommend: { source: "same_collection", maxProducts: 6 } });
    expect(await t.ids({ productId: "shoe" })).toEqual(["band", "zsock"]); // Band, zebra sock (case-insensitive); not Shoe itself, not Gone (sold out), not Tee (other collection)
  });

  it("explicit collections take over, and a page with no product and no collections has nothing to show", async () => {
    const t = await shop({ products, recommend: { source: "same_collection", collectionIds: ["kids"], maxProducts: 6 } });
    expect(await t.ids({ productId: "shoe" })).toEqual(["hat", "zsock"]);
    const t2 = await shop({ products, recommend: { source: "same_collection", maxProducts: 6 } });
    expect(await t2.ids()).toEqual([]);
    expect(await t2.ids({ productId: "unknown-product" })).toEqual([]);
  });

  it("without a viewed product it falls back to the collections of what is in the cart (cart placement)", async () => {
    const t = await shop({ products, recommend: { source: "same_collection", placement: "cart", maxProducts: 6 } });
    expect(await t.ids({ cart: "tee" })).toEqual([]); // tee is alone in its collection
    expect(await t.ids({ cart: "hat" })).toEqual(["zsock"]);
  });
});

describe("complements and alternatives", () => {
  it("complements come from the merchant's links, heaviest first, ties by id, and unavailable ones drop out", async () => {
    const t = await shop({ products: [item("main"), item("a"), item("b"), item("c"), oos("d")], recommend: { source: "complements", maxProducts: 6 } });
    for (const [to, w] of [["a", 5], ["b", 9], ["c", 5], ["d", 100]] as const) expect((await link(t, "main", to, "complement", w)).status).toBe(201);
    expect(await t.ids({ productId: "main" })).toEqual(["b", "a", "c"]); // by weight; a/c tie by id order; d is sold out
    expect(await t.ids({ productId: "a" })).toEqual([]); // links are one-way
  });

  it("complements of what is in the cart are used when no product is being viewed", async () => {
    const t = await shop({ products: [item("main"), item("x")], recommend: { source: "complements", placement: "cart" } });
    await link(t, "main", "x");
    expect(await t.ids({ cart: "main" })).toEqual(["x"]);
    expect(await t.ids({ cart: "main,x" })).toEqual([]); // already in the cart
  });

  it("alternatives show only on a product the catalog says is sold out", async () => {
    const t = await shop({ products: [oos("sold"), item("instock"), item("alt1"), oos("alt2"), item("alt3"), item("unk", { variants: [{ externalId: "unk-v" }] })], recommend: { source: "alternatives", maxProducts: 6 } });
    for (const from of ["sold", "instock", "unk"]) { await link(t, from, "alt1", "alternative", 1); await link(t, from, "alt2", "alternative", 9); await link(t, from, "alt3", "alternative", 3); }
    expect(await t.ids({ productId: "sold" })).toEqual(["alt3", "alt1"]); // alt2 is sold out too
    expect(await t.ids({ productId: "instock" })).toEqual([]); // nothing to substitute for
    expect(await t.ids({ productId: "unk" })).toEqual([]); // unknown stock is not treated as sold out
    expect(await t.ids()).toEqual([]);
  });

  it("a complement link is not an alternative and vice versa", async () => {
    const t = await shop({ products: [oos("sold"), item("x")], recommend: { source: "alternatives" } });
    await link(t, "sold", "x", "complement");
    expect(await t.ids({ productId: "sold" })).toEqual([]);
  });
});

describe("free-shipping gap", () => {
  const catalog = [
    item("cheap", { title: "Cheap", variants: [{ externalId: "c", price: 8, available: true }] }),
    item("mid", { title: "Mid", variants: [{ externalId: "m", price: 25, available: true }] }),
    item("big", { title: "Big", variants: [{ externalId: "b", price: 60, available: true }] }),
    item("tricky", { title: "Tricky", variants: [{ externalId: "t1", price: 5, available: true }, { externalId: "t2", price: 90, available: true }] }),
    oos("gone", { variants: [{ externalId: "g", price: 30, available: false }] }),
    item("free", { title: "Free", variants: [{ externalId: "f" }] }),
  ];

  it("offers products that bring the real cart to free shipping, cheapest that does so first", async () => {
    const t = await shop({ products: catalog, recommend: { source: "shipping_threshold", freeShippingThreshold: 75, maxProducts: 6 } });
    expect(await t.ids({ subtotal: "50" })).toEqual(["mid", "big"]); // gap 25: cheap (8) falls short, tricky has a 5 option that falls short, gone is sold out, free has no price
    expect(await t.ids({ subtotal: "70" })).toEqual(["tricky", "cheap", "mid", "big"]); // gap 5: every in-stock option of tricky (5 and 90) now closes it
    expect(await t.ids({ subtotal: "74.99" })).toEqual(["tricky", "cheap", "mid", "big"]);
  });

  it("has nothing to say when the cart is unknown, invalid or already qualifies", async () => {
    const t = await shop({ products: catalog, recommend: { source: "shipping_threshold", freeShippingThreshold: 75 } });
    expect(await t.ids()).toEqual([]);
    for (const subtotal of ["75", "120", "-3", "abc", "1e12"]) expect(await t.ids({ subtotal }), subtotal).toEqual([]);
  });
});

describe("tenancy", () => {
  it("never shows another store's products, even when the merchant lists their ids", async () => {
    const env = await makeEnv();
    const other = await shop({ env, products: [item("secret", { title: "Other store product" })] });
    const mine = await shop({ env, products: [item("mine")], recommend: { source: "manual", productIds: ["secret", "mine"], maxProducts: 6 } });
    expect(await mine.ids()).toEqual(["mine"]);
    expect(other.storeId).not.toBe(mine.storeId);
  });

  it("a campaign id from another store answers like an unknown one", async () => {
    const env = await makeEnv();
    const a = await shop({ env, products: [item("a")], recommend: { source: "manual", productIds: ["a"] } });
    const b = await shop({ env, products: [item("b")], recommend: { source: "manual", productIds: ["b"] } });
    expect((await a.ask({}, b.campaignId)).json).toEqual({ products: [] });
    expect((await b.ask({}, a.campaignId)).json).toEqual({ products: [] });
    expect((await a.ask()).json.products.map((p) => p.id)).toEqual(["a"]);
  });
});

describe("the public endpoint", () => {
  it("answers the same empty list for every reason there is nothing to show", async () => {
    const empty = { products: [] };
    const t = await shop({ products: [item("a")], recommend: { source: "manual", productIds: ["a"] } });
    expect((await t.ask()).json.products).toHaveLength(1); // control: it works

    const unknownSite = await t.env.app.request(`/api/v1/recommendations?siteId=cf_doesnotexist1&campaignId=${t.campaignId}`);
    expect(await unknownSite.json()).toEqual(empty);
    expect((await t.ask({}, "cmp_nope")).json).toEqual(empty);

    const toast = await t.c.post(`${t.base}/campaigns`, validConfig({ tool: "toast", format: "toast", toast: {} }));
    await t.c.post(`${t.base}/campaigns/${toast.json.data.id}/publish`, { approve: true, approvedUpdatedAt: toast.json.data.updatedAt });
    expect((await t.ask({}, toast.json.data.id)).json).toEqual(empty); // a live campaign that is not an upsell

    await t.c.post(`${t.base}/campaigns/${t.campaignId}/pause`);
    const paused = await t.ask();
    expect(paused.status).toBe(200);
    expect(paused.json).toEqual(empty);
    await t.c.post(`${t.base}/campaigns/${t.campaignId}/resume`);
    expect((await t.ask()).json.products).toHaveLength(1);

    await t.c.patch(`${t.base}/delivery`, { enabled: false }); // the kill switch
    expect((await t.ask()).json).toEqual(empty);
  });

  it("stops the moment the plan no longer includes the tool", async () => {
    const t = await shop({ products: [item("a")], recommend: { source: "manual", productIds: ["a"] } });
    expect((await t.ask()).json.products).toHaveLength(1);
    await setPlan(t.env, t.orgId, "starter");
    expect((await t.ask()).json).toEqual({ products: [] });
  });

  it("takes its options from the live campaign, never from the request", async () => {
    const t = await shop({ products: [item("a"), item("b"), item("c")], recommend: { source: "manual", productIds: ["a"], maxProducts: 1 } });
    const forged = await t.ask({ source: "same_collection", productIds: "b,c", maxProducts: "6", excludeProductIds: "a", onlyAvailable: "false" });
    expect(forged.json.products.map((p) => p.id)).toEqual(["a"]);
  });

  it("is public and credential-less: CORS for any origin, never cached, store currency included", async () => {
    const t = await shop({ products: [item("a")], recommend: { source: "manual", productIds: ["a"] } });
    const r = await t.ask();
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("access-control-allow-credentials")).toBeNull();
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.json.currency).toBe("EUR");
  });

  it("rejects malformed requests and bounds what it accepts", async () => {
    const t = await shop({ products: [item("a")], recommend: { source: "manual", productIds: ["a"] } });
    expect((await t.env.app.request("/api/v1/recommendations")).status).toBe(422);
    expect((await t.env.app.request(`/api/v1/recommendations?siteId=${t.siteKey}`)).status).toBe(422);
    expect((await t.ask({ cart: "x".repeat(2300) })).status).toBe(422);
    // ids beyond the cap are ignored, not an error
    const many = Array.from({ length: 60 }, (_, i) => `p${i}`).join(",");
    expect((await t.ask({ cart: many })).status).toBe(200);
  });

  it("is rate limited per site and address", async () => {
    const t = await shop({ products: [item("a")], recommend: { source: "manual", productIds: ["a"] } });
    let last = 200;
    for (let i = 0; i < 125; i++) last = (await t.ask()).status;
    expect(last).toBe(429);
  });

  it("answers a preflight for storefront browsers", async () => {
    const t = await shop({});
    const r = await t.env.app.request("/api/v1/recommendations", { method: "OPTIONS", headers: { origin: "https://shop.example.com", "access-control-request-method": "GET" } });
    expect(r.status).toBeLessThan(300);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("product links (merchant managed)", () => {
  async function two() { const t = await shop({ products: [item("a"), item("b"), item("c")] }); return t; }

  it("creates, updates in place, lists with titles, filters by product and removes", async () => {
    const t = await two();
    const created = await link(t, "a", "b", "complement", 3);
    expect(created.status).toBe(201);
    const again = await link(t, "a", "b", "complement", 8); // same pair and kind: update
    expect(again.status).toBe(200);
    expect(again.json.data.id).toBe(created.json.data.id);
    await link(t, "a", "b", "alternative", 1); // a different kind is a different link
    await link(t, "b", "c");
    const all = (await t.c.get(`${t.base}/relationships`)).json.data as { id: string; kind: string; weight: number; product: { id: string; title: string }; related: { id: string; title: string } }[];
    expect(all).toHaveLength(3);
    expect(all.find((l) => l.kind === "complement" && l.product.id === "a")).toMatchObject({ weight: 8, related: { id: "b", title: "Item b" } });
    expect((await t.c.get(`${t.base}/relationships?productId=b`)).json.data).toHaveLength(1);
    expect((await t.c.del(`${t.base}/relationships/${created.json.data.id}`)).status).toBe(204);
    expect((await t.c.get(`${t.base}/relationships`)).json.data).toHaveLength(2);
    expect((await t.c.del(`${t.base}/relationships/${created.json.data.id}`)).status).toBe(404); // already gone
  });

  it("refuses a link to itself, to an unknown product, and with bad input", async () => {
    const t = await two();
    expect((await link(t, "a", "a")).status).toBe(422);
    expect((await link(t, "a", "ghost")).status).toBe(404);
    expect((await link(t, "ghost", "a")).status).toBe(404);
    expect((await t.c.post(`${t.base}/relationships`, { productId: "a", relatedProductId: "b", kind: "bundle" })).status).toBe(422);
    expect((await t.c.post(`${t.base}/relationships`, { productId: "a", relatedProductId: "b", kind: "complement", weight: -1 })).status).toBe(422);
    expect((await t.c.post(`${t.base}/relationships`, { productId: "a", relatedProductId: "b", kind: "complement", weight: 1.5 })).status).toBe(422);
  });

  it("caps links per product", async () => {
    const many = Array.from({ length: 52 }, (_, i) => item(`p${i}`));
    const t = await shop({ products: many.slice(0, 52) });
    for (let i = 1; i <= 50; i++) expect((await link(t, "p0", `p${i}`)).status).toBe(201);
    const over = await link(t, "p0", "p51");
    expect(over.status).toBe(409);
    expect(over.json.error.code).toBe("limit_reached");
    expect((await link(t, "p0", "p50", "complement", 7)).status).toBe(200); // updating an existing one is still fine
  });

  it("is tenant-isolated and role-gated", async () => {
    const t = await two();
    const l = await link(t, "a", "b");
    const stranger = await signup(t.env, "stranger@example.com");
    expect((await stranger.c.get(`${t.base}/relationships`)).status).toBe(404);
    expect((await stranger.c.post(`${t.base}/relationships`, { productId: "a", relatedProductId: "c", kind: "complement", weight: 0 })).status).toBe(404);
    expect((await stranger.c.del(`${t.base}/relationships/${l.json.data.id}`)).status).toBe(404);

    // a link can only join products of the same store, so another store's id never resolves
    const other = await shop({ env: t.env, products: [item("zzz")] });
    expect((await link(t, "a", "zzz")).status).toBe(404);
    expect((await other.c.get(`${other.base}/relationships`)).json.data).toEqual([]);

    const member = async (email: string, role: "viewer" | "editor") => {
      const u = await signup(t.env, email);
      await t.env.deps.db.insert(schema.memberships).values({ id: `m_${role}`, organizationId: t.orgId, userId: u.userId, role, createdAt: "t" });
      return u;
    };
    const viewer = await member("viewer@example.com", "viewer");
    expect((await viewer.c.get(`${t.base}/relationships`)).status).toBe(200); // read-only access
    expect((await viewer.c.post(`${t.base}/relationships`, { productId: "a", relatedProductId: "c", kind: "complement", weight: 0 })).status).toBe(403);
    expect((await viewer.c.del(`${t.base}/relationships/${l.json.data.id}`)).status).toBe(403);
    const editor = await member("editor@example.com", "editor");
    expect((await editor.c.post(`${t.base}/relationships`, { productId: "a", relatedProductId: "c", kind: "complement", weight: 0 })).status).toBe(201);
    expect((await new Client(t.env).get(`${t.base}/relationships`)).status).toBe(401);
  });

  it("is audited and cleans up when a product is removed from the catalog", async () => {
    const t = await two();
    const l = await link(t, "a", "b");
    await t.c.del(`${t.base}/relationships/${l.json.data.id}`);
    const actions = (await t.env.deps.db.select().from(schema.auditLogs)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["relationship.set", "relationship.removed"]));

    await link(t, "a", "c");
    await t.env.deps.db.delete(schema.products).where(eq(schema.products.externalId, "c"));
    expect((await t.c.get(`${t.base}/relationships`)).json.data).toEqual([]); // cascade
  });
});

describe("recommendation analytics", () => {
  const ev = (siteId: string, o: Record<string, unknown>) => ({ eventId: `e_${Math.random().toString(36).slice(2, 14)}`, siteId, sessionId: "sess_12345678", occurredAt: "2026-10-27T12:00:00.000Z", schemaVersion: 1, ...o });
  const send = (env: Env, events: unknown[]) => env.app.request("/api/v1/events/batch", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ consent: true, events }) });

  it("counts impressions, clicks and add-to-carts through the shared pipeline, once per event id", async () => {
    const t = await shop({ products: [item("a")], recommend: { source: "manual", productIds: ["a"] } });
    const base = { campaignId: t.campaignId, versionId: t.versionId };
    const dup = ev(t.siteKey, { ...base, type: "recommendation_add_to_cart" });
    expect((await send(t.env, [
      ev(t.siteKey, { ...base, type: "campaign_eligible" }), ev(t.siteKey, { ...base, type: "recommendation_impression" }),
      ev(t.siteKey, { ...base, type: "recommendation_click" }), dup, dup,
    ])).status).toBe(202);
    const [row] = await t.env.deps.db.select().from(schema.analyticsAggregates);
    expect(row).toMatchObject({ campaignId: t.campaignId, eligible: 1, impressions: 1, clicks: 1, addToCarts: 1 });
  });

  it("shows add-to-carts in the merchant's analytics, per campaign and in total", async () => {
    const t = await shop({ products: [item("a")], recommend: { source: "manual", productIds: ["a"] } });
    const base = { campaignId: t.campaignId, versionId: t.versionId };
    await send(t.env, [ev(t.siteKey, { ...base, type: "recommendation_impression" }), ev(t.siteKey, { ...base, type: "recommendation_add_to_cart" }), ev(t.siteKey, { ...base, type: "recommendation_add_to_cart" })]);
    const r = await t.c.get(`${t.base}/analytics?from=2026-10-27&to=2026-10-27`);
    expect(r.json.data.totals).toMatchObject({ impressions: 1, addToCarts: 2 });
    expect(r.json.data.campaigns[0]).toMatchObject({ campaignId: t.campaignId, addToCarts: 2 });
  });

  it("ignores events that reference another store's campaign or a forged version, and carries no personal data", async () => {
    const env = await makeEnv();
    const a = await shop({ env, products: [item("a")], recommend: { source: "manual", productIds: ["a"] } });
    const b = await shop({ env, products: [item("b")], recommend: { source: "manual", productIds: ["b"] } });
    await send(env, [
      ev(b.siteKey, { type: "recommendation_add_to_cart", campaignId: a.campaignId, versionId: a.versionId }),
      ev(b.siteKey, { type: "recommendation_click", campaignId: b.campaignId, versionId: "ver_forged" }),
    ]);
    expect(await env.deps.db.select().from(schema.analyticsAggregates)).toHaveLength(0);
    await send(env, [ev(a.siteKey, { type: "recommendation_impression", campaignId: a.campaignId, versionId: a.versionId, email: "x@y.co", productId: "a", cart: ["a"] })]);
    const rows = await env.deps.db.select().from(schema.analyticsAggregates);
    expect(JSON.stringify(rows)).not.toContain("x@y.co");
  });
});

describe("validation and warnings for upsell campaigns", () => {
  it("rejects what cannot work and warns about what probably is not intended", async () => {
    const t = await shop({});
    const validate = (cfg: unknown) => t.c.post(`${t.base}/campaigns/validate`, cfg);
    const noPicks = await validate(upsell({ source: "manual", productIds: [] }));
    expect(noPicks.json.data.valid).toBe(false);
    const noThreshold = await validate(upsell({ source: "shipping_threshold" }));
    expect(noThreshold.json.data.valid).toBe(false);
    expect((await validate(upsell({ source: "same_collection", maxProducts: 7 }))).json.data.valid).toBe(false);
    const cart = await validate(upsell({ source: "same_collection", placement: "cart" }));
    expect(cart.json.data.valid).toBe(true);
    expect(cart.json.data.warnings.join(" ")).toMatch(/cart upsell should target/i);
  });
});

describe("database: product relationships", () => {
  it("keeps one link per pair and kind", async () => {
    const t = await shop({ products: [item("a"), item("b")] });
    await link(t, "a", "b");
    await link(t, "a", "b");
    expect(await t.env.deps.db.select().from(schema.productRelationships)).toHaveLength(1);
  });
});
