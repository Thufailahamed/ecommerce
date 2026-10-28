import { describe, expect, it } from "vitest";
import { normalizeBigCommerceProduct, normalizeShopifyProduct, normalizeWooProduct, parseCsv, productsFromCsv } from "./index";

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
