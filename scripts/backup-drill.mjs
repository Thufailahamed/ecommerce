// Backup and restore drill: export a database, restore it into an empty one, and prove the copy is complete.
//   node scripts/backup-drill.mjs [persistDir=tests/load/.state]
// Runs against LOCAL D1 (SQLite) in throwaway project directories, so it never touches your dev database.
// The same flow works against a real database:
//   wrangler d1 export convertflow --remote --output backup.sql        (or Time Travel: wrangler d1 time-travel restore ...)
//   wrangler d1 execute convertflow-restore --remote --file backup.sql
// Rehearse the REMOTE version against staging before you need it. This script proves the dump/restore logic and that
// the schema (indexes, foreign keys, unique constraints) survives a round trip.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const src = resolve(process.argv[2] ?? "tests/load/.state");
const apiDir = resolve("apps/api");
// Miniflare derives the local database file name from database_id, so this MUST match the id the source was created with
// (apps/api/wrangler.jsonc ships the placeholder "REPLACE_ME"). Override with DB_ID=... if you replaced it.
const DB_ID = process.env.DB_ID ?? "REPLACE_ME";
const work = mkdtempSync(join(tmpdir(), "cf-drill-"));
const dump = join(work, "backup.sql");

/** A throwaway project whose default local state is `state` (wrangler d1 export has no --persist-to). */
function project(name, copyStateFrom) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "wrangler.jsonc"), JSON.stringify({ name, compatibility_date: "2026-10-01", d1_databases: [{ binding: "DB", database_name: "convertflow", database_id: DB_ID }] }));
  if (copyStateFrom) cpSync(copyStateFrom, join(dir, ".wrangler", "state"), { recursive: true });
  return dir;
}
// Run wrangler's own binary with cwd = the throwaway project. (`pnpm --dir ... exec` would silently run in apps/api,
// i.e. against the real local dev database, so it is deliberately not used here.)
// The package does not export its bin path, so locate it relative to package.json (always exported).
const wranglerRoot = dirname(createRequire(join(apiDir, "package.json")).resolve("wrangler/package.json"));
const wranglerBin = join(wranglerRoot, "bin", "wrangler.js");
const wr = (cwd, args) => {
  if (!resolve(cwd).startsWith(resolve(work))) throw new Error(`refusing to run wrangler outside the temp workspace: ${cwd}`);
  return execSync(`node "${wranglerBin}" ${args}`, { cwd, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 512 * 1024 * 1024 }).toString();
};
const q = (cwd, sql) => JSON.parse(wr(cwd, `d1 execute convertflow --local --json --command "${sql}"`))[0].results;

const A = project("source", src);
const tables = q(A, "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf_%' and name not like 'd1_%' order by name").map((r) => r.name);
if (tables.length === 0) { console.error("source database has no tables: run the load test or migrations first"); process.exit(2); }

console.log(`1) exporting ${tables.length} tables from ${src}`);
wr(A, `d1 export convertflow --local --output "${dump}"`);
// Drop wrangler's own bookkeeping (migration history, autoincrement counters). It is not application data and
// restoring it onto a database that already tracks migrations collides. `wrangler d1 migrations apply` rebuilds it.
const cleaned = readFileSync(dump, "utf8")
  .replace(/CREATE TABLE IF NOT EXISTS "d1_migrations"\([\s\S]*?\);\r?\n/, "")
  .replace(/INSERT INTO "d1_migrations".*\r?\n/g, "")
  .replace(/INSERT INTO "sqlite_sequence".*\r?\n/g, "");
// The dump interleaves each table's CREATE with its rows, so a child table's INSERTs can precede its parent's CREATE.
// Real D1 defers foreign-key checks on import (the dump starts with PRAGMA defer_foreign_keys=TRUE); local SQLite
// still resolves the parent table at insert time. Putting every CREATE before every INSERT is order-independent.
const stmts = cleaned.split(/;\r?\n/).map((s) => s.trim()).filter((s) => s && !/sqlite_sequence/.test(s)); // no AUTOINCREMENT tables remain, so no sqlite_sequence
const rank = (s) => (/^PRAGMA/i.test(s) ? 0 : /^CREATE/i.test(s) ? 1 : 2);
writeFileSync(dump, stmts.map((s, i) => [rank(s), i, s]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , s]) => `${s};`).join("\n") + "\n");
console.log(`   dump: ${(statSync(dump).size / 1024).toFixed(0)} KB`);

console.log("2) restoring into an EMPTY database (no migrations applied)");
const B = project("restored");
wr(B, `d1 execute convertflow --local --file "${dump}"`);

console.log("3) comparing");
let ok = true, rows = 0;
for (const t of tables) {
  const a = q(A, `select count(*) as n from \\"${t}\\"`)[0].n, b = q(B, `select count(*) as n from \\"${t}\\"`)[0].n;
  rows += a;
  if (a !== b) { ok = false; console.log(`   MISMATCH ${t}: source ${a}, restored ${b}`); }
}
// Counts can match while contents differ, so compare every row: re-export the restored database and require the
// set of INSERT statements to be identical to the original's. (D1 does not allow PRAGMA integrity_check.)
const dump2 = join(work, "restored.sql");
wr(B, `d1 export convertflow --local --output "${dump2}"`);
const inserts = (file) => readFileSync(file, "utf8").split(/;\r?\n/).filter((s) => /^INSERT INTO/i.test(s.trim()) && !/d1_migrations|sqlite_sequence/.test(s)).map((s) => s.trim()).sort();
const rowsA = inserts(dump), rowsB = inserts(dump2);
const sameRows = rowsA.length === rowsB.length && rowsA.every((r, i) => r === rowsB[i]);
if (!sameRows) { ok = false; console.log(`   ROW CONTENT DIFFERS: ${rowsA.length} source rows vs ${rowsB.length} restored`); }
const fk = q(B, "pragma foreign_key_check");
const idx = (dir) => q(dir, "select count(*) as n from sqlite_master where type='index' and name not like 'sqlite_%'")[0].n;
const idxA = idx(A), idxB = idx(B);
console.log(`   ${tables.length} tables, ${rows} rows counted; every row byte-identical=${sameRows}; foreign_key violations=${fk.length}; indexes ${idxA} -> ${idxB}`);
if (fk.length) ok = false;
if (idxA !== idxB) { ok = false; console.log("   indexes were not all restored"); }

// The constraint the app depends on must survive the round trip: duplicate event ids are still rejected.
try {
  q(B, "insert into event_dedup (store_id,event_id,seen_at) values ('s','e','t')");
  q(B, "insert into event_dedup (store_id,event_id,seen_at) values ('s','e','t')");
  ok = false; console.log("   UNIQUE constraint on event_dedup did NOT survive the restore");
} catch { console.log("   unique constraints survived (duplicate insert rejected)"); }

rmSync(work, { recursive: true, force: true });
console.log(ok ? "RESULT: PASS (backup restores completely)" : "RESULT: FAIL");
process.exit(ok ? 0 : 1);
