#!/usr/bin/env node
// Local development runner. No Cloudflare account needed: Wrangler emulates D1, KV and Queues on disk.
//
//   node scripts/dev-local.mjs up                    create everything that is missing, then run all four services
//   node scripts/dev-local.mjs db                    create / upgrade the local database only
//   node scripts/dev-local.mjs plan <email> <plan>   give an account a plan (free|starter|growth|scale), as a Stripe webhook would
//   node scripts/dev-local.mjs feature <email> <cap> switch a preview capability on for the account's workspaces (workflows.create|ai.commerce_manager)
//   node scripts/dev-local.mjs reset                 delete the local database (stop `up` first)
//
// Services: API :8790, web app :3200, demo storefront :4000, mail inbox :4100 (stands in for Resend).
// Port 3000 and 8787 are avoided on purpose: other projects on this machine tend to hold them.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(ROOT, ".local-dev", "state");
const API_DIR = join(ROOT, "apps", "api");
const WEB_DIR = join(ROOT, "apps", "web");
const SDK_BUNDLE = join(ROOT, "apps", "storefront-sdk", "dist", "cf.js");
const P = { api: 8790, web: 3200, store: 4000, mail: 4100 };
const U = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, `http://localhost:${v}`]));
const PLANS = ["free", "starter", "growth", "scale"];

const run = (cmd, cwd, opts = {}) => spawnSync(cmd, { cwd, shell: true, stdio: "inherit", ...opts });
const quoted = (p) => `"${p}"`;

/** API settings live in apps/api/.dev.vars (gitignored). Created once so the credential key stays stable between runs. */
function ensureEnv() {
  const file = join(API_DIR, ".dev.vars");
  if (existsSync(file)) return;
  writeFileSync(file, [
    "# Local development only. Created by scripts/dev-local.mjs; safe to delete (a new key makes stored store credentials unreadable).",
    `CREDENTIAL_KEY=${randomBytes(32).toString("base64")}`,
    "RESEND_API_KEY=local",
    `RESEND_BASE_URL=${U.mail}`,
    "EMAIL_FROM=ConvertFlow <noreply@localhost.test>",
    "",
  ].join("\n"));
  console.log(`created ${file}`);
}

function migrate() {
  mkdirSync(STATE, { recursive: true });
  const r = run(`pnpm exec wrangler d1 migrations apply convertflow --local --persist-to ${quoted(STATE)}`, API_DIR);
  if (r.status !== 0) { console.error("Database migration failed."); process.exit(1); }
}

function setPlan(email, plan) {
  if (!/^[\w.+-]+@[\w.-]+$/.test(email ?? "") || !PLANS.includes(plan)) { console.error(`Usage: plan <email> <${PLANS.join("|")}>`); process.exit(1); }
  const sql = `update subscriptions set plan='${plan}', status='active' where organization_id in (select m.organization_id from memberships m join users u on u.id=m.user_id where u.email='${email.toLowerCase()}')`;
  const r = run(`pnpm exec wrangler d1 execute convertflow --local --persist-to ${quoted(STATE)} --command ${quoted(sql)}`, API_DIR);
  process.exit(r.status ?? 1);
}

/** Preview capabilities (packages/contracts/src/entitlements.ts). The plan must still grant them. */
const PREVIEWS = ["workflows.create", "ai.commerce_manager"];
function enableFeature(email, cap) {
  if (!/^[\w.+-]+@[\w.-]+$/.test(email ?? "") || !PREVIEWS.includes(cap)) { console.error(`Usage: feature <email> <${PREVIEWS.join("|")}>`); process.exit(1); }
  const sql = `insert or ignore into organization_features (organization_id, feature, enabled_by, created_at) select m.organization_id, '${cap}', 'dev-local', '${new Date().toISOString()}' from memberships m join users u on u.id=m.user_id where u.email='${email.toLowerCase()}'`;
  const r = run(`pnpm exec wrangler d1 execute convertflow --local --persist-to ${quoted(STATE)} --command ${quoted(sql)}`, API_DIR);
  process.exit(r.status ?? 1);
}

/* ---------- mail inbox: the app talks to it exactly as it would talk to Resend ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const box = [];

function startMail() {
  createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method === "POST" && u.pathname === "/emails") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const m = JSON.parse(raw);
        for (const to of m.to ?? []) box.unshift({ to: String(to).toLowerCase(), subject: m.subject, text: m.text, headers: m.headers ?? {}, at: new Date() });
        json(200, { id: `local_${box.length}` });
      });
      return;
    }
    if (u.pathname === "/outbox") return json(200, box.filter((m) => !u.searchParams.get("to") || m.to === u.searchParams.get("to").toLowerCase()));
    if (u.pathname === "/health") return res.end("ok");
    const items = box.map((m) => {
      const body = esc(m.text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
      return `<article><h2>${esc(m.subject)}</h2><p class="meta">To ${esc(m.to)} · ${m.at.toLocaleTimeString()}</p><pre>${body}</pre></article>`;
    }).join("");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><title>Local inbox</title><meta http-equiv="refresh" content="5">
<style>body{font:15px system-ui;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#191a1b}article{border:1px solid #e4e7ec;border-radius:10px;padding:1rem 1.25rem;margin:1rem 0}h2{font-size:1rem;margin:0}.meta{color:#586377;font-size:13px;margin:.25rem 0 .75rem}pre{white-space:pre-wrap;word-break:break-word;margin:0;font:inherit}a{color:#003fff}</style>
<h1>Local inbox</h1><p>Every email the app sends lands here instead of being delivered. Refreshes every 5 seconds.</p>${items || "<p><em>No emails yet.</em></p>"}`);
  }).listen(P.mail, () => console.log(`[mail]  inbox at ${U.mail}`));
}

/* ---------- demo storefront: a stand-in shop that loads the real SDK ---------- */

