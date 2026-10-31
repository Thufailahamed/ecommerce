import { SseDecoder, type ChatEvent, type ChatMessageView, type Palette, type SiteDocument } from "@convertflow/store-builder";
import { api, ApiError, API_URL } from "./api";

/** Where store images are served from. Documents store `asset:<id>`; the renderer joins it to this base. */
export const ASSET_BASE = `${API_URL}/api/v1/storefront/assets`;

export interface SiteSummary {
  id: string; name: string; slug: string; status: "draft" | "published" | "archived"; updatedAt: string; publishedAt: string | null; prompt: string | null;
  preview: { palette: Palette; headingFont: string; tagline: string; heroImage: string; products: number; pages: number } | null;
}

export interface SiteView {
  id: string; organizationId: string; name: string; slug: string; status: "draft" | "published" | "archived"; revision: number;
  draft: SiteDocument; publishedVersionId: string | null; publishedAt: string | null; prompt: string | null;
  notifyEmail: string | null; paymentsConnected: boolean; role: string; busy: boolean;
  ai: { chat: boolean; images: boolean; model: string | null };
  usage: { messages: { used: number; limit: number }; images: { used: number; limit: number } };
  updatedAt: string;
}

export interface VersionRow { id: string; number: number; kind: "ai" | "manual" | "restore" | "publish" | "initial"; label: string; createdAt: string; createdBy: string | null }
export interface AssetRow { id: string; ref: string; source: "upload" | "ai"; contentType: string; bytes: number; alt: string | null; createdAt: string }
export interface OrderRow {
  id: string; number: number; status: "pending_payment" | "paid" | "unpaid" | "fulfilled" | "cancelled"; email: string; name: string;
  address: Record<string, string>; lines: { productId: string; title: string; quantity: number; unitPrice: number; lineTotal: number; options: Record<string, string> }[];
  currency: string; subtotal: number; shipping: number; total: number; note: string | null; createdAt: string;
}
export interface SubmissionRow { id: string; kind: "newsletter" | "contact"; email: string; name: string | null; message: string | null; createdAt: string }

export const storeUrl = (slug: string) => `/s/${slug}`;

export const builder = {
  list: (organizationId: string) => api<SiteSummary[]>(`/api/v1/sites?organizationId=${encodeURIComponent(organizationId)}`),
  create: (body: { organizationId: string; name?: string; prompt?: string; currency?: string; preset?: string }) => api<{ id: string; slug: string; name: string }>("/api/v1/sites", { method: "POST", body }),
  get: (id: string) => api<SiteView>(`/api/v1/sites/${id}`),
  update: (id: string, body: { name?: string; slug?: string; notifyEmail?: string | null }) => api<{ name: string; slug: string; notifyEmail: string | null }>(`/api/v1/sites/${id}`, { method: "PATCH", body }),
  archive: (id: string) => api<void>(`/api/v1/sites/${id}`, { method: "DELETE" }),
  save: (id: string, document: SiteDocument, revision: number, label?: string) => api<{ revision: number; draft: SiteDocument }>(`/api/v1/sites/${id}/draft`, { method: "PUT", body: { document, revision, ...(label ? { label } : {}) } }),
  versions: (id: string) => api<VersionRow[]>(`/api/v1/sites/${id}/versions`),
  version: (id: string, versionId: string) => api<VersionRow & { document: SiteDocument }>(`/api/v1/sites/${id}/versions/${versionId}`),
  restore: (id: string, versionId: string, revision: number) => api<{ revision: number; draft: SiteDocument }>(`/api/v1/sites/${id}/versions/${versionId}/restore`, { method: "POST", body: { revision } }),
  messages: (id: string) => api<ChatMessageView[]>(`/api/v1/sites/${id}/messages`),
  publish: (id: string, revision: number) => api<{ versionId: string; publishedAt: string; slug: string; warnings: unknown[] }>(`/api/v1/sites/${id}/publish`, { method: "POST", body: { approve: true, revision } }),
  unpublish: (id: string) => api<void>(`/api/v1/sites/${id}/unpublish`, { method: "POST", body: {} }),
  payments: (id: string, stripeSecretKey: string | null) => api<{ paymentsConnected: boolean }>(`/api/v1/sites/${id}/payments`, { method: "PUT", body: { stripeSecretKey } }),
  assets: (id: string) => api<AssetRow[]>(`/api/v1/sites/${id}/assets`),
  generateImage: (id: string, prompt: string, alt?: string) => api<{ id: string; ref: string }>(`/api/v1/sites/${id}/assets/generate`, { method: "POST", body: { prompt, ...(alt ? { alt } : {}) } }),
  orders: (id: string) => api<OrderRow[]>(`/api/v1/sites/${id}/orders`),
  setOrderStatus: (id: string, orderId: string, status: "paid" | "fulfilled" | "cancelled") => api<void>(`/api/v1/sites/${id}/orders/${orderId}`, { method: "PATCH", body: { status } }),
  submissions: (id: string) => api<SubmissionRow[]>(`/api/v1/sites/${id}/submissions`),
};

/** Uploads raw image bytes; the server checks the type from the bytes themselves. */
export async function uploadImage(siteId: string, file: File, alt = ""): Promise<{ id: string; ref: string }> {
  const res = await fetch(`${API_URL}/api/v1/sites/${siteId}/assets?alt=${encodeURIComponent(alt)}`, {
    method: "POST", credentials: "include", headers: { "content-type": file.type || "application/octet-stream" }, body: file,
  });
  const json = (await res.json().catch(() => null)) as { data?: { id: string; ref: string }; error?: { code: string; message: string } } | null;
  if (!res.ok || !json?.data) throw new ApiError(res.status, json?.error?.code ?? "network", json?.error?.message ?? "Upload failed");
  return json.data;
}

/**
 * One chat turn over server-sent events. Resolves when the stream ends; `onEvent` sees every event as it arrives.
 * Aborting the signal stops the turn on the server too (the server keeps what it already saved).
 */
export async function streamChat(
  siteId: string,
  body: { message: string; selection?: { sectionId: string } | null; path?: string; mode?: "auto" | "build" | "edit" },
  onEvent: (e: ChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/sites/${siteId}/chat`, {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal,
  });
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(res.status, json?.error?.code ?? "network", json?.error?.message ?? "The AI could not be reached");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const sse = new SseDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const e of sse.push(decoder.decode(value, { stream: true }))) onEvent(e);
  }
}

export const relativeTime = (iso: string, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return days < 30 ? `${days} d ago` : new Date(iso).toLocaleDateString();
};
