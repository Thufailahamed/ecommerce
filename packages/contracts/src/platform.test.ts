import { describe, expect, it } from "vitest";
import { DOMAIN_EVENTS, DOMAIN_EVENT_TYPES, isDomainEventType, parseDomainEventPayload } from "./domain-events";
import { PERMISSIONS, ROLES, isPermission, permissionsFor, roleCan, type Permission } from "./permissions";

describe("permission catalog", () => {
  it("is a ladder: a higher role holds everything a lower one does", () => {
    for (let i = 1; i < ROLES.length; i++) {
      const lower = new Set(permissionsFor(ROLES[i - 1]!));
      const higher = new Set(permissionsFor(ROLES[i]!));
      for (const p of lower) expect(higher.has(p)).toBe(true);
    }
    expect(permissionsFor("owner")).toHaveLength(Object.keys(PERMISSIONS).length);
  });

  it("keeps the thresholds the routes enforced before the catalog existed", () => {
    const expected: Record<Permission, "viewer" | "editor" | "admin" | "owner"> = {
      "store.read": "viewer", "store.settings.update": "admin", "store.disconnect": "owner", "integrations.read": "editor", "integrations.manage": "admin",
      "catalog.read": "viewer", "catalog.write": "editor", "campaigns.read": "viewer", "campaigns.write": "editor",
      "campaigns.publish": "admin", "ai.generate": "editor", "analytics.read": "viewer", "contacts.read": "editor",
      "contacts.manage": "admin", "providers.manage": "admin", "workflows.read": "editor", "workflows.manage": "admin", "audit.read": "admin", "operations.read": "admin",
      "operations.manage": "admin", "organization.read": "viewer", "stores.create": "admin", "team.invite": "admin",
      "team.manage_roles": "owner", "billing.read": "viewer", "billing.manage": "owner", "organization.audit.read": "admin",
      "sites.read": "viewer", "sites.write": "editor", "sites.publish": "admin", "sites.orders": "editor",
    };
    expect(Object.fromEntries(Object.entries(PERMISSIONS).map(([k, v]) => [k, v.minRole]))).toEqual(expected);
  });

  it("answers role checks and rejects unknown names", () => {
    expect(roleCan("editor", "campaigns.write")).toBe(true);
    expect(roleCan("editor", "campaigns.publish")).toBe(false);
    expect(roleCan("admin", "store.disconnect")).toBe(false);
    expect(isPermission("campaigns.publish")).toBe(true);
    expect(isPermission("campaigns.delete_everything")).toBe(false);
    expect(isPermission("toString")).toBe(false);
  });
});

describe("domain event catalog", () => {
  it("validates payloads strictly, so nothing extra (an address, a token) can ride along", () => {
    expect(parseDomainEventPayload("customer.subscribed", { contactId: "con_1", channel: "email" }).ok).toBe(true);
    const extra = parseDomainEventPayload("customer.subscribed", { contactId: "con_1", channel: "email", email: "a@b.co" });
    expect(extra.ok).toBe(false);
    expect(parseDomainEventPayload("order.created", { platform: "shopify", externalOrderId: "1", total: 10, currency: "usd", placedAt: "2026-10-27T10:00:00Z" }).ok).toBe(false);
    expect(parseDomainEventPayload("order.created", { platform: "shopify", externalOrderId: "1", total: -1, currency: "USD", placedAt: "2026-10-27T10:00:00Z" }).ok).toBe(false);
    expect(parseDomainEventPayload("order.created", { platform: "shopify", externalOrderId: "1", total: 10, currency: "USD", placedAt: "2026-10-27T10:00:00Z" }).ok).toBe(true);
  });

  it("gives every type a version, a privacy class and a description", () => {
    for (const t of DOMAIN_EVENT_TYPES) {
      const e = DOMAIN_EVENTS[t];
      expect(e.version).toBeGreaterThanOrEqual(1);
      expect(["none", "pseudonymous"]).toContain(e.privacy);
      expect(e.description.length).toBeGreaterThan(10);
      expect(t).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    }
    expect(isDomainEventType("order.created")).toBe(true);
    expect(isDomainEventType("order.exploded")).toBe(false);
  });

  it("classes events that carry a contact id as pseudonymous, so erasure can find them", () => {
    for (const t of DOMAIN_EVENT_TYPES) {
      const keys = Object.keys((DOMAIN_EVENTS[t].payload as unknown as { shape: Record<string, unknown> }).shape);
      if (keys.includes("contactId")) expect(DOMAIN_EVENTS[t].privacy).toBe("pseudonymous");
    }
  });
});
