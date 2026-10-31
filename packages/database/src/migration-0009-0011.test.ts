import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../migrations");
const statements = (file: string) => readFileSync(join(DIR, file), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const upTo = (prefix: string) => ALL.filter((f) => f < prefix);
const file = (prefix: string) => ALL.find((f) => f.startsWith(prefix))!;

async function db(files: string[]) {
  const c = createClient({ url: ":memory:" });
  await c.execute("PRAGMA foreign_keys = ON");
  for (const f of files) for (const s of statements(f)) await c.execute(s);
  return c;
}
const rejects = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };
const T = "2026-10-29T00:00:00Z";
const seed = async (c: Awaited<ReturnType<typeof db>>) => {
  await c.execute(`insert into organizations (id,name,created_at) values ('o1','O','${T}')`);
  await c.execute(`insert into stores (id,organization_id,platform,name,domain,site_key,created_at,updated_at) values ('s1','o1','custom','S','s.example.com','cf_key1234567','${T}','${T}')`);
};

describe("migrations 0009-0011", () => {
  it("follow 0008 in order", () => {
    const at = ALL.findIndex((f) => f.startsWith("0008"));
    expect(ALL.slice(at, at + 4).map((f) => f.slice(0, 4))).toEqual(["0008", "0009", "0010", "0011"]);
  });

  it("0009: one row per workspace feature, removed with the workspace", async () => {
    const c = await db([...upTo("0009"), file("0009")]);
    await seed(c);
    const flag = () => c.execute(`insert into organization_features (organization_id,feature,created_at) values ('o1','workflows.create','${T}')`);
    await flag();
    expect(await rejects(flag())).toBe(true);
    await c.execute("delete from organizations where id = 'o1'");
    expect((await c.execute("select count(*) n from organization_features")).rows[0]?.["n"]).toBe(0);
  });

  it("0010: versions and runs are unique per workflow, and a run is once per version and trigger", async () => {
    const c = await db([...upTo("0010"), file("0010")]);
    await seed(c);
    await c.execute(`insert into workflows (id,store_id,name,draft_definition,created_at,updated_at) values ('w1','s1','W','{}','${T}','${T}')`);
    const version = (id: string, n: number) => c.execute(`insert into workflow_versions (id,workflow_id,store_id,version,definition,created_at) values ('${id}','w1','s1',${n},'{}','${T}')`);
    await version("v1", 1);
    expect(await rejects(version("v2", 1))).toBe(true);
    const run = (id: string) => c.execute(`insert into workflow_runs (id,store_id,workflow_id,version_id,trigger_key,run_at,created_at) values ('${id}','s1','w1','v1','evt_1','${T}','${T}')`);
    await run("r1");
    expect(await rejects(run("r2"))).toBe(true);
    expect((await c.execute("select status, attempts, steps from workflow_runs")).rows[0]).toMatchObject({ status: "scheduled", attempts: 0, steps: "[]" });
    await c.execute(`insert into action_requests (id,store_id,organization_id,action,input,origin,expires_at,created_at) values ('a1','s1','o1','campaign.pause','{}','ai','${T}','${T}')`);
    expect((await c.execute("select status from action_requests")).rows[0]?.["status"]).toBe("pending");
    await c.execute("delete from stores where id = 's1'");
    for (const t of ["workflows", "workflow_versions", "workflow_runs", "action_requests"]) {
      expect((await c.execute(`select count(*) n from ${t}`)).rows[0]?.["n"]).toBe(0);
    }
  });

  it("0011: existing generations become campaign.generate and get their workspace from the store", async () => {
    const c = await db(upTo("0011"));
    await seed(c);
    await c.execute(`insert into ai_generations (id,store_id,prompt,status,created_at) values ('g1','s1','p','succeeded','${T}'),('g2','gone','p','failed','${T}')`);
    for (const s of statements(file("0011"))) await c.execute(s);
    const rows = (await c.execute("select id, task, organization_id, provider, estimated_cost_usd from ai_generations order by id")).rows;
    expect(rows.map((r) => [r["id"], r["task"], r["organization_id"], r["provider"], r["estimated_cost_usd"]])).toEqual([
      ["g1", "campaign.generate", "o1", null, null], ["g2", "campaign.generate", null, null, null],
    ]);
  });
});
