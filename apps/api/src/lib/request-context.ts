import { tryGetContext } from "hono/context-storage";

/**
 * The id of the request being handled, for audit rows and platform events. Read through Hono's context storage
 * (AsyncLocalStorage, available on Workers with `nodejs_compat`), so services do not take it as a parameter and do
 * not depend on route handlers. Null outside a request: queue consumers and the cron pass their own ids explicitly.
 */
export const correlationOf = (d: { correlationId?: string }): string | null => d.correlationId ?? currentCorrelationId();

export function currentCorrelationId(): string | null {
  const c = tryGetContext<{ Variables: { requestId?: string } }>();
  return c?.var.requestId ?? null;
}
