import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignConfig, SHIPPED_TOOLS } from "@convertflow/contracts";
import type { Store } from "@/lib/api";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }), useSearchParams: () => new URLSearchParams(""), usePathname: () => "/" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const apiMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));
// The preview renders through the real SDK renderer; that is covered by the SDK and e2e suites.
vi.mock("@/components/campaign-preview", () => ({ CampaignPreview: () => <div data-testid="preview" /> }));

const store: Store = { id: "sto_1", name: "Shop", platform: "custom", domain: "shop.example.com", siteKey: "cf_key", currency: "EUR", deliveryEnabled: true, organizationId: "o1" };
const catalog = [
  { id: "prd_1", externalId: "shoe", title: "Running shoe", url: null, handle: "shoe", imageUrl: null },
  { id: "prd_2", externalId: "sock", title: "Trail socks", url: null, handle: "sock", imageUrl: null },
];

let products: unknown[] = catalog;
beforeEach(() => {
  apiMock.mockReset(); replace.mockReset(); products = catalog;
  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    if (path.endsWith("/products")) return products;
    if (path.endsWith("/integration")) return { maxDiscountPercent: null };
    if (path.endsWith("/relationships") && !init?.method) return [];
    if (init?.method === "POST" && path.endsWith("/campaigns")) return { id: "cmp_1", name: "x", tool: "upsell", status: "draft", draftConfig: init.body, publishedVersionId: null, updatedAt: "2026-10-27T00:00:00Z" };
    return undefined;
  });
});

const open = async () => {
  const { CampaignEditor } = await import("@/components/campaign-editor");
  render(<CampaignEditor store={store} tool="upsell" />);
  return userEvent.setup();
};
const savedBody = () => apiMock.mock.calls.find((c) => c[1]?.method === "POST" && String(c[0]).endsWith("/campaigns"))?.[1].body;
const save = async (u: ReturnType<typeof userEvent.setup>) => { await u.click(screen.getByRole("button", { name: "Create draft" })); await waitFor(() => expect(savedBody()).toBeTruthy()); return savedBody(); };

