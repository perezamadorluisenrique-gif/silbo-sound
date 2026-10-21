// OFDM payload with time-differential QPSK, for the fast "archivo" profile.
// Chosen with tools/ofdm-genie.ts (medium room, 15 dB, 2000 B): N=8192/CP=1024 rep 2 -> 1/4 to
// 3/4 frames; rep 3 -> 10/10 at 1.9 kbit/s; N=16384/CP=2048 rep 2 -> 10/10 at 2.8 kbit/s (kept).
//
// Why this shape (measured with tools/ofdm-probe.ts, see NEXT.md): in the simulated rooms the
// limit is reverberation, not noise. Long symbols (16384 samples = 341 ms, 2.9 Hz bins) with a
// 43 ms cyclic prefix keep inter-symbol interference to ~6 % raw bit errors in the medium room,
// and differential phase between consecutive symbols on the same bin needs no channel estimate
// (a room is static over a few seconds). Clock drift is removed by resampling every symbol with
// the clock ratio the frame's postamble measures. FEC: rate-1/2 K=7 convolutional code with
// soft Viterbi, every coded bit sent twice, bits spread over all bins and symbols by a seeded permutation, CRC-32 on top.
import { Fft } from '../dsp/fft.ts';
import { Rng } from '../dsp/rng.ts';
import { convEncode, convCodedBits, viterbiDecode } from '../fec/conv.ts';
import { crc32 } from '../fec/crc.ts';
import { scramble } from '../fec/scramble.ts';
import { FS } from './chirp.ts';

export interface OfdmParams {
  N: number; // FFT size
  CP: number; // cyclic prefix
  f0: number; // lowest carrier (Hz)
  f1: number; // highest carrier (Hz)
  clip: number; // peak / RMS limit applied before normalisation (crest factor)
  rep: number; // every coded bit is sent rep times in different slots (diversity; LLRs add)
}
export const OFDM: OfdmParams = { N: 16384, CP: 2048, f0: 1000, f1: 7800, clip: 3.2, rep: 2 };

const SEED = 0x51b0;

function bins(p: OfdmParams): [number, number] {
  return [Math.ceil(p.f0 / (FS / p.N)), Math.floor(p.f1 / (FS / p.N))];
}
export function carriers(p: OfdmParams = OFDM): number {
  const [k0, k1] = bins(p);
  return k1 - k0 + 1;
}
/** Data symbols for a payload of len bytes (+4 CRC), excluding the reference symbol. */
export function ofdmSymbols(len: number, p: OfdmParams = OFDM): number {
  return Math.ceil((p.rep * convCodedBits(8 * (len + 4))) / (2 * carriers(p)));
}
export function ofdmSamples(len: number, p: OfdmParams = OFDM): number {
  return (ofdmSymbols(len, p) + 1) * (p.N + p.CP);
}

function permutation(n: number): Uint32Array {
  const perm = new Uint32Array(n);
  for (let i = 0; i < n; i++) perm[i] = i;
  const rng = new Rng(SEED ^ n);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = t;
  }
  return perm;
}

function withCrc(data: Uint8Array): Uint8Array {
  const c = crc32(data);
  const full = new Uint8Array(data.length + 4);
  full.set(data);
  full.set([c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255], data.length);
  return full;
}

// Gray-coded dibit -> phase increment in quarter turns: 00->0, 01->1, 11->2, 10->3
const INC = [0, 1, 3, 2];

/** OFDM samples for the payload (reference symbol first), peak-normalised to 0.9. */
export function ofdmEncode(data: Uint8Array, p: OfdmParams = OFDM): Float32Array {
  const [k0] = bins(p);
  const K = carriers(p);
  const nsym = ofdmSymbols(data.length, p);
  const coded = convEncode(scramble(withCrc(data), SEED));
  const slots = nsym * K * 2;
  const bits = new Uint8Array(slots);
  const fill = new Rng(SEED + 1);
  for (let i = 0; i < slots; i++) bits[i] = fill.int(2);
  const perm = permutation(slots);
  for (let r = 0; r < p.rep; r++) for (let j = 0; j < coded.length; j++) bits[perm[r * coded.length + j]!] = coded[j]!;
  const L = p.N + p.CP;
  const out = new Float32Array((nsym + 1) * L);
  const f = Fft.of(p.N);
  const re = new Float64Array(p.N);
  const im = new Float64Array(p.N);
  // reference phases
  // (Schroeder phase pi*i^2/K: a chirp-like reference symbol with a low crest factor)
  const q = new Float64Array(K);
  for (let i = 0; i < K; i++) q[i] = (Math.PI * i * i) / K;
  for (let s = 0; s <= nsym; s++) {
    if (s > 0) for (let i = 0; i < K; i++) q[i] = q[i]! + (Math.PI / 2) * INC[(bits[((s - 1) * K + i) * 2]! << 1) | bits[((s - 1) * K + i) * 2 + 1]!]!;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < K; i++) {
      const a = q[i]!;
      re[k0 + i] = Math.cos(a);
      im[k0 + i] = Math.sin(a);
      re[p.N - k0 - i] = Math.cos(a);
      im[p.N - k0 - i] = -Math.sin(a);
    }
    f.transform(re, im, true);
    for (let n = 0; n < L; n++) out[s * L + n] = re[(n - p.CP + p.N) % p.N]!;
  }
  // crest-factor limit, then peak 0.9
  let e = 0;
  for (const v of out) e += v * v;
  const lim = p.clip * Math.sqrt(e / out.length);
  let pk = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(-lim, Math.min(lim, out[i]!));
    pk = Math.max(pk, Math.abs(out[i]!));
  }
  for (let i = 0; i < out.length; i++) out[i]! *= 0.9 / pk;
  return out;
}

