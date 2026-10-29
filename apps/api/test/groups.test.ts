import { describe, expect, it } from "vitest";
import { schema } from "@convertflow/database";
import { Client, makeEnv, setPlan, signup, validConfig, type Env } from "./helpers.js";

/** A signed-in owner with one store on the growth plan. */
async function shop(env: Env, email: string, name = "Shop") {
  const u = await signup(env, email);
  await setPlan(env, u.orgId, "growth");
  const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "custom", name, domain: `${name.toLowerCase()}.example.com`, currency: "EUR" });
  expect(s.status, JSON.stringify(s.json)).toBe(201);
  return { ...u, storeId: s.json.data.id as string, base: `/api/v1/stores/${s.json.data.id}` };
}

async function draft(u: Awaited<ReturnType<typeof shop>>, name = "Welcome") {
  const c = await u.c.post(`${u.base}/campaigns`, validConfig({ name }));
  expect(c.status, JSON.stringify(c.json)).toBe(201);
  return c.json.data as { id: string; name: string; status: string; updatedAt: string };
}

describe("campaign groups", () => {
  it("creates, lists and renames groups, and refuses a duplicate name", async () => {
    const env = await makeEnv();
    const u = await shop(env, "groups1@example.com");
    const made = await u.c.post(`${u.base}/campaign-groups`, { name: "Black Friday" });
    expect(made.status).toBe(201);
    expect(made.json.data).toMatchObject({ name: "Black Friday", campaignIds: [] });
    expect((await u.c.post(`${u.base}/campaign-groups`, { name: "Black Friday" })).json.error.code).toBe("name_taken");

    const other = await u.c.post(`${u.base}/campaign-groups`, { name: "Winter" });
    const renamed = await u.c.patch(`${u.base}/campaign-groups/${made.json.data.id}`, { name: "Cyber Monday" });
    expect(renamed.json.data.name).toBe("Cyber Monday");
    expect((await u.c.patch(`${u.base}/campaign-groups/${other.json.data.id}`, { name: "Cyber Monday" })).status).toBe(409);
    expect((await u.c.get(`${u.base}/campaign-groups`)).json.data.map((g: { name: string }) => g.name)).toEqual(["Cyber Monday", "Winter"]);
  });

  it("adds campaigns to a group; deleting the group keeps the campaigns", async () => {
    const env = await makeEnv();
    const u = await shop(env, "groups2@example.com");
    const a = await draft(u, "A");
    const b = await draft(u, "B");
    const g = (await u.c.post(`${u.base}/campaign-groups`, { name: "Spring" })).json.data;

    const added = await u.c.post(`${u.base}/campaign-groups/${g.id}/members`, { campaignIds: [a.id, b.id, a.id] });
    expect(added.status).toBe(200);
    expect(added.json.data.campaignIds.sort()).toEqual([a.id, b.id].sort());

    expect((await u.c.del(`${u.base}/campaign-groups/${g.id}/members/${a.id}`)).status).toBe(204);
    expect((await u.c.del(`${u.base}/campaign-groups/${g.id}/members/${a.id}`)).status).toBe(204); // idempotent
    expect((await u.c.get(`${u.base}/campaign-groups`)).json.data[0].campaignIds).toEqual([b.id]);

    expect((await u.c.del(`${u.base}/campaign-groups/${g.id}`)).status).toBe(204);
    expect((await u.c.get(`${u.base}/campaign-groups`)).json.data).toEqual([]);
    expect((await u.c.get(`${u.base}/campaigns/${b.id}`)).status).toBe(200);
  });

  it("refuses campaigns from another store and keeps groups per store", async () => {
    const env = await makeEnv();
    const u = await shop(env, "groups3@example.com", "First");
    const mine = await draft(u, "Mine");
    const s2 = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "custom", name: "Second", domain: "second.example.com", currency: "EUR" });
    const base2 = `/api/v1/stores/${s2.json.data.id}`;
    const theirs = await u.c.post(`${base2}/campaigns`, validConfig({ name: "Theirs" }));
    const g = (await u.c.post(`${u.base}/campaign-groups`, { name: "Only here" })).json.data;

    const bad = await u.c.post(`${u.base}/campaign-groups/${g.id}/members`, { campaignIds: [mine.id, theirs.json.data.id] });
    expect(bad.status).toBe(404);
    expect((await u.c.get(`${u.base}/campaign-groups`)).json.data[0].campaignIds).toEqual([]);

    expect((await u.c.get(`${base2}/campaign-groups`)).json.data).toEqual([]);
    expect((await u.c.post(`${base2}/campaign-groups/${g.id}/members`, { campaignIds: [theirs.json.data.id] })).status).toBe(404);
  });

  it("requires a signed-in user", async () => {
    const env = await makeEnv();
    const u = await shop(env, "groups4@example.com");
    const anon = new Client(env);
    expect((await anon.get(`${u.base}/campaign-groups`)).status).toBe(401);
    expect((await anon.post(`${u.base}/campaign-groups`, { name: "Nope" })).status).toBe(401);
  });

  it("caps the number of groups per store", async () => {
    const env = await makeEnv();
    const u = await shop(env, "groups5@example.com");
    for (let i = 0; i < 50; i++) expect((await u.c.post(`${u.base}/campaign-groups`, { name: `G${i}` })).status).toBe(201);
    const over = await u.c.post(`${u.base}/campaign-groups`, { name: "One too many" });
    expect(over.status).toBe(409);
    expect(over.json.error.code).toBe("limit_reached");
  });

  it("lets viewers read but not manage, and keeps one workspace's groups out of another's", async () => {
    const env = await makeEnv();
    const owner = await shop(env, "groups6@example.com");
    const viewer = await signup(env, "groups-viewer@example.com");
    await env.deps.db.insert(schema.memberships).values({ id: "m_grp_viewer", organizationId: owner.orgId, userId: viewer.userId, role: "viewer", createdAt: "t" });
    const editor = await signup(env, "groups-editor@example.com");
    await env.deps.db.insert(schema.memberships).values({ id: "m_grp_editor", organizationId: owner.orgId, userId: editor.userId, role: "editor", createdAt: "t" });

    expect((await viewer.c.get(`${owner.base}/campaign-groups`)).status).toBe(200);
    expect((await viewer.c.post(`${owner.base}/campaign-groups`, { name: "Not allowed" })).status).toBe(403);
    const made = await editor.c.post(`${owner.base}/campaign-groups`, { name: "Editor's group" });
    expect(made.status).toBe(201);
    expect((await editor.c.patch(`${owner.base}/campaign-groups/${made.json.data.id}`, { name: "Renamed" })).status).toBe(200);

    const outsider = await shop(env, "groups7@example.com", "Elsewhere");
    expect((await outsider.c.get(`${owner.base}/campaign-groups`)).status).toBe(404);
  });
});

