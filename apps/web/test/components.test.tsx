import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }), useSearchParams: () => new URLSearchParams(search), usePathname: () => "/" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

const apiMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));

const session = { me: { userId: "u1", email: "me@example.com", organizations: [{ id: "o1", name: "Org", role: "owner" }] }, security: { mfaEnabled: false, recoveryCodesLeft: 0, emailVerified: true, emailConfigured: true }, reload: vi.fn(async () => undefined), stores: [], store: null, selectStore: vi.fn() };
vi.mock("@/lib/session", () => ({ useSession: () => session }));

beforeEach(() => { apiMock.mockReset(); replace.mockReset(); search = ""; session.reload.mockClear(); session.security = { mfaEnabled: false, recoveryCodesLeft: 0, emailVerified: true, emailConfigured: true }; });

describe("sign-in form", () => {
  const setup = async (mode: "login" | "signup") => { const { AuthForm } = await import("@/components/auth-form"); render(<AuthForm mode={mode} />); return userEvent.setup(); };
  const fill = async (u: ReturnType<typeof userEvent.setup>) => { await u.type(screen.getByLabelText("Email"), "a@example.com"); await u.type(screen.getByLabelText("Password"), "correct-horse-battery"); };

  it("signs in and goes to the app", async () => {
    apiMock.mockResolvedValueOnce({ userId: "u" });
    const u = await setup("login"); await fill(u);
    await u.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/app"));
    expect(apiMock).toHaveBeenCalledWith("/api/v1/auth/login", { method: "POST", body: { email: "a@example.com", password: "correct-horse-battery" } });
  });
  it("never redirects off-site from ?next=", async () => {
    const { AuthForm } = await import("@/components/auth-form");
    for (const evil of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)"]) {
      replace.mockReset(); apiMock.mockReset(); apiMock.mockResolvedValueOnce({});
      search = `next=${encodeURIComponent(evil)}`;
      const { unmount } = render(<AuthForm mode="login" />);
      const u = userEvent.setup(); await fill(u);
      await u.click(screen.getByRole("button", { name: "Sign in" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/app"), { timeout: 3000 });
      unmount();
    }
  });
  it("honours a same-site ?next= path (invite flow)", async () => {
    apiMock.mockResolvedValueOnce({}); search = `next=${encodeURIComponent("/invite?token=abc")}`;
    const u = await setup("login"); await fill(u);
    await u.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/invite?token=abc"));
  });
  it("asks for the second factor when required, then resubmits with the code", async () => {
    apiMock.mockRejectedValueOnce(new ApiError(401, "mfa_required", "Enter the 6-digit code")).mockResolvedValueOnce({});
    const u = await setup("login"); await fill(u);
    await u.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByLabelText("Authentication code")).toBeTruthy();
    expect(screen.getByText("Two-step verification")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull(); // not shown as an error
    await u.type(screen.getByLabelText("Authentication code"), "123456");
    await u.click(screen.getByRole("button", { name: "Verify and sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/app"));
    expect(apiMock).toHaveBeenLastCalledWith("/api/v1/auth/login", { method: "POST", body: { email: "a@example.com", password: "correct-horse-battery", code: "123456" } });
  });
  it("shows the server's message for bad credentials and offers password reset", async () => {
    apiMock.mockRejectedValueOnce(new ApiError(401, "invalid_credentials", "Invalid email or password"));
    const u = await setup("login"); await fill(u);
    await u.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Invalid email or password");
    expect(screen.getByRole("link", { name: "Forgot your password?" }).getAttribute("href")).toBe("/forgot-password");
  });
  it("signup enforces the 10-character minimum at the field", async () => {
    await setup("signup");
    expect(screen.getByLabelText("Password").getAttribute("minlength")).toBe("10");
  });
});

describe("verification banner", () => {
  it("shows only when email is configured and the account is unconfirmed, and resends", async () => {
    const { VerifyBanner } = await import("@/components/verify-banner");
    const { container, rerender } = render(<VerifyBanner />);
    expect(container.textContent).toBe(""); // verified: hidden
    session.security = { mfaEnabled: false, recoveryCodesLeft: 0, emailVerified: false, emailConfigured: false };
    rerender(<VerifyBanner />); expect(container.textContent).toBe(""); // no email on this deployment: hidden
    session.security = { mfaEnabled: false, recoveryCodesLeft: 0, emailVerified: false, emailConfigured: true };
    rerender(<VerifyBanner />);
    expect(screen.getByText(/to publish campaigns/)).toBeTruthy();
    apiMock.mockResolvedValueOnce({});
    await userEvent.setup().click(screen.getByRole("button", { name: "Resend confirmation" }));
    expect(await screen.findByText(/Check your inbox/)).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith("/api/v1/auth/resend-verification", { method: "POST", body: {} });
  });
});

describe("promotions guardrail", () => {
  const store = { id: "s1", name: "S", platform: "custom", domain: "a.com", siteKey: "k", currency: "USD", deliveryEnabled: true, organizationId: "o1" };
  it("is off by default and saves a numeric ceiling, or turns off with null", async () => {
    const { DiscountGuardrail } = await import("@/components/settings/guardrail");
    const changed = vi.fn(); apiMock.mockResolvedValue(undefined);
    const { rerender } = render(<DiscountGuardrail store={store} current={null} canEdit onChanged={changed} />);
    expect(screen.getByText("Off")).toBeTruthy();
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Allow promotions" }));
    expect(apiMock).toHaveBeenCalledWith("/api/v1/stores/s1/settings", { method: "PATCH", body: { maxDiscountPercent: 20 } });
    rerender(<DiscountGuardrail store={store} current={20} canEdit onChanged={changed} />);
    expect(screen.getByText("On, up to 20% off")).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Turn off" }));
    expect(apiMock).toHaveBeenLastCalledWith("/api/v1/stores/s1/settings", { method: "PATCH", body: { maxDiscountPercent: null } });
  });
  it("is read-only for non-admins", async () => {
    const { DiscountGuardrail } = await import("@/components/settings/guardrail");
    render(<DiscountGuardrail store={store} current={10} canEdit={false} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Update limit" })).toBeNull();
  });
});

describe("team settings", () => {
  const team = { members: [{ userId: "u1", email: "me@example.com", role: "owner", joinedAt: "x" }, { userId: "u2", email: "ed@example.com", role: "editor", joinedAt: "x" }], invites: [{ id: "i1", email: "new@example.com", role: "viewer", expiresAt: "2026-12-01T00:00:00Z" }] };
  it("lists members and pending invites; owners can change roles; the owner row is fixed", async () => {
    apiMock.mockResolvedValue(team);
    const { TeamSection } = await import("@/components/settings/team");
    render(<TeamSection orgId="o1" myRole="owner" myUserId="u1" />);
    expect(await screen.findByText("ed@example.com")).toBeTruthy();
    expect(screen.getByText(/new@example.com/)).toBeTruthy();
    expect(screen.getByText("(you)")).toBeTruthy();
    expect(screen.getByLabelText("Role for ed@example.com")).toBeTruthy();
    expect(screen.queryByLabelText("Role for me@example.com")).toBeNull();
    await userEvent.setup().selectOptions(screen.getByLabelText("Role for ed@example.com"), "viewer");
    expect(apiMock).toHaveBeenCalledWith("/api/v1/organizations/o1/members/u2", { method: "PATCH", body: { role: "viewer" } });
  });
  it("sends an invite and shows the shareable link", async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => init?.method === "POST" ? { email: "x@example.com", role: "editor", emailed: false, inviteUrl: "https://app.example.com/invite?token=T" } : team);
    const { TeamSection } = await import("@/components/settings/team");
    render(<TeamSection orgId="o1" myRole="admin" myUserId="u1" />);
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText("Invite by email"), "x@example.com");
    await u.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByTestId("invite-url")).toBeTruthy();
    expect(screen.getByText(/Email delivery isn't configured/)).toBeTruthy();
    expect(screen.queryByRole("option", { name: "admin" })).toBeNull(); // admins cannot invite admins
  });
  it("viewers see the team but get no invite form", async () => {
    apiMock.mockResolvedValue(team);
    const { TeamSection } = await import("@/components/settings/team");
    render(<TeamSection orgId="o1" myRole="viewer" myUserId="u3" />);
    await screen.findByText("ed@example.com");
    expect(screen.queryByLabelText("Invite by email")).toBeNull();
  });
});

describe("two-step verification setup", () => {
  it("walks through setup and shows recovery codes exactly once", async () => {
    apiMock.mockImplementation(async (path: string) => path.endsWith("/start") ? { secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/x" } : { recoveryCodes: ["AAAAA-11111", "BBBBB-22222"] });
    const { SecuritySection } = await import("@/components/settings/security");
    render(<SecuritySection />);
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Set up two-step verification" }));
    expect((await screen.findByTestId("mfa-secret")).textContent).toBe("JBSWY3DPEHPK3PXP");
    await u.type(screen.getByLabelText("6-digit code from the app"), "123456");
    await u.click(screen.getByRole("button", { name: "Turn on" }));
    expect((await screen.findByTestId("recovery-codes")).textContent).toContain("AAAAA-11111");
    expect(screen.getByRole("alert").textContent).toMatch(/only once/);
    await u.click(screen.getByRole("button", { name: /I've saved them/ }));
    expect(screen.queryByTestId("recovery-codes")).toBeNull();
    expect(session.reload).toHaveBeenCalled();
  });
});