/** Catmull-Rom interpolation of x at fractional position t. */
function interp(x: Float32Array, t: number): number {
  const i = Math.floor(t);
  const u = t - i;
  const a = x[i - 1] ?? 0;
  const b = x[i] ?? 0;
  const c = x[i + 1] ?? 0;
  const d = x[i + 2] ?? 0;
  return b + 0.5 * u * (c - a + u * (2 * a - 5 * b + 4 * c - d + u * (3 * (b - c) + d - a)));
}

/**
 * Soft bits for the payload whose reference symbol starts (cyclic prefix included) at rx
 * position `start` (transmitter sample 0 of the OFDM part), with clock ratio rx/tx.
 */
export function ofdmSoft(rx: Float32Array, start: number, ratio: number, len: number, p: OfdmParams = OFDM): { soft: Float64Array; slip: number } {
  const [k0] = bins(p);
  const K = carriers(p);
  const nsym = ofdmSymbols(len, p);
  const L = p.N + p.CP;
  const f = Fft.of(p.N);
  const re = new Float64Array(p.N);
  const im = new Float64Array(p.N);
  const pr = new Float64Array(K);
  const pi = new Float64Array(K);
  const soft = new Float64Array(nsym * K * 2);
  const zR = new Float64Array(K);
  const zI = new Float64Array(K);
  const wR = new Float64Array(K);
  const wI = new Float64Array(K);
  let slipSum = 0;
  let slipN = 0;
  let shift = 0; // rx samples added to every later window after a sample gap (see below)
  const bigR = new Float64Array(p.N);
  const bigI = new Float64Array(p.N);
  const back = Math.round((3 * p.CP) / 4); // FFT window starts 1/4 of the prefix early
  const demod = (s: number) => {
    const w = start + (s * L + back) * ratio + shift;
    for (let n = 0; n < p.N; n++) re[n] = interp(rx, w + n * ratio);
    im.fill(0);
    f.transform(re, im);
  };
  for (let s = 0; s <= nsym; s++) {
    demod(s);
    if (s > 0) {
      // z = Y_s * conj(Y_{s-1}); the channel cancels, leaving the data increment plus a phase
      // ramp 2*pi*k*d/N from any residual timing slip d between the two symbols (clock-ratio
      // error, mostly on short frames whose postamble gives a coarse ratio), estimated below.
      for (let i = 0; i < K; i++) {
        const ar = re[k0 + i]!;
        const ai = im[k0 + i]!;
        const zr = ar * pr[i]! + ai * pi[i]!;
        const zi = ai * pr[i]! - ar * pi[i]!;
        zR[i] = zr;
        zI[i] = zi;
        // w = z^4 / |z|^3: the 4th power removes the QPSK data, the weight keeps |z|
        const r2 = zr * zr - zi * zi;
        const i2 = 2 * zr * zi;
        const m = Math.hypot(zr, zi);
        const g = 1 / (m * m * m + 1e-300);
        wR[i] = (r2 * r2 - i2 * i2) * g;
        wI[i] = 2 * r2 * i2 * g;
      }
      // slip d (samples) maximising |sum_k w_k exp(-j*4*2*pi*k*d/N)|: coarse grid, then fine
      const score = (d: number) => {
        const st = (-8 * Math.PI * d) / p.N;
        let cr = Math.cos(st * k0);
        let ci = Math.sin(st * k0);
        const dr = Math.cos(st);
        const di = Math.sin(st);
        let sr = 0;
        let si = 0;
        for (let i = 0; i < K; i++) {
          sr += wR[i]! * cr - wI[i]! * ci;
          si += wR[i]! * ci + wI[i]! * cr;
          const t = cr * dr - ci * di;
          ci = cr * di + ci * dr;
          cr = t;
        }
        return sr * sr + si * si;
      };
      let bestD = 0;
      let bestS = -1;
      for (let d = -5; d <= 5.0001; d += 0.05) {
        const v = score(d);
        if (v > bestS) [bestS, bestD] = [v, d];
      }
      const c0 = bestD;
      for (let d = c0 - 0.05; d <= c0 + 0.05; d += 0.005) {
        const v = score(d);
        if (v > bestS) [bestS, bestD] = [v, d];
      }
      // Sample gaps: a phone (or a starved browser) that drops or inserts a few ms of audio
      // shifts every later symbol by hundreds of samples. The same metric over the whole range
      // is one FFT over the carriers (4d = FFT bin, so ±N/8 in 1/4-sample steps); a clearly
      // stronger peak far away is a jump: correct this symbol's phase ramp, move every later
      // window by it and demodulate this symbol again at the moved window, so the next
      // difference is taken between aligned symbols.
      bigR.fill(0);
      bigI.fill(0);
      for (let i = 0; i < K; i++) {
        bigR[k0 + i] = wR[i]!;
        bigI[k0 + i] = wI[i]!;
      }
      f.transform(bigR, bigI);
      let bm = 0;
      let bv = -1;
      for (let m = 0; m < p.N; m++) {
        const v = bigR[m]! * bigR[m]! + bigI[m]! * bigI[m]!;
        if (v > bv) [bv, bm] = [v, m];
      }
      const dBig = (bm >= p.N / 2 ? bm - p.N : bm) / 4;
      let jumped = false;
      if (Math.abs(dBig) > 8 && bv > 3 * bestS) {
        bestS = -1;
        for (let d = dBig - 0.3; d <= dBig + 0.3; d += 0.01) {
          const v = score(d);
          if (v > bestS) [bestS, bestD] = [v, d];
        }
        jumped = true;
      }
      const slope = (2 * Math.PI * bestD) / p.N; // radians per carrier
      if (!jumped) {
        slipSum += bestD;
        slipN++;
      }
      if (typeof process !== "undefined" && process.env?.OFDM_DEBUG) console.error("slope", s, slope, (slope * p.N) / (2 * Math.PI));
      for (let i = 0; i < K; i++) {
        const a = -slope * (k0 + i) - Math.PI / 4; // undo the ramp, then rotate by -pi/4
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const ur = zR[i]! * c - zI[i]! * sn;
        const ui = zR[i]! * sn + zI[i]! * c;
        soft[((s - 1) * K + i) * 2] = ur; // first bit 0 <=> increment 0 or 1 quarter turn
        soft[((s - 1) * K + i) * 2 + 1] = -ui; // second bit 0 <=> increment 0 or 3
      }
      if (jumped) {
        // the gap fell inside this symbol or the previous one: its increments are garbage, so
        // erase them (soft 0) and let the code and the second copy of each bit fill them in
        soft.fill(0, (s - 1) * K * 2, s * K * 2);
        shift -= Math.round(bestD) * ratio; // positive slip: symbols arrive earlier
        demod(s);
      }
    }
    for (let i = 0; i < K; i++) {
      pr[i] = re[k0 + i]!;
      pi[i] = im[k0 + i]!;
    }
  }
  // normalise per carrier by its mean |z| so one loud bin cannot dominate the Viterbi metric
  // more than its reliability warrants (|z| ~ |H|^2; dividing by sqrt keeps |H| weighting)
  for (let i = 0; i < K; i++) {
    let m = 0;
    let used = 0;
    for (let s = 0; s < nsym; s++) {
      const a = Math.abs(soft[(s * K + i) * 2]!) + Math.abs(soft[(s * K + i) * 2 + 1]!);
      m += a;
      if (a > 0) used++;
    }
    const g = 1 / Math.sqrt(m / (2 * Math.max(1, used)) + 1e-30);
    for (let s = 0; s < nsym; s++) {
      soft[(s * K + i) * 2]! *= g;
      soft[(s * K + i) * 2 + 1]! *= g;
    }
  }
  return { soft, slip: slipN ? slipSum / slipN : 0 };
}

/** Decode the payload; null if the CRC-32 fails. */
export function ofdmDecode(rx: Float32Array, start: number, ratio: number, len: number, p: OfdmParams = OFDM): Uint8Array | null {
  let r = ofdmSoft(rx, start, ratio, len, p);
  // a mean slip between symbols means the clock ratio from the postamble was off (short frames,
  // or a chirp sidelobe taken for the direct path): correct the ratio and demodulate again
  if (Math.abs(r.slip) > 0.25) {
    ratio -= r.slip / (p.N + p.CP); // a positive slip means the symbols arrive earlier than the windows
    r = ofdmSoft(rx, start, ratio, len, p);
  }
  const soft = r.soft;
  const perm = permutation(soft.length);
  const n = convCodedBits(8 * (len + 4));
  const llr = new Float64Array(n);
  for (let k = 0; k < p.rep; k++) for (let j = 0; j < n; j++) llr[j]! += soft[perm[k * n + j]!]!;
  const full = scramble(viterbiDecode(llr, len + 4), SEED);
  const d = full.slice(0, len);
  const c = ((full[len]! << 24) | (full[len + 1]! << 16) | (full[len + 2]! << 8) | full[len + 3]!) >>> 0;
  return crc32(d) === c ? d : null;
}
