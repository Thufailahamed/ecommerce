import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { schema } from "@convertflow/database";
import type { CampaignAIProvider } from "@convertflow/ai";
import { createApp } from "../src/app.js";
import type { Deps, EmailMessage, EmailProvider, KeyValue, Secrets } from "../src/deps.js";

export const ORIGIN = "http://localhost:3000";
export const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

/** Captures every email instead of sending it, so tests can follow the links inside. */
export class MailBox implements EmailProvider {
  sent: EmailMessage[] = [];
  failNext = false;
  async send(m: EmailMessage) { if (this.failNext) { this.failNext = false; throw new Error("provider down"); } this.sent.push(m); }
  last(to?: string) { return [...this.sent].reverse().find((m) => !to || m.to === to); }
  /** First URL in the plain-text body of the latest message. */
  link(to?: string): string { const m = this.last(to)?.text.match(/https?:\/\/\S+/); if (!m) throw new Error("no link in email"); return m[0]; }
  token(to?: string): string { return new URL(this.link(to)).searchParams.get("token") ?? ""; }
  /** Token from the latest email to `to` whose subject matches, e.g. the invite rather than a later verification email. */
  tokenOf(to: string, subject: RegExp): string {
    const m = [...this.sent].reverse().find((x) => x.to === to && subject.test(x.subject));
    const url = m?.text.match(/https?:\/\/\S+/)?.[0];
    if (!url) throw new Error(`no email to ${to} matching ${subject}`);
    return new URL(url).searchParams.get("token") ?? "";
  }
}

export async function makeEnv(ai?: CampaignAIProvider, extra: { secrets?: Secrets; fetchFn?: typeof fetch; email?: EmailProvider } = {}) {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  const dir = join(import.meta.dirname, "../../../packages/database/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(join(dir, f), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await client.execute(stmt);
    }
  }
  // `store` is exposed to tests as a plain Map (get/set/delete). The `get` seen by the app is async, like KV.
  const store = new Map<string, string>();
  const kv: KeyValue = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
  const clock = { t: Date.parse("2026-10-27T12:00:00Z") };
  const deps: Deps = {
    db: drizzle(client, { schema }), kv, now: () => new Date(clock.t), ...(ai ? { ai } : {}),
    ...(extra.secrets ? { secrets: extra.secrets } : {}), ...(extra.fetchFn ? { fetchFn: extra.fetchFn } : {}), ...(extra.email ? { email: extra.email } : {}),
  };
  const app = createApp(deps, { allowedOrigin: ORIGIN, secureCookies: false });
  return { app, deps, kv: store, clock };
}

export type Env = Awaited<ReturnType<typeof makeEnv>>;

export class Client {
  cookie = "";
  constructor(private env: Env) {}
  async req(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { origin: ORIGIN, ...extra };
    if (this.cookie) headers["cookie"] = this.cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await this.env.app.request(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0] ?? "";
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown) => this.req("POST", p, b ?? {});
  put = (p: string, b: unknown) => this.req("PUT", p, b);
  patch = (p: string, b: unknown) => this.req("PATCH", p, b);
  del = (p: string, b?: unknown) => this.req("DELETE", p, b);
}

export const validConfig = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, name: "Welcome", format: "popup",
  creative: { headline: "Welcome", body: "Take a look around.", ctaLabel: "Shop", ctaUrl: "/collections/all" },
  style: {}, trigger: { type: "delay", seconds: 5 },
  targeting: { match: "all", conditions: [{ field: "page_type", op: "in", value: ["home"] }] },
  frequency: {}, goal: { type: "clicks" }, ...over,
});

export async function signup(env: Env, email: string) {
  const c = new Client(env);
  const r = await c.post("/api/v1/auth/register", { email, password: "correct-horse-battery" });
  return { c, orgId: r.json.data.organizationId as string, userId: r.json.data.userId as string };
}

export async function setupStore(env: Env, email = "owner@example.com") {
  const u = await signup(env, email);
  const s = await u.c.post("/api/v1/stores", { organizationId: u.orgId, platform: "custom", name: "Test shop", domain: "shop.example.com", currency: "USD" });
  return { ...u, storeId: s.json.data.id as string, siteKey: s.json.data.siteKey as string };
}

/** Moves an organisation to a plan directly (what a verified Stripe webhook would do). */
export async function setPlan(env: Env, orgId: string, plan: "free" | "starter" | "growth" | "scale") {
  const { eq } = await import("drizzle-orm");
  await env.deps.db.update(schema.subscriptions).set({ plan, status: "active" }).where(eq(schema.subscriptions.organizationId, orgId));
}
