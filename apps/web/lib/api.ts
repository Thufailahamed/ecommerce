export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: init.body !== undefined ? { "content-type": "application/json" } : {},
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as { data?: T; error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok || !json) throw new ApiError(res.status, json?.error?.code ?? "network", json?.error?.message ?? "Request failed", json?.error?.details);
  return json.data as T;
}

async function fail(res: Response): Promise<never> {
  const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  throw new ApiError(res.status, json?.error?.code ?? "network", json?.error?.message ?? "Request failed", json?.error?.details);
}

/** For list endpoints that return `{ data, nextCursor }`; `api` would drop the cursor. */
export async function apiPage<T>(path: string): Promise<{ data: T[]; nextCursor: string | null }> {
  const res = await fetch(`${API_URL}${path}`, { credentials: "include" });
  if (!res.ok) return fail(res);
  const json = (await res.json()) as { data: T[]; nextCursor?: string | null };
  return { data: json.data, nextCursor: json.nextCursor ?? null };
}

/** For file downloads (CSV). Returns the body and whether the server cut it short. */
export async function apiFile(path: string): Promise<{ blob: Blob; truncated: boolean }> {
  const res = await fetch(`${API_URL}${path}`, { credentials: "include" });
  if (!res.ok) return fail(res);
  return { blob: await res.blob(), truncated: res.headers.get("x-export-truncated") === "true" };
}

export type SyncStatus = "pending" | "synced" | "failed" | "skipped_no_consent" | "skipped_suppressed";
/** DELETE that also reports which list providers could not be reached while erasing someone (the server names them in a header). */
export async function apiErase(path: string): Promise<{ providerCleanupFailed: string[] }> {
  const res = await fetch(`${API_URL}${path}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) return fail(res);
  const h = res.headers.get("x-provider-cleanup-failed");
  return { providerCleanupFailed: h ? h.split(",").filter(Boolean) : [] };
}

export interface ContactSync { provider: "klaviyo" | "mailchimp"; status: SyncStatus; action: "subscribe" | "unsubscribe"; error: string | null }
export interface Contact { id: string; email: string | null; phone: string | null; firstName?: string | null; emailStatus: "none" | "pending" | "subscribed" | "unsubscribed"; smsStatus: "none" | "pending" | "subscribed" | "unsubscribed"; source: string; createdAt: string; sync?: ContactSync[] }
export interface ProviderView { provider: "klaviyo" | "mailchimp"; label: string; connected: boolean; status: "connected" | "error" | null; listId: string | null; listName: string | null; verified: boolean; verifiedAt: string | null; lastCheckedAt: string | null; lastError: string | null; counts: Record<SyncStatus, number> }
export interface Store { id: string; name: string; platform: string; domain: string; siteKey: string; currency: string; deliveryEnabled: boolean; organizationId: string }
export interface Me { userId: string; email: string; organizations: { id: string; name: string; role: string }[] }
export interface Security { mfaEnabled: boolean; recoveryCodesLeft: number; emailVerified: boolean; emailConfigured: boolean }
export interface CampaignRow { id: string; name: string; tool: "toast" | "feed" | "upsell" | "sms" | "email"; status: "draft" | "scheduled" | "active" | "paused" | "archived"; draftConfig: unknown; publishedVersionId: string | null; updatedAt: string }
