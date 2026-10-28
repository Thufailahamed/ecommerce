import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProviderView, Store } from "@/lib/api";

const apiMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));

const store: Store = { id: "sto_1", name: "Shop", platform: "custom", domain: "shop.example.com", siteKey: "cf_key", currency: "USD", deliveryEnabled: true, organizationId: "o1" };
const counts = { pending: 0, synced: 0, failed: 0, skipped_no_consent: 0, skipped_suppressed: 0 };
const view = (p: "klaviyo" | "mailchimp", over: Partial<ProviderView> = {}): ProviderView => ({
  provider: p, label: p === "klaviyo" ? "Klaviyo" : "Mailchimp", connected: false, status: null, listId: null, listName: null, verified: false, verifiedAt: null, lastCheckedAt: null, lastError: null, counts: { ...counts }, ...over,
});
let state: ProviderView[];
const calls = () => apiMock.mock.calls.map((c) => `${c[1]?.method ?? "GET"} ${String(c[0]).replace("/api/v1/stores/sto_1/providers", "")}`);
/** The body of the most recent matching call. */
const bodyOf = (method: string, path: string) => [...apiMock.mock.calls].reverse().find((c) => c[1]?.method === method && String(c[0]).endsWith(path))?.[1].body;

beforeEach(() => {
  apiMock.mockReset();
  state = [view("klaviyo"), view("mailchimp")];
  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: Record<string, unknown> }) => {
    const m = init?.method ?? "GET";
    if (m === "GET" && path.endsWith("/providers")) return state;
    if (m === "PUT" && init?.body?.["apiKey"]) { state = state.map((p) => (p.provider === "klaviyo" ? view("klaviyo", { connected: true, status: "connected" }) : p)); return { provider: state[0], lists: [{ id: "L1", name: "Newsletter" }, { id: "L2", name: "VIPs" }], queued: 0 }; }
    if (m === "PUT" && init?.body?.["listId"]) { state = state.map((p) => (p.provider === "klaviyo" ? { ...p, listId: String(init.body!["listId"]), listName: "VIPs" } : p)); return { provider: state[0], queued: init.body["syncExisting"] ? 3 : 0 }; }
    if (path.endsWith("/lists")) return [{ id: "L1", name: "Newsletter" }, { id: "L2", name: "VIPs" }];
    if (path.endsWith("/retry")) return { retried: 2 };
    return undefined;
  });
});

const open = async () => {
  const { ProviderPanel } = await import("@/components/providers");
  render(<ProviderPanel store={store} />);
  await screen.findByRole("article", { name: "Klaviyo connection" });
  return userEvent.setup();
};
const card = (name: string) => within(screen.getByRole("article", { name: `${name} connection` }));

