// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignConfig, type StorefrontConfig } from "@convertflow/contracts";
import { renderFeed, sortFeed, type FeedItem } from "./feed";
import { boot } from "./index";

const cfg = (id: string, over: Record<string, unknown> = {}) => CampaignConfig.parse({
  schemaVersion: 1, name: id, tool: "feed", format: "feed_item", feed: {},
  creative: { headline: `Title ${id}`, body: `Body ${id}`, ctaLabel: "See it", ctaUrl: "/collections/new" },
  style: {}, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] }, frequency: {}, goal: { type: "clicks" }, ...over,
});
const item = (id: string, over: Record<string, unknown> = {}, publishedAt?: string): FeedItem => ({ campaignId: id, versionId: `${id}_v1`, config: cfg(id, over), publishedAt });

const root = () => document.querySelector("[data-convertflow][data-tool=feed]")!.shadowRoot!;
const bell = () => root().querySelector("button[aria-haspopup=dialog]") as HTMLButtonElement;
const panel = () => root().querySelector("[role=dialog]") as HTMLElement;
const titles = () => Array.from(root().querySelectorAll("li")).map((li) => li.textContent ?? "");

beforeEach(() => { document.body.innerHTML = ""; sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); window.ConvertFlow?.destroy?.(); });

describe("feed renderer", () => {
  it("shows nothing at all when there is nothing to show", () => {
    renderFeed(document, [], {});
    expect((document.querySelector("[data-convertflow]") as HTMLElement).style.display).toBe("none");
  });

  it("is a closed bell with an accessible name and an unread count; the panel is not announced until opened", () => {
    renderFeed(document, [item("a"), item("b")], { isRead: () => false });
    expect(bell().getAttribute("aria-label")).toBe("Notifications, 2 unread");
    expect(bell().getAttribute("aria-expanded")).toBe("false");
    expect(panel().style.display).toBe("none");
  });

  it("opening shows the cards, marks them read, clears the badge, and reports the items shown", () => {
    const read = new Set<string>();
    const onOpen = vi.fn();
    renderFeed(document, [item("a"), item("b")], { isRead: (v) => read.has(v), markRead: (ids) => ids.forEach((i) => read.add(i)), onOpen });
    bell().click();
    expect(bell().getAttribute("aria-expanded")).toBe("true");
    expect(titles().join("|")).toContain("Title a");
    expect(titles().join("|")).toContain("Title b");
    expect(titles().every((t) => /New/.test(t))).toBe(true); // they were unread when opened
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]![0]).toHaveLength(2);
    expect(read.size).toBe(2);
    expect(bell().getAttribute("aria-label")).toBe("Notifications"); // no unread left
  });

  it("an item that was already read is not marked New", () => {
    renderFeed(document, [item("a"), item("b")], { isRead: (v) => v === "a_v1" }, document.body, { open: true });
    const lis = Array.from(root().querySelectorAll("li"));
    expect(lis.find((l) => l.textContent!.includes("Title a"))!.textContent).not.toMatch(/New/);
    expect(lis.find((l) => l.textContent!.includes("Title b"))!.textContent).toMatch(/New/);
  });

  it("Escape closes the panel and returns focus to the bell; the close button does too", () => {
    renderFeed(document, [item("a")], {});
    bell().click();
    expect(root().activeElement).toBe(panel());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel().style.display).toBe("none");
    expect(root().activeElement).toBe(bell());
    bell().click();
    (root().querySelector("button[aria-label='Close notifications']") as HTMLButtonElement).click();
    expect(panel().style.display).toBe("none");
    expect(root().activeElement).toBe(bell());
  });

  it("a click outside closes it, a click inside does not", () => {
    renderFeed(document, [item("a")], {});
    const outside = document.createElement("button"); document.body.appendChild(outside);
    bell().click();
    panel().dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(panel().style.display).toBe("flex");
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(panel().style.display).toBe("none");
  });

  it("orders by the merchant's order, then newest, then id", () => {
    const ids = sortFeed([
      item("c", { feed: { order: 10 } }, "2026-01-01T00:00:00Z"),
      item("a", { feed: { order: 5 } }, "2026-01-01T00:00:00Z"),
      item("d", { feed: { order: 10 } }, "2026-03-01T00:00:00Z"),
      item("b", { feed: { order: 10 } }, "2026-03-01T00:00:00Z"),
    ]).map((i) => i.campaignId);
    expect(ids).toEqual(["a", "b", "d", "c"]);
  });

  it("renders copy as text, re-checks URLs, and skips unsafe images", () => {
    const evil = item("e", { creative: { headline: "<img src=x onerror=alert(1)>", body: "<b>b</b>", ctaLabel: "Go", ctaUrl: "/ok", imageUrl: "https://cdn.example.com/p.jpg" } });
    renderFeed(document, [evil], {}, document.body, { open: true });
    expect(root().querySelector("li b")).toBeNull();
    expect(titles()[0]).toContain("<img src=x onerror=alert(1)>");
    expect(root().querySelector("li img")!.getAttribute("src")).toBe("https://cdn.example.com/p.jpg");
    document.body.innerHTML = "";
    const bad = { ...evil, config: { ...evil.config, creative: { ...evil.config.creative, ctaUrl: "javascript:alert(1)", imageUrl: "javascript:alert(1)" } } };
    renderFeed(document, [bad], {}, document.body, { open: true });
    expect(root().querySelector("li img")).toBeNull();
    expect(root().querySelector("li a")!.getAttribute("href")).toBe("#");
  });

  it("shows the category, a formatted date, and a configured coupon code in the open", () => {
    renderFeed(document, [item("a", { feed: { category: "Offers" }, promotion: { code: "SAVE10", percentOff: 10 } }, "2026-10-01T12:00:00Z")], {}, document.body, { open: true });
    const t = titles()[0]!;
    expect(t).toContain("Offers");
    expect(t).toMatch(/2026/);
    expect(t).toContain("SAVE10");
    expect(t).toContain("10% off");
  });

  it("an item whose button is used is reported", () => {
    const onItemClick = vi.fn();
    renderFeed(document, [item("a")], { onItemClick }, document.body, { open: true });
    const a = root().querySelector("li a")!;
    a.addEventListener("click", (e) => e.preventDefault());
    (a as HTMLElement).click();
    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick.mock.calls[0]![0].campaignId).toBe("a");
  });

  it("re-reads the eligible items on open, so an item that expired meanwhile is gone", () => {
    const live = [item("a"), item("b")];
    renderFeed(document, live, { getItems: () => live.slice(0, 1) });
    bell().click();
    expect(titles()).toHaveLength(1);
    expect(titles()[0]).toContain("Title a");
  });

  it("hides itself if everything expires while it is open", () => {
    const h = renderFeed(document, [item("a")], {}, document.body, { open: true });
    h.update([]);
    expect((document.querySelector("[data-convertflow]") as HTMLElement).style.display).toBe("none");
    expect(h.isOpen).toBe(false);
  });

  it("destroy removes the UI and its document listeners", () => {
    const h = renderFeed(document, [item("a")], {}, document.body, { open: true });
    const remove = vi.spyOn(document, "removeEventListener");
    h.destroy();
    expect(document.querySelector("[data-convertflow]")).toBeNull();
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith("pointerdown", expect.any(Function), true);
  });

  it("positions the bell on the configured side", () => {
    renderFeed(document, [item("a", { feed: { position: "bottom_left" } })], {});
    expect(bell().style.left).toBe("16px");
    expect(bell().style.right).toBe("");
  });
});

