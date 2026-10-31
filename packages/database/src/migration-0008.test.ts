import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../migrations");
const statements = (file: string) => readFileSync(join(DIR, file), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const M = "0008_platform_foundation.sql";
const BEFORE = ALL.filter((f) => f < M);

async function db(files: string[]) {
  const c = createClient({ url: ":memory:" });
  await c.execute("PRAGMA foreign_keys = ON");
  for (const f of files) for (const s of statements(f)) await c.execute(s);
  return c;
}
const rejects = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };
const T = "2026-10-29T00:00:00Z";

describe("migration 0008: audit enrichment and platform events", () => {
  it("is the migration after 0007", () => {
    expect(BEFORE.at(-1)).toMatch(/^0007_/);
  });

  it("keeps existing audit rows, classifies their actors and fills in the workspace from the store", async () => {
    const c = await db(BEFORE);
    await c.execute(`insert into organizations (id,name,created_at) values ('o1','O','${T}')`);
    await c.execute(`insert into stores (id,organization_id,platform,name,domain,site_key,created_at,updated_at) values ('s1','o1','custom','S','s.example.com','cf_key1234567','${T}','${T}')`);
    await c.execute(`insert into audit_logs (id,store_id,actor_id,action,created_at) values ('a1','s1','u1','campaign.published','${T}')`);
    await c.execute(`insert into audit_logs (id,store_id,action,target_type,created_at) values ('a2','s1','customers/redact','privacy_request','${T}')`);
    await c.execute(`insert into audit_logs (id,store_id,action,created_at) values ('a3','s1','contact.provider_cleanup_failed','${T}')`);
    await c.execute(`insert into audit_logs (id,organization_id,actor_id,action,created_at) values ('a4','o1','u1','team.invited','${T}')`);
    await c.execute(`insert into audit_logs (id,store_id,actor_id,action,created_at) values ('a5','gone','u1','store.created','${T}')`);
    for (const s of statements(M)) await c.execute(s);

    const rows = (await c.execute("select id, organization_id, actor_type, correlation_id, summary from audit_logs order by id")).rows;
    expect(rows.map((r) => [r["id"], r["organization_id"], r["actor_type"]])).toEqual([
      ["a1", "o1", "user"], ["a2", "o1", "platform"], ["a3", "o1", "system"], ["a4", "o1", "user"], ["a5", null, "user"],
    ]);
    expect(rows.every((r) => r["correlation_id"] === null && r["summary"] === null)).toBe(true);
  });

  it("records an event once per workspace idempotency key and removes deliveries with their event", async () => {
    const c = await db([...BEFORE, M]);
    await c.execute(`insert into organizations (id,name,created_at) values ('o1','O','${T}'),('o2','P','${T}')`);
    const ev = (id: string, org: string, key: string) => c.execute(`insert into domain_events (id,organization_id,type,schema_version,source,idempotency_key,privacy,payload,occurred_at,recorded_at) values ('${id}','${org}','order.created',1,'api','${key}','none','{}','${T}','${T}')`);
    await ev("e1", "o1", "k");
    expect(await rejects(ev("e2", "o1", "k"))).toBe(true);
    await ev("e3", "o2", "k"); // another workspace may use the same key
    await c.execute(`insert into domain_event_deliveries (event_id,subscriber,status,updated_at) values ('e1','x','succeeded','${T}')`);
    expect(await rejects(c.execute(`insert into domain_event_deliveries (event_id,subscriber,status,updated_at) values ('nope','x','succeeded','${T}')`))).toBe(true);
    await c.execute("delete from organizations where id = 'o1'");
    expect((await c.execute("select count(*) n from domain_events")).rows[0]?.["n"]).toBe(1);
    expect((await c.execute("select count(*) n from domain_event_deliveries")).rows[0]?.["n"]).toBe(0);
  });
});
