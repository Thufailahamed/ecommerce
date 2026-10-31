import { drizzle } from "drizzle-orm/d1";
import { lt } from "drizzle-orm";
import { schema } from "@convertflow/database";
import {
  BindingChatModel, BindingImageModel, DEFAULT_AI_MODEL, DEFAULT_BUILDER_MODEL, DEFAULT_IMAGE_MODEL, GatewayChatModel, GatewayImageModel,
  WorkersAIProvider, workersAiModel, type AiBinding,
} from "@convertflow/ai";
import { createApp } from "./app.js";
import { processEvents, purgeDedup, type EventMessage } from "./services/events.js";
import { publishConfig } from "./services/campaigns.js";
import { notifyRestock, purgeSubscribers } from "./services/restock.js";
import { purgeContacts } from "./services/contacts.js";
import { ResendEmail } from "./services/email.js";
import { createTwilioVerifier } from "@convertflow/integrations";
import { isSyncMessage, processSyncMessage, sweepSyncJobs, type SyncMessage } from "./services/providers.js";
import { dispatchDomainEvent, isDomainEventMessage, purgeDomainEvents, sweepDomainEvents, type DomainEventMessage } from "./services/domain-events.js";
import { SUBSCRIBERS } from "./services/subscribers.js";
import { executeRun, isWorkflowRunMessage, runScheduledWorkflows, sweepWorkflowRuns, type WorkflowRunMessage } from "./services/workflows.js";
import { expireActionRequests } from "./services/actions.js";
import { isCatalogReconcileMessage, reconcileShopifyBilling, runCatalogReconcile, scheduleCatalogReconcile, type CatalogReconcileMessage } from "./services/reconcile.js";
import { isWooProductRefreshMessage, runWooProductRefresh, type WooProductRefreshMessage } from "./services/woocommerce.js";
import type { Deps, Secrets } from "./deps.js";

/** The one queue carries analytics batches, list-provider sync jobs, platform events, workflow runs and catalog reconciliation pages. */
type QueueMessage = EventMessage | SyncMessage | DomainEventMessage | WorkflowRunMessage | CatalogReconcileMessage | WooProductRefreshMessage;

interface Env {
  DB: D1Database;
  CONFIG_KV: KVNamespace;
  EVENTS_QUEUE?: Queue<QueueMessage>;
  AI?: AiBinding;
  AI_MODEL?: string;
  AI_GATEWAY_ID?: string;
  /**
   * AI store builder over AI Gateway's REST endpoint (works locally and deployed). Needs the account id and an API
   * token (secret) with Workers AI access; AI_GATEWAY_AUTH_TOKEN only when the gateway is an Authenticated Gateway.
   * Without them a deployed Worker falls back to the AI binding through AI_GATEWAY_ID.
   */
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_TOKEN?: string;
  AI_GATEWAY_AUTH_TOKEN?: string;
  /** Provider-first model id, e.g. "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast" or any model the gateway routes. */
  BUILDER_AI_MODEL?: string;
  BUILDER_IMAGE_MODEL?: string;
  /** "off" disables image generation (stores keep placeholders the merchant can upload over). */
  BUILDER_IMAGES?: string;
  /** Replaces https://gateway.ai.cloudflare.com (a local mock for end-to-end runs). */
  AI_GATEWAY_BASE_URL?: string;
  /** JSON: {"<model id>": {"inputPerMTok": 0.29, "outputPerMTok": 2.25}}. Prices change: set them from the provider's current page. */
  AI_COST_RATES?: string;
  ALLOWED_ORIGIN: string;
  // secrets (wrangler secret put ...)
  CREDENTIAL_KEY?: string;
  SHOPIFY_API_SECRET?: string;
  /** Shopify app client id (public, a var not a secret). With SHOPIFY_API_SECRET, API_ORIGIN and CREDENTIAL_KEY it enables installs and Shopify Billing. */
  SHOPIFY_API_KEY?: string;
  /** Comma-separated scopes requested on install; must match shopify.app.toml. Default read_products,read_inventory. */
  SHOPIFY_SCOPES?: string;
  SHOPIFY_API_VERSION?: string;
  /** "true" makes Shopify Billing charges test charges (development stores and app review). */
  SHOPIFY_BILLING_TEST?: string;
  SHOPIFY_TRIAL_DAYS?: string;
  /** Replaces https://{shop} (a local mock for end-to-end runs). Must contain "{shop}". */
  SHOPIFY_ADMIN_BASE_URL?: string;
  /** Replaces https://{domain} for WooCommerce REST calls (a local mock for end-to-end runs). Must contain "{domain}". */
  WOOCOMMERCE_BASE_URL?: string;
  /** Public origin of the storefront script (cf.js), e.g. https://sdk.example.com. Given to the Shopify theme embed. */
  SDK_ORIGIN?: string;
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
  /** SMS signup: one Twilio Verify service texts the confirmation codes for every store. All three are needed; the token is a secret. */
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_VERIFY_SERVICE_SID?: string;
  /** Replaces https://verify.twilio.com (a local mock for end-to-end runs). */
  TWILIO_VERIFY_BASE_URL?: string;
}

