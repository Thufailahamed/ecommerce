/**
 * Parsing model output. Models wrap JSON in prose or fences, leave trailing commas, and use smart quotes; edit turns
 * stream a <message> the merchant reads live, then <ops> and <suggestions> that are parsed when the stream ends.
 */

/** Finds the first complete JSON object or array in `text` and parses it, repairing common mistakes. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/^\uFEFF/, "").replace(/```(?:json)?/gi, "");
  const start = cleaned.search(/[[{]/);
  if (start < 0) throw new Error("no JSON found");
  const end = matchingEnd(cleaned, start);
  const slice = cleaned.slice(start, end === -1 ? undefined : end + 1);
  const attempts = [slice, repair(slice)];
  if (end === -1) attempts.push(closeTruncated(repair(slice)));
  for (const a of attempts) {
    try { return JSON.parse(a); } catch { /* try the next repair */ }
  }
  throw new Error("invalid JSON");
}

function matchingEnd(s: string, start: number): number {
  const stack: string[] = [];
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

function repair(s: string): string {
  return s
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    // Raw newlines inside strings are invalid JSON; models emit them in long descriptions.
    .replace(/"(?:[^"\\]|\\.)*"/gs, (m) => m.replace(/\n/g, "\\n").replace(/\t/g, "\\t"));
}

/** Closes a response cut off by the token limit, dropping the half-written last value. */
function closeTruncated(s: string): string {
  let t = s.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"{}[\]]*$/, "").replace(/,\s*$/, "");
  const stack: string[] = [];
  let inStr = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (inStr) { if (ch === "\\") i++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (inStr) t += '"';
  return t + stack.reverse().join("");
}

/* ---------- edit turns: <message>…</message><ops>[…]</ops><suggestions>[…]</suggestions> ---------- */

/**
 * Feeds streamed text and reports what is inside <message> as it arrives, so the merchant reads the reply while the
 * operations are still being written. Tags split across chunks are handled by holding back a short tail.
 */
export class TaggedStream {
  private buf = "";
  private emitted = 0;
  private full = "";

  /** Returns the new part of the message, if any. */
  push(chunk: string): string {
    this.full += chunk;
    this.buf = this.full;
    const open = this.buf.indexOf("<message>");
    if (open < 0) return "";
    const from = open + "<message>".length;
    const close = this.buf.indexOf("</message>", from);
    // Hold back anything that could be the start of "</message>".
    const safeEnd = close >= 0 ? close : Math.max(from, this.buf.length - "</message>".length);
    const visible = this.buf.slice(from, safeEnd);
    if (visible.length <= this.emitted) return "";
    const delta = visible.slice(this.emitted);
    this.emitted = visible.length;
    return delta;
  }

  get text(): string { return this.full; }
}

export interface EditResponse { message: string; ops: unknown[]; suggestions: string[]; opsParseError?: string }

const between = (s: string, tag: string): string | null => {
  const a = s.indexOf(`<${tag}>`);
  if (a < 0) return null;
  const b = s.indexOf(`</${tag}>`, a);
  return s.slice(a + tag.length + 2, b < 0 ? undefined : b);
};

export function parseEditResponse(text: string): EditResponse {
  const message = between(text, "message");
  const opsText = between(text, "ops");
  const sugText = between(text, "suggestions");
  if (message === null && opsText === null) {
    // No tags: the model may have answered with one JSON object instead.
    try {
      const j = extractJson(text) as { message?: unknown; ops?: unknown; suggestions?: unknown };
      if (j && typeof j === "object" && !Array.isArray(j) && ("ops" in j || "message" in j)) {
        return { message: typeof j.message === "string" ? j.message : "", ops: Array.isArray(j.ops) ? j.ops : [], suggestions: stringList(j.suggestions) };
      }
    } catch { /* plain prose */ }
    return { message: text.trim(), ops: [], suggestions: [] };
  }
  let ops: unknown[] = [];
  let opsParseError: string | undefined;
  if (opsText !== null && opsText.trim()) {
    try {
      const parsed = extractJson(opsText);
      ops = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { ops?: unknown }).ops) ? (parsed as { ops: unknown[] }).ops : [parsed];
    } catch (e) { opsParseError = e instanceof Error ? e.message : "invalid operations"; }
  }
  let suggestions: string[] = [];
  if (sugText) { try { suggestions = stringList(extractJson(sugText)); } catch { /* optional */ } }
  return { message: (message ?? "").trim(), ops, suggestions, ...(opsParseError ? { opsParseError } : {}) };
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((s) => s.replace(/[<>]/g, "").trim().slice(0, 90)).filter(Boolean).slice(0, 4) : [];
}
