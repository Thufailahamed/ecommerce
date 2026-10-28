import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../migrations");
const statements = (file: string) => readFileSync(join(DIR, file), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
const BEFORE = ["0000_same_raider.sql", "0001_tiresome_vision.sql", "0002_campaign_tool.sql"];

async function db(files: string[]) {
  const c = createClient({ url: ":memory:" });
  await c.execute("PRAGMA foreign_keys = ON");
  for (const f of files) for (const s of statements(f)) await c.execute(s);
  return c;
}
const seedStore = async (c: Awaited<ReturnType<typeof db>>) => {
  await c.execute("insert into organizations (id,name,created_at) values ('o1','Org','t')");
  await c.execute("insert into stores (id,organization_id,platform,name,domain,site_key,currency,delivery_enabled,status,created_at,updated_at) values ('s1','o1','custom','S','a.example.com','cf_key1','USD',1,'active','t','t')");
};
const rejects = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };

describe("migration 0003: contacts and consent", () => {
  it("keeps existing suppression entries and treats them as email", async () => {
    const c = await db(BEFORE);
    await c.execute("insert into suppression_records (id,store_id,email_hash,reason,created_at) values ('sup1','s1','abc','unsubscribed','t')");
    for (const s of statements("0003_contacts_consent.sql")) await c.execute(s);
    const rows = (await c.execute("select id, channel, email_hash from suppression_records")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "sup1", channel: "email", email_hash: "abc" });
  });

  it("suppression is unique per channel: the same hash may exist for email and sms, never twice for one", async () => {
    const c = await db([...BEFORE, "0003_contacts_consent.sql"]);
    const ins = (id: string, channel: string) => c.execute({ sql: "insert into suppression_records (id,store_id,email_hash,channel,reason,created_at) values (?,'s1','h',?,'unsubscribed','t')", args: [id, channel] });
    await ins("a", "email");
    await ins("b", "sms");
    expect(await rejects(ins("c", "email"))).toBe(true);
    expect(await rejects(ins("d", "sms"))).toBe(true);
  });

  it("a person is unique per store by email and by phone, but email-only and phone-only contacts coexist", async () => {
    const c = await db([...BEFORE, "0003_contacts_consent.sql"]);
    await seedStore(c);
    const ins = (id: string, email: string | null, phone: string | null) => c.execute({
      sql: "insert into contacts (id,store_id,email,phone,source,created_at,updated_at) values (?,'s1',?,?,'api','t','t')", args: [id, email, phone],
    });
    await ins("c1", "a@example.com", null);
    await ins("c2", null, "+14155550123");
    await ins("c3", "b@example.com", null); // several rows with a NULL phone are fine
    await ins("c4", null, "+14155550199");  // and with a NULL email
    expect(await rejects(ins("c5", "a@example.com", null))).toBe(true);
    expect(await rejects(ins("c6", null, "+14155550123"))).toBe(true);
    const defaults = (await c.execute("select email_status, sms_status from contacts where id='c1'")).rows[0];
    expect(defaults).toMatchObject({ email_status: "none", sms_status: "none" });
  });

  it("erasing a contact removes its consent history, and removing a store removes both", async () => {
    const c = await db([...BEFORE, "0003_contacts_consent.sql"]);
    await seedStore(c);
    const contact = (id: string, email: string) => c.execute({ sql: "insert into contacts (id,store_id,email,source,created_at,updated_at) values (?,'s1',?,'api','t','t')", args: [id, email] });
    const event = (id: string, contactId: string) => c.execute({ sql: "insert into consent_events (id,store_id,contact_id,channel,event,source,created_at) values (?,'s1',?,'email','requested','api','t')", args: [id, contactId] });
    await contact("c1", "a@example.com"); await contact("c2", "b@example.com");
    await event("e1", "c1"); await event("e2", "c1"); await event("e3", "c2");

    await c.execute("delete from contacts where id='c1'");
    expect((await c.execute("select id from consent_events")).rows.map((r) => r["id"])).toEqual(["e3"]);

    await c.execute("delete from stores where id='s1'");
    expect((await c.execute("select count(*) as n from contacts")).rows[0]?.["n"]).toBe(0);
    expect((await c.execute("select count(*) as n from consent_events")).rows[0]?.["n"]).toBe(0);
  });

  it("a confirmation token can belong to only one consent event", async () => {
    const c = await db([...BEFORE, "0003_contacts_consent.sql"]);
    await seedStore(c);
    await c.execute("insert into contacts (id,store_id,email,source,created_at,updated_at) values ('c1','s1','a@example.com','api','t','t')");
    const ev = (id: string, token: string | null) => c.execute({ sql: "insert into consent_events (id,store_id,contact_id,channel,event,source,token_hash,created_at) values (?,'s1','c1','email','requested','api',?,'t')", args: [id, token] });
    await ev("e1", "tok"); await ev("e2", null); await ev("e3", null);
    expect(await rejects(ev("e4", "tok"))).toBe(true);
  });
});