describe("upsell editor", () => {
  it("starts from a valid product-page block and hides what does not apply to it", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "Recommendations" })).toBeTruthy();
    expect(screen.queryByLabelText("Format")).toBeNull(); // fixed by the tool
    expect(screen.queryByLabelText("Button link")).toBeNull(); // the button adds to cart, it does not link
    expect(screen.getByLabelText("Add button label")).toBeTruthy();
    expect(screen.queryByLabelText("Trigger")).toBeNull(); // an inline block is part of the page, not triggered
    expect(screen.queryByLabelText("Max per session")).toBeNull();
    expect(screen.queryByLabelText("Placement")).not.toBeNull(); // the recommendation placement (not the popup placement)
    expect(screen.queryByRole("heading", { name: "Discount code (optional)" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Featured products (optional)" })).toBeNull();
  });

  it("is a shipped tool, so the editor can be reached from its page", () => {
    expect(SHIPPED_TOOLS.has("upsell")).toBe(true);
  });

  it("saves a config the real contract accepts, tagged as the upsell tool and aimed at product pages", async () => {
    const u = await open();
    const body = await save(u);
    expect(body).toMatchObject({ tool: "upsell", format: "recommendation", goal: { type: "add_to_cart" }, recommend: { source: "same_collection", placement: "product_page", layout: "row", maxProducts: 3, addToCart: true, showPrice: true } });
    expect(body.targeting.conditions).toEqual([{ field: "page_type", op: "in", value: ["product"] }]);
    expect(CampaignConfig.safeParse(body).success).toBe(true);
  });

  it("offers every source with an explanation, and switching sources asks for what that source needs", async () => {
    const u = await open();
    const which = screen.getByLabelText("Which products") as HTMLSelectElement;
    expect(Array.from(which.options).map((o) => o.value)).toEqual(["same_collection", "manual", "complements", "shipping_threshold", "alternatives"]);

    await u.selectOptions(which, "shipping_threshold");
    const threshold = screen.getByLabelText("Free-shipping threshold (EUR)") as HTMLInputElement;
    expect(threshold.value).toBe("75");
    await u.clear(threshold); await u.type(threshold, "99");
    expect((await save(u)).recommend).toMatchObject({ source: "shipping_threshold", freeShippingThreshold: 99 });
  });

  it("drops the threshold when the source changes away from it", async () => {
    const u = await open();
    await u.selectOptions(screen.getByLabelText("Which products"), "shipping_threshold");
    await u.selectOptions(screen.getByLabelText("Which products"), "complements");
    expect(screen.queryByLabelText("Free-shipping threshold (EUR)")).toBeNull();
    expect((await save(u)).recommend).not.toHaveProperty("freeShippingThreshold");
  });

  it("blocks saving 'products I pick' until something is picked, then saves catalog ids", async () => {
    const u = await open();
    await u.selectOptions(screen.getByLabelText("Which products"), "manual");
    await waitFor(() => expect(within(screen.getByLabelText("Add a recommended product")).getByText("Running shoe")).toBeTruthy());
    expect((screen.getByRole("button", { name: "Create draft" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Pick at least one product/)).toBeTruthy();
    await u.selectOptions(screen.getByLabelText("Add a recommended product"), "sock");
    await u.selectOptions(screen.getByLabelText("Add a recommended product"), "shoe");
    await u.selectOptions(screen.getByLabelText("Add a recommended product"), "sock"); // a duplicate is ignored
    expect(screen.getByRole("button", { name: "Remove Trail socks" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Remove (Trail socks|Running shoe)$/ })).toHaveLength(2); // the duplicate was not added
    expect((await save(u)).recommend.productIds).toEqual(["sock", "shoe"]); // in the order picked
  });

  it("collections are optional and saved as a clean list", async () => {
    const u = await open();
    await u.type(screen.getByLabelText("Collections"), "run, ,kids ,");
    expect((await save(u)).recommend.collectionIds).toEqual(["run", "kids"]);
  });

  it("changing where it goes retargets an untouched rule and gives a toast a trigger", async () => {
    const u = await open();
    await u.selectOptions(screen.getByLabelText("Placement"), "cart");
    expect(screen.queryByLabelText("Trigger")).toBeNull(); // still inline
    await u.selectOptions(screen.getByLabelText("Placement"), "toast");
    expect(screen.getByLabelText("Trigger")).toBeTruthy(); // a toast is triggered
    expect((screen.getByLabelText("Layout") as HTMLSelectElement).disabled).toBe(true); // a toast always shows a list
    expect(screen.getByLabelText("Max per session")).toBeTruthy(); // and is capped like any toast
    const body = await save(u);
    expect(body.recommend.placement).toBe("toast");
    expect(body.targeting.conditions).toEqual([]);
    expect(body.trigger).toEqual({ type: "delay", seconds: 5 });
    expect(CampaignConfig.safeParse(body).success).toBe(true);
  });

  it("does not overwrite targeting the merchant customised when the placement changes", async () => {
    const u = await open();
    await u.selectOptions(screen.getByLabelText("Add rule"), "device");
    await u.selectOptions(screen.getByLabelText("Placement"), "cart");
    const conds = (await save(u)).targeting.conditions;
    expect(conds).toHaveLength(2); // the product-page rule and the device rule are both still there
  });

  it("warns about a cart block with no cart targeting, a custom store without an add-to-cart function, and an empty catalog", async () => {
    products = [];
    const u = await open();
    await u.selectOptions(screen.getByLabelText("Placement"), "cart");
    await u.selectOptions(screen.getByLabelText("Which products"), "alternatives");
    await waitFor(() => expect(screen.getByText(/catalog is empty/i)).toBeTruthy());
    expect(screen.getByText(/ConvertFlow\.addToCart/)).toBeTruthy();
    expect(screen.getByText(/only show on a product your catalog says is out of stock/i)).toBeTruthy();
    // the placement change kept a page-type rule, so the cart warning does not fire here
    expect(screen.queryByText(/cart block should target/i)).toBeNull();
    await u.click(screen.getByRole("tab", { name: "Targeting" }));
    await u.click(screen.getAllByRole("button", { name: "Remove rule" })[0]!);
    expect(screen.getByText(/cart block should target the cart page/i)).toBeTruthy();
  });

  it("layout, count, price and add-to-cart choices are saved", async () => {
    const u = await open();
    await u.selectOptions(screen.getByLabelText("Layout"), "grid");
    const count = screen.getByLabelText("How many (1–6)");
    await u.clear(count); await u.type(count, "5");
    await u.click(screen.getByRole("checkbox", { name: "Show prices" }));
    await u.click(screen.getByRole("checkbox", { name: "Let shoppers add to cart from here" }));
    expect((await save(u)).recommend).toMatchObject({ layout: "grid", maxProducts: 5, showPrice: false, addToCart: false });
  });
});

describe("product links", () => {
  const setup = async (links: unknown[] = []) => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path.endsWith("/products")) return catalog;
      if (path.endsWith("/relationships") && !init?.method) return links;
      if (init?.method === "POST") return { id: "rel_1", created: true };
      return undefined;
    });
    const { ProductLinks } = await import("@/components/product-links");
    render(<ProductLinks store={store} />);
    return userEvent.setup();
  };
  const link = { id: "rel_9", kind: "complement", weight: 4, product: { id: "shoe", title: "Running shoe" }, related: { id: "sock", title: "Trail socks" } };

  it("lists existing links with their relationship and weight", async () => {
    await setup([link]);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Running shoe")).toBeTruthy();
    expect(within(table).getByText("Goes well with")).toBeTruthy();
    expect(within(table).getByText("Trail socks")).toBeTruthy();
    expect(within(table).getByText("4")).toBeTruthy();
  });

  it("adds a link between two different products", async () => {
    const u = await setup();
    await waitFor(() => expect(screen.getByLabelText("Product")).toBeTruthy());
    const add = screen.getByRole("button", { name: "Add link" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true); // nothing chosen yet
    await u.selectOptions(screen.getByLabelText("Product"), "shoe");
    await waitFor(() => expect(within(screen.getByLabelText("Other product")).queryByText("Running shoe")).toBeNull()); // a product cannot be linked to itself
    await u.selectOptions(screen.getByLabelText("Relationship"), "alternative");
    await u.selectOptions(screen.getByLabelText("Other product"), "sock");
    await u.click(add);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/stores/sto_1/relationships", { method: "POST", body: { productId: "shoe", relatedProductId: "sock", kind: "alternative", weight: 0 } }));
  });

  it("removes a link", async () => {
    const u = await setup([link]);
    await u.click(await screen.findByRole("button", { name: /Remove link from Running shoe to Trail socks/ }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/stores/sto_1/relationships/rel_9", { method: "DELETE" }));
  });

  it("says what to do when the catalog has too few products", async () => {
    apiMock.mockImplementation(async (path: string) => (path.endsWith("/products") ? [catalog[0]] : []));
    const { ProductLinks } = await import("@/components/product-links");
    render(<ProductLinks store={store} />);
    expect(await screen.findByText(/Import at least two products/)).toBeTruthy();
  });
});
