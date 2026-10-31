// Repository checks that run in CI next to typecheck and tests (`pnpm check`). Dependency-free on purpose: each rule here
// guards a mistake this codebase has actually made or must never make. It is not a general-purpose linter (none is
// configured); see docs/final-verification-report.md.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SKIP = new Set(["node_modules", ".next", ".open-next", ".wrangler", ".turbo", "dist", ".state", "test-results", ".local-dev", "playwright-report", ".git"]);
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs|js|jsonc|json|toml|sql|liquid|md)$/.test(name) && name !== "pnpm-lock.yaml") files.push(p);
  }
})(ROOT);

const problems = [];
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");
const isTest = (p) => /(\.test\.tsx?|\.spec\.ts|\/test\/|\/tests\/)/.test(rel(p));
const isSource = (p) => /\.(ts|tsx|mjs|js)$/.test(p);

for (const f of files) {
  const text = readFileSync(f, "utf8");
  const r = rel(f);
  // A control character in a source file once hid inside a regex and made it never match (docs/status.md).
  if (isSource(f) && /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) problems.push(`${r}: contains a control character`);
  if (isTest(f) && /\b(it|test|describe)\.only\(/.test(text)) problems.push(`${r}: focused test (.only) would skip the rest of the suite`);
  if (isSource(f) && /^\s*debugger;?\s*$/m.test(text)) problems.push(`${r}: debugger statement`);
  // Real-looking secrets outside tests and fixtures.
  if (!isTest(f) && /(sk_live_[A-Za-z0-9]{8,}|rk_live_[A-Za-z0-9]{8,}|shpat_[a-f0-9]{32}|shpss_[a-f0-9]{32}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY-----)/.test(text)) problems.push(`${r}: looks like a committed secret`);
}

// Every migration has its own migration test (they backfill and constrain data; untested SQL has broken things before).
const MIG = join(ROOT, "packages/database/migrations");
const DBSRC = join(ROOT, "packages/database/src");
const tested = readdirSync(DBSRC).filter((f) => /^migration-.*\.test\.ts$/.test(f)).map((f) => readFileSync(join(DBSRC, f), "utf8")).join("\n");
for (const m of readdirSync(MIG).filter((f) => /^\d{4}_.*\.sql$/.test(f))) {
  const n = m.slice(0, 4);
  if (n === "0000" || n === "0001") continue; // the initial schema, covered by schema.test.ts
  if (!tested.includes(n) && !tested.includes(m)) problems.push(`packages/database/migrations/${m}: no migration test mentions it`);
}

// The Shopify app's requested scopes and the API's default must agree, or installs fail the scope check.
const toml = readFileSync(join(ROOT, "apps/shopify-app/shopify.app.toml"), "utf8");
const tomlScopes = /^\s*scopes\s*=\s*"([^"]*)"/m.exec(toml)?.[1]?.split(",").map((s) => s.trim()).sort().join(",");
const appTs = readFileSync(join(ROOT, "apps/api/src/services/shopify-app.ts"), "utf8");
const codeScopes = /DEFAULT_SCOPES = \[([^\]]*)\]/.exec(appTs)?.[1]?.replace(/["\s]/g, "").split(",").sort().join(",");
if (!tomlScopes || !codeScopes || tomlScopes !== codeScopes) problems.push(`shopify.app.toml scopes (${tomlScopes}) differ from DEFAULT_SCOPES in shopify-app.ts (${codeScopes})`);

// Every tool the contracts ship has a storefront chunk in the SDK build.
const tools = /SHIPPED_TOOLS[^=]*= new Set<Tool>\(\[([^\]]*)\]/.exec(readFileSync(join(ROOT, "packages/contracts/src/tools.ts"), "utf8"))?.[1]?.replace(/["\s]/g, "").split(",") ?? [];
const build = readFileSync(join(ROOT, "apps/storefront-sdk/build.mjs"), "utf8");
if (tools.length === 0) problems.push("packages/contracts/src/tools.ts: could not read SHIPPED_TOOLS");
for (const t of tools) if (!build.includes(`"${t}"`)) problems.push(`apps/storefront-sdk/build.mjs: shipped tool "${t}" has no storefront chunk`);

if (problems.length) {
  console.error(`Repository checks failed (${problems.length}):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`Repository checks passed (${files.length} files).`);
