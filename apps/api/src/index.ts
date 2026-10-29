import { drizzle } from "drizzle-orm/d1";
import { lt } from "drizzle-orm";
import { schema } from "@convertflow/database";
import { DEFAULT_AI_MODEL, WorkersAIProvider, type AiBinding } from "@convertflow/ai";
import { createApp } from "./app.js";
import { processEvents, purgeDedup, type EventMessage } from "./services/events.js";
import { publishConfig } from "./services/campaigns.js";
import { notifyRestock, purgeSubscribers } from "./services/restock.js";
import { purgeContacts } from "./services/contacts.js";
import { ResendEmail } from "./services/email.js";
import { isSyncMessage, processSyncMessage, sweepSyncJobs, type SyncMessage } from "./services/providers.js";
import type { Deps, Secrets } from "./deps.js";

/** The one queue carries analytics batches and list-provider sync jobs. */
type QueueMessage = EventMessage | SyncMessage;

interface Env {
  DB: D1Database;
  CONFIG_KV: KVNamespace;
  EVENTS_QUEUE?: Queue<QueueMessage>;
  AI?: AiBinding;
  AI_MODEL?: string;
  AI_GATEWAY_ID?: string;
  ALLOWED_ORIGIN: string;
  // secrets (wrangler secret put ...)
  CREDENTIAL_KEY?: string;
  SHOPIFY_API_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_STARTER?: string;
  STRIPE_PRICE_GROWTH?: string;
  STRIPE_PRICE_SCALE?: string;
  TURNSTILE_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Override the Resend API origin (staging or a local mock). Defaults to https://api.resend.com. */
  RESEND_BASE_URL?: string;
  /** Public origin of this API, used in email links sent to shoppers (confirm / unsubscribe). */
  API_ORIGIN?: string;
  /** Override a list provider's API origin (staging, or a local mock). A connection through one is never marked verified. */
  KLAVIYO_BASE_URL?: string;
  MAILCHIMP_BASE_URL?: string;
}

function secrets(env: Env): Secrets {
  const prices: Secrets["stripePrices"] = {};
  if (env.STRIPE_PRICE_STARTER) prices.starter = env.STRIPE_PRICE_STARTER;
  if (env.STRIPE_PRICE_GROWTH) prices.growth = env.STRIPE_PRICE_GROWTH;
  if (env.STRIPE_PRICE_SCALE) prices.scale = env.STRIPE_PRICE_SCALE;
  const s: Secrets = { stripePrices: prices, webOrigin: env.ALLOWED_ORIGIN };
  if (env.CREDENTIAL_KEY) s.credentialKey = env.CREDENTIAL_KEY;
  if (env.SHOPIFY_API_SECRET) s.shopifyApiSecret = env.SHOPIFY_API_SECRET;
  if (env.STRIPE_SECRET_KEY) s.stripeSecretKey = env.STRIPE_SECRET_KEY;
  if (env.STRIPE_WEBHOOK_SECRET) s.stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (env.TURNSTILE_SECRET) s.turnstileSecret = env.TURNSTILE_SECRET;
  if (env.API_ORIGIN) s.apiOrigin = env.API_ORIGIN;
  if (env.KLAVIYO_BASE_URL || env.MAILCHIMP_BASE_URL) s.providerBaseUrls = { ...(env.KLAVIYO_BASE_URL ? { klaviyo: env.KLAVIYO_BASE_URL } : {}), ...(env.MAILCHIMP_BASE_URL ? { mailchimp: env.MAILCHIMP_BASE_URL } : {}) };
  return s;
}

function deps(env: Env): Deps {
  const d: Deps = {
    db: drizzle(env.DB, { schema }),
    kv: env.CONFIG_KV,
    now: () => new Date(),
    secrets: secrets(env),
  };
  if (env.AI) d.ai = new WorkersAIProvider(env.AI, { model: env.AI_MODEL ?? DEFAULT_AI_MODEL, ...(env.AI_GATEWAY_ID ? { gatewayId: env.AI_GATEWAY_ID } : {}) });
  if (env.AI_GATEWAY_ID) d.aiGatewayId = env.AI_GATEWAY_ID;
  // Email is optional: without both values every email-dependent feature degrades explicitly instead of failing open.
  if (env.RESEND_API_KEY && env.EMAIL_FROM) d.email = new ResendEmail(env.RESEND_API_KEY, env.EMAIL_FROM, fetch, env.RESEND_BASE_URL);
  const q = env.EVENTS_QUEUE;
  if (q) d.enqueueEvents = async (m, opts) => { await q.send(m as QueueMessage, opts?.delaySeconds ? { delaySeconds: opts.delaySeconds } : undefined); };
  return d;
}

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const secure = new URL(env.ALLOWED_ORIGIN).protocol === "https:";
    return createApp(deps(env), { allowedOrigin: env.ALLOWED_ORIGIN, secureCookies: secure }).fetch(req, env, ctx);
  },

  /** Queue consumer. Processing is idempotent, so retries after a failure are safe. */
  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    const d = deps(env);
    for (const m of batch.messages) {
      try {
        // A sync job that must wait (rate limit, provider outage) is re-queued with a delay by processSyncMessage.
        if (isSyncMessage(m.body)) await processSyncMessage(d, m.body); else await processEvents(d, m.body);
        m.ack();
      } catch (e) {
        console.error(JSON.stringify({ level: "error", where: "queue", message: e instanceof Error ? e.message : String(e) }));
        m.retry();
      }
    }
  },

  /** Daily: purge dedup ledger and expired sessions; republish every config so monthly usage resets take effect. */
  async scheduled(_e: ScheduledController, env: Env) {
    const d = deps(env);
    await purgeDedup(d);
    await d.db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, d.now().toISOString()));
    const stores = await d.db.select({ id: schema.stores.id, status: schema.stores.status }).from(schema.stores);
    for (const s of stores) {
      if (s.status !== "active") continue;
      await publishConfig(d, s.id);
      await notifyRestock(d, s.id); // drains alerts held back by the per-run cap or monthly quota
    }
    await purgeSubscribers(d);
    await sweepSyncJobs(d); // hand any list-provider sync job that was missed (a lost enqueue, an outage) back to the queue
    await purgeContacts(d);
    await d.db.delete(schema.authTokens).where(lt(schema.authTokens.expiresAt, new Date(d.now().getTime() - 7 * 86_400_000).toISOString()));
    await d.db.delete(schema.invitations).where(lt(schema.invitations.expiresAt, new Date(d.now().getTime() - 30 * 86_400_000).toISOString()));
  },
};
