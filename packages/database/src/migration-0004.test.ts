import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../migrations");
const statements = (file: string) => readFileSync(join(DIR, file), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
const BEFORE = ["0000_same_raider.sql", "0001_tiresome_vision.sql", "0002_campaign_tool.sql", "0003_contacts_consent.sql"];
const M = "0004_upsell_relationships.sql";

async function db(files: string[]) {
  const c = createClient({ url: ":memory:" });
  await c.execute("PRAGMA foreign_keys = ON");
  for (const f of files) for (const s of statements(f)) await c.execute(s);
  return c;
}
type Db = Awaited<ReturnType<typeof db>>;
const seed = async (c: Db) => {
  await c.execute("insert into organizations (id,name,created_at) values ('o1','Org','t')");
  await c.execute("insert into stores (id,organization_id,platform,name,domain,site_key,currency,delivery_enabled,status,created_at,updated_at) values ('s1','o1','custom','S','a.example.com','cf_key1','USD',1,'active','t','t')");
  for (const p of ["p1", "p2"]) await c.execute({ sql: "insert into products (id,store_id,external_id,title,status,collection_ids,synced_at) values (?,'s1',?,?,'active','[]','t')", args: [p, p, p] });
};
const rejects = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };
const link = (c: Db, id: string, kind = "complement", from = "p1", to = "p2") =>
  c.execute({ sql: "insert into product_relationships (id,store_id,product_id,related_product_id,kind,weight,created_at) values (?,'s1',?,?,?,0,'t')", args: [id, from, to, kind] });

describe("migration 0004: upsell product links and add-to-cart counts", () => {
  it("keeps existing analytics rows and gives them zero add-to-carts", async () => {
    const c = await db(BEFORE);
    await c.execute("insert into analytics_aggregates (store_id,campaign_id,version_id,day,impressions,clicks) values ('s1','c1','v1','2026-10-27',7,3)");
    for (const s of statements(M)) await c.execute(s);
    const [row] = (await c.execute("select impressions, clicks, add_to_carts from analytics_aggregates")).rows;
    expect(row).toMatchObject({ impressions: 7, clicks: 3, add_to_carts: 0 });
  });

  it("allows one link per pair and kind, but the same pair may be linked as both a complement and an alternative", async () => {
    const c = await db([...BEFORE, M]);
    await seed(c);
    await link(c, "r1", "complement");
    await link(c, "r2", "alternative");
    expect(await rejects(link(c, "r3", "complement"))).toBe(true);
    expect(await rejects(link(c, "r4", "alternative"))).toBe(true);
    await link(c, "r5", "complement", "p2", "p1"); // the reverse direction is its own link
  });

  it("removes links with either product, and with the store", async () => {
    const c = await db([...BEFORE, M]);
    await seed(c);
    await link(c, "r1");
    await c.execute("delete from products where id = 'p2'"); // the linked product
    expect((await c.execute("select count(*) as n from product_relationships")).rows[0]).toMatchObject({ n: 0 });
    await c.execute("insert into products (id,store_id,external_id,title,status,collection_ids,synced_at) values ('p3','s1','p3','p3','active','[]','t')");
    await link(c, "r2", "complement", "p1", "p3");
    await c.execute("delete from stores where id = 's1'");
    expect((await c.execute("select count(*) as n from product_relationships")).rows[0]).toMatchObject({ n: 0 });
  });

  it("stores the kind and weight as given (the allowed kinds are enforced by the API, not by SQL)", async () => {
    const c = await db([...BEFORE, M]);
    await seed(c);
    await link(c, "r1", "complement");
    const [r] = (await c.execute("select kind, weight from product_relationships")).rows;
    expect(r).toMatchObject({ kind: "complement", weight: 0 });
  });
});