describe("saved campaign templates", () => {
  it("saves a draft as a template and starts a new draft from it without touching the original", async () => {
    const env = await makeEnv();
    const u = await shop(env, "tpl1@example.com");
    const source = await draft(u, "Summer sale");

    const saved = await u.c.post(`${u.base}/campaign-templates`, { name: "Sale template", campaignId: source.id });
    expect(saved.status).toBe(201);
    expect(saved.json.data).toMatchObject({ name: "Sale template", sourceCampaignId: source.id });
    expect((await u.c.get(`${u.base}/campaign-templates`)).json.data.map((t: { name: string }) => t.name)).toEqual(["Sale template"]);

    const fresh = await u.c.post(`${u.base}/campaign-templates/${saved.json.data.id}/campaigns`, {});
    expect(fresh.status).toBe(201);
    expect(fresh.json.data).toMatchObject({ name: "Sale template", status: "draft" });
    expect(fresh.json.data.id).not.toBe(source.id);

    const original = await u.c.get(`${u.base}/campaigns/${source.id}`);
    expect(original.json.data.name).toBe("Summer sale");
  });

  it("refuses a campaign from another store, and deletes once", async () => {
    const env = await makeEnv();
    const u = await shop(env, "tpl2@example.com", "Alpha");
    const mine = await draft(u);
    const s2 = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "custom", name: "Beta", domain: "beta.example.com", currency: "EUR" });
    const base2 = `/api/v1/stores/${s2.json.data.id}`;
    const theirs = await u.c.post(`${base2}/campaigns`, validConfig({ name: "Beta campaign" }));

    expect((await u.c.post(`${u.base}/campaign-templates`, { name: "Stolen", campaignId: theirs.json.data.id })).status).toBe(404);

    const t = await u.c.post(`${u.base}/campaign-templates`, { name: "Keep", campaignId: mine.id });
    expect((await u.c.del(`${u.base}/campaign-templates/${t.json.data.id}`)).status).toBe(204);
    expect((await u.c.del(`${u.base}/campaign-templates/${t.json.data.id}`)).status).toBe(404);
    expect((await u.c.post(`${u.base}/campaign-templates/${t.json.data.id}/campaigns`, {})).status).toBe(404);
  });

  it("caps saved templates per store", async () => {
    const env = await makeEnv();
    const u = await shop(env, "tpl3@example.com");
    const source = await draft(u);
    for (let i = 0; i < 50; i++) {
      expect((await u.c.post(`${u.base}/campaign-templates`, { name: `Template ${i}`, campaignId: source.id })).status).toBe(201);
    }
    const over = await u.c.post(`${u.base}/campaign-templates`, { name: "One too many", campaignId: source.id });
    expect(over.status).toBe(409);
    expect(over.json.error.code).toBe("limit_reached");
  });
});