describe("list provider panel", () => {
  it("lists both providers, each asking for a key and saying what it is checked against", async () => {
    await open();
    for (const n of ["Klaviyo", "Mailchimp"]) {
      expect(card(n).getByLabelText(`${n} API key`)).toBeTruthy();
      expect(card(n).getByText(/checked with .* before it is saved, stored encrypted, and never shown again/)).toBeTruthy();
    }
    expect(screen.getByText(/does not send marketing email itself/)).toBeTruthy();
  });

  it("connect needs a plausible key, hides it as it is typed, and never shows it again afterwards", async () => {
    const u = await open();
    const input = card("Klaviyo").getByLabelText("Klaviyo API key") as HTMLInputElement;
    expect(input.type).toBe("password");
    const connect = card("Klaviyo").getByRole("button", { name: "Connect" }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
    await u.type(input, "pk_secret_value_123");
    expect(connect.disabled).toBe(false);
    await u.click(connect);
    await waitFor(() => expect(bodyOf("PUT", "/klaviyo")).toEqual({ apiKey: "pk_secret_value_123" }));
    await screen.findByText(/Now choose the list/);
    expect(document.body.textContent).not.toContain("pk_secret_value_123");
    expect(screen.queryByLabelText("Klaviyo API key")).toBeNull(); // the form is gone: nothing to re-reveal
  });

  it("after connecting, the merchant picks a list and decides whether to add everyone already subscribed", async () => {
    const u = await open();
    await u.type(card("Klaviyo").getByLabelText("Klaviyo API key"), "pk_secret_value_123");
    await u.click(card("Klaviyo").getByRole("button", { name: "Connect" }));
    await screen.findByLabelText("Klaviyo list");
    expect(card("Klaviyo").getByText(/No list chosen yet: nothing is being copied/)).toBeTruthy();
    await u.selectOptions(card("Klaviyo").getByLabelText("Klaviyo list"), "L2");
    await u.click(card("Klaviyo").getByLabelText(/Also add everyone who is already subscribed/));
    await u.click(card("Klaviyo").getByRole("button", { name: "Use this list" }));
    await waitFor(() => expect(bodyOf("PUT", "/klaviyo")).toEqual({ listId: "L2", syncExisting: true }));
    await screen.findByText(/3 existing subscribers are being added/);
  });

  it("says plainly that a connection is not verified against the live provider, until it is", async () => {
    state = [view("klaviyo", { connected: true, status: "connected", listId: "L1", listName: "Newsletter" }), view("mailchimp", { connected: true, status: "connected", listId: "A1", listName: "Main", verified: true, verifiedAt: "2026-10-20T09:00:00.000Z" })];
    await open();
    expect(card("Klaviyo").getByText(/Not verified against the live provider/)).toBeTruthy();
    expect(card("Klaviyo").getByText(/Newsletter/)).toBeTruthy();
    expect(card("Mailchimp").queryByText(/Not verified against the live provider/)).toBeNull();
    expect(card("Mailchimp").getByText(/Verified with Mailchimp on/)).toBeTruthy();
  });

  it("surfaces a broken connection and failed contacts, and retrying sends them again", async () => {
    state = [view("klaviyo", { connected: true, status: "error", listId: "L1", listName: "Newsletter", lastError: "The provider rejected the key. Reconnect it, then retry the failed contacts.", counts: { ...counts, failed: 2, synced: 5, pending: 1 } }), view("mailchimp")];
    const u = await open();
    expect(card("Klaviyo").getByText("Needs attention")).toBeTruthy();
    expect(card("Klaviyo").getByRole("alert").textContent).toContain("Reconnect it");
    expect(card("Klaviyo").getByText("5")).toBeTruthy(); // copied
    await u.click(card("Klaviyo").getByRole("button", { name: "Retry 2 failed" }));
    await waitFor(() => expect(calls()).toContain("POST /klaviyo/retry"));
    await screen.findByText(/2 failed contacts were sent again/);
  });

  it("disconnecting takes two steps and can be cancelled", async () => {
    state = [view("klaviyo", { connected: true, status: "connected", listId: "L1", listName: "Newsletter" }), view("mailchimp")];
    const u = await open();
    await u.click(card("Klaviyo").getByRole("button", { name: "Disconnect" }));
    await u.click(card("Klaviyo").getByRole("button", { name: "Cancel" }));
    expect(calls().some((c) => c.startsWith("DELETE"))).toBe(false);
    await u.click(card("Klaviyo").getByRole("button", { name: "Disconnect" }));
    await u.click(card("Klaviyo").getByRole("button", { name: "Disconnect for good" }));
    await waitFor(() => expect(calls()).toContain("DELETE /klaviyo"));
    await screen.findByText(/People already copied stay on that list/);
  });

  it("shows a failed connection check in words, not the provider's response", async () => {
    const { ApiError } = await import("@/lib/api");
    const u = await open();
    apiMock.mockImplementationOnce(async () => { throw new ApiError(422, "provider_auth_failed", "The provider rejected this key. Check that it is correct and has permission to read lists and manage subscriptions."); });
    await u.type(card("Mailchimp").getByLabelText("Mailchimp API key"), "badkey-us21-abcdef");
    await u.click(card("Mailchimp").getByRole("button", { name: "Connect" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The provider rejected this key");
  });
});
