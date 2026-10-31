import { build } from "esbuild";
import { createHash } from "node:crypto";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";

// The core script is the only one every page downloads, so it carries the marketing claim. Each tool's renderer is a
// separate script, fetched the first time a campaign of that tool is eligible. A page that uses every tool downloads
// the core plus all five; the TOTAL budget keeps that bounded too.
const BUDGET_CORE_GZIP = 12 * 1024; // fail the build, not a code review, if the core bloats
const BUDGET_TOTAL_GZIP = 35 * 1024;
// The marketing site says "under 15 KB". If the core trips this, either slim the SDK or change that copy
// (apps/web/components/marketing/sections.tsx: FactsBand and FAQ) so the claim stays true.
const MARKETING_CLAIM_GZIP = 15 * 1024;
const TOOLS = ["toast", "feed", "upsell", "email", "sms"];

const common = { bundle: true, minify: true, format: "iife", target: "es2019", legalComments: "none", write: false };
const gz = (b) => gzipSync(b, { level: 9 }).length;

mkdirSync("dist", { recursive: true });
for (const f of readdirSync("dist")) if (/^cf(-[a-z]+\.[0-9a-f]{10})?\.js$/.test(f)) rmSync(`dist/${f}`);

// Tool scripts first: the core is built knowing their content-hashed names, so a cached core can never request a
// tool script from a different release (a new release means new names).
const chunks = {};
let total = 0;
for (const t of TOOLS) {
  const r = await build({ ...common, entryPoints: [`src/chunk-${t}.ts`] });
  const out = r.outputFiles[0].contents;
  const name = `cf-${t}.${createHash("sha256").update(out).digest("hex").slice(0, 10)}.js`;
  writeFileSync(`dist/${name}`, out);
  chunks[t] = name;
  total += gz(out);
  console.log(`  ${name}: ${out.length} B raw, ${gz(out)} B gzip`);
}

const r = await build({ ...common, entryPoints: ["src/index.ts"], define: { __CF_CHUNKS__: JSON.stringify(chunks) } });
const raw = r.outputFiles[0].contents;
writeFileSync("dist/cf.js", raw);
const core = gz(raw);
total += core;
console.log(`SDK core: ${raw.length} B raw, ${core} B gzip, ${brotliCompressSync(raw).length} B brotli. All scripts together: ${total} B gzip`);
if (core > BUDGET_CORE_GZIP) {
  console.error(`SDK core exceeds the ${BUDGET_CORE_GZIP} B gzip budget`);
  process.exit(1);
}
if (total > BUDGET_TOTAL_GZIP) {
  console.error(`SDK scripts together exceed the ${BUDGET_TOTAL_GZIP} B gzip budget`);
  process.exit(1);
}
if (core > MARKETING_CLAIM_GZIP) {
  console.error(`SDK core is ${core} B gzip, above the ${MARKETING_CLAIM_GZIP} B the marketing site claims. Update the copy or slim the SDK.`);
  process.exit(1);
}

// Served by Workers static assets. The core has a short cache + SWR so SDK fixes roll out within the hour; tool scripts
// are named by content hash, so they can be cached for good.
writeFileSync("dist/_headers",
  "/cf.js\n  Cache-Control: public, max-age=3600, stale-while-revalidate=86400\n  Access-Control-Allow-Origin: *\n  X-Content-Type-Options: nosniff\n" +
  "/cf-*.js\n  Cache-Control: public, max-age=31536000, immutable\n  Access-Control-Allow-Origin: *\n  X-Content-Type-Options: nosniff\n");
