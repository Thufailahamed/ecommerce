import { eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { encrypt, decrypt } from "../lib/aes.js";
import { newId } from "../lib/crypto.js";
import { HttpError, type Deps } from "../deps.js";

const { integrationCredentials: ic } = schema;

function keyOrThrow(d: Deps): string {
  const k = d.secrets?.credentialKey;
  if (!k) throw new HttpError(503, "not_configured", "Credential encryption key is not configured");
  return k;
}

/** Tokens are encrypted at rest and never returned by any API route. */
export async function saveCredentials(d: Deps, storeId: string, c: { accessToken: string; refreshToken?: string; expiresAt?: string; scopes?: string }) {
  const key = keyOrThrow(d);
  const row = {
    storeId, encryptedAccessToken: await encrypt(c.accessToken, key),
    encryptedRefreshToken: c.refreshToken ? await encrypt(c.refreshToken, key) : null,
    expiresAt: c.expiresAt ?? null, scopes: c.scopes ?? null, updatedAt: d.now().toISOString(),
  };
  await d.db.insert(ic).values({ id: newId("crd"), ...row })
    .onConflictDoUpdate({ target: ic.storeId, set: row });
}

export async function loadCredentials(d: Deps, storeId: string) {
  const [r] = await d.db.select().from(ic).where(eq(ic.storeId, storeId)).limit(1);
  if (!r) return null;
  const key = keyOrThrow(d);
  return {
    accessToken: await decrypt(r.encryptedAccessToken, key),
    refreshToken: r.encryptedRefreshToken ? await decrypt(r.encryptedRefreshToken, key) : undefined,
    expiresAt: r.expiresAt ?? undefined,
  };
}
