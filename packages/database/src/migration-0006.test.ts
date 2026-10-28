import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../migrations");
const statements = (file: string) => readFileSync(join(DIR, file), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const M = "0006_analytics_by_tool.sql";
const BEFORE = ALL.filter((f) => f < M);

async function db(files: string[]) {
  const c = createClient({ url: ":memory:" });
  await c.execute("PRAGMA foreign_keys = ON");
  for (const f of files) for (const s of statements(f)) await c.execute(s);
  return c;
}
const rejects = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };
const count = (c: Awaited<ReturnType<typeof db>>, id: string, metric: string, value: number, day = "2026-10-27") =>
  c.execute({ sql: "insert into metric_counters (store_id,campaign_id,version_id,day,metric,value) values ('s1',?,'v1',?,?,?)", args: [id, day, metric, value] });

describe("migration 0006: per-tool metric counters", () => {
  it("is the migration after 0005 and runs on a database that already holds analytics", async () => {
    expect(BEFORE.at(-1)).toMatch(/^0005_/);
    const c = await db(BEFORE);
    await c.execute("insert into analytics_aggregates (store_id,campaign_id,version_id,day,impressions,clicks,add_to_carts) values ('s1','c1','v1','2026-10-27',7,3,2)");
    for (const s of statements(M)) await c.execute(s);
    const [row] = (await c.execute("select impressions, clicks, add_to_carts from analytics_aggregates")).rows;
    expect(row).toMatchObject({ impressions: 7, clicks: 3, add_to_carts: 2 }); // existing per-campaign analytics are untouched
    expect((await c.execute("select count(*) as n from metric_counters")).rows[0]).toMatchObject({ n: 0 });
  });

  it("allows one row per store, campaign, version, day and metric, and defaults the value to zero", async () => {
    const c = await db([...BEFORE, M]);
    await count(c, "c1", "form_submit_success", 2);
    expect(await rejects(count(c, "c1", "form_submit_success", 5))).toBe(true);
    await count(c, "c1", "form_submit_failure", 1);
    await count(c, "c1", "form_submit_success", 1, "2026-10-28");
    await count(c, "c2", "form_submit_success", 1);
    await c.execute("insert into metric_counters (store_id,campaign_id,version_id,day,metric) values ('s1','c3','v1','2026-10-27','form_submit_attempt')");
    expect((await c.execute("select value from metric_counters where campaign_id='c3'")).rows[0]).toMatchObject({ value: 0 });
  });

  it("holds no personal data: only ids, a day, a metric name and a number", async () => {
    const c = await db([...BEFORE, M]);
    const cols = (await c.execute("pragma table_info(metric_counters)")).rows.map((r) => r["name"]);
    expect(cols).toEqual(["store_id", "campaign_id", "version_id", "day", "metric", "value"]);
  });

  it("is indexed for the store-and-date-range read the dashboard makes", async () => {
    const c = await db([...BEFORE, M]);
    const plan = (await c.execute("explain query plan select campaign_id, metric, sum(value) from metric_counters where store_id='s1' and day >= '2026-10-01' and day <= '2026-10-31' group by campaign_id, metric")).rows.map((r) => String(r["detail"])).join(" ");
    expect(plan).toMatch(/metric_counters_(store_day_idx|uq)/);
  });
});
