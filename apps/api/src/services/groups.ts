import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { CampaignConfig, GROUP_LIMIT, TEMPLATE_LIMIT, type CampaignTemplateInput } from "@convertflow/contracts";
import { newId } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";
import { createCampaign, getCampaign } from "./campaigns.js";

const { campaigns, campaignGroups, campaignGroupMembers, campaignTemplates } = schema;

export interface GroupView { id: string; name: string; campaignIds: string[]; createdAt: string; updatedAt: string }

const isUniqueViolation = (e: unknown) => /UNIQUE/i.test(String((e as Error)?.message ?? e));

async function loadGroup(d: Deps, storeId: string, groupId: string) {
  const [g] = await d.db.select().from(campaignGroups).where(and(eq(campaignGroups.id, groupId), eq(campaignGroups.storeId, storeId))).limit(1);
  if (!g) throw new HttpError(404, "not_found", "Group not found");
  return g;
}

async function nameTaken(d: Deps, storeId: string, name: string, exceptId?: string) {
  const [hit] = await d.db.select({ id: campaignGroups.id }).from(campaignGroups)
    .where(and(eq(campaignGroups.storeId, storeId), eq(campaignGroups.name, name))).limit(1);
  if (hit && hit.id !== exceptId) throw new HttpError(409, "name_taken", "A group with that name already exists");
}

export async function listGroups(d: Deps, storeId: string): Promise<GroupView[]> {
  const groups = await d.db.select().from(campaignGroups).where(eq(campaignGroups.storeId, storeId)).orderBy(asc(campaignGroups.name));
  if (groups.length === 0) return [];
  const members = await d.db.select().from(campaignGroupMembers).where(eq(campaignGroupMembers.storeId, storeId));
  return groups.map((g) => ({
    id: g.id, name: g.name, createdAt: g.createdAt, updatedAt: g.updatedAt,
    campaignIds: members.filter((m) => m.groupId === g.id).map((m) => m.campaignId),
  }));
}

export async function createGroup(d: Deps, storeId: string, name: string): Promise<GroupView> {
  const [groupCount] = await d.db.select({ n: sql<number>`count(*)` }).from(campaignGroups).where(eq(campaignGroups.storeId, storeId));
  if (Number(groupCount?.n ?? 0) >= GROUP_LIMIT) throw new HttpError(409, "limit_reached", `A store can have up to ${GROUP_LIMIT} groups`);
  await nameTaken(d, storeId, name);
  const now = d.now().toISOString();
  const row = { id: newId("grp"), storeId, name, createdAt: now, updatedAt: now };
  try { await d.db.insert(campaignGroups).values(row); }
  catch (e) { if (isUniqueViolation(e)) throw new HttpError(409, "name_taken", "A group with that name already exists"); throw e; }
  return { id: row.id, name, campaignIds: [], createdAt: now, updatedAt: now };
}

export async function renameGroup(d: Deps, storeId: string, groupId: string, name: string) {
  await loadGroup(d, storeId, groupId);
  await nameTaken(d, storeId, name, groupId);
  await d.db.update(campaignGroups).set({ name, updatedAt: d.now().toISOString() }).where(eq(campaignGroups.id, groupId));
  return (await listGroups(d, storeId)).find((g) => g.id === groupId)!;
}

/** Deletes the group and its links. The campaigns themselves are untouched. */
export async function deleteGroup(d: Deps, storeId: string, groupId: string) {
  await loadGroup(d, storeId, groupId);
  await d.db.delete(campaignGroups).where(eq(campaignGroups.id, groupId));
}

export async function addMembers(d: Deps, storeId: string, groupId: string, campaignIds: string[]) {
  await loadGroup(d, storeId, groupId);
  const unique = [...new Set(campaignIds)];
  const found = await d.db.select({ id: campaigns.id }).from(campaigns)
    .where(and(eq(campaigns.storeId, storeId), inArray(campaigns.id, unique)));
  if (found.length !== unique.length) throw new HttpError(404, "not_found", "One or more campaigns were not found in this store");
  const now = d.now().toISOString();
  await d.db.insert(campaignGroupMembers)
    .values(unique.map((campaignId) => ({ groupId, campaignId, storeId, addedAt: now })))
    .onConflictDoNothing();
  return (await listGroups(d, storeId)).find((g) => g.id === groupId)!;
}

/** Idempotent: removing a campaign that is not in the group still succeeds. */
export async function removeMember(d: Deps, storeId: string, groupId: string, campaignId: string) {
  await loadGroup(d, storeId, groupId);
  await d.db.delete(campaignGroupMembers).where(and(eq(campaignGroupMembers.groupId, groupId), eq(campaignGroupMembers.campaignId, campaignId)));
}

export async function listTemplates(d: Deps, storeId: string) {
  return d.db.select({
    id: campaignTemplates.id, name: campaignTemplates.name, sourceCampaignId: campaignTemplates.sourceCampaignId, createdAt: campaignTemplates.createdAt,
  }).from(campaignTemplates).where(eq(campaignTemplates.storeId, storeId)).orderBy(desc(campaignTemplates.createdAt));
}

/** Saves a campaign's current draft as a reusable template. The draft must still be valid, so a template can always be used. */
export async function saveTemplate(d: Deps, storeId: string, actorId: string, input: CampaignTemplateInput) {
  const [templateCount] = await d.db.select({ n: sql<number>`count(*)` }).from(campaignTemplates).where(eq(campaignTemplates.storeId, storeId));
  if (Number(templateCount?.n ?? 0) >= TEMPLATE_LIMIT) throw new HttpError(409, "limit_reached", `A store can keep up to ${TEMPLATE_LIMIT} templates`);
  const source = await getCampaign(d, storeId, input.campaignId);
  const parsed = CampaignConfig.safeParse(source.draftConfig);
  if (!parsed.success) throw new HttpError(422, "invalid_campaign", "This campaign's draft is not valid yet. Fix it in the Builder, then save it as a template.");
  const row = {
    id: newId("tpl"), storeId, name: input.name,
    config: { ...parsed.data, name: input.name },
    sourceCampaignId: source.id, createdBy: actorId, createdAt: d.now().toISOString(),
  };
  await d.db.insert(campaignTemplates).values(row);
  return { id: row.id, name: row.name, sourceCampaignId: row.sourceCampaignId, createdAt: row.createdAt };
}

export async function deleteTemplate(d: Deps, storeId: string, templateId: string) {
  const [t] = await d.db.select({ id: campaignTemplates.id }).from(campaignTemplates)
    .where(and(eq(campaignTemplates.id, templateId), eq(campaignTemplates.storeId, storeId))).limit(1);
  if (!t) throw new HttpError(404, "not_found", "Template not found");
  await d.db.delete(campaignTemplates).where(eq(campaignTemplates.id, templateId));
}

/** Starts a new draft from a saved template. Nothing is published, and the draft is validated again as a new campaign. */
export async function campaignFromTemplate(d: Deps, storeId: string, actorId: string, templateId: string) {
  const [t] = await d.db.select().from(campaignTemplates)
    .where(and(eq(campaignTemplates.id, templateId), eq(campaignTemplates.storeId, storeId))).limit(1);
  if (!t) throw new HttpError(404, "not_found", "Template not found");
  return createCampaign(d, storeId, actorId, t.config);
}
