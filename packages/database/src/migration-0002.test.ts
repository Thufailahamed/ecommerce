import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../migrations");
const statements = (file: string) => readFileSync(join(DIR, file), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());

describe("migration 0002: campaign tool", () => {
  it("tags existing campaigns on upgrade: restock forms become email, everything else toast", async () => {
    const db = createClient({ url: ":memory:" });
    await db.execute("PRAGMA foreign_keys = ON");
    // The database exactly as it is in production today.
    for (const f of ["0000_same_raider.sql", "0001_tiresome_vision.sql"]) for (const s of statements(f)) await db.execute(s);
    await db.execute("insert into organizations (id,name,created_at) values ('o1','Org','t')");
    await db.execute("insert into stores (id,organization_id,platform,name,domain,site_key,currency,delivery_enabled,status,created_at,updated_at) values ('s1','o1','custom','S','a.example.com','cf_key1','USD',1,'active','t','t')");
    const ins = (id: string, format: string) => db.execute({
      sql: "insert into campaigns (id,store_id,name,status,draft_config,created_at,updated_at) values (?,'s1','n','draft',?,'t','t')",
      args: [id, JSON.stringify({ format })],
    });
    await ins("c_popup", "popup"); await ins("c_bar", "announcement_bar"); await ins("c_restock", "restock");

    for (const s of statements("0002_campaign_tool.sql")) await db.execute(s);

    const rows = (await db.execute("select id, tool from campaigns order by id")).rows;
    expect(Object.fromEntries(rows.map((r) => [String(r["id"]), String(r["tool"])]))).toEqual({ c_bar: "toast", c_popup: "toast", c_restock: "email" });
  });

  it("new campaigns default to toast and the tool index exists", async () => {
    const db = createClient({ url: ":memory:" });
    for (const f of ["0000_same_raider.sql", "0001_tiresome_vision.sql", "0002_campaign_tool.sql"]) for (const s of statements(f)) await db.execute(s);
    const idx = (await db.execute("select name from sqlite_master where type='index' and name='campaigns_store_tool_idx'")).rows;
    expect(idx).toHaveLength(1);
  });
});
