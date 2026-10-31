import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { starterDocument, type ChatEvent, type SiteDocument } from "@convertflow/store-builder";
import { ApiError } from "@/lib/api";
import type { SiteView } from "@/lib/builder";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams(""), usePathname: () => "/" }));

const save = vi.fn();
const streamChat = vi.fn();
vi.mock("@/lib/builder", async (orig) => {
  const real = await orig<typeof import("@/lib/builder")>();
  return {
    ...real,
    builder: { ...real.builder, save: (...a: unknown[]) => save(...a), get: vi.fn(async () => site()), messages: vi.fn(async () => []) },
    streamChat: (...a: unknown[]) => streamChat(...a),
  };
});

const { BuilderProvider, useBuilder } = await import("@/components/builder/state");
const { ChatPanel } = await import("@/components/builder/chat-panel");
const { Inspector } = await import("@/components/builder/inspector");

const doc = () => starterDocument({ name: "Ember & Oak", currency: "USD" });
function site(over: Partial<SiteView> = {}): SiteView {
  return {
    id: "site_1", organizationId: "o1", name: "Ember & Oak", slug: "ember-and-oak", status: "draft", revision: 3, draft: doc(), publishedVersionId: null, publishedAt: null,
    prompt: null, notifyEmail: null, paymentsConnected: false, role: "owner", busy: false, ai: { chat: true, images: true, model: "workers-ai/@cf/meta/llama" },
    usage: { messages: { used: 2, limit: 30 }, images: { used: 0, limit: 24 } }, updatedAt: "2026-10-29T00:00:00Z", ...over,
  };
}

let probe: ReturnType<typeof useBuilder> | null = null;
function Probe() { probe = useBuilder(); return null; }

function mount(s: SiteView = site()) {
  return render(<BuilderProvider initial={s} initialMessages={[]}><Probe /><ChatPanel /><Inspector /></BuilderProvider>);
}
const heading = (d: SiteDocument) => (d.pages[0]!.sections[0] as { heading: string }).heading;

beforeEach(() => {
  save.mockReset(); streamChat.mockReset(); probe = null;
  save.mockImplementation(async (_id: string, d: SiteDocument, revision: number) => ({ revision: revision + 1, draft: d }));
  try { sessionStorage.clear(); } catch { /* jsdom */ }
});

describe("builder chat", () => {
  it("streams the reply, applies the AI's document live, and sends the selected section", async () => {
    streamChat.mockImplementation(async (_id: string, body: { message: string; selection: unknown }, onEvent: (e: ChatEvent) => void) => {
      const next = doc();
      (next.pages[0]!.sections[0] as { heading: string }).heading = "Evenings, slowed down";
      onEvent({ type: "start", mode: "edit", userMessage: { id: "m1", role: "user", content: body.message, createdAt: "2026-10-29T00:00:00Z" } });
      onEvent({ type: "delta", text: "Made it " });
      onEvent({ type: "delta", text: "punchier." });
      onEvent({ type: "doc", doc: next, revision: 4 });
      onEvent({ type: "done", revision: 4, usage: { used: 3, limit: 30 }, message: { id: "m2", role: "assistant", content: "Made it punchier.", createdAt: "2026-10-29T00:00:01Z", changes: [{ summary: "Edited hero", target: "hero" }], versionId: "ver_1", suggestions: ["Add a gift guide"] } });
    });
    mount();
    act(() => probe!.select("hero"));
    await userEvent.type(screen.getByLabelText("Message the AI designer"), "Make this punchier{Enter}");

    await screen.findByText("Edited hero");
    expect(streamChat.mock.calls[0]![1]).toMatchObject({ message: "Make this punchier", selection: { sectionId: "hero" }, mode: "auto" });
    expect(heading(probe!.doc)).toBe("Evenings, slowed down");
    expect(screen.getByRole("button", { name: "Add a gift guide" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Restore this version/ })).toBeTruthy();
    // One undo step reverts the whole AI turn.
    act(() => probe!.undo());
    expect(heading(probe!.doc)).toBe("Ember & Oak");
  });

  it("explains why chat is unavailable instead of failing", () => {
    mount(site({ ai: { chat: false, images: false, model: null } }));
    expect(screen.getByRole("status").textContent).toMatch(/isn't configured/);
    expect((screen.getByLabelText("Message the AI designer") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("starts building straight away for a store created from a prompt, once", async () => {
    streamChat.mockResolvedValue(undefined);
    const { unmount } = mount(site({ prompt: "A candle shop with autumn vibes" }));
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(1));
    expect(streamChat.mock.calls[0]![1]).toMatchObject({ message: "A candle shop with autumn vibes", mode: "build" });
    unmount();
    mount(site({ prompt: "A candle shop with autumn vibes" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(streamChat).toHaveBeenCalledTimes(1);
  });
});

describe("builder editing", () => {
  it("edits a section from the inspector, autosaves with the revision, and undoes", async () => {
    save.mockImplementation(async (_id: string, d: SiteDocument, revision: number) => ({ revision: revision + 1, draft: d }));
    mount();
    act(() => probe!.select("hero"));
    const input = await screen.findByLabelText(/^Heading/);
    await userEvent.clear(input);
    await userEvent.type(input, "Light the room ");
    // The trailing space survives while typing even though the stored text is trimmed.
    expect((input as HTMLInputElement).value).toBe("Light the room ");
    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 3000 });
    const [, sent, revision] = save.mock.calls.at(-1)! as [string, SiteDocument, number];
    expect(heading(sent)).toBe("Light the room");
    expect(revision).toBe(3);
    await waitFor(() => expect(probe!.saveState).toBe("saved"), { timeout: 3000 });
    act(() => probe!.undo());
    expect(heading(probe!.doc)).toBe("Ember & Oak");
  });

  it("reports a conflict when someone else saved first", async () => {
    save.mockRejectedValue(new ApiError(409, "stale_revision", "changed"));
    mount();
    act(() => { probe!.apply([{ op: "set_brand", brand: { tagline: "New" } }]); });
    await waitFor(() => expect(probe!.saveState).toBe("conflict"), { timeout: 3000 });
  });

  it("hides and deletes sections from the inspector", async () => {
    save.mockImplementation(async (_id: string, d: SiteDocument, revision: number) => ({ revision: revision + 1, draft: d }));
    mount();
    act(() => probe!.select("newsletter"));
    await userEvent.click(await screen.findByRole("button", { name: "Hide section" }));
    expect(probe!.doc.pages[0]!.sections.find((s) => s.id === "newsletter")!.hidden).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete section" }));
    expect(probe!.doc.pages[0]!.sections.some((s) => s.id === "newsletter")).toBe(false);
    expect(probe!.selectedId).toBeNull();
  });
});
