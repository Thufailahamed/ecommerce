import { describe, expect, it } from "vitest";
import { assignGroup } from "@convertflow/campaign-engine";
import { base32Decode, base32Encode, totpAt, verifyTotp } from "../src/lib/totp.js";
import { MIN_SESSIONS_PER_ARM, compareArms, normalCdf } from "../src/lib/stats.js";

describe("TOTP (RFC 6238 test vectors, SHA-1, 8 digits in the RFC, last 6 here)", () => {
  const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
  // RFC 6238 appendix B: T=59 -> 94287082, T=1111111109 -> 07081804, T=1234567890 -> 89005924
  it.each([[59, "287082"], [1111111109, "081804"], [1234567890, "005924"], [2000000000, "279037"]])("code at t=%i is %s", async (t, want) => {
    expect(await totpAt(secret, t * 1000)).toBe(want);
  });
  it("round-trips base32", () => {
    const b = crypto.getRandomValues(new Uint8Array(20));
    expect(Array.from(base32Decode(base32Encode(b)))).toEqual(Array.from(b));
    expect(() => base32Decode("0189")).toThrow();
  });
  it("accepts +/-1 step, rejects further drift, bad format and replays of other windows", async () => {
    const now = 1_700_000_000_000;
    const code = await totpAt(secret, now);
    expect(await verifyTotp(secret, code, now)).toBe(true);
    expect(await verifyTotp(secret, code, now + 30_000)).toBe(true);
    expect(await verifyTotp(secret, code, now + 90_000)).toBe(false);
    expect(await verifyTotp(secret, "12345", now)).toBe(false);
    expect(await verifyTotp(secret, "abcdef", now)).toBe(false);
  });
});

describe("experiment statistics", () => {
  it("normal CDF matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
  it("refuses a verdict on small samples", () => {
    expect(compareArms({ n: MIN_SESSIONS_PER_ARM - 1, x: 50 }, { n: 1000, x: 10 }).verdict).toBe("insufficient_data");
    expect(compareArms({ n: 1000, x: 5 }, { n: 1000, x: 5 }).verdict).toBe("insufficient_data"); // too few orders
  });
  it("detects a real positive effect", () => {
    const r = compareArms({ n: 5000, x: 300 }, { n: 5000, x: 200 }); // 6% vs 4%
    expect(r.verdict).toBe("significant_positive");
    expect(r.relativeLift).toBeCloseTo(0.5, 6);
    expect(r.pValue!).toBeLessThan(0.001);
  });
  it("detects a harmful effect and flags noise as not significant", () => {
    expect(compareArms({ n: 5000, x: 200 }, { n: 5000, x: 300 }).verdict).toBe("significant_negative");
    expect(compareArms({ n: 1000, x: 52 }, { n: 1000, x: 48 }).verdict).toBe("not_significant");
  });
  it("matches a hand-computed z-test", () => {
    // rT=0.06 rH=0.04 pooled=0.05 se=sqrt(.05*.95*(2/5000))=0.004359 z=4.588 p~4.5e-6
    const r = compareArms({ n: 5000, x: 300 }, { n: 5000, x: 200 });
    expect(r.pValue!).toBeGreaterThan(3e-6);
    expect(r.pValue!).toBeLessThan(6e-6);
  });
});

describe("assignGroup", () => {
  it("is deterministic, near the requested split, and independent across campaigns", () => {
    expect(assignGroup("v1", "c1", 20)).toBe(assignGroup("v1", "c1", 20));
    let holdout = 0, differs = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const a = assignGroup(`visitor-${i}`, "cmp_a", 20), b = assignGroup(`visitor-${i}`, "cmp_b", 20);
      if (a === "holdout") holdout++;
      if (a !== b) differs++;
    }
    expect(holdout / N).toBeGreaterThan(0.18);
    expect(holdout / N).toBeLessThan(0.22);
    expect(differs / N).toBeGreaterThan(0.25); // ~2*0.2*0.8 = 0.32 if independent
  });
  it("0 and 100 percent are exact", () => {
    for (let i = 0; i < 200; i++) { expect(assignGroup(`v${i}`, "c", 0)).toBe("treatment"); expect(assignGroup(`v${i}`, "c", 100)).toBe("holdout"); }
  });
});
