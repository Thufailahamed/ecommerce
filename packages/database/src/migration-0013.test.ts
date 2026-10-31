import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../migrations");
const statements = (file: string) => readFileSync(join(DIR, file), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const T = "2026-10-29T00:00:00Z";
const rejects = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };

async function upTo(last: string) {
  const c = createClient({ url: ":memory:" });
  await c.execute("PRAGMA foreign_keys = ON");
  for (const f of ALL.filter((x) => x <= `${last}~`)) for (const s of statements(f)) await c.execute(s);
  return c;
}
const apply = async (c: Awaited<ReturnType<typeof upTo>>, file: string) => { for (const s of statements(file)) await c.execute(s); };

describe("migration 0013: Shopify app installs and billing provider", () => {
  it("follows 0012", () => {
    expect(ALL.find((f) => f.startsWith("0013"))).toBe("0013_shopify_app.sql");
  });

  it("marks existing paid subscriptions as Stripe and leaves never-paid workspaces without a provider", async () => {
    const c = await upTo("0012");
    await c.execute(`insert into organizations (id,name,created_at) values ('o1','A','${T}'),('o2','B','${T}')`);
    await c.execute(`insert into subscriptions (id,organization_id,plan,status,provider_ref,customer_ref,updated_at) values ('s1','o1','growth','active','sub_1','cus_1','${T}')`);
    await c.execute(`insert into subscriptions (id,organization_id,plan,status,updated_at) values ('s2','o2','free','active','${T}')`);
    await apply(c, "0013_shopify_app.sql");
    const rows = (await c.execute("select id, provider, plan from subscriptions order by id")).rows;
    expect(rows).toEqual([expect.objectContaining({ id: "s1", provider: "stripe", plan: "growth" }), expect.objectContaining({ id: "s2", provider: null })]);
  });

  it("one installation per shop and per claim token; deleting the store keeps the install record", async () => {
    const c = await upTo("0013");
    await c.execute(`insert into organizations (id,name,created_at) values ('o1','A','${T}')`);
    await c.execute(`insert into stores (id,organization_id,platform,name,domain,external_id,site_key,created_at,updated_at) values ('st1','o1','shopify','S','s.myshopify.com','s.myshopify.com','cf_aaaaaaaaaaaa','${T}','${T}')`);
    const ins = (id: string, shop: string, claim: string | null) => c.execute(`insert into shopify_installations (id,shop,store_id,status,scopes,claim_token_hash,installed_at,updated_at) values ('${id}','${shop}','st1','installed','read_products',${claim ? `'${claim}'` : "null"},'${T}','${T}')`);
    await ins("i1", "s.myshopify.com", "h1");
    expect(await rejects(ins("i2", "s.myshopify.com", null))).toBe(true);
    expect(await rejects(ins("i3", "t.myshopify.com", "h1"))).toBe(true);
    await ins("i4", "u.myshopify.com", null);
    await ins("i5", "v.myshopify.com", null); // several unclaimed rows: NULLs are distinct
    await c.execute("delete from stores where id='st1'");
    const left = (await c.execute("select id, store_id from shopify_installations order by id")).rows;
    expect(left.map((r) => r["store_id"])).toEqual([null, null, null]);
  });
});
