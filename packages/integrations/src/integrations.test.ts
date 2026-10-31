import { describe, expect, it } from "vitest";
import { normalizeBigCommerceProduct, normalizeShopifyProduct, normalizeWooProduct, normalizeWooVariation, isWooVariable, wooOrderFacts, parseCsv, productsFromCsv } from "./index";

describe("shopify", () => {
  it("maps availability honestly", () => {
    const p = normalizeShopifyProduct({
      id: 1, title: "Shoe", handle: "shoe", status: "active", image: { src: "https://cdn/x.png" },
      variants: [
        { id: 10, price: "99.00", inventory_management: "shopify", inventory_quantity: 3 },
        { id: 11, inventory_management: "shopify", inventory_quantity: 0 },
        { id: 12, inventory_management: "shopify" },
        { id: 13, inventory_management: null },
        { id: 14, inventory_management: "shopify", inventory_quantity: 0, inventory_policy: "continue" },
      ],
    })!;
    expect(p.url).toBe("/products/shoe");
    expect(p.variants.map((v) => v.available)).toEqual([true, false, undefined, true, true]);
    expect(p.variants[0]?.price).toBe(99);
  });
  it("rejects malformed payloads", () => {
    expect(normalizeShopifyProduct({})).toBeNull();
    expect(normalizeShopifyProduct("x")).toBeNull();
  });
});

describe("woocommerce", () => {
  it("maps stock_status and path", () => {
    const p = normalizeWooProduct({ id: 5, name: "Mug", status: "publish", permalink: "https://s.com/product/mug/", stock_status: "outofstock", price: "12", categories: [{ id: 3 }] })!;
    expect(p.url).toBe("/product/mug/");
    expect(p.variants[0]).toEqual({ externalId: "5", price: 12, available: false });
    expect(p.collectionIds).toEqual(["3"]);
    expect(normalizeWooProduct({ id: 6, name: "X", stock_status: "onbackorder" })!.variants[0]?.available).toBeUndefined();
  });

  it("variable products take their variants from the variations, never from the parent", () => {
    const parent = { id: 9, name: "Tee", type: "variable", status: "publish", price: "", stock_status: "instock" };
    const p = normalizeWooProduct(parent, [
      { id: 91, status: "publish", price: "20", stock_status: "instock", attributes: [{ name: "Size", option: "S" }, { name: "Colour", option: "Red" }] },
      { id: 92, status: "publish", price: "22", stock_status: "outofstock", attributes: [{ name: "Size", option: "M" }] },
      { id: 93, status: "private", price: "22", stock_status: "instock", attributes: [] }, // disabled: cannot be bought
    ])!;
    expect(isWooVariable(parent)).toBe(true);
    expect(p.variants).toEqual([{ externalId: "91", title: "S / Red", price: 20, available: true }, { externalId: "92", title: "M", price: 22, available: false }]);
    // Variations not fetched: no invented variant, so stock already known is left alone.
    expect(normalizeWooProduct(parent)!.variants).toEqual([]);
    expect(normalizeWooVariation({ status: "publish" })).toBeNull();
  });

  it("order facts: id, total, currency and UTC time only; drafts and failed orders are not purchases", () => {
    const o = { id: 1201, status: "processing", total: "59.90", currency: "eur", date_created_gmt: "2026-10-27T10:00:00", billing: { email: "x@example.com" } };
    expect(wooOrderFacts(o)).toEqual({ externalOrderId: "1201", total: 59.9, currency: "EUR", placedAt: "2026-10-27T10:00:00.000Z" });
    expect(JSON.stringify(wooOrderFacts(o))).not.toContain("example.com");
    for (const status of ["checkout-draft", "failed", "cancelled"]) expect(wooOrderFacts({ ...o, status }), status).toBeNull();
    expect(wooOrderFacts({ ...o, currency: "" })).toBeNull();
    expect(wooOrderFacts({ ...o, date_created_gmt: undefined })?.placedAt).toBeNull();
  });
});

describe("bigcommerce", () => {
  it("maps tracking and visibility", () => {
    expect(normalizeBigCommerceProduct({ id: 1, name: "A", inventory_tracking: "product", inventory_level: 0, is_visible: false })).toMatchObject({ status: "draft", variants: [{ available: false }] });
    expect(normalizeBigCommerceProduct({ id: 2, name: "B", inventory_tracking: "none", availability: "available", custom_url: { url: "/b/" } })).toMatchObject({ url: "/b/", variants: [{ available: true }] });
  });
});

describe("csv", () => {
  it("parses quotes, commas, CRLF and BOM", () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
  });
  it("imports products and reports bad rows", () => {
    const r = productsFromCsv("﻿id,Title,price,available,collections\n1,Shoe,99,yes,a|b\n,NoId,1,,\n2,Hat,,maybe,\n");
    expect(r.products).toHaveLength(2);
    expect(r.products[0]).toMatchObject({ externalId: "1", collectionIds: ["a", "b"], variants: [{ price: 99, available: true }] });
    expect(r.products[1]?.variants[0]?.available).toBeUndefined();
    expect(r.errors).toEqual(["Row 3: missing id or title"]);
    expect(productsFromCsv("foo\n1").errors[0]).toMatch(/id/);
  });
});
