import type { Context } from "hono";
import type { z } from "zod";
import { HttpError } from "../deps.js";
import type { SessionUser } from "../services/auth.js";

export type Vars = { user: SessionUser; requestId: string; token: string };
export type Ctx = Context<{ Variables: Vars }>;

/** Best-effort per-isolate limiter. Production must also set a Cloudflare rate-limiting rule; this only blunts bursts. */
export function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string, now = Date.now()): boolean => {
    const h = hits.get(key);
    if (!h || h.reset <= now) { hits.set(key, { n: 1, reset: now + windowMs }); if (hits.size > 5000) hits.clear(); return true; }
    return ++h.n <= max;
  };
}

export const MAX_JSON_BODY = 512 * 1024;

export async function body<T extends z.ZodType>(c: Ctx, schema: T, max = MAX_JSON_BODY): Promise<z.infer<T>> {
  let json: unknown;
  const text = await c.req.text();
  if (text.length > max) throw new HttpError(413, "too_large", "Request body too large");
  try { json = JSON.parse(text); } catch { throw new HttpError(400, "invalid_json", "Request body must be valid JSON"); }
  const r = schema.safeParse(json);
  if (!r.success) throw new HttpError(422, "validation_failed", "Request validation failed", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return r.data;
}
