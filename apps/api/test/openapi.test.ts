import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { documentedRoutes } from "../src/openapi.js";
import { makeEnv } from "./helpers.js";

describe("OpenAPI document", () => {
  it("documents exactly the routes the server serves (no drift in either direction)", async () => {
    const env = await makeEnv();
    const app = createApp(env.deps, { allowedOrigin: "http://localhost:3000", secureCookies: false });
    const real = new Set(app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`));
    const docs = new Set(documentedRoutes());
    expect([...real].filter((r) => !docs.has(r)).sort(), "served but undocumented").toEqual([]);
    expect([...docs].filter((r) => !real.has(r)).sort(), "documented but not served").toEqual([]);
  });
  it("is served publicly, is valid-looking OpenAPI 3.1, and reuses the real request schemas", async () => {
    const env = await makeEnv();
    const res = await env.app.request("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    const doc = await res.json() as { openapi: string; paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: { properties?: Record<string, unknown> } }> }; security: unknown[]; "x-minimum-role"?: string }>> };
    expect(doc.openapi).toBe("3.1.0");
    const create = doc.paths["/api/v1/stores/{storeId}/campaigns"]?.["post"];
    expect(create?.requestBody?.content["application/json"]?.schema.properties).toHaveProperty("creative");
    expect(create?.["x-minimum-role"]).toBe("editor");
    expect(create?.security).toEqual([{ sessionCookie: [] }]);
    expect(doc.paths["/api/v1/events/batch"]?.["post"]?.security).toEqual([]);
    expect(doc.paths["/api/v1/webhooks/stripe"]?.["post"]?.security).toEqual([{ webhookSignature: [] }]);
    // path params are declared for every templated path
    for (const [p, ops] of Object.entries(doc.paths)) {
      const names = [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const op of Object.values(ops)) expect((op as { parameters?: { name: string }[] }).parameters?.map((x) => x.name) ?? []).toEqual(names);
    }
  });
});