describe("feed on the storefront", () => {
  const pub = (id: string, over: Record<string, unknown> = {}, publishedAt = "2026-10-20T00:00:00.000Z") => ({ campaignId: id, versionId: `${id}_v1`, config: cfg(id, over), publishedAt });
  const store = (...campaigns: ReturnType<typeof pub>[]): StorefrontConfig => ({ schemaVersion: 1, siteId: "cf_x", generatedAt: "2026-10-27T00:00:00.000Z", deliveryEnabled: true, campaigns });
  let posts: { events?: { type: string; campaignId?: string }[] }[];
  const types = () => posts.flatMap((p) => p.events?.map((e) => e.type) ?? []);
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

  async function start(c: StorefrontConfig, consent = true) {
    document.body.innerHTML = ""; localStorage.clear(); sessionStorage.clear();
    window.ConvertFlow = { consent };
    posts = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/sdk/v1/config/")) return new Response(JSON.stringify(c));
      posts.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(null, { status: 202 });
    }));
    const s = document.createElement("script"); s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
    boot(s); await wait();
  }
  const hasFeed = () => !!document.querySelector("[data-convertflow][data-tool=feed]") && (document.querySelector("[data-tool=feed]") as HTMLElement).style.display !== "none";

  it("appears for an eligible item, reports eligibility once, and counts each item opened once per session", async () => {
    await start(store(pub("a"), pub("b")));
    expect(hasFeed()).toBe(true);
    expect(types().filter((t) => t === "campaign_eligible")).toHaveLength(1);
    bell().click(); await wait();
    expect(types().filter((t) => t === "feed_open")).toHaveLength(2);
    bell().click(); bell().click(); await wait(); // close and reopen
    expect(types().filter((t) => t === "feed_open")).toHaveLength(2); // not inflated
  });

  it("is not shown for an item whose targeting does not match, or outside its schedule", async () => {
    await start(store(
      pub("a", { targeting: { match: "all", conditions: [{ field: "page_type", op: "in", value: ["cart"] }] } }),
      pub("b", { schedule: { endsAt: "2020-01-01T00:00:00Z" } }),
      pub("c", { schedule: { startsAt: "2099-01-01T00:00:00Z" } }),
    ));
    expect(hasFeed()).toBe(false);
  });

  it("is not affected by a toast on screen, nor does it suppress one", async () => {
    const toast = { campaignId: "t", versionId: "t_v1", config: CampaignConfig.parse({ schemaVersion: 1, name: "t", tool: "toast", format: "toast", toast: {}, creative: { headline: "Toast!", ctaLabel: "Go", ctaUrl: "/x" }, style: {}, trigger: { type: "immediate" }, targeting: { match: "all", conditions: [] }, frequency: {}, goal: { type: "clicks" } }) };
    await start(store(pub("a"), toast as never));
    expect(hasFeed()).toBe(true);
    expect(Array.from(document.querySelectorAll("[data-tool=toast]"))).toHaveLength(1);
  });

  it("unread state survives a reload with consent, and is only session-long without it", async () => {
    await start(store(pub("a")), true);
    expect(bell().getAttribute("aria-label")).toBe("Notifications, 1 unread");
    bell().click(); await wait();
    expect(localStorage.getItem("cf:feed:v1")).toContain("a_v1");
    window.ConvertFlow!.destroy!();
    document.body.innerHTML = "";
    window.ConvertFlow = { consent: true };
    const s = document.createElement("script"); s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
    boot(s); await wait();
    expect(bell().getAttribute("aria-label")).toBe("Notifications"); // already read

    await start(store(pub("a")), false);
    bell().click(); await wait();
    expect(localStorage.getItem("cf:feed:v1")).toBeNull(); // nothing persisted beyond the session
    expect(sessionStorage.getItem("cf:feed:v1")).toContain("a_v1");
    expect(posts).toHaveLength(0); // and nothing sent
  });

  it("a new item after a visit shows as unread again", async () => {
    await start(store(pub("a")), true);
    bell().click(); await wait();
    window.ConvertFlow!.destroy!();
    document.body.innerHTML = "";
    window.ConvertFlow = { consent: true };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/sdk/v1/config/") ? new Response(JSON.stringify(store(pub("a"), pub("b")))) : new Response(null, { status: 202 }))));
    localStorage.removeItem("cf:v1"); // drop the cached config so the new item is fetched
    const s = document.createElement("script"); s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
    boot(s); await wait();
    expect(bell().getAttribute("aria-label")).toBe("Notifications, 1 unread");
  });

  it("a click on an item is tracked and counts as the last click for purchase attribution", async () => {
    await start(store(pub("a")));
    bell().click(); await wait();
    const a = root().querySelector("li a")!;
    a.addEventListener("click", (e) => e.preventDefault());
    (a as HTMLElement).click(); await wait();
    expect(types()).toContain("feed_item_click");
    expect(JSON.parse(localStorage.getItem("cf:v1")!).lastClick.campaignId).toBe("a");
  });

  it("a failed config request shows nothing and does not throw", async () => {
    document.body.innerHTML = ""; localStorage.clear(); sessionStorage.clear();
    window.ConvertFlow = { consent: true };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    const s = document.createElement("script"); s.dataset["site"] = "cf_x"; s.dataset["api"] = "https://api.test";
    expect(() => boot(s)).not.toThrow();
    await wait();
    expect(document.querySelector("[data-convertflow]")).toBeNull();
  });

  it("goes away when the kill switch is thrown, and destroy removes it", async () => {
    await start({ ...store(pub("a")), deliveryEnabled: false });
    expect(hasFeed()).toBe(false);
    await start(store(pub("a")));
    expect(hasFeed()).toBe(true);
    window.ConvertFlow!.destroy!();
    expect(document.querySelector("[data-convertflow]")).toBeNull();
  });
});
