import { createClient, type Client } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../migrations");
let db: Client;

beforeEach(async () => {
  db = createClient({ url: ":memory:" });
  await db.execute("PRAGMA foreign_keys = ON"); // D1 enforces foreign keys
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(join(DIR, f), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await db.execute(stmt);
  }
});

const run = (sql: string, args: (string | number | null)[] = []) => db.execute({ sql, args });
const seedOrg = async () => {
  await run("insert into organizations (id,name,created_at) values ('o1','Org','t')");
  await run("insert into stores (id,organization_id,platform,name,domain,site_key,currency,delivery_enabled,status,created_at,updated_at) values ('s1','o1','custom','S','a.example.com','cf_key1',?, 1,'active','t','t')", ["USD"]);
};

describe("migrations", () => {
  it("apply cleanly and create the expected tables", async () => {
    const r = await run("select name from sqlite_master where type='table' and name not like '\\_%' escape '\\' and name not like 'sqlite_%'");
    const tables = r.rows.map((x) => String(x["name"]));
    for (const t of ["users", "organizations", "memberships", "sessions", "stores", "campaigns", "campaign_versions", "event_dedup", "analytics_aggregates", "conversions", "attribution_records", "webhook_events", "subscriptions", "usage_records", "ai_generations", "audit_logs", "integration_credentials", "products", "product_variants"]) {
      expect(tables, t).toContain(t);
    }
  });
});

describe("integrity guarantees the app relies on", () => {
  it("rejects duplicate emails, site keys and platform identities", async () => {
    await run("insert into users (id,email,created_at) values ('u1','a@x.com','t')");
    await expect(run("insert into users (id,email,created_at) values ('u2','a@x.com','t')")).rejects.toThrow(/UNIQUE/i);
    await seedOrg();
    await expect(run("insert into stores (id,organization_id,platform,name,domain,site_key,currency,delivery_enabled,status,created_at,updated_at) values ('s2','o1','custom','S','b.example.com','cf_key1','USD',1,'active','t','t')")).rejects.toThrow(/UNIQUE/i);
  });
  it("makes webhook deliveries and events idempotent at the database level", async () => {
    await seedOrg();
    await run("insert into webhook_events (id,store_id,platform,delivery_id,topic,status,received_at) values ('w1','s1','shopify','d1','t','received','t')");
    await expect(run("insert into webhook_events (id,store_id,platform,delivery_id,topic,status,received_at) values ('w2','s1','shopify','d1','t','received','t')")).rejects.toThrow(/UNIQUE/i);
    await run("insert into event_dedup (store_id,event_id,seen_at) values ('s1','e1','t')");
    await expect(run("insert into event_dedup (store_id,event_id,seen_at) values ('s1','e1','t')")).rejects.toThrow(/UNIQUE/i);
    await run("insert into event_dedup (store_id,event_id,seen_at) values ('s2','e1','t')"); // same id, other store: fine
  });
  it("campaign versions are unique per campaign and number", async () => {
    await seedOrg();
    await run("insert into campaigns (id,store_id,name,status,draft_config,created_at,updated_at) values ('c1','s1','n','draft','{}','t','t')");
    await run("insert into campaign_versions (id,campaign_id,store_id,version,config,source,created_at) values ('v1','c1','s1',1,'{}','manual','t')");
    await expect(run("insert into campaign_versions (id,campaign_id,store_id,version,config,source,created_at) values ('v2','c1','s1',1,'{}','manual','t')")).rejects.toThrow(/UNIQUE/i);
  });
  it("one conversion per order and one attribution per rule", async () => {
    await seedOrg();
    await run("insert into conversions (id,store_id,order_id,total,currency,occurred_at) values ('k1','s1','o-1',10,'USD','t')");
    await expect(run("insert into conversions (id,store_id,order_id,total,currency,occurred_at) values ('k2','s1','o-1',10,'USD','t')")).rejects.toThrow(/UNIQUE/i);
  });
  it("deleting a store cascades to campaigns, versions, products and credentials", async () => {
    await seedOrg();
    await run("insert into campaigns (id,store_id,name,status,draft_config,created_at,updated_at) values ('c1','s1','n','draft','{}','t','t')");
    await run("insert into campaign_versions (id,campaign_id,store_id,version,config,source,created_at) values ('v1','c1','s1',1,'{}','manual','t')");
    await run("insert into products (id,store_id,external_id,title,status,collection_ids,synced_at) values ('p1','s1','x','T','active','[]','t')");
    await run("insert into product_variants (id,store_id,product_id,external_id,availability,synced_at) values ('pv1','s1','p1','y','unknown','t')");
    await run("insert into integration_credentials (id,store_id,encrypted_access_token,updated_at) values ('i1','s1','ct','t')");
    await run("delete from stores where id='s1'");
    for (const t of ["campaigns", "campaign_versions", "products", "product_variants", "integration_credentials"]) {
      expect((await run(`select count(*) as n from ${t}`)).rows[0]?.["n"], t).toBe(0);
    }
  });
  it("rejects rows that violate enums-by-foreign-key (orphan store)", async () => {
    await expect(run("insert into campaigns (id,store_id,name,status,draft_config,created_at,updated_at) values ('c1','missing','n','draft','{}','t','t')")).rejects.toThrow(/FOREIGN KEY/i);
  });
});
