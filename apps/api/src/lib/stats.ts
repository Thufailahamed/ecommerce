/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf). Accurate to ~1.5e-7. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export interface ArmResult { n: number; x: number }

export interface ExperimentResult {
  treatmentRate: number | null;
  holdoutRate: number | null;
  /** (treatment - holdout) / holdout. Null when the holdout rate is zero or undefined. */
  relativeLift: number | null;
  pValue: number | null;
  verdict: "insufficient_data" | "not_significant" | "significant_positive" | "significant_negative";
}

export const MIN_SESSIONS_PER_ARM = 200;
export const MIN_ORDERS_TOTAL = 20;
export const ALPHA = 0.05;

/**
 * Two-proportion z-test (pooled), two-sided. Deliberately conservative: a verdict is only offered with
 * enough sessions in both arms and enough total orders, because small samples produce confident-looking noise.
 */
export function compareArms(treatment: ArmResult, holdout: ArmResult): ExperimentResult {
  const rate = (a: ArmResult) => (a.n > 0 ? a.x / a.n : null);
  const rT = rate(treatment), rH = rate(holdout);
  const base = { treatmentRate: rT, holdoutRate: rH, relativeLift: rT !== null && rH !== null && rH > 0 ? (rT - rH) / rH : null };
  if (treatment.n < MIN_SESSIONS_PER_ARM || holdout.n < MIN_SESSIONS_PER_ARM || treatment.x + holdout.x < MIN_ORDERS_TOTAL || rT === null || rH === null) {
    return { ...base, pValue: null, verdict: "insufficient_data" };
  }
  const pooled = (treatment.x + holdout.x) / (treatment.n + holdout.n);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / treatment.n + 1 / holdout.n));
  if (se === 0) return { ...base, pValue: null, verdict: "insufficient_data" };
  const z = (rT - rH) / se;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  const verdict = p < ALPHA ? (rT > rH ? "significant_positive" : "significant_negative") : "not_significant";
  return { ...base, pValue: p, verdict };
}
