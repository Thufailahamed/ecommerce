// Stand-in for a WooCommerce site's REST API v3 so end-to-end runs exercise the real connect, sync and webhook code. It
// follows the documented request shapes, NOT WooCommerce itself: a pass here says nothing about a live WordPress site.
// The API Worker reaches it through WOOCOMMERCE_BASE_URL=http://localhost:4600/{domain}.
//   GET    /:domain/wp-json/wc/v3/products[?per_page&page]   (X-WP-TotalPages)  |  /products/:id  |  /products/:id/variations
//   GET    /:domain/wp-json/wc/v3/webhooks   POST /webhooks   DELETE /webhooks/:id
// Control (the browser test plays the merchant and WooCommerce itself):
//   POST /__keys?domain=&ck=&cs=&permissions=read_write   -> keys the merchant "approved"
//   POST /__products?domain=&count=&variable=1            -> N simple products (+ one variable product with two variations)
//   GET  /__hooks?domain=                                 -> the webhooks apps created, with their secrets (to sign deliveries)
//   GET  /health
import { createServer } from "node:http";

const keys = new Map(); // `${domain}|${ck}` -> { cs, permissions }
const catalogs = new Map(); // domain -> { products, variations: Map<id, []> }
const hooks = new Map(); // domain -> [{ id, topic, status, delivery_url, secret }]
let nextHook = 100;

const simple = (domain, n) => ({ id: n, name: `E2E Woo product ${n}`, type: "simple", status: "publish", permalink: `https://${domain}/product/e2e-${n}/`, stock_status: n % 5 === 0 ? "outofstock" : "instock", price: "12.00", categories: [{ id: 15 }], images: [] });

createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const json = (code, body, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
  if (u.pathname === "/health") return res.end("ok");
  if (process.env.E2E_WOO_LOG === "1") console.log(`[mock-woo] ${req.method} ${u.pathname}`);
  const q = (k) => u.searchParams.get(k);
  if (u.pathname === "/__keys" && req.method === "POST") { keys.set(`${q("domain")}|${q("ck")}`, { cs: q("cs"), permissions: q("permissions") ?? "read_write" }); return json(200, { ok: true }); }
  if (u.pathname === "/__products" && req.method === "POST") {
    const domain = q("domain"), count = Number(q("count") ?? 10);
    const products = Array.from({ length: count }, (_, i) => simple(domain, i + 1));
    const variations = new Map();
    if (q("variable") === "1") {
      const id = count + 1;
      products.push({ ...simple(domain, id), name: "E2E Woo tee", type: "variable", price: "" });
      variations.set(id, [
        { id: id * 10 + 1, status: "publish", price: "20.00", stock_status: "instock", attributes: [{ name: "Size", option: "S" }] },
        { id: id * 10 + 2, status: "publish", price: "20.00", stock_status: "outofstock", attributes: [{ name: "Size", option: "M" }] },
      ]);
    }
    catalogs.set(domain, { products, variations });
    return json(200, { ok: true });
  }
  if (u.pathname === "/__hooks") return json(200, hooks.get(q("domain")) ?? []);

  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const m = /^\/([a-z0-9.-]+)\/wp-json\/wc\/v3(\/.*)$/.exec(u.pathname);
    if (!m) return json(404, { code: "rest_no_route" });
    const [, domain, path] = m;
    const auth = String(req.headers["authorization"] ?? "");
    const [ck, cs] = auth.startsWith("Basic ") ? Buffer.from(auth.slice(6), "base64").toString().split(":") : [u.searchParams.get("consumer_key"), u.searchParams.get("consumer_secret")];
    const key = keys.get(`${domain}|${ck}`);
    if (!key || key.cs !== cs) return json(401, { code: "woocommerce_rest_cannot_view" });
    if (req.method !== "GET" && key.permissions === "read") return json(401, { code: "woocommerce_rest_cannot_create" });
    let body; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
    const cat = catalogs.get(domain) ?? { products: [], variations: new Map() };
    const list = hooks.get(domain) ?? [];
    hooks.set(domain, list);

    if (path === "/products" && req.method === "GET") {
      const per = Number(u.searchParams.get("per_page") ?? 10), page = Number(u.searchParams.get("page") ?? 1);
      return json(200, cat.products.slice((page - 1) * per, page * per), { "x-wp-totalpages": String(Math.max(1, Math.ceil(cat.products.length / per))) });
    }
    let r = /^\/products\/(\d+)\/variations$/.exec(path);
    if (r) return json(200, cat.variations.get(Number(r[1])) ?? []);
    r = /^\/products\/(\d+)$/.exec(path);
    if (r) { const p = cat.products.find((x) => x.id === Number(r[1])); return p ? json(200, p) : json(404, { code: "woocommerce_rest_product_invalid_id" }); }
    if (path === "/webhooks" && req.method === "GET") return json(200, list.map(({ secret: _s, ...h }) => h));
    if (path === "/webhooks" && req.method === "POST") {
      const h = { id: nextHook++, topic: body?.topic, status: body?.status ?? "active", delivery_url: body?.delivery_url, secret: body?.secret };
      list.push(h);
      return json(201, { id: h.id, topic: h.topic, status: h.status, delivery_url: h.delivery_url });
    }
    r = /^\/webhooks\/(\d+)$/.exec(path);
    if (r && req.method === "DELETE") {
      const i = list.findIndex((h) => h.id === Number(r[1]));
      if (i < 0) return json(404, {});
      const [h] = list.splice(i, 1);
      return json(200, { id: h.id });
    }
    return json(404, { code: "rest_no_route" });
  });
}).listen(Number(process.env.E2E_WOO_PORT ?? 4600), () => console.log("mock woocommerce on", process.env.E2E_WOO_PORT ?? 4600));
