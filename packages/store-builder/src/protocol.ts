import type { AppliedOp, FailedOp } from "./ops";
import type { SiteDocument } from "./schema";

/**
 * Wire formats shared by the API and the web app: the server-sent events of a chat turn, and the messages between the
 * editor and its preview iframe.
 */

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** What the assistant changed, for the chips under its reply. */
  changes?: { summary: string; target: string }[];
  failed?: FailedOp[];
  /** The version this turn produced; the merchant can restore it. */
  versionId?: string | null;
  selection?: { pageId: string; sectionId: string; label: string } | null;
  status?: "ok" | "error" | "cancelled";
  steps?: { key: string; label: string; state: "done" | "error" | "skipped" }[];
  suggestions?: string[];
}

export type ChatEvent =
  | { type: "start"; userMessage: ChatMessageView; mode: "build" | "edit" }
  | { type: "status"; step: string; label: string; state: "active" | "done" | "error" | "skipped"; detail?: string }
  | { type: "delta"; text: string }
  | { type: "doc"; doc: SiteDocument; revision: number }
  | { type: "ops"; applied: AppliedOp[]; failed: FailedOp[] }
  | { type: "done"; message: ChatMessageView; revision: number; usage: { used: number; limit: number } }
  | { type: "error"; code: string; message: string; message_?: ChatMessageView };

/** Encodes one SSE frame. */
export const sseFrame = (e: ChatEvent) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;

/** Splits an SSE byte stream into events. Feed decoded text; returns complete events and keeps the remainder. */
export class SseDecoder {
  private buf = "";
  push(text: string): ChatEvent[] {
    this.buf += text.replace(/\r\n/g, "\n");
    const out: ChatEvent[] = [];
    let i: number;
    while ((i = this.buf.indexOf("\n\n")) >= 0) {
      const frame = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data) continue;
      try { out.push(JSON.parse(data) as ChatEvent); } catch { /* ignore a malformed frame */ }
    }
    return out;
  }
}

/* ---------- editor <-> preview iframe ---------- */

export type PreviewMode = "edit" | "preview";

export type EditorToPreview =
  | { source: "sb-editor"; type: "render"; doc: SiteDocument; path: string; mode: PreviewMode; selectedId: string | null; assetBase: string; busy: boolean }
  | { source: "sb-editor"; type: "scroll-to"; sectionId: string };

export type PreviewToEditor =
  | { source: "sb-preview"; type: "ready" }
  | { source: "sb-preview"; type: "select"; sectionId: string; pageId: string }
  | { source: "sb-preview"; type: "hover"; sectionId: string | null }
  | { source: "sb-preview"; type: "navigate"; path: string };

export const isPreviewMessage = (d: unknown): d is PreviewToEditor => typeof d === "object" && d !== null && (d as { source?: unknown }).source === "sb-preview";
export const isEditorMessage = (d: unknown): d is EditorToPreview => typeof d === "object" && d !== null && (d as { source?: unknown }).source === "sb-editor";

/** Resolves a document image source to a URL the browser can load. */
export function imageUrl(src: string, assetBase: string): string {
  if (!src) return "";
  if (src.startsWith("asset:")) return `${assetBase.replace(/\/$/, "")}/${src.slice(6)}`;
  return src;
}
