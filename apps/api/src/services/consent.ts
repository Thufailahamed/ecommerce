import { and, eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import type { Deps } from "../deps.js";
import { isSuppressed } from "./suppression.js";

export type ContactDecision =
  | { allowed: true; reason: "subscribed" }
  | { allowed: false; reason: "unknown_contact" | "no_identifier" | "not_subscribed" | "suppressed" };

/**
 * The one question every marketing action must ask before contacting someone: does this contact, in this store, have
 * confirmed consent on this channel right now, and is their identifier not suppressed? Channels never stand in for each
 * other: email consent says nothing about SMS. Store-scoped, so another tenant's contact id is simply unknown.
 *
 * The underlying model (append-only consent events, per-channel hashed suppression) lives in contacts.ts and
 * suppression.ts; this is the read-side facade workflows, the AI manager and future senders use.
 */
export async function canContact(d: Deps, storeId: string, contactId: string, channel: "email" | "sms"): Promise<ContactDecision> {
  const c = schema.contacts;
  const [row] = await d.db.select({ email: c.email, phone: c.phone, emailStatus: c.emailStatus, smsStatus: c.smsStatus })
    .from(c).where(and(eq(c.storeId, storeId), eq(c.id, contactId))).limit(1);
  if (!row) return { allowed: false, reason: "unknown_contact" };
  const value = channel === "email" ? row.email : row.phone;
  if (!value) return { allowed: false, reason: "no_identifier" };
  if ((channel === "email" ? row.emailStatus : row.smsStatus) !== "subscribed") return { allowed: false, reason: "not_subscribed" };
  if (await isSuppressed(d, storeId, channel, value)) return { allowed: false, reason: "suppressed" };
  return { allowed: true, reason: "subscribed" };
}
