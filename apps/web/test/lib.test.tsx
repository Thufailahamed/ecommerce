import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { api, ApiError } from "@/lib/api";
import { int, isoDay, pct, useApi } from "@/lib/use-api";
import { BRAND, BRAND_FULL } from "@/lib/brand";

const respond = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })));

describe("api client", () => {
  it("unwraps { data } and sends credentials", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: { ok: 1 } })));
    vi.stubGlobal("fetch", f);
    expect(await api<{ ok: number }>("/x")).toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledWith(expect.stringContaining("/x"), expect.objectContaining({ credentials: "include", method: "GET" }));
  });
  it("sends JSON bodies with the right header", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: 1 })));
    vi.stubGlobal("fetch", f);
    await api("/y", { method: "POST", body: { a: 1 } });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toEqual({ "content-type": "application/json" });
  });
  it("maps API errors to ApiError with code, message and details", async () => {
    respond(422, { error: { code: "validation_failed", message: "Bad", details: ["x"] } });
    await expect(api("/z")).rejects.toMatchObject({ status: 422, code: "validation_failed", message: "Bad", details: ["x"] });
    await expect(api("/z")).rejects.toBeInstanceOf(ApiError);
  });
  it("handles 204, non-JSON failures and network errors", async () => {
    respond(204, undefined);
    expect(await api("/d", { method: "POST", body: {} })).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>502</html>", { status: 502 })));
    await expect(api("/e")).rejects.toMatchObject({ status: 502, code: "network" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(api("/f")).rejects.toThrow();
  });
});

describe("useApi", () => {
  it("loads data, then exposes it", async () => {
    respond(200, { data: [1, 2] });
    const { result } = renderHook(() => useApi<number[]>("/list"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([1, 2]);
    expect(result.current.error).toBeNull();
  });
  it("surfaces the server's message on failure and can retry", async () => {
    respond(403, { error: { code: "forbidden", message: "Nope" } });
    const { result } = renderHook(() => useApi("/secret"));
    await waitFor(() => expect(result.current.error).toBe("Nope"));
    respond(200, { data: "ok" });
    await result.current.reload();
    await waitFor(() => expect(result.current.data).toBe("ok"));
  });
  it("does nothing for a null path", () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    const { result } = renderHook(() => useApi(null));
    expect(result.current.loading).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("formatters and brand", () => {
  it("formats numbers, percentages and days", () => {
    expect(int(1234567)).toBe("1,234,567");
    expect(pct(0.1234)).toBe("12.3%");
    expect(pct(null)).toBe("–");
    expect(isoDay(new Date("2026-10-27T23:59:59Z"))).toBe("2026-10-27");
  });
  it("brand is a single configurable constant", () => {
    expect(BRAND_FULL).toBe(`${BRAND.name} ${BRAND.suffix}`.trim());
  });
});
