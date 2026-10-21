// Iterative radix-2 complex FFT, written from the textbook definition.
const cache = new Map<number, Fft>();

export class Fft {
  readonly n: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;
  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two: ${n}`);
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >>> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }
  static of(n: number): Fft {
    let f = cache.get(n);
    if (!f) {
      f = new Fft(n);
      cache.set(n, f);
    }
    return f;
  }
  /** In-place transform. inverse=true computes the unscaled inverse, then divides by n. */
  transform(re: Float64Array, im: Float64Array, inverse = false): void {
    const n = this.n;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i]!;
      if (j > i) {
        let t = re[i]!;
        re[i] = re[j]!;
        re[j] = t;
        t = im[i]!;
        im[i] = im[j]!;
        im[j] = t;
      }
    }
    const sgn = inverse ? -1 : 1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >>> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step]!;
          const wi = sgn * this.sin[k * step]!;
          const a = start + k;
          const b = a + half;
          const xr = re[b]! * wr - im[b]! * wi;
          const xi = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - xr;
          im[b] = im[a]! - xi;
          re[a] = re[a]! + xr;
          im[a] = im[a]! + xi;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] = re[i]! / n;
        im[i] = im[i]! / n;
      }
    }
  }
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Linear convolution of two real signals via FFT. Output length a.length + b.length - 1. */
export function convolve(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const outLen = a.length + b.length - 1;
  const n = nextPow2(outLen);
  const f = Fft.of(n);
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  for (let i = 0; i < a.length; i++) ar[i] = a[i]!;
  for (let i = 0; i < b.length; i++) br[i] = b[i]!;
  f.transform(ar, ai);
  f.transform(br, bi);
  for (let i = 0; i < n; i++) {
    const r = ar[i]! * br[i]! - ai[i]! * bi[i]!;
    const im = ar[i]! * bi[i]! + ai[i]! * br[i]!;
    ar[i] = r;
    ai[i] = im;
  }
  f.transform(ar, ai, true);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = ar[i]!;
  return out;
}

/**
 * Cross-correlation of a long signal x with a short template t (valid part):
 * out[k] = sum_j x[k + j] * t[j], for k in [0, x.length - t.length].
 * Overlap-save in blocks so it scales to minutes of audio.
 */
export function correlate(x: ArrayLike<number>, t: ArrayLike<number>): Float32Array {
  const m = t.length;
  const outLen = Math.max(0, x.length - m + 1);
  const out = new Float32Array(outLen);
  if (outLen === 0) return out;
  const n = nextPow2(Math.max(4 * m, 8192));
  const f = Fft.of(n);
  const tr = new Float64Array(n);
  const ti = new Float64Array(n);
  // correlation = convolution with time-reversed template
  for (let j = 0; j < m; j++) tr[j] = t[m - 1 - j]!;
  f.transform(tr, ti);
  const step = n - m + 1;
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  for (let k0 = 0; k0 < outLen; k0 += step) {
    br.fill(0);
    bi.fill(0);
    for (let i = 0; i < n && k0 + i < x.length; i++) br[i] = x[k0 + i]!;
    f.transform(br, bi);
    for (let i = 0; i < n; i++) {
      const r = br[i]! * tr[i]! - bi[i]! * ti[i]!;
      const im = br[i]! * ti[i]! + bi[i]! * tr[i]!;
      br[i] = r;
      bi[i] = im;
    }
    f.transform(br, bi, true);
    // full-convolution index (m-1+i) corresponds to correlation lag k0+i
    for (let i = 0; i < step && k0 + i < outLen; i++) out[k0 + i] = br[m - 1 + i]!;
  }
  return out;
}
