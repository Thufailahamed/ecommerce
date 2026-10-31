import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../migrations");
const statements = (file: string) => readFileSync(join(DIR, file), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const T = "2026-10-29T00:00:00Z";
const rejects = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };

async function db() {
  const c = createClient({ url: ":memory:" });
  await c.execute("PRAGMA foreign_keys = ON");
  for (const f of ALL.filter((x) => x <= "0012~")) for (const s of statements(f)) await c.execute(s);
  await c.execute(`insert into organizations (id,name,created_at) values ('o1','O','${T}')`);
  return c;
}
const site = (id: string, slug: string) => `insert into sites (id,organization_id,name,slug,draft,created_at,updated_at) values ('${id}','o1','S','${slug}','{}','${T}','${T}')`;

describe("migration 0012: AI store builder", () => {
  it("follows 0011", () => {
    expect(ALL.find((f) => f.startsWith("0012"))).toBe("0012_ai_store_builder.sql");
  });

  it("slugs are unique across the platform; versions and order numbers unique per site", async () => {
    const c = await db();
    await c.execute(site("s1", "ember"));
    expect(await rejects(c.execute(site("s2", "ember")))).toBe(true);
    const v = (n: number) => c.execute(`insert into site_versions (id,site_id,number,kind,label,document,created_at) values ('v${n}${Math.random()}','s1',${n},'ai','x','{}','${T}')`);
    await v(1);
    expect(await rejects(v(1))).toBe(true);
    const o = (id: string) => c.execute(`insert into site_orders (id,site_id,number,status,email,name,address,lines,currency,subtotal,shipping,total,access_hash,created_at,updated_at) values ('${id}','s1',1001,'unpaid','a@b.co','A','{}','[]','USD',1,0,1,'h','${T}','${T}')`);
    await o("o1");
    expect(await rejects(o("o2"))).toBe(true);
    const row = await c.execute("select status, revision from sites where id='s1'");
    expect(row.rows[0]).toMatchObject({ status: "draft", revision: 1 });
  });

  it("deleting the workspace removes its stores and everything under them", async () => {
    const c = await db();
    await c.execute(site("s1", "ember"));
    await c.execute(`insert into site_messages (id,site_id,role,content,created_at) values ('m1','s1','user','hi','${T}')`);
    await c.execute(`insert into site_assets (id,site_id,source,content_type,bytes,created_at) values ('a1','s1','ai','image/jpeg',10,'${T}')`);
    await c.execute(`insert into site_submissions (id,site_id,kind,email,created_at) values ('f1','s1','newsletter','a@b.co','${T}')`);
    await c.execute("delete from organizations where id='o1'");
    for (const t of ["sites", "site_messages", "site_assets", "site_submissions"]) {
      expect((await c.execute(`select count(*) n from ${t}`)).rows[0]?.["n"], t).toBe(0);
    }
  });
});
