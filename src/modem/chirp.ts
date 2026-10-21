// Linear chirp preambles and their detection by normalised matched filtering.
import { correlate } from '../dsp/fft.ts';
import { applyBiquads, bandpassSections } from '../dsp/filters.ts';

export const FS = 48000;

export function chirp(len: number, f0: number, f1: number, fs = FS, taperFrac = 0.05): Float32Array {
  const x = new Float32Array(len);
  const T = len / fs;
  const k = (f1 - f0) / T;
  const taper = Math.round(len * taperFrac);
  for (let n = 0; n < len; n++) {
    const t = n / fs;
    let w = 1;
    if (n < taper) w = 0.5 - 0.5 * Math.cos((Math.PI * n) / taper);
    else if (n >= len - taper) w = 0.5 - 0.5 * Math.cos((Math.PI * (len - 1 - n)) / taper);
    x[n] = w * Math.sin(2 * Math.PI * (f0 * t + 0.5 * k * t * t));
  }
  return x;
}

export interface Peak {
  index: number; // estimated start of the chirp (direct path) in the input
  score: number; // normalised correlation, 0..1
}

/**
 * Normalised cross-correlation of x against template t, restricted to [from, to).
 * ncc[k] = <x[k..k+L), t> / (|t| * |x[k..k+L)|)
 */
export function ncc(x: Float32Array, t: Float32Array, from = 0, to = x.length - t.length + 1): Float32Array {
  from = Math.max(0, from);
  to = Math.min(to, x.length - t.length + 1);
  if (to <= from) return new Float32Array(0);
  const seg = x.subarray(from, to + t.length - 1);
  const c = correlate(seg, t);
  let tn = 0;
  for (let i = 0; i < t.length; i++) tn += t[i]! * t[i]!;
  tn = Math.sqrt(tn);
  const out = new Float32Array(c.length);
  let e = 0;
  for (let i = 0; i < t.length; i++) e += seg[i]! * seg[i]!;
  for (let k = 0; k < c.length; k++) {
    if (k > 0) {
      const a = seg[k - 1]!;
      const b = seg[k + t.length - 1]!;
      e += b * b - a * a;
    }
    out[k] = c[k]! / (tn * Math.sqrt(Math.max(e, 1e-12)));
  }
  return out;
}

export function prefilter(x: Float32Array, lo: number, hi: number, fs = FS): Float32Array {
  return applyBiquads(x, bandpassSections(fs, lo, hi, 4));
}

/**
 * Find chirp arrivals: local maxima of the NCC above threshold, at least minGap apart.
 * The reported index is the earliest arrival within 300 samples before the maximum that
 * reaches 60 % of it (the direct path, not a stronger late reflection).
 */
export function findChirps(xf: Float32Array, t: Float32Array, threshold: number, minGap: number, from = 0, to?: number): Peak[] {
  const r = ncc(xf, t, from, to);
  const peaks: Peak[] = [];
  let k = 0;
  while (k < r.length) {
    if (r[k]! < threshold) {
      k++;
      continue;
    }
    // climb to the local maximum within minGap
    let best = k;
    for (let j = k; j < Math.min(r.length, k + minGap); j++) if (r[j]! > r[best]!) best = j;
    let early = best;
    for (let j = Math.max(0, best - 300); j < best; j++) {
      if (r[j]! >= 0.6 * r[best]! && r[j]! >= r[j - 1 < 0 ? 0 : j - 1]! && r[j]! >= r[j + 1]!) {
        early = j;
        break;
      }
    }
    peaks.push({ index: from + early, score: r[best]! });
    k = best + minGap;
  }
  return peaks;
}
