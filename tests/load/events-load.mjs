// Load + integrity test for the hot path: public event ingestion and the edge config.
//   1. start the API:  cd apps/api && pnpm exec wrangler d1 migrations apply convertflow --local --persist-to ../../tests/load/.state
//                      pnpm exec wrangler dev --local --port 8799 --persist-to ../../tests/load/.state --var ALLOWED_ORIGIN:http://localhost:3100
//   2. run:            node tests/load/events-load.mjs [seconds=15] [concurrency=16]
// Numbers are from the LOCAL runtime (workerd + local SQLite/Queue): useful for regressions and integrity, NOT a
// production capacity claim. Production adds network latency and D1's single-writer limits (see docs/architecture.md).
const API = process.env.API ?? "http://localhost:8799";
const SECONDS = Number(process.argv[2] ?? 15), CONC = Number(process.argv[3] ?? 16);
const H = { origin: "http://localhost:3100", "content-type": "application/json" };

const j = async (res) => { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } };
const email = `load${Date.now()}@example.com`;
let r = await fetch(`${API}/api/v1/auth/register`, { method: "POST", headers: H, body: JSON.stringify({ email, password: "correct-horse-battery" }) });
const cookie = r.headers.get("set-cookie").split(";")[0];
const auth = { ...H, cookie };
const reg = await j(r);
r = await fetch(`${API}/api/v1/stores`, { method: "POST", headers: auth, body: JSON.stringify({ organizationId: reg.data.organizationId, platform: "custom", name: "Load", domain: "load.example.com", currency: "USD" }) });
const store = (await j(r)).data;
const cfg = { schemaVersion: 1, name: "Load", format: "popup", creative: { headline: "Hi", ctaLabel: "Go", ctaUrl: "/" }, style: {}, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] }, frequency: {}, goal: { type: "clicks" } };
const camp = (await j(await fetch(`${API}/api/v1/stores/${store.id}/campaigns`, { method: "POST", headers: auth, body: JSON.stringify(cfg) }))).data;
await fetch(`${API}/api/v1/stores/${store.id}/campaigns/${camp.id}/publish`, { method: "POST", headers: auth, body: JSON.stringify({ approve: true, approvedUpdatedAt: camp.updatedAt }) });
const versionId = (await j(await fetch(`${API}/api/v1/stores/${store.id}/campaigns/${camp.id}/versions`, { headers: auth }))).data[0].id;

let seq = 0, sentEvents = 0;
const stats = { ok: 0, bad: 0, limited: 0, lat: [] };
const batch = () => {
  const events = Array.from({ length: 50 }, () => ({ eventId: `ld_${Date.now().toString(36)}_${seq++}`, type: "campaign_impression", siteId: store.siteKey, campaignId: camp.id, versionId, sessionId: `sess_${seq % 997}_load`, occurredAt: new Date().toISOString(), schemaVersion: 1 }));
  return events;
};
async function worker(until) {
  while (Date.now() < until) {
    const events = batch();
    const t0 = performance.now();
    try {
      const res = await fetch(`${API}/api/v1/events/batch`, { method: "POST", headers: { "content-type": "text/plain", "cf-connecting-ip": `10.${(seq >> 8) & 255}.${seq & 255}.${(seq * 7) & 255}` }, body: JSON.stringify({ consent: true, events }) });
      stats.lat.push(performance.now() - t0);
      if (res.status === 202) { stats.ok++; sentEvents += events.length; } else if (res.status === 429) stats.limited++; else stats.bad++;
      await res.arrayBuffer();
    } catch { stats.bad++; }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: CONC }, () => worker(t0 + SECONDS * 1000)));
const secs = (Date.now() - t0) / 1000;
const pct = (p) => stats.lat.sort((a, b) => a - b)[Math.floor(stats.lat.length * p)]?.toFixed(1);
console.log(`ingest: ${stats.ok} batches ok (${sentEvents} events) in ${secs.toFixed(1)}s = ${(stats.ok / secs).toFixed(0)} req/s, ${(sentEvents / secs).toFixed(0)} events/s | errors ${stats.bad}, 429 ${stats.limited}`);
console.log(`latency ms: p50 ${pct(0.5)}  p95 ${pct(0.95)}  p99 ${pct(0.99)}`);

// Integrity: after the queue drains, the aggregate must equal exactly what was accepted. Then replay a batch: nothing may change.
const day = new Date().toISOString().slice(0, 10);
const count = async () => (await j(await fetch(`${API}/api/v1/stores/${store.id}/analytics?from=${day}&to=${day}`, { headers: auth }))).data.totals.impressions;
let got = 0;
for (let i = 0; i < 60; i++) { got = await count(); if (got >= sentEvents) break; await new Promise((r) => setTimeout(r, 1000)); }
console.log(`integrity: accepted ${sentEvents}, aggregated ${got} -> ${got === sentEvents ? "EXACT MATCH" : "MISMATCH"}`);
// Idempotency. The local queue holds a batch for up to its 5 s timeout, so poll for the first delivery instead of guessing.
const replay = batch();
const post = () => fetch(`${API}/api/v1/events/batch`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ consent: true, events: replay }) });
const waitFor = async (want) => { for (let i = 0; i < 40; i++) { if ((await count()) >= want) return; await new Promise((r) => setTimeout(r, 500)); } };
await post(); await waitFor(sentEvents + 50);
const before = await count();
await post(); await new Promise((r) => setTimeout(r, 9000)); // longer than the queue batch window
const after = await count();
console.log(`idempotency: replayed batch changed the total by ${after - before} (must be 0)`);

// Edge config is the other hot path (every shopper page view).
const lat = []; let cfgBad = 0;
const t1 = Date.now();
await Promise.all(Array.from({ length: CONC }, async () => { while (Date.now() - t1 < 5000) { const s = performance.now(); const res = await fetch(`${API}/sdk/v1/config/${store.siteKey}.json`); lat.push(performance.now() - s); if (!res.ok) cfgBad++; await res.arrayBuffer(); } }));
lat.sort((a, b) => a - b);
console.log(`config: ${lat.length} reqs in 5s = ${(lat.length / 5).toFixed(0)} req/s, p50 ${lat[Math.floor(lat.length * 0.5)].toFixed(1)}ms p99 ${lat[Math.floor(lat.length * 0.99)].toFixed(1)}ms, errors ${cfgBad}`);

const ok = stats.bad === 0 && cfgBad === 0 && got === sentEvents && after === before;
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(ok ? 0 : 1);
