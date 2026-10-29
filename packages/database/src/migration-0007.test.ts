import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../migrations");
const statements = (file: string) => readFileSync(join(DIR, file), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const M = "0007_campaign_groups_and_templates.sql";
const BEFORE = ALL.filter((f) => f < M);

async function db(files: string[]) {
  const c = createClient({ url: ":memory:" });
  await c.execute("PRAGMA foreign_keys = ON");
  for (const f of files) for (const s of statements(f)) await c.execute(s);
  return c;
}
const rejects = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };

describe("migration 0007: campaign groups and saved templates", () => {
  it("is the migration after 0006 and adds only new tables", async () => {
    expect(BEFORE.at(-1)).toMatch(/^0006_/);
    const c = await db([...BEFORE, M]);
    const tables = (await c.execute("select name from sqlite_master where type='table'")).rows.map((r) => r["name"]);
    expect(tables).toEqual(expect.arrayContaining(["campaign_groups", "campaign_group_members", "campaign_templates", "campaigns"]));
  });

  it("allows one group name per store, and one membership per group and campaign", async () => {
    const c = await db([...BEFORE, M]);
    // This test is about uniqueness, not parents: the store and campaign rows are not needed here.
    await c.execute("PRAGMA foreign_keys = OFF");
    await c.execute("insert into campaign_groups (id,store_id,name,created_at,updated_at) values ('g1','s1','Spring','2026-10-27','2026-10-27')");
    expect(await rejects(c.execute("insert into campaign_groups (id,store_id,name,created_at,updated_at) values ('g2','s1','Spring','2026-10-27','2026-10-27')"))).toBe(true);
    await c.execute("insert into campaign_group_members (group_id,campaign_id,store_id,added_at) values ('g1','c1','s1','2026-10-27')");
    expect(await rejects(c.execute("insert into campaign_group_members (group_id,campaign_id,store_id,added_at) values ('g1','c1','s1','2026-10-27')"))).toBe(true);
  });
});
