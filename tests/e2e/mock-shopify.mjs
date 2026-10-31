// Stand-in for Shopify's server-side APIs (OAuth token exchange, Admin GraphQL) so end-to-end runs exercise the real
// install, sync and billing code paths. It follows the documented request shapes, NOT Shopify itself: a pass here says
// nothing about the live Shopify API. The API Worker reaches it through SHOPIFY_ADMIN_BASE_URL=http://localhost:4500/{shop}.
//   POST /:shop/admin/oauth/access_token          code -> offline token
//   POST /:shop/admin/api/2026-10/graphql.json    products page | shop | appSubscriptionCreate | node(charge) | appSubscriptionCancel
//                                                 | webPixelCreate/Update | currentAppInstallation | metafieldsSet | themes | inventoryItem
//   DELETE /:shop/admin/api_permissions/current.json   revoke the token (uninstall)
// Control (the browser test plays the merchant at Shopify):
//   POST /__approve?shop=&scope=   -> { code }        a code the merchant "approved"
//   POST /__products?shop=&count=  -> sets N products
//   POST /__charge?id=&status=     -> sets a charge's status (the merchant approving or declining on Shopify's page)
//   GET  /__charges?shop=          -> charges        |  GET /__setup?shop= -> { pixel, metafields }  |  GET /health
//   POST /__embed?shop=&on=1       -> the live theme has the app embed switched on (1) or off (0)
import { createServer } from "node:http";

const API_KEY = process.env.E2E_SHOPIFY_KEY ?? "e2e_client_id";
const SECRET = process.env.E2E_SHOPIFY_SECRET ?? "e2e_shopify_secret";
const codes = new Map(); // code -> { shop, scope }
const tokens = new Map(); // shop -> token
const products = new Map(); // shop -> product nodes
const charges = new Map(); // gid -> charge (with shop)
const pixels = new Map(); // shop -> { id, settings }
const metafields = new Map(); // shop -> { key: value }
const embeds = new Map(); // shop -> boolean

const product = (n) => ({
  legacyResourceId: String(7000 + n), title: `E2E Shopify product ${n}`, handle: `e2e-product-${n}`, status: "ACTIVE", onlineStoreUrl: null,
  featuredMedia: null, collections: { nodes: [{ legacyResourceId: "300" }] },
  variants: { pageInfo: { hasNextPage: false }, nodes: [{ legacyResourceId: String(8000 + n), title: "Default", price: "24.00", availableForSale: n % 4 !== 0 }] },
});

createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (u.pathname === "/health") return res.end("ok");
  if (u.pathname === "/__approve" && req.method === "POST") {
    const code = `e2ecode_${codes.size + 1}_${Date.now()}`;
    codes.set(code, { shop: u.searchParams.get("shop"), scope: u.searchParams.get("scope") ?? "read_products,read_inventory,read_orders,read_themes,write_pixels,read_customer_events" });
    return json(200, { code });
  }
  if (u.pathname === "/__products" && req.method === "POST") {
    products.set(u.searchParams.get("shop"), Array.from({ length: Number(u.searchParams.get("count") ?? 12) }, (_, i) => product(i + 1)));
    return json(200, { ok: true });
  }
  if (u.pathname === "/__charge" && req.method === "POST") {
    const c = charges.get(u.searchParams.get("id"));
    if (!c) return json(404, {});
    c.status = u.searchParams.get("status"); c.currentPeriodEnd = "2026-12-01T00:00:00Z";
    return json(200, c);
  }
  if (u.pathname === "/__setup") { const shop = u.searchParams.get("shop"); return json(200, { pixel: pixels.get(shop) ?? null, metafields: metafields.get(shop) ?? null }); }
  if (u.pathname === "/__embed" && req.method === "POST") { embeds.set(u.searchParams.get("shop"), u.searchParams.get("on") === "1"); return json(200, { ok: true }); }
  if (u.pathname === "/__charges") return json(200, [...charges.values()].filter((c) => c.shop === u.searchParams.get("shop")));

  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const m = /^\/([a-z0-9-]+\.myshopify\.com)(\/admin\/.*)$/.exec(u.pathname);
    if (!m) return json(404, {});
    const [, shop, path] = m;
    let body; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    if (path === "/admin/oauth/access_token") {
      const c = codes.get(body.code);
      if (!c || c.shop !== shop || body.client_id !== API_KEY || body.client_secret !== SECRET) return json(400, { error: "invalid_request" });
      codes.delete(body.code);
      const token = `shpat_e2e_${shop}_${Date.now()}`;
      tokens.set(shop, token);
      return json(200, { access_token: token, scope: c.scope });
    }
    if (path === "/admin/api_permissions/current.json" && req.method === "DELETE") {
      if (req.headers["x-shopify-access-token"] !== tokens.get(shop)) return json(401, {});
      tokens.delete(shop);
      return json(200, {});
    }
    if (path !== "/admin/api/2026-10/graphql.json") return json(404, {});
    if (!tokens.has(shop) || req.headers["x-shopify-access-token"] !== tokens.get(shop)) return json(401, { errors: "[API] Invalid API key or access token" });
    const q = String(body.query ?? ""), v = body.variables ?? {};
    if (q.includes("products(")) {
      const all = products.get(shop) ?? [];
      const start = v.after ? Number(v.after) : 0;
      const more = start + 10 < all.length;
      return json(200, { data: { products: { pageInfo: { hasNextPage: more, endCursor: more ? String(start + 10) : null }, nodes: all.slice(start, start + 10) } } });
    }
    if (q.includes("webPixelCreate")) {
      if (pixels.has(shop)) return json(200, { data: { webPixelCreate: { userErrors: [{ code: "TAKEN", field: [], message: "taken" }], webPixel: null } } });
      const p = { id: `gid://shopify/WebPixel/${pixels.size + 1}`, settings: JSON.parse(v.settings) };
      pixels.set(shop, p);
      return json(200, { data: { webPixelCreate: { userErrors: [], webPixel: { id: p.id } } } });
    }
    if (q.includes("webPixelUpdate")) {
      const p = pixels.get(shop);
      if (!p || p.id !== v.id) return json(200, { data: { webPixelUpdate: { userErrors: [{ code: "NOT_FOUND", field: ["id"], message: "x" }], webPixel: null } } });
      p.settings = JSON.parse(v.settings);
      return json(200, { data: { webPixelUpdate: { userErrors: [], webPixel: { id: p.id } } } });
    }
    if (q.includes("webPixel {")) return json(200, { data: { webPixel: pixels.has(shop) ? { id: pixels.get(shop).id } : null } });
    if (q.includes("currentAppInstallation")) return json(200, { data: { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } } });
    if (q.includes("metafieldsSet")) {
      metafields.set(shop, Object.fromEntries(v.metafields.map((x) => [x.key, x.value])));
      return json(200, { data: { metafieldsSet: { userErrors: [], metafields: v.metafields.map((x) => ({ key: x.key })) } } });
    }
    if (q.includes("themes(")) {
      const content = JSON.stringify({ current: { blocks: { "1": { type: "shopify://apps/convertflow/blocks/convertflow-embed/e2e", disabled: !embeds.get(shop), settings: {} } } } });
      return json(200, { data: { themes: { nodes: [{ name: "Dawn", files: { nodes: [{ body: { content } }] } }] } } });
    }
    if (q.includes("inventoryItem(")) {
      // Here an inventory item id is its variant id.
      const id = String(v.id).split("/").pop();
      const p = (products.get(shop) ?? []).find((x) => x.variants.nodes.some((n) => n.legacyResourceId === id));
      return json(200, { data: { inventoryItem: p ? { variant: { product: p } } : null } });
    }
    if (q.includes("primaryDomain")) return json(200, { data: { shop: { name: "E2E Shopify Shop", currencyCode: "USD", primaryDomain: { host: shop } } } });
    if (q.includes("shop { name }")) return json(200, { data: { shop: { name: "E2E Shopify Shop" } } });
    if (q.includes("appSubscriptionCreate")) {
      const id = `gid://shopify/AppSubscription/${4000 + charges.size}`;
      charges.set(id, { id, shop, name: v.name, status: "PENDING", test: Boolean(v.test), trialDays: v.trialDays ?? 0, createdAt: new Date().toISOString(), currentPeriodEnd: null });
      return json(200, { data: { appSubscriptionCreate: { userErrors: [], confirmationUrl: `https://${shop}/admin/charges/e2e/${id.split("/").pop()}/RecurringApplicationCharge/confirm_recurring_application_charge`, appSubscription: { id, status: "PENDING" } } } });
    }
    if (q.includes("node(id:")) { const c = charges.get(v.id); return json(200, { data: { node: c && c.shop === shop ? { ...c, shop: undefined } : null } }); }
    if (q.includes("appSubscriptionCancel")) {
      const c = charges.get(v.id);
      if (c) c.status = "CANCELLED";
      return json(200, { data: { appSubscriptionCancel: { userErrors: [], appSubscription: c ? { id: c.id, status: c.status } : null } } });
    }
    return json(200, { errors: [{ message: "unknown query", extensions: { code: "UNKNOWN" } }] });
  });
}).listen(Number(process.env.E2E_SHOPIFY_PORT ?? 4500), () => console.log("mock shopify on", process.env.E2E_SHOPIFY_PORT ?? 4500));
