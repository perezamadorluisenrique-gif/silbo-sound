// Small DSP toolkit for the bench's channel simulator. Deliberately independent of src/dsp
// (which is part of the codec): a codec change must never silently change the channel too.

/** mulberry32 PRNG with Gaussian samples (polar Box-Muller). */
export class Rng {
  private s: number;
  private spare: number | null = null;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  uniform(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  gauss(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * m;
    return u * m;
  }
}

/** Stable 32-bit seed from any list of numbers and strings (FNV-1a). */
export function seedOf(...parts: (number | string)[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = String(p) + '|';
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

// ---------- FFT (iterative radix-2, in place) ----------
function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a]! += xr;
        im[a]! += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {
    re[i]! /= n;
    im[i]! /= n;
  }
}
export { fft };

/** Linear convolution via FFT; output length x.length + h.length - 1. */
export function convolve(x: Float32Array, h: Float32Array): Float32Array {
  const L = x.length + h.length - 1;
  let n = 1;
  while (n < L) n <<= 1;
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  ar.set(x);
  br.set(h);
  fft(ar, ai);
  fft(br, bi);
  for (let i = 0; i < n; i++) {
    const r = ar[i]! * br[i]! - ai[i]! * bi[i]!;
    ai[i] = ar[i]! * bi[i]! + ai[i]! * br[i]!;
    ar[i] = r;
  }
  fft(ar, ai, true);
  const out = new Float32Array(L);
  for (let i = 0; i < L; i++) out[i] = ar[i]!;
  return out;
}

/** Power spectrum magnitude (dB) of a real signal at one frequency, by Goertzel over the whole buffer. */
export function toneLevelDb(x: ArrayLike<number>, f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const s0 = x[i]! + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const p = s1 * s1 + s2 * s2 - c * s1 * s2;
  return 10 * Math.log10(Math.max(p, 1e-30) / ((x.length * x.length) / 4));
}

// ---------- biquads (RBJ cookbook) ----------
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}
function norm(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
export function lowpass(fs: number, f0: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * Math.min(f0, 0.49 * fs)) / fs;
  const al = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  return norm((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
}
export function highpass(fs: number, f0: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * f0) / fs;
  const al = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  return norm((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
}
export function peaking(fs: number, f0: number, gainDb: number, q: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * f0) / fs;
  const al = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  return norm(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
}
/** Two-pole resonator (band-pass, constant 0 dB peak gain) at f0 with bandwidth bw. */
export function resonator(fs: number, f0: number, bw: number): Biquad {
  return bandpass(fs, f0, f0 / bw);
}
export function bandpass(fs: number, f0: number, q: number): Biquad {
  const w = (2 * Math.PI * f0) / fs;
  const al = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  return norm(al, 0, -al, 1 + al, -2 * c, 1 - al);
}
export function butterQs(order: number): number[] {
  const qs: number[] = [];
  for (let k = 0; k < order / 2; k++) qs.push(1 / (2 * Math.sin(((2 * k + 1) * Math.PI) / (2 * order))));
  return qs;
}
export function butterLow(fs: number, f: number, order = 4): Biquad[] {
  return butterQs(order).map((q) => lowpass(fs, f, q));
}
export function butterHigh(fs: number, f: number, order = 4): Biquad[] {
  return butterQs(order).map((q) => highpass(fs, f, q));
}
export function butterBand(fs: number, lo: number, hi: number, order = 4): Biquad[] {
  return [...butterHigh(fs, lo, order), ...butterLow(fs, hi, order)];
}
export function filter(x: Float32Array, sections: Biquad[]): Float32Array {
  let y = Float32Array.from(x);
  for (const s of sections) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const xi = y[i]!;
      const yi = s.b0 * xi + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2;
      x2 = x1;
      x1 = xi;
      y2 = y1;
      y1 = yi;
      y[i] = yi;
    }
  }
  return y;
}
/** |H(f)| in dB of a biquad cascade. */
export function responseDb(sections: Biquad[], f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs;
  let mag = 1;
  for (const s of sections) {
    // H(e^jw) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
    const nr = s.b0 + s.b1 * Math.cos(w) + s.b2 * Math.cos(2 * w);
    const ni = -s.b1 * Math.sin(w) - s.b2 * Math.sin(2 * w);
    const dr = 1 + s.a1 * Math.cos(w) + s.a2 * Math.cos(2 * w);
    const di = -s.a1 * Math.sin(w) - s.a2 * Math.sin(2 * w);
    mag *= Math.hypot(nr, ni) / Math.hypot(dr, di);
  }
  return 20 * Math.log10(mag);
}

export function power(x: ArrayLike<number>, start = 0, end = x.length): number {
  let s = 0;
  for (let i = start; i < end; i++) s += x[i]! * x[i]!;
  return s / Math.max(1, end - start);
}
export const db = (p: number) => 10 * Math.log10(Math.max(p, 1e-30));

// ---------- resampling with a polyphase windowed-sinc table ----------
const HALF = 16;
const PHASES = 1024;
let TABLE: Float32Array | null = null;
function table(): Float32Array {
  if (TABLE) return TABLE;
  // TABLE[p * 2HALF + j] = h(d) for d = (p / PHASES) - (j - HALF + 1), Blackman-windowed sinc
  const t = new Float32Array((PHASES + 1) * 2 * HALF);
  for (let p = 0; p <= PHASES; p++) {
    for (let j = 0; j < 2 * HALF; j++) {
      const d = p / PHASES - (j - HALF + 1);
      const s = d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d);
      const w = Math.abs(d) >= HALF ? 0 : 0.42 + 0.5 * Math.cos((Math.PI * d) / HALF) + 0.08 * Math.cos((2 * Math.PI * d) / HALF);
      t[p * 2 * HALF + j] = s * w;
    }
  }
  return (TABLE = t);
}

/**
 * y[m] = x((m - delay) / ratio): the receiver samples `ratio` times as fast as the sender
 * (ratio = 1 + ppm·1e-6) and the signal arrives `delay` (fractional) samples late.
 */
export function resample(x: Float32Array, ratio: number, delay = 0): Float32Array {
  if (ratio === 1 && delay === 0) return Float32Array.from(x);
  const T = table();
  const outLen = Math.floor((x.length - 1) * ratio + delay);
  const y = new Float32Array(Math.max(0, outLen));
  for (let m = 0; m < y.length; m++) {
    const t = (m - delay) / ratio;
    const i0 = Math.floor(t);
    const fr = (t - i0) * PHASES;
    const p = Math.floor(fr);
    const a = fr - p;
    const r0 = p * 2 * HALF;
    const r1 = r0 + 2 * HALF;
    let acc = 0;
    for (let j = 0; j < 2 * HALF; j++) {
      const k = i0 - HALF + 1 + j;
      if (k < 0 || k >= x.length) continue;
      acc += x[k]! * (T[r0 + j]! + a * (T[r1 + j]! - T[r0 + j]!));
    }
    y[m] = acc;
  }
  return y;
}
