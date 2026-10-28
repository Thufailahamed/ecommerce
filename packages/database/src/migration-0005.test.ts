import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../migrations");
const statements = (file: string) => readFileSync(join(DIR, file), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
const BEFORE = ["0000_same_raider.sql", "0001_tiresome_vision.sql", "0002_campaign_tool.sql", "0003_contacts_consent.sql", "0004_upsell_relationships.sql"];
const M = "0005_provider_sync.sql";

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
  await c.execute("insert into contacts (id,store_id,email,email_status,sms_status,source,created_at,updated_at) values ('c1','s1','a@example.com','subscribed','none','form:cmp_1','t','t')");
};
const rejects = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };
const conn = (c: Db, id: string, provider = "klaviyo", store = "s1") =>
  c.execute({ sql: "insert into provider_connections (id,store_id,provider,encrypted_credentials,status,created_at,updated_at) values (?,?,?,'enc','connected','t','t')", args: [id, store, provider] });
const job = (c: Db, id: string, provider = "klaviyo", channel = "email", contact = "c1") =>
  c.execute({ sql: "insert into provider_sync_jobs (id,store_id,contact_id,provider,channel,action,created_at,updated_at) values (?,'s1',?,?,?,'subscribe','t','t')", args: [id, contact, provider, channel] });

describe("migration 0005: provider connections, sync jobs, first name, form version", () => {
  it("keeps existing contacts and consent history, adding empty first name and form version", async () => {
    const c = await db(BEFORE);
    await seed(c);
    await c.execute("insert into consent_events (id,store_id,contact_id,channel,event,source,created_at) values ('e1','s1','c1','email','requested','form:cmp_1','t')");
    for (const s of statements(M)) await c.execute(s);
    expect((await c.execute("select email, email_status, first_name from contacts")).rows[0]).toMatchObject({ email: "a@example.com", email_status: "subscribed", first_name: null });
    expect((await c.execute("select event, version_id from consent_events")).rows[0]).toMatchObject({ event: "requested", version_id: null });
  });

  it("allows one connection per provider per store, and the same provider for another store", async () => {
    const c = await db([...BEFORE, M]);
    await seed(c);
    await c.execute("insert into stores (id,organization_id,platform,name,domain,site_key,currency,delivery_enabled,status,created_at,updated_at) values ('s2','o1','custom','S2','b.example.com','cf_key2','USD',1,'active','t','t')");
    await conn(c, "pc1", "klaviyo");
    await conn(c, "pc2", "mailchimp");
    await conn(c, "pc3", "klaviyo", "s2");
    expect(await rejects(conn(c, "pc4", "klaviyo"))).toBe(true);
  });

  it("allows one sync job per contact, provider and channel", async () => {
    const c = await db([...BEFORE, M]);
    await seed(c);
    await job(c, "j1", "klaviyo");
    await job(c, "j2", "mailchimp");
    await job(c, "j3", "klaviyo", "sms");
    expect(await rejects(job(c, "j4", "klaviyo"))).toBe(true);
  });

  it("a sync job must belong to a real contact", async () => {
    const c = await db([...BEFORE, M]);
    await seed(c);
    expect(await rejects(job(c, "j1", "klaviyo", "email", "nobody"))).toBe(true);
  });

  it("erasing a contact removes its sync jobs, and removing a store removes connections and jobs", async () => {
    const c = await db([...BEFORE, M]);
    await seed(c);
    await job(c, "j1"); await conn(c, "pc1");
    await c.execute("delete from contacts where id = 'c1'");
    expect((await c.execute("select count(*) as n from provider_sync_jobs")).rows[0]).toMatchObject({ n: 0 });
    await c.execute("insert into contacts (id,store_id,email,email_status,sms_status,source,created_at,updated_at) values ('c2','s1','b@example.com','subscribed','none','x','t','t')");
    await job(c, "j2", "klaviyo", "email", "c2");
    await c.execute("delete from stores where id = 's1'");
    expect((await c.execute("select count(*) as n from provider_connections")).rows[0]).toMatchObject({ n: 0 });
    expect((await c.execute("select count(*) as n from provider_sync_jobs")).rows[0]).toMatchObject({ n: 0 });
  });
});
