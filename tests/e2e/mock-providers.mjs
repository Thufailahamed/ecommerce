// Stand-in for Klaviyo and Mailchimp so end-to-end runs can watch what the app really sends to a list provider.
// It follows the request shapes the adapters use, NOT the real services: a pass here says nothing about the live APIs.
//   Klaviyo   GET /api/lists | POST /api/profile-import/ | POST /api/profile-subscription-bulk-(create|delete)-jobs/   key: pk_e2e_good
//   Mailchimp GET /3.0/lists | PUT|PATCH /3.0/lists/:id/members/:md5                                                    key: e2e000-us21
// Control: GET /__calls?provider=klaviyo|mailchimp  |  DELETE /__calls  |  POST /__fail?status=429&count=2&retryAfter=1&provider=klaviyo  |  GET /health
// (/__fail makes the next `count` non-GET requests, to that provider only if one is named, answer with `status`.)
import { createServer } from "node:http";

const calls = [];
let failing = { status: 0, count: 0, retryAfter: undefined, provider: undefined };

const KLAVIYO_KEY = "pk_e2e_good";
const MAILCHIMP_KEY = "e2e000-us21";

createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const json = (code, body, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(body === undefined ? undefined : JSON.stringify(body)); };
  if (u.pathname === "/health") return res.end("ok");
  if (u.pathname === "/__calls") {
    if (req.method === "DELETE") { calls.length = 0; failing = { status: 0, count: 0 }; return json(200, { ok: true }); }
    const p = u.searchParams.get("provider");
    return json(200, calls.filter((c) => !p || c.provider === p));
  }
  if (u.pathname === "/__fail" && req.method === "POST") {
    failing = { status: Number(u.searchParams.get("status") ?? 500), count: Number(u.searchParams.get("count") ?? 1), retryAfter: u.searchParams.get("retryAfter") ?? undefined, provider: u.searchParams.get("provider") ?? undefined };
    return json(200, { ok: true });
  }

  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const provider = u.pathname.startsWith("/3.0/") ? "mailchimp" : u.pathname.startsWith("/api/") ? "klaviyo" : undefined;
    if (!provider) return json(404, { error: "not found" });
    const auth = req.headers["authorization"] ?? "";
    const ok = provider === "klaviyo"
      ? auth === `Klaviyo-API-Key ${KLAVIYO_KEY}`
      : auth === `Basic ${Buffer.from(`convertflow:${MAILCHIMP_KEY}`).toString("base64")}`;
    let body; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
    const rec = { provider, method: req.method, path: u.pathname, body, authorised: ok };
    calls.push(rec);
    if (!ok) return json(401, { errors: [{ code: "not_authenticated" }], title: "API Key Invalid" });
    if (failing.count > 0 && req.method !== "GET" && (!failing.provider || failing.provider === provider)) {
      failing.count--;
      return json(failing.status, { title: "Simulated failure" }, failing.retryAfter ? { "retry-after": failing.retryAfter } : {});
    }
    if (provider === "klaviyo") {
      if (req.method === "GET" && u.pathname === "/api/lists") return json(200, { data: [{ id: "KL1", attributes: { name: "E2E Newsletter" } }, { id: "KL2", attributes: { name: "E2E VIPs" } }], links: {} });
      if (req.method === "POST" && u.pathname === "/api/profile-import/") return json(201, { data: { id: "klaviyo_profile_1" } });
      if (req.method === "POST" && /^\/api\/profile-subscription-bulk-(create|delete)-jobs\/$/.test(u.pathname)) return json(202);
    } else {
      if (req.method === "GET" && u.pathname === "/3.0/lists") return json(200, { lists: [{ id: "MC1", name: "E2E Audience" }] });
      if ((req.method === "PUT" || req.method === "PATCH") && /^\/3\.0\/lists\/[^/]+\/members\/[0-9a-f]{32}$/.test(u.pathname)) return json(200, { id: "mc_member_1", status: req.method === "PATCH" ? "unsubscribed" : "subscribed" });
    }
    json(404, { title: "Resource Not Found" });
  });
}).listen(Number(process.env.E2E_PROVIDER_PORT ?? 4200), () => console.log("mock providers on", process.env.E2E_PROVIDER_PORT ?? 4200));
