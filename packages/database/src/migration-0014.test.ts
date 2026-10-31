import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../migrations");
const statements = (file: string) => readFileSync(join(DIR, file), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const T = "2026-10-29T00:00:00Z";
const rejects = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };

async function upTo(last: string) {
  const c = createClient({ url: ":memory:" });
  await c.execute("PRAGMA foreign_keys = ON");
  for (const f of ALL.filter((x) => x <= `${last}~`)) for (const s of statements(f)) await c.execute(s);
  return c;
}
const apply = async (c: Awaited<ReturnType<typeof upTo>>, file: string) => { for (const s of statements(file)) await c.execute(s); };

describe("migration 0014: Shopify storefront setup and WooCommerce connections", () => {
  it("follows 0013", () => {
    expect(ALL.find((f) => f.startsWith("0014"))).toBe("0014_platform_connections.sql");
  });

  it("keeps existing Shopify installs, with no pixel or metafields recorded yet", async () => {
    const c = await upTo("0013");
    await c.execute(`insert into shopify_installations (id,shop,status,scopes,installed_at,updated_at) values ('i1','s.myshopify.com','installed','read_products','${T}','${T}')`);
    await apply(c, "0014_platform_connections.sql");
    const [row] = (await c.execute("select shop, status, web_pixel_id, app_metafields_set_at, setup_error from shopify_installations")).rows;
    expect(row).toMatchObject({ shop: "s.myshopify.com", status: "installed", web_pixel_id: null, app_metafields_set_at: null, setup_error: null });
  });

  it("one WooCommerce connection per store, removed with the store, with safe defaults", async () => {
    const c = await upTo("0014");
    await c.execute(`insert into organizations (id,name,created_at) values ('o1','A','${T}')`);
    await c.execute(`insert into stores (id,organization_id,platform,name,domain,external_id,site_key,created_at,updated_at) values ('st1','o1','woocommerce','W','w.example.com','w.example.com','cf_aaaaaaaaaaaa','${T}','${T}')`);
    const ins = (id: string) => c.execute(`insert into woocommerce_connections (id,store_id,method,encrypted_webhook_secret,connected_at,updated_at) values ('${id}','st1','authorize','enc','${T}','${T}')`);
    await ins("w1");
    expect(await rejects(ins("w2"))).toBe(true);
    const [row] = (await c.execute("select webhook_ids, webhook_state, verified_at from woocommerce_connections")).rows;
    expect(row).toMatchObject({ webhook_ids: "[]", webhook_state: "pending", verified_at: null });
    await c.execute("delete from stores where id='st1'");
    expect((await c.execute("select count(*) as n from woocommerce_connections")).rows[0]?.["n"]).toBe(0);
  });
});