function startStore() {
  createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/health") return res.end("ok");
    // The core script and the per-tool scripts it loads on demand (cf-<tool>.<hash>.js) come from the same directory.
    const sdk = /^\/(cf(?:-[a-z]+\.[0-9a-f]{10})?\.js)$/.exec(u.pathname);
    if (sdk) {
      const file = join(dirname(SDK_BUNDLE), sdk[1]);
      if (!existsSync(file)) { res.writeHead(404); return res.end("SDK not built"); }
      res.setHeader("content-type", "application/javascript"); res.setHeader("cache-control", "no-store");
      return res.end(readFileSync(file));
    }
    const site = (u.searchParams.get("site") ?? "").replace(/[^\w-]/g, "");
    const consent = u.searchParams.get("consent"); // 1 = analytics allowed, 0 = not; omitted = the SDK decides
    let ctx = "";
    try { const raw = u.searchParams.get("ctx"); if (raw) ctx = `window.ConvertFlowContext=${JSON.stringify(JSON.parse(raw))};`; } catch { /* ignore bad ctx */ }
    res.setHeader("content-type", "text/html");
    if (!site) {
      return res.end(`<!doctype html><meta charset="utf-8"><title>Demo shop</title><body style="font:16px system-ui;max-width:36rem;margin:3rem auto">
<h1>Demo shop</h1><p>Open a page with your store's site key (Settings in the app):</p>
<p><code>${U.store}/products/running-shoe?site=<b>YOUR_SITE_KEY</b>&amp;consent=0</code></p>
<p>The path picks the page type: <code>/</code> home, <code>/products/x</code> product, <code>/collections/x</code> collection, <code>/cart</code> cart.</p></body>`);
    }
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Demo shop ${esc(u.pathname)}</title></head>
<body style="font-family:sans-serif"><h1>Demo shop</h1><p>Path: ${esc(u.pathname)}</p>
${consent === null && !ctx ? "" : `<script>${consent === null ? "" : `window.ConvertFlow={consent:${consent === "1"}};`}${ctx}</script>`}
<script async src="/cf.js" data-site="${site}" data-api="${U.api}"></script>
<button id="buy" onclick="window.ConvertFlow.trackPurchase({orderId:'DEV-'+Date.now(),total:59.9,currency:'USD'})">Simulate order confirmation</button>
</body></html>`);
  }).listen(P.store, () => console.log(`[shop]  demo storefront at ${U.store}`));
}

/* ---------- processes ---------- */

const children = [];
function service(name, cmd, cwd, env = {}) {
  const c = spawn(cmd, { cwd, shell: true, env: { ...process.env, ...env } });
  children.push(c);
  const pipe = (stream) => { let tail = ""; stream.on("data", (d) => { const lines = (tail + d).split(/\r?\n/); tail = lines.pop() ?? ""; for (const l of lines) if (l.trim()) console.log(`[${name}] ${l}`); }); };
  pipe(c.stdout); pipe(c.stderr);
  c.on("exit", (code) => { if (!stopping) console.log(`[${name}] exited (${code}). Stopping everything.`), stop(1); });
}
let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const c of children) {
    if (!c.pid) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else c.kill("SIGTERM");
  }
  process.exit(code);
}

function up() {
  ensureEnv();
  if (!existsSync(SDK_BUNDLE)) { console.log("building the storefront SDK (first run)..."); if (run("pnpm --filter @convertflow/storefront-sdk build", ROOT).status !== 0) process.exit(1); }
  migrate();
  startMail(); startStore();
  service("api", `pnpm exec wrangler dev --local --port ${P.api} --persist-to ${quoted(STATE)} --var ALLOWED_ORIGIN:${U.web} --var API_ORIGIN:${U.api}`, API_DIR);
  service("web", `pnpm exec next dev -p ${P.web}`, WEB_DIR, { NEXT_PUBLIC_API_URL: U.api, NEXT_PUBLIC_SDK_URL: U.store });
  process.on("SIGINT", () => stop(0)); process.on("SIGTERM", () => stop(0));
  setTimeout(() => console.log(`\nReady when the api and web lines above settle:\n  app      ${U.web}\n  api      ${U.api}/health\n  inbox    ${U.mail}\n  demo shop ${U.store}\nCtrl+C stops everything.\n`), 4000);
}

const [cmd = "up", ...rest] = process.argv.slice(2);
if (cmd === "up") up();
else if (cmd === "db") { ensureEnv(); migrate(); }
else if (cmd === "plan") setPlan(rest[0], rest[1]);
else if (cmd === "feature") enableFeature(rest[0], rest[1]);
else if (cmd === "reset") { rmSync(join(ROOT, ".local-dev"), { recursive: true, force: true }); console.log("local database deleted"); }
else { console.error("Usage: node scripts/dev-local.mjs [up|db|plan <email> <plan>|feature <email> <capability>|reset]"); process.exit(1); }
