// A stand-in storefront on another origin. ?site=<siteKey>&consent=1|0 controls the snippet.
// The URL path decides the page type the SDK detects (/, /products/x, /cart ...).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const DIST = new URL("../../apps/storefront-sdk/dist/", import.meta.url);
// The core script and the per-tool scripts it loads on demand (cf-<tool>.<hash>.js) are served from the same directory, like a real host does.
const SDK_FILE = /^\/(cf(?:-[a-z]+\.[0-9a-f]{10})?\.js)$/;

createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/health") return res.end("ok");
  const sdk = SDK_FILE.exec(u.pathname);
  if (sdk) { res.setHeader("content-type", "application/javascript"); try { return res.end(readFileSync(new URL(sdk[1], DIST))); } catch { res.statusCode = 404; return res.end("not found"); } }
  const site = u.searchParams.get("site") ?? "";
  const consent = u.searchParams.get("consent");
  // Optional page data the host page would normally provide (product id, availability...), passed as JSON.
  let ctx = "";
  try { const raw = u.searchParams.get("ctx"); if (raw) ctx = `window.ConvertFlowContext=${JSON.stringify(JSON.parse(raw))};`; } catch { /* ignore bad ctx */ }
  // ?adder=ok|slow|flaky|fail: the store's own ConvertFlow.addToCart, as a custom store would provide it. Added product ids end up in
  // window.__added and every call is counted in window.__calls. "slow" takes 800 ms, "flaky" fails once, "fail" always fails.
  const mode = (u.searchParams.get("adder") ?? "").replace(/[^a-z]/g, "");
  const adder = !mode ? "" : `window.__added=[];window.__calls=0;window.ConvertFlow=Object.assign(window.ConvertFlow||{},{addToCart:function(i){window.__calls++;
if(${JSON.stringify(mode)}==="fail"||(${JSON.stringify(mode)}==="flaky"&&window.__calls===1))return Promise.reject(new Error("store refused"));
return new Promise(function(ok){setTimeout(function(){window.__added.push(i.productId);ok({itemCount:window.__added.length,productIds:window.__added.slice()});},${JSON.stringify(mode)}==="slow"?800:0);});}});`;
  res.setHeader("content-type", "text/html");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Demo shop ${u.pathname}</title></head>
<body style="font-family:sans-serif"><main><h1>Demo shop</h1><p>Path: ${u.pathname.replace(/[<>&]/g, "")}</p>
<div data-convertflow-recommendations></div></main>
${consent === null && !ctx && !adder ? "" : `<script>${consent === null ? "" : `window.ConvertFlow={consent:${consent === "1"}};`}${ctx}${adder}</script>`}
<script async src="/cf.js" data-site="${site.replace(/[^\w-]/g, "")}" data-api="http://localhost:${process.env.E2E_API_PORT ?? "8799"}"></script>
<button id="buy" onclick="window.ConvertFlow.trackPurchase({orderId:'E2E-'+Date.now(),total:59.9,currency:'USD'})">Simulate order confirmation</button>
</body></html>`);
}).listen(Number(process.env.E2E_STORE_PORT ?? 4000), () => console.log("storefront on", process.env.E2E_STORE_PORT ?? 4000));
