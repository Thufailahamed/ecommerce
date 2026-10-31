// Stand-in for Klaviyo, Mailchimp and Twilio Verify so end-to-end runs can watch what the app really sends to a provider.
//   Twilio    POST /v2/Services/:sid/Verifications | POST /v2/Services/:sid/VerificationCheck   auth: Basic ACe2e...:e2e_token
//             GET /__sms?phone=+1...  -> { code, sent }  (the shopper's phone: the last code texted to that number)
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
const TWILIO_AUTH = `Basic ${Buffer.from("ACe2e00000000000000000000000000000:e2e_token").toString("base64")}`;
const texts = new Map(); // phone -> { code, sent }

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

  if (u.pathname === "/__sms") return json(200, texts.get(u.searchParams.get("phone")) ?? { code: null, sent: 0 });

  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (u.pathname.startsWith("/v2/Services/")) {
      const form = Object.fromEntries(new URLSearchParams(raw));
      calls.push({ provider: "twilio", method: req.method, path: u.pathname, body: { ...form, Code: form.Code ? "***" : undefined }, authorised: req.headers["authorization"] === TWILIO_AUTH });
      if (req.headers["authorization"] !== TWILIO_AUTH) return json(401, { code: 20003, message: "Authenticate" });
      if (u.pathname.endsWith("/Verifications")) {
        // Numbers ending in 0000 play a landline Twilio will not text.
        if (!/^\+[1-9]\d{7,14}$/.test(form.To ?? "") || form.To.endsWith("0000")) return json(400, { code: 60200, message: "Invalid parameter To" });
        const prev = texts.get(form.To);
        texts.set(form.To, { code: String(Math.floor(100000 + Math.random() * 900000)), sent: (prev?.sent ?? 0) + 1, friendlyName: form.CustomFriendlyName });
        return json(201, { status: "pending", to: form.To, channel: "sms" });
      }
      if (u.pathname.endsWith("/VerificationCheck")) {
        const t = texts.get(form.To);
        if (!t || !t.code) return json(404, { code: 20404, message: "not found" });
        if (t.code !== form.Code) return json(200, { status: "pending", valid: false });
        t.code = null;
        return json(200, { status: "approved", valid: true });
      }
      return json(404, {});
    }
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
