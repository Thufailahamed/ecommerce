import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { applyOps, starterDocument, type SiteDocument } from "@convertflow/store-builder";
import { Storefront, type StorefrontProps } from "@/components/storefront/storefront";

// next/font only works under the Next compiler.
vi.mock("@/components/storefront/fonts", () => ({ storefrontFontClass: "", fontVar: () => "sans-serif" }));

function buildDoc(): SiteDocument {
  const { doc, failed } = applyOps(starterDocument({ name: "Ember & Oak", tagline: "Small-batch candles." }), [
    { op: "add_collection", collection: { title: "Candles", description: "Hand-poured." } },
    { op: "add_product", product: { title: "Cedar Smoke Candle", price: 34, description: "Woody.", collection: "candles", featured: true } },
    { op: "add_product", product: { title: "Fig Leaf Candle", price: 32, featured: true, options: [{ name: "Size", values: ["8oz", "12oz"] }] } },
    { op: "add_section", page: "home", section: { type: "testimonials", heading: "Kind words", items: [{ quote: "The best candle I own.", author: "Sam" }], sample: true } },
  ]);
  expect(failed).toEqual([]);
  return doc;
}

const doc = buildDoc();
const renderStore = (props: Partial<StorefrontProps> = {}) =>
  render(<Storefront doc={doc} path="/" mode="preview" basePath="" assetBase="https://api.test/assets" {...props} />);

beforeEach(() => { window.localStorage.clear(); });

describe("Storefront", () => {
  it("renders the home page hero", () => {
    renderStore();
    expect(screen.getByRole("heading", { level: 1, name: "Ember & Oak" })).toBeTruthy();
    expect(screen.getAllByText("Cedar Smoke Candle").length).toBeGreaterThan(0);
  });

  it("hides sample testimonials on the live store but shows them in preview", () => {
    const live = renderStore({ mode: "live", basePath: "/s/ember", slug: "ember", apiUrl: "https://api.test" });
    expect(screen.queryByText("The best candle I own.")).toBeNull();
    live.unmount();

    renderStore({ mode: "preview" });
    expect(screen.getByText("The best candle I own.")).toBeTruthy();
    expect(screen.getByText(/sample quotes/i)).toBeTruthy();
  });

  it("requires every option before adding to cart, and the header count follows the cart", () => {
    renderStore({ path: "/products/fig-leaf-candle" });
    expect(screen.getByRole("heading", { level: 1, name: "Fig Leaf Candle" })).toBeTruthy();
    const add = screen.getByRole<HTMLButtonElement>("button", { name: "Add to cart" });
    expect(add.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Cart, 0 items" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "12oz" }));
    expect(add.disabled).toBe(false);
    fireEvent.click(add);

    expect(screen.getByRole("button", { name: "Cart, 1 item" })).toBeTruthy();
    const drawer = screen.getByRole("dialog", { name: /your cart/i });
    expect(within(drawer).getByText("Size: 12oz")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("sf-cart:preview") ?? "[]")).toEqual([{ productId: expect.any(String), quantity: 1, options: { Size: "12oz" } }]);
  });

  it("selects sections in edit mode instead of following their links", () => {
    const onSelectSection = vi.fn();
    const onNavigate = vi.fn();
    renderStore({ mode: "edit", onSelectSection, onNavigate });

    fireEvent.click(screen.getByRole("link", { name: "Shop now" }));
    expect(onSelectSection).toHaveBeenCalledWith("hero", "home");
    expect(onNavigate).not.toHaveBeenCalled();

    // Header navigation still moves between pages in the editor.
    const nav = screen.getByRole("navigation", { name: "Main" });
    fireEvent.click(within(nav).getByRole("link", { name: "About" }));
    expect(onNavigate).toHaveBeenCalledWith("/about");
  });

  it("never renders markup from document text", () => {
    const dir = join(import.meta.dirname, "../components/storefront");
    for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f))) {
      expect(readFileSync(join(dir, file), "utf8"), file).not.toContain("dangerouslySetInnerHTML");
    }
  });
});
