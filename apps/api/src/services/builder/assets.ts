import { and, desc, eq } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { HttpError, type Deps } from "../../deps.js";
import { recordUsage, requireQuota } from "../entitlements.js";

const { siteAssets } = schema;

/** Image types a browser renders safely as <img>. SVG is excluded: it can carry script. */
export const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Lowercase so it fits the document's `asset:<id>` reference format. */
const assetId = () => `ast_${Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Checks the first bytes, so a file's declared type cannot smuggle something else past the allow-list. */
export function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "image/avif";
  return null;
}

export async function storeAsset(d: Deps, siteId: string, bytes: Uint8Array, source: "upload" | "ai", meta: { alt?: string; prompt?: string } = {}) {
  const contentType = sniffImage(bytes);
  if (!contentType || !IMAGE_TYPES.has(contentType)) throw new HttpError(415, "unsupported_image", "Upload a JPEG, PNG, WebP, GIF or AVIF image.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "too_large", "Images can be up to 4 MB.");
  const id = assetId();
  await d.kv.put(`asset:${id}`, JSON.stringify({ t: contentType, b: toBase64(bytes) }));
  await d.db.insert(siteAssets).values({ id, siteId, source, contentType, bytes: bytes.length, alt: meta.alt?.slice(0, 160) ?? null, prompt: meta.prompt?.slice(0, 600) ?? null, createdAt: d.now().toISOString() });
  return { id, ref: `asset:${id}`, contentType, bytes: bytes.length };
}

export async function listAssets(d: Deps, siteId: string) {
  return d.db.select().from(siteAssets).where(eq(siteAssets.siteId, siteId)).orderBy(desc(siteAssets.createdAt)).limit(200);
}

export async function readAsset(d: Deps, id: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!/^ast_[a-f0-9]{20}$/.test(id)) return null;
  const raw = await d.kv.get(`asset:${id}`);
  if (!raw) return null;
  const j = JSON.parse(raw) as { t: string; b: string };
  const bin = atob(j.b);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType: j.t };
}

export async function assetBelongsTo(d: Deps, siteId: string, id: string) {
  const [a] = await d.db.select({ id: siteAssets.id }).from(siteAssets).where(and(eq(siteAssets.id, id), eq(siteAssets.siteId, siteId))).limit(1);
  return Boolean(a);
}

/** One AI image, metered. Throws 402 when the month's images are used up. */
export async function generateImage(d: Deps, site: { id: string; organizationId: string }, prompt: string, alt: string, signal?: AbortSignal) {
  if (!d.builderImages) throw new HttpError(503, "ai_unavailable", "Image generation is not configured.");
  await requireQuota(d, site.organizationId, "ai_images", (q) => `You've used all ${q.limit} AI images for this month.`);
  const started = Date.now();
  try {
    const img = await d.builderImages.generate(prompt, signal);
    await recordUsage(d, site.organizationId, "ai_images");
    const stored = await storeAsset(d, site.id, img.bytes, "ai", { alt, prompt });
    await logImage(d, site, prompt, "succeeded", Date.now() - started);
    return stored;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    await logImage(d, site, prompt, "failed", Date.now() - started, e instanceof Error ? e.message : "unknown");
    throw new HttpError(502, "ai_failed", "The image could not be generated. Try again or upload one.");
  }
}

async function logImage(d: Deps, site: { id: string; organizationId: string }, prompt: string, status: "succeeded" | "failed", durationMs: number, error?: string) {
  await d.db.insert(schema.aiGenerations).values({
    id: `gen_${assetId().slice(4)}`, storeId: site.id, organizationId: site.organizationId, requestedBy: null, task: "site.image",
    provider: "ai_gateway", model: d.builderImages?.model ?? null, prompt: prompt.slice(0, 1000), status, durationMs,
    error: error?.slice(0, 300) ?? null, createdAt: d.now().toISOString(),
  });
}
