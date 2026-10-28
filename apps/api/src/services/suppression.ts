import { and, eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { sha256Hex } from "../lib/crypto.js";
import type { Deps } from "../deps.js";

const { suppressionRecords } = schema;

/** Same recipe as the restock flow, so a suppression written there also blocks marketing and the reverse. */
export const identifierHash = (storeId: string, value: string) => sha256Hex(`${storeId}:${value}`);

/** Whether this address or number has opted out (or bounced) for the channel. Holds only a hash, so it outlives the contact. */
export async function isSuppressed(d: Deps, storeId: string, channel: "email" | "sms", value: string): Promise<boolean> {
  const [row] = await d.db.select({ id: suppressionRecords.id }).from(suppressionRecords)
    .where(and(eq(suppressionRecords.storeId, storeId), eq(suppressionRecords.channel, channel), eq(suppressionRecords.emailHash, await identifierHash(storeId, value)))).limit(1);
  return row !== undefined;
}
