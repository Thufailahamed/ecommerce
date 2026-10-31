import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { validateWorkflowDefinition } from "@convertflow/contracts";
import type { Store } from "@/lib/api";
import { WORKFLOW_PRESETS, describeWorkflow } from "@/lib/workflows";

const apiMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));
const store: Store = { id: "sto_1", name: "Shop", platform: "custom", domain: "s.example.com", siteKey: "cf_key", currency: "USD", deliveryEnabled: true, organizationId: "o1" };
let role = "admin";
vi.mock("@/lib/session", () => ({
  useSession: () => ({ store }),
  useStoreRole: () => role,
}));

const { default: AutomationsPage } = await import("@/app/app/automations/page");
const { default: ManagerPage } = await import("@/app/app/manager/page");

const pending = (over: Record<string, unknown> = {}) => ({
  id: "arq_1", action: "campaign.pause", input: { campaignId: "cmp_1" }, origin: "ai", status: "pending", rationale: "It had 1200 impressions but only 48 clicks.",
  evidence: { range: { from: "2026-09-28", to: "2026-10-27" }, metrics: [{ key: "ctr", label: "Click-through rate", kind: "observed", value: 0.04 }] },
  sideEffects: "live", planId: "pln_1", error: null, expiresAt: "2026-10-30T12:00:00Z", createdAt: "2026-10-27T12:00:00Z", ...over,
});

describe("workflow presets", () => {
  it("are all accepted by the server's validator, and read back in words from the registries", () => {
    for (const p of WORKFLOW_PRESETS) expect(validateWorkflowDefinition(p.definition).ok, p.key).toBe(true);
    const v = validateWorkflowDefinition(WORKFLOW_PRESETS[1]!.definition);
    expect(v.ok && describeWorkflow(v.definition)).toEqual(["When campaign.paused happens", expect.stringMatching(/^Then: Ask a merchant.*\(waits for a merchant\)$/)]);
  });
});

describe("automations page", () => {
  const v = validateWorkflowDefinition(WORKFLOW_PRESETS[0]!.definition);
  const draftDefinition = v.ok ? v.definition : null;
  beforeEach(() => {
    role = "admin";
    apiMock.mockReset();
    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith("/workflows")) return [{ id: "wfl_1", name: "Note large orders", status: "draft", draftDefinition, activeVersionId: null, updatedAt: "2026-10-27T11:00:00.000Z" }];
      if (path.includes("/action-requests")) return [];
      return undefined;
    });
  });

  it("shows the definition in words before activating, and activates exactly the reviewed version", async () => {
    render(<AutomationsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Review and activate" }));
    expect(screen.getByText("When order.created happens")).toBeTruthy();
    expect(screen.getByText("If the order total is at least 200")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/stores/sto_1/workflows/wfl_1/activate", { method: "POST", body: { approve: true, approvedUpdatedAt: "2026-10-27T11:00:00.000Z" } }));
  });

  it("hides management controls from members who cannot manage workflows", async () => {
    role = "editor";
    render(<AutomationsPage />);
    expect(await screen.findByText("Note large orders")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review and activate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New workflow" })).toBeNull();
  });

  it("shows the server's validation issues when a draft is rejected", async () => {
    const { ApiError } = await import("@/lib/api");
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (init?.method === "POST") throw new ApiError(422, "invalid_workflow", "Workflow is invalid", ["actions.0.action: unknown action sql.run"]);
      return [];
    });
    render(<AutomationsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "New workflow" }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("actions.0.action: unknown action sql.run")).toBeTruthy();
  });
});

describe("AI manager page", () => {
  beforeEach(() => {
    role = "editor";
    apiMock.mockReset();
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith("/ai/plans")) return { planId: "pln_1", interpretation: "Fewer interruptions", requestIds: ["arq_1"], stale: true, discarded: [{ action: "note.record", reasons: ["note.record cannot be used by the AI"] }], evidence: { range: { from: "2026-09-28", to: "2026-10-27" }, latestDay: "2026-10-20" } };
      if (path.includes("/approve") && init?.method === "POST") return { status: "executed" };
      if (path.includes("/action-requests")) return [pending()];
      return undefined;
    });
  });

  it("sends the objective, reports what was queued, discarded and how old the figures are", async () => {
    render(<ManagerPage />);
    const button = screen.getByRole("button", { name: "Propose actions" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("What would you like to improve?"), "Fewer interruptions for new visitors");
    await userEvent.click(button);
    expect(await screen.findByText("Fewer interruptions")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith("/api/v1/stores/sto_1/ai/plans", { method: "POST", body: { objective: "Fewer interruptions for new visitors" } });
    expect(screen.getByText(/1 proposal queued/)).toBeTruthy();
    expect(screen.getByText(/more than three days old \(latest: 2026-10-20\)/)).toBeTruthy();
    expect(screen.getByText("1 discarded by the platform's checks")).toBeTruthy();
  });

  it("describes a proposal from the registry with its evidence and effect, and approves it on request", async () => {
    render(<ManagerPage />);
    expect(await screen.findByText("Pause a live campaign (cmp_1)")).toBeTruthy();
    expect(screen.getByText("4.0%")).toBeTruthy();
    expect(screen.getByText("Changes the storefront")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/stores/sto_1/action-requests/arq_1/approve", { method: "POST", body: {} }));
    expect(await screen.findByText("Approved and done.")).toBeTruthy();
  });

  it("offers no Approve button to a member whose role could not do the action by hand", async () => {
    role = "viewer";
    render(<ManagerPage />);
    expect(await screen.findByText("Needs campaigns.write")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
