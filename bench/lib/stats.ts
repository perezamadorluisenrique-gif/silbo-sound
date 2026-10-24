// Small statistics helpers for the bench's aggregation and comparisons.

/** Wilson score interval for k successes out of n (95 %). */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

/** Two-sided p-value of a two-proportion z-test (pooled). 1 when undefined. */
export function twoProportionP(k1: number, n1: number, k2: number, n2: number): number {
  if (!n1 || !n2) return 1;
  const p = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return 1;
  const z = Math.abs(k1 / n1 - k2 / n2) / se;
  return 2 * (1 - normCdf(z));
}
function normCdf(z: number): number {
  // Abramowitz-Stegun 7.1.26 via erf
  const t = 1 / (1 + 0.3275911 * (z / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return 0.5 * (1 + y);
}

/**
 * First crossing of `level` by the success curve, walking from the mildest value towards the
 * harshest, linearly interpolated. null if the curve never drops below the level; the first
 * value if it starts below it.
 */
export function crossing(values: number[], rates: number[], level: number): number | null {
  if (!values.length) return null;
  if (rates[0]! < level) return values[0]!;
  for (let k = 1; k < values.length; k++) {
    if (rates[k]! < level) {
      const r0 = rates[k - 1]!;
      const r1 = rates[k]!;
      const f = (r0 - level) / (r0 - r1);
      return values[k - 1]! + f * (values[k]! - values[k - 1]!);
    }
  }
  return null;
}