function secrets(env: Env): Secrets {
  const prices: Secrets["stripePrices"] = {};
  if (env.STRIPE_PRICE_STARTER) prices.starter = env.STRIPE_PRICE_STARTER;
  if (env.STRIPE_PRICE_GROWTH) prices.growth = env.STRIPE_PRICE_GROWTH;
  if (env.STRIPE_PRICE_SCALE) prices.scale = env.STRIPE_PRICE_SCALE;
  const s: Secrets = { stripePrices: prices, webOrigin: env.ALLOWED_ORIGIN };
  if (env.CREDENTIAL_KEY) s.credentialKey = env.CREDENTIAL_KEY;
  if (env.SHOPIFY_API_SECRET) s.shopifyApiSecret = env.SHOPIFY_API_SECRET;
  if (env.SHOPIFY_API_KEY) s.shopifyApiKey = env.SHOPIFY_API_KEY;
  if (env.SHOPIFY_SCOPES) s.shopifyScopes = env.SHOPIFY_SCOPES.split(",").map((x) => x.trim()).filter(Boolean);
  if (env.SHOPIFY_API_VERSION) s.shopifyApiVersion = env.SHOPIFY_API_VERSION;
  if (env.SHOPIFY_ADMIN_BASE_URL) s.shopifyAdminBaseUrl = env.SHOPIFY_ADMIN_BASE_URL;
  if (env.WOOCOMMERCE_BASE_URL) s.wooBaseUrl = env.WOOCOMMERCE_BASE_URL;
  if (env.SDK_ORIGIN) s.sdkOrigin = env.SDK_ORIGIN.replace(/\/+$/, "");
  if (env.SHOPIFY_BILLING_TEST === "true") s.shopifyBillingTest = true;
  if (env.SHOPIFY_TRIAL_DAYS && /^\d{1,3}$/.test(env.SHOPIFY_TRIAL_DAYS)) s.shopifyTrialDays = Number(env.SHOPIFY_TRIAL_DAYS);
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
    subscribers: SUBSCRIBERS,
  };
  if (env.AI) {
    const p = new WorkersAIProvider(env.AI, { model: env.AI_MODEL ?? DEFAULT_AI_MODEL, ...(env.AI_GATEWAY_ID ? { gatewayId: env.AI_GATEWAY_ID } : {}) });
    d.ai = p; d.aiText = p; d.aiProviderName = "workers_ai";
  }
  if (env.AI_COST_RATES) {
    try { d.aiCostRates = JSON.parse(env.AI_COST_RATES) as NonNullable<Deps["aiCostRates"]>; } catch { /* a bad setting means no estimates, never a wrong one */ }
  }
  if (env.AI_GATEWAY_ID) d.aiGatewayId = env.AI_GATEWAY_ID;
  const builderModel = env.BUILDER_AI_MODEL ?? DEFAULT_BUILDER_MODEL;
  const imagesOn = env.BUILDER_IMAGES !== "off";
  if (env.AI_GATEWAY_ACCOUNT_ID && env.AI_GATEWAY_TOKEN) {
    const rest = {
      accountId: env.AI_GATEWAY_ACCOUNT_ID, gatewayId: env.AI_GATEWAY_ID ?? "default", apiToken: env.AI_GATEWAY_TOKEN,
      ...(env.AI_GATEWAY_AUTH_TOKEN ? { gatewayToken: env.AI_GATEWAY_AUTH_TOKEN } : {}), ...(env.AI_GATEWAY_BASE_URL ? { baseUrl: env.AI_GATEWAY_BASE_URL } : {}),
    };
    d.builderChat = new GatewayChatModel({ ...rest, model: builderModel });
    if (imagesOn) d.builderImages = new GatewayImageModel({ ...rest, imageModel: env.BUILDER_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL });
  } else if (env.AI && workersAiModel(builderModel)) {
    d.builderChat = new BindingChatModel(env.AI, { model: builderModel, ...(env.AI_GATEWAY_ID ? { gatewayId: env.AI_GATEWAY_ID } : {}) });
    if (imagesOn) d.builderImages = new BindingImageModel(env.AI, env.BUILDER_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL, env.AI_GATEWAY_ID);
  }
  // Email is optional: without both values every email-dependent feature degrades explicitly instead of failing open.
  if (env.RESEND_API_KEY && env.EMAIL_FROM) d.email = new ResendEmail(env.RESEND_API_KEY, env.EMAIL_FROM, fetch, env.RESEND_BASE_URL);
  // SMS signup is optional the same way: without a verifier, SMS forms cannot be published and nothing is collected.
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID) {
    d.phoneVerifier = createTwilioVerifier({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, serviceSid: env.TWILIO_VERIFY_SERVICE_SID, ...(env.TWILIO_VERIFY_BASE_URL ? { baseUrl: env.TWILIO_VERIFY_BASE_URL } : {}) });
  }
  const q = env.EVENTS_QUEUE;
  if (q) {
    d.enqueueEvents = async (m, opts) => { await q.send(m as QueueMessage, opts?.delaySeconds ? { delaySeconds: opts.delaySeconds } : undefined); };
    d.enqueueDomainEvent = async (m) => { await q.send(m); };
  }
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
        // A platform event throws while any subscriber still fails, so the queue retries it (then the DLQ; the daily
        // sweep re-queues it while it has attempts left). Subscribers that already succeeded are not run again.
        if (isSyncMessage(m.body)) await processSyncMessage(d, m.body);
        else if (isDomainEventMessage(m.body)) await dispatchDomainEvent(d, m.body.eventId);
        else if (isWorkflowRunMessage(m.body)) await executeRun(d, m.body.runId); // claims the run, so a redelivery is a no-op
        else if (isCatalogReconcileMessage(m.body)) await runCatalogReconcile(d, m.body); // one catalog page; queues the next itself
        else if (isWooProductRefreshMessage(m.body)) await runWooProductRefresh(d, m.body); // a variable product changed at a WooCommerce store
        else await processEvents(d, m.body);
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
    await sweepDomainEvents(d); // platform events whose enqueue was lost, or that failed with attempts left
    await purgeDomainEvents(d);
    await runScheduledWorkflows(d);
    await sweepWorkflowRuns(d); // delayed runs whose queue message was lost
    await expireActionRequests(d);
    await scheduleCatalogReconcile(d); // a full catalog pass per connected store, a page per queue message
    await reconcileShopifyBilling(d); // re-read each Shopify-billed workspace's charge, in case a webhook was lost
    await d.db.delete(schema.authTokens).where(lt(schema.authTokens.expiresAt, new Date(d.now().getTime() - 7 * 86_400_000).toISOString()));
    await d.db.delete(schema.invitations).where(lt(schema.invitations.expiresAt, new Date(d.now().getTime() - 30 * 86_400_000).toISOString()));
  },
};
