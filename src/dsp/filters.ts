// Biquad filters (RBJ audio EQ cookbook formulas) and Butterworth cascades.
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export function lowpass(fs: number, f0: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 };
}

export function highpass(fs: number, f0: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  return { b0: (1 + c) / 2 / a0, b1: -(1 + c) / a0, b2: (1 + c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 };
}

export function peaking(fs: number, f0: number, gainDb: number, q: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + alpha / A;
  return { b0: (1 + alpha * A) / a0, b1: (-2 * c) / a0, b2: (1 - alpha * A) / a0, a1: (-2 * c) / a0, a2: (1 - alpha / A) / a0 };
}

/** Q values of the biquad sections of an order-n (even) Butterworth filter. */
export function butterworthQs(order: number): number[] {
  const qs: number[] = [];
  for (let k = 0; k < order / 2; k++) qs.push(1 / (2 * Math.sin(((2 * k + 1) * Math.PI) / (2 * order))));
  return qs;
}

export function applyBiquads(x: Float32Array, sections: Biquad[]): Float32Array {
  let y = Float32Array.from(x);
  for (const s of sections) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    const out = new Float32Array(y.length);
    for (let i = 0; i < y.length; i++) {
      const xi = y[i]!;
      const yi = s.b0 * xi + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2;
      x2 = x1;
      x1 = xi;
      y2 = y1;
      y1 = yi;
      out[i] = yi;
    }
    y = out;
  }
  return y;
}

export function bandpassSections(fs: number, lo: number, hi: number, order = 4): Biquad[] {
  const qs = butterworthQs(order);
  return [...qs.map((q) => highpass(fs, lo, q)), ...qs.map((q) => lowpass(fs, hi, q))];
}

export function power(x: ArrayLike<number>, start = 0, end = x.length): number {
  let s = 0;
  for (let i = start; i < end; i++) s += x[i]! * x[i]!;
  return s / Math.max(1, end - start);
}
