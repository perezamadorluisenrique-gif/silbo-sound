// Main modem v1: parallel MFSK ("6 x 16-FSK"), Reed-Solomon + interleaving + scrambling,
// chirp preamble for detection and channel equalisation, down-chirp postamble for clock drift.
//
// Each symbol is S = G + N samples: a guard G that soaks up the previous symbol's echoes
// and a window of N samples evaluated with one FFT. In each of NG groups exactly one of 16
// tones sounds (4 bits); groups are interleaved in frequency so a room null or the speaker's
// tilt hurts every group a little instead of one group a lot.
import { Fft } from '../dsp/fft.ts';
import { chirp, findChirps, prefilter, ncc, FS } from './chirp.ts';
import { rsEncode, rsDecode } from '../fec/rs.ts';
import { crc32, crc8 } from '../fec/crc.ts';
import { scramble } from '../fec/scramble.ts';
import { ofdmEncode, ofdmDecode, ofdmSamples } from './ofdm.ts';

export interface MfskParams {
  id: number; // profile id sent in the header (0-15)
  name: string;
  N: number; // FFT window (bin spacing FS/N)
  G: number; // guard samples
  R: number; // tone ramp length (overlaps the next guard)
  bin0: number; // first bin
  ng: number; // parallel groups (4 bits each)
  parity: number; // RS parity bytes per codeword
  evalOffset: number; // window start relative to end of guard
  binNorm: boolean; // refine equalisation with per-bin mean energy of the payload
  erasures: boolean;
  M: number; // tones per group (power of two)
  H: number; // hop sets: consecutive symbols use disjoint bins, so echoes of the
  //            previous H-1 symbols land outside the bins being compared
  block: boolean; // hop sets as contiguous sub-bands instead of interleaved bins
}

const GRID = { N: 1024, G: 128, R: 64, bin0: 21, evalOffset: -32, block: true, binNorm: true, erasures: true };

/**
 * Profiles share the symbol grid (1024-sample window + 128 guard = 24 ms at 48 kHz, 46.9 Hz bins
 * from 984 Hz) and differ in how many hop sets, groups and tones they use.
 * The header is always sent with the most robust profile so any receiver can read it.
 */
export const PROFILES: MfskParams[] = [
  { ...GRID, id: 0, name: 'rápido', M: 4, H: 4, ng: 8, parity: 32 }, // 16 bit/símbolo, 984-6937 Hz
  { ...GRID, id: 1, name: 'robusto', M: 4, H: 6, ng: 5, parity: 48 }, // 10 bit/símbolo, 984-6563 Hz
];
export const DEFAULT = PROFILES[0]!;
const HDR = PROFILES[1]!;

/** A profile for experiments (tools/ with P='{...}'), sent with id 15. */
export function custom(over: Partial<MfskParams>): MfskParams {
  return { ...DEFAULT, ...over, id: 15, name: 'experimental' };
}

const PRE_LEN = 4096;
const GAP = 256;
const HDR_BYTES = 4;
const HDR_PARITY = 8;
const VERSION = 1;
const HDR_SEED = 0x1d2b;
const PAY_SEED = 0xace1;

export function preamble(): Float32Array {
  return chirp(PRE_LEN, 800, 7800);
}
export function postamble(): Float32Array {
  return chirp(PRE_LEN, 7800, 800);
}
const PRE = preamble();
const POST = postamble();

/**
 * A frame family: the band its chirps and header live in. «phone» (800-7800 Hz) carries
 * profiles 0-2; «discreto» (near ultrasound, 17.4-19.6 kHz) carries profile 3 only, with its
 * own chirps, so a receiver looks for both families independently.
 */
export interface Family {
  name: string;
  preLen: number;
  pre: Float32Array;
  post: Float32Array;
  lo: number; // receiver band-pass for chirp detection
  hi: number;
  hdr: MfskParams; // profile used for the header
  profiles: Record<number, MfskParams>;
  ofdm: boolean;
  threshold: number;
}
export const PHONE: Family = { name: 'phone', preLen: PRE_LEN, pre: PRE, post: POST, lo: 700, hi: 8000, hdr: PROFILES[1]!, profiles: { 0: PROFILES[0]!, 1: PROFILES[1]! }, ofdm: true, threshold: 0.15 };

/**
 * Profile 3 «discreto»: 3 hop sets x 3 groups x 4 tones = 36 bins of 46.9 Hz from 17.63 to
 * 19.31 kHz (6 bit/symbol). Longer guard and tone ramps than the phone grid keep the
 * spectral splatter of tone switching above ~16 kHz, so the frame is (nearly) inaudible.
 */
export const DISCRETO: MfskParams = { id: 3, name: 'discreto', N: 1024, G: 256, R: 192, bin0: 376, evalOffset: -32, block: true, binNorm: true, erasures: true, M: 4, H: 3, ng: 3, parity: 64 };
// parity 64 (not 48): 0.6 s more for 140 bytes, and at 2 dB in the large room with saturation
// 20/24 frames instead of 12/24 (tools/discreto-probe.ts); at 5 dB 48 already lost ~1 in 100.
const U_PRE_LEN = 8192;
export const ULTRA: Family = {
  name: 'discreto',
  preLen: U_PRE_LEN,
  pre: chirp(U_PRE_LEN, 17400, 19500, FS, 0.25),
  post: chirp(U_PRE_LEN, 19500, 17400, FS, 0.25),
  lo: 17000,
  hi: 20000,
  hdr: DISCRETO,
  profiles: { 3: DISCRETO },
  ofdm: false,
  threshold: 0.15,
};

export function symLen(p: MfskParams): number {
  return p.G + p.N;
}
function bitsPerTone(p: MfskParams): number {
  return Math.log2(p.M);
}
function bitsPerSymbol(p: MfskParams): number {
  return p.ng * bitsPerTone(p);
}
export function nbins(p: MfskParams): number {
  return p.bin0 + p.M * p.ng * p.H;
}
function binOf(p: MfskParams, group: number, tone: number, hop: number): number {
  const i = tone * p.ng + group;
  return p.block ? p.bin0 + hop * p.M * p.ng + i : p.bin0 + i * p.H + hop;
}

export interface Layout {
  codewords: number[]; // data bytes per codeword
  coded: number; // total coded bytes
  symbols: number; // payload symbols
}

export function layout(len: number, p: MfskParams): Layout {
  const T = len + 4;
  const kmax = 255 - p.parity;
  const c = Math.max(1, Math.ceil(T / kmax));
  const base = Math.floor(T / c);
  const extra = T % c;
  const codewords = Array.from({ length: c }, (_, i) => base + (i < extra ? 1 : 0));
  const coded = T + c * p.parity;
  return { codewords, coded, symbols: Math.ceil((coded * 8) / bitsPerSymbol(p)) };
}

function hdrSymbols(fam: Family = PHONE): number {
  return Math.ceil(((HDR_BYTES + HDR_PARITY) * 8) / bitsPerSymbol(fam.hdr));
}

export function frameSamples(len: number, p: MfskParams = DEFAULT, fam: Family = PHONE): number {
  const S = symLen(p);
  return fam.preLen + GAP + (hdrSymbols(fam) + layout(len, p).symbols) * S + GAP + fam.preLen;
}

// ---------- byte <-> nibble <-> symbol ----------
function bytesToSymbols(bytes: Uint8Array, nsym: number, p: MfskParams): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let s = 0; s < nsym; s++) {
    const tones = new Uint8Array(p.ng);
    const bpt = bitsPerTone(p);
    for (let g = 0; g < p.ng; g++) {
      const bit0 = (s * p.ng + g) * bpt;
      let v = 0;
      for (let q = 0; q < bpt; q++) {
        const bit = bit0 + q;
        v = (v << 1) | (((bytes[bit >> 3] ?? 0) >> (7 - (bit & 7))) & 1);
      }
      tones[g] = v;
    }
    out.push(tones);
  }
  return out;
}

function interleave(cws: Uint8Array[]): Uint8Array {
  const total = cws.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  const maxLen = Math.max(...cws.map((c) => c.length));
  let k = 0;
  for (let j = 0; j < maxLen; j++) for (const c of cws) if (j < c.length) out[k++] = c[j]!;
  return out;
}

/** Inverse of interleave: returns, for each codeword, the stream positions of its bytes. */
function deinterleaveMap(lens: number[]): number[][] {
  const maps = lens.map(() => [] as number[]);
  const maxLen = Math.max(...lens);
  let k = 0;
  for (let j = 0; j < maxLen; j++) for (let i = 0; i < lens.length; i++) if (j < lens[i]!) maps[i]!.push(k++);
  return maps;
}

// ---------- transmitter ----------
function synth(out: Float32Array, at: number, tones: Uint8Array, p: MfskParams, hop: number): void {
  const S = symLen(p);
  const len = S + p.R;
  for (let g = 0; g < p.ng; g++) {
    const f = (binOf(p, g, tones[g]!, hop) * FS) / p.N;
    const w = (2 * Math.PI * f) / FS;
    const ph0 = (Math.PI * g * g) / p.ng; // Schroeder-like phases keep the crest factor low
    for (let i = 0; i < len; i++) {
      let env = 1;
      if (i < p.R) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / p.R);
      else if (i >= S) env = 0.5 + 0.5 * Math.cos((Math.PI * (i - S)) / p.R);
      const idx = at + i;
      if (idx < out.length) out[idx]! += env * Math.sin(w * i + ph0);
    }
  }
}

export function encode(data: Uint8Array, p: MfskParams = DEFAULT, fam: Family = PHONE): Float32Array {
  const HDR = fam.hdr;
  const PRE_LEN = fam.preLen;
  if (data.length > 65535) throw new Error('payload too long');
  if (p.N !== HDR.N || p.G !== HDR.G || p.bin0 !== HDR.bin0) throw new Error('profile must share the header symbol grid');
  if (p.bin0 + p.M * p.ng * p.H > p.N / 2) throw new Error('profile does not fit below Nyquist');
  const S = symLen(p);
  // header
  const h = new Uint8Array(HDR_BYTES);
  h[0] = (VERSION << 4) | p.id;
  h[1] = data.length >> 8;
  h[2] = data.length & 255;
  h[3] = crc8(h.subarray(0, 3));
  const hcw = scramble(rsEncode(h, HDR_PARITY), HDR_SEED);
  // payload
  const lay = layout(data.length, p);
  const c = crc32(data);
  const full = new Uint8Array(data.length + 4);
  full.set(data);
  full.set([c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255], data.length);
  const cws: Uint8Array[] = [];
  let off = 0;
  for (const k of lay.codewords) {
    cws.push(rsEncode(full.subarray(off, off + k), p.parity));
    off += k;
  }
  const stream = scramble(interleave(cws), PAY_SEED);
  const hs = hdrSymbols(fam);
  const hsyms = bytesToSymbols(hcw, hs, HDR);
  const psyms = bytesToSymbols(stream, lay.symbols, p);
  const syms = [...hsyms, ...psyms];
  const total = frameSamples(data.length, p, fam);
  const out = new Float32Array(total + p.R);
  out.set(fam.pre, 0);
  const d0 = PRE_LEN + GAP;
  hsyms.forEach((t, k) => synth(out, d0 + k * S, t, HDR, k % HDR.H));
  psyms.forEach((t, k) => synth(out, d0 + (hs + k) * S, t, p, k % p.H));
  // normalise data part to peak 1, chirps at 0.7 of full scale
  let peak = 0;
  for (let i = d0; i < d0 + syms.length * S + p.R; i++) peak = Math.max(peak, Math.abs(out[i]!));
  for (let i = d0; i < d0 + syms.length * S + p.R; i++) out[i]! *= 0.9 / peak;
  for (let i = 0; i < PRE_LEN; i++) out[i]! *= 0.7;
  const e0 = d0 + syms.length * S + GAP;
  for (let i = 0; i < PRE_LEN; i++) out[e0 + i] = 0.7 * fam.post[i]!;
  return out;
}

// ---------- profile 2: OFDM payload ("archivo") ----------
/** Profile id of the OFDM payload (src/modem/ofdm.ts): same preamble, header and postamble. */
export const OFDM_ID = 2;
export const DISCRETO_ID = 3;
export const PROFILE_NAMES = ['rápido', 'robusto', 'archivo', 'discreto'];
const OFDM_GAP = 128; // after the header's last tone ramp

function headerCodeword(id: number, len: number): Uint8Array {
  const h = new Uint8Array(HDR_BYTES);
  h[0] = (VERSION << 4) | id;
  h[1] = len >> 8;
  h[2] = len & 255;
  h[3] = crc8(h.subarray(0, 3));
  return scramble(rsEncode(h, HDR_PARITY), HDR_SEED);
}

function ofdmPayloadOffset(): number {
  return PRE_LEN + GAP + hdrSymbols() * symLen(HDR) + OFDM_GAP;
}

export function encodeOfdm(data: Uint8Array): Float32Array {
  if (data.length > 65535) throw new Error('payload too long');
  const S = symLen(HDR);
  const hs = hdrSymbols();
  const hsyms = bytesToSymbols(headerCodeword(OFDM_ID, data.length), hs, HDR);
  const pay = ofdmEncode(data);
  const p0 = ofdmPayloadOffset();
  const out = new Float32Array(p0 + pay.length + GAP + PRE_LEN);
  const d0 = PRE_LEN + GAP;
  hsyms.forEach((t, k) => synth(out, d0 + k * S, t, HDR, k % HDR.H));
  let peak = 0;
  for (let i = d0; i < p0; i++) peak = Math.max(peak, Math.abs(out[i]!));
  for (let i = d0; i < p0; i++) out[i]! *= 0.9 / peak;
  out.set(pay, p0);
  for (let i = 0; i < PRE_LEN; i++) out[i] = 0.7 * PRE[i]!;
  const e0 = p0 + pay.length + GAP;
  for (let i = 0; i < PRE_LEN; i++) out[e0 + i] = 0.7 * POST[i]!;
  return out;
}

/** Encode with any profile id (0 rápido, 1 robusto, 2 archivo, 3 discreto). */
export function encodeWith(data: Uint8Array, id: number): Float32Array {
  if (id === DISCRETO_ID) return encode(data, DISCRETO, ULTRA);
  return id === OFDM_ID ? encodeOfdm(data) : encode(data, PROFILES[id]);
}
export function airtimeWith(len: number, id: number): number {
  if (id === DISCRETO_ID) return frameSamples(len, DISCRETO, ULTRA) / FS;
  return (id === OFDM_ID ? ofdmPayloadOffset() + ofdmSamples(len) + GAP + PRE_LEN : frameSamples(len, PROFILES[id])) / FS;
}

// ---------- receiver ----------
export interface DecodeStats {
  start: number;
  end: number;
  score: number;
  ppmEstimate: number;
  symbols: number;
  rsCorrected: number;
  erasureRetries: number;
  profile?: number;
}
export interface Decoded {
  data: Uint8Array;
  stats: DecodeStats;
}

/** |H(f)|^2 at every modem bin, from the received preamble. */
function chirpEqualiser(rx: Float32Array, at: number, p: MfskParams, fam: Family = PHONE): Float64Array {
  const PRE_LEN = fam.preLen;
  const PRE = fam.pre;
  const n = PRE_LEN + 2048 <= 8192 ? 8192 : 16384;
  const f = Fft.of(n);
  const rr = new Float64Array(n);
  const ri = new Float64Array(n);
  const cr = new Float64Array(n);
  const ci = new Float64Array(n);
  for (let i = 0; i < PRE_LEN + 2048 && at + i < rx.length; i++) rr[i] = rx[at + i]!;
  for (let i = 0; i < PRE_LEN; i++) cr[i] = PRE[i]!;
  f.transform(rr, ri);
  f.transform(cr, ci);
  const ratio = n / p.N;
  const nb = p.N / 2;
  const h2 = new Float64Array(nb);
  for (let b = p.bin0; b < nb; b++) {
    let num = 0;
    let den = 0;
    const c0 = Math.round(b * ratio);
    for (let j = c0 - ratio; j <= c0 + ratio; j++) {
      num += rr[j]! * rr[j]! + ri[j]! * ri[j]!;
      den += cr[j]! * cr[j]! + ci[j]! * ci[j]!;
    }
    h2[b] = num / Math.max(den, 1e-12) + 1e-12;
  }
  return h2;
}

function symbolEnergies(rx: Float32Array, start: number, p: MfskParams, re: Float64Array, im: Float64Array): Float64Array {
  re.fill(0);
  im.fill(0);
  const s = Math.round(start);
  for (let i = 0; i < p.N; i++) re[i] = rx[s + i] ?? 0;
  Fft.of(p.N).transform(re, im);
  const nb = p.N / 2;
  const e = new Float64Array(nb);
  for (let b = p.bin0; b < nb; b++) e[b] = re[b]! * re[b]! + im[b]! * im[b]!;
  return e;
}

interface Soft {
  bytes: Uint8Array;
  conf: Float64Array; // per byte, higher = more reliable
}

function decide(energies: Float64Array[], norm: Float64Array, p: MfskParams, nbytes: number, k0: number): Soft {
  const bytes = new Uint8Array(nbytes);
  const conf = new Float64Array(nbytes).fill(Infinity);
  const bpt = bitsPerTone(p);
  energies.forEach((e, s) => {
    const hop = (k0 + s) % p.H;
    for (let g = 0; g < p.ng; g++) {
      let best = -1;
      let b1 = -Infinity;
      let b2 = -Infinity;
      for (let t = 0; t < p.M; t++) {
        const bin = binOf(p, g, t, hop);
        const v = e[bin]! / norm[bin]!;
        if (v > b1) {
          b2 = b1;
          b1 = v;
          best = t;
        } else if (v > b2) b2 = v;
      }
      const c = b1 / Math.max(b2, 1e-30);
      const bit0 = (s * p.ng + g) * bpt;
      for (let q = 0; q < bpt; q++) {
        const bit = bit0 + q;
        const bi = bit >> 3;
        if (bi >= nbytes) break;
        if ((best >> (bpt - 1 - q)) & 1) bytes[bi]! |= 1 << (7 - (bit & 7));
        conf[bi] = Math.min(conf[bi]!, c);
      }
    }
  });
  return { bytes, conf };
}

/**
 * Candidate decodings of one codeword: plain errors-only decoding, then errors-and-erasures
 * with growing numbers of the least reliable bytes erased. Heavier erasure leaves fewer
 * check symbols, so a candidate can be a miscorrection: the frame CRC-32 picks the right one.
 */
function candidates(cw: Uint8Array, conf: ArrayLike<number>, nsym: number, useErasures: boolean): { data: Uint8Array; corrected: number }[] {
  const out: { data: Uint8Array; corrected: number }[] = [];
  const seen = new Set<string>();
  const push = (r: { ok: boolean; data: Uint8Array; corrected: number }) => {
    if (!r.ok) return;
    const key = r.data.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ data: r.data, corrected: r.corrected });
  };
  push(rsDecode(cw, nsym));
  if (!useErasures) return out;
  const order = Array.from({ length: cw.length }, (_, i) => i).sort((a, b) => conf[a]! - conf[b]!);
  for (const f of [nsym / 4, nsym / 2, (3 * nsym) / 4, nsym - 4].map(Math.floor)) {
    if (f > 0) push(rsDecode(cw, nsym, order.slice(0, f)));
  }
  return out;
}

function decodeWithErasures(cw: Uint8Array, conf: ArrayLike<number>, nsym: number, useErasures: boolean): { ok: boolean; data: Uint8Array; corrected: number; retries: number } {
  const c = candidates(cw, conf, nsym, useErasures);
  if (!c.length) return { ok: false, data: cw.slice(0, cw.length - nsym), corrected: 0, retries: 0 };
  return { ok: true, data: c[0]!.data, corrected: c[0]!.corrected, retries: c.length - 1 };
}

/** Clock ratio rx/tx from the down-chirp postamble expected endOff samples after the preamble. */
function clockRatio(rx: Float32Array, at: number, endOff: number, threshold: number, fam: Family = PHONE): number {
  const PRE_LEN = fam.preLen;
  const tol = Math.round(endOff * 600e-6) + 400;
  let ratio = 1;
  const exp = at + endOff;
  const tail = ncc(prefilter(rx.subarray(Math.max(0, exp - tol - 2000), Math.min(rx.length, exp + tol + PRE_LEN + 2000)), fam.lo, fam.hi), fam.post);
  const base = Math.max(0, exp - tol - 2000);
  let best = -1;
  let bestV = 0;
  for (let i = 0; i < tail.length; i++) {
    const pos = base + i;
    if (pos < exp - tol || pos > exp + tol) continue;
    if (tail[i]! > bestV) {
      bestV = tail[i]!;
      best = pos;
    }
  }
  if (best >= 0 && bestV > threshold * 0.8) {
    const atMax = best;
    // earliest arrival reaching 60 % of the maximum
    for (let j = Math.max(exp - tol, best - 300); j < best; j++) {
      const v = tail[j - base]!;
      if (v >= 0.6 * bestV && v >= tail[j - base - 1]! && v >= tail[j - base + 1]!) {
        best = j;
        break;
      }
    }
    // on short frames a correlation sidelobe can pass for the earliest arrival and give an
    // impossible drift: then trust the maximum, and failing that assume no drift
    const plausible = (r: number) => Math.abs(r - 1) <= 300e-6;
    if (typeof process !== "undefined" && process.env?.MFSK_DEBUG) console.error("[mfsk] post", { exp, early: best, atMax, bestV, tol });
    ratio = (best - at) / endOff;
    if (!plausible(ratio)) ratio = (atMax - at) / endOff;
    if (!plausible(ratio)) ratio = 1;
  }
  return ratio;
}

/**
 * Preamble detector threshold (normalised correlation). 0.25 missed 2 of 10 real frames buried
 * in loud simulated ambience (NCC 0.21 and 0.25 at the true position) while ambience alone never
 * passed 0.18; candidates below that are cheap to reject because the header must pass RS(12,4)
 * and CRC-8 and the payload CRC-32, so the threshold sits lower, at 0.15.
 */
export const DETECT_THRESHOLD = 0.15;

/**
 * Every frame of one family in rx. skipBefore: frames starting before this sample were already
 * decoded (the app's sliding windows overlap). Frames that the header says end beyond rx are
 * left for the next window instead of being decoded and failing.
 */
export function decodeAll(rx: Float32Array, override?: MfskParams, threshold = DETECT_THRESHOLD, fam: Family = PHONE, skipBefore = -1): Decoded[] {
  const HDR = fam.hdr;
  const PRE_LEN = fam.preLen;
  let p = HDR;
  const S = symLen(p);
  const xf = prefilter(rx, fam.lo, fam.hi);
  const peaks = findChirps(xf, fam.pre, threshold, PRE_LEN);
  const out: Decoded[] = [];
  const re = new Float64Array(p.N);
  const im = new Float64Array(p.N);
  let busyUntil = skipBefore;
  const hs = hdrSymbols(fam);
  const d0 = PRE_LEN + GAP;
  const dbg = typeof process !== 'undefined' && process.env?.MFSK_DEBUG ? (...a: unknown[]) => console.error('[mfsk]', ...a) : () => {};
  dbg('peaks', peaks.map((q) => `${q.index}:${q.score.toFixed(2)}`).join(' '));
  for (const pk of peaks) {
    if (pk.index < busyUntil) continue;
    const eq = chirpEqualiser(rx, pk.index, HDR, fam);
    const win = (k: number, r: number) => pk.index + (d0 + k * S) * r + p.G + p.evalOffset;
    // header
    const hE: Float64Array[] = [];
    for (let k = 0; k < hs; k++) hE.push(symbolEnergies(rx, win(k, 1), HDR, re, im));
    const hSoft = decide(hE, eq, HDR, HDR_BYTES + HDR_PARITY, 0);
    const hdr = decodeWithErasures(scramble(hSoft.bytes, HDR_SEED), hSoft.conf, HDR_PARITY, true);
    if (!hdr.ok) {
      dbg('header RS fail at', pk.index);
      continue;
    }
    const h = hdr.data;
    if (h[0]! >> 4 !== VERSION || crc8(h.subarray(0, 3)) !== h[3]) {
      dbg('header check fail', Array.from(h));
      continue;
    }
    const pid = h[0]! & 15;
    const len0 = (h[1]! << 8) | h[2]!;
    if (pid === OFDM_ID && fam.ofdm) {
      const p0 = ofdmPayloadOffset();
      const endOffO = p0 + ofdmSamples(len0) + GAP;
      if (pk.index + (endOffO + PRE_LEN) * 1.0003 > rx.length) {
        dbg('ofdm frame not complete yet at', pk.index);
        continue;
      }
      const ratioO = clockRatio(rx, pk.index, endOffO, threshold);
      const data = ofdmDecode(rx, pk.index + p0 * ratioO, ratioO, len0);
      if (!data) {
        dbg('ofdm crc fail at', pk.index, 'ratio', ratioO);
        continue;
      }
      const end = Math.round(pk.index + (endOffO + PRE_LEN) * ratioO);
      busyUntil = end;
      out.push({ data, stats: { start: pk.index, end, score: pk.score, ppmEstimate: (ratioO - 1) * 1e6, symbols: hs, rsCorrected: 0, erasureRetries: 0, profile: OFDM_ID } });
      continue;
    }
    const prof = override && override.id === pid ? override : fam.profiles[pid];
    if (!prof) {
      dbg('unknown profile', pid);
      continue;
    }
    p = prof;
    const len = (h[1]! << 8) | h[2]!;
    const lay = layout(len, p);
    // postamble: clock ratio
    const endOff = d0 + (hs + lay.symbols) * S + GAP;
    if (pk.index + (endOff + PRE_LEN) * 1.0003 > rx.length) {
      dbg('frame not complete yet at', pk.index);
      continue;
    }
    const ratio = clockRatio(rx, pk.index, endOff, threshold, fam);
    // payload
    const E: Float64Array[] = [];
    for (let k = 0; k < lay.symbols; k++) E.push(symbolEnergies(rx, win(hs + k, ratio), p, re, im));
    let norm = eq;
    if (p.binNorm && lay.symbols >= 24) {
      // mean energy per bin over the payload: every tone is used ~1/16 of the time
      const nb = p.N / 2;
      const m = new Float64Array(nb);
      for (const e of E) for (let b = p.bin0; b < nb; b++) m[b]! += e[b]!;
      norm = m.map((v) => v / E.length + 1e-12);
    }
    const soft = decide(E, norm, p, lay.coded, 0);
    const stream = scramble(soft.bytes, PAY_SEED);
    const maps = deinterleaveMap(lay.codewords.map((k) => k + p.parity));
    const cands: { data: Uint8Array; corrected: number }[][] = [];
    for (let i = 0; i < maps.length; i++) {
      const m = maps[i]!;
      const cw = Uint8Array.from(m.map((q) => stream[q]!));
      const cf = m.map((q) => soft.conf[q]!);
      const c = candidates(cw, cf, p.parity, p.erasures);
      if (!c.length) {
        dbg('codeword', i, 'of', maps.length, 'failed; ratio', ratio, 'peak', pk.index);
        break;
      }
      cands.push(c);
    }
    if (cands.length < maps.length) continue;
    // try combinations (first candidates first) until the CRC-32 matches; capped at 64
    let data: Uint8Array | null = null;
    let corrected = 0;
    let retries = 0;
    const idx = cands.map(() => 0);
    for (let attempt = 0; attempt < 64; attempt++) {
      const full = new Uint8Array(len + 4);
      let off = 0;
      for (let i = 0; i < cands.length; i++) {
        full.set(cands[i]![idx[i]!]!.data, off);
        off += cands[i]![idx[i]!]!.data.length;
      }
      const d = full.slice(0, len);
      const c = ((full[len]! << 24) | (full[len + 1]! << 16) | (full[len + 2]! << 8) | full[len + 3]!) >>> 0;
      if (crc32(d) === c) {
        data = d;
        corrected = cands.reduce((a, cs, i) => a + cs[idx[i]!]!.corrected, 0);
        retries = attempt;
        break;
      }
      // odometer over codewords that have alternatives
      let j = 0;
      while (j < cands.length) {
        idx[j]!++;
        if (idx[j]! < cands[j]!.length) break;
        idx[j] = 0;
        j++;
      }
      if (j === cands.length) break;
    }
    if (!data) {
      dbg('crc32 fail');
      continue;
    }
    const end = Math.round(pk.index + (endOff + PRE_LEN) * ratio);
    busyUntil = end;
    out.push({
      data,
      stats: {
        start: pk.index,
        end,
        score: pk.score,
        ppmEstimate: (ratio - 1) * 1e6,
        symbols: hs + lay.symbols,
        rsCorrected: corrected,
        erasureRetries: retries,
        profile: pid,
      },
    });
  }
  return out;
}

/** Both families: every frame in rx, in order of arrival. */
export function decodeAny(rx: Float32Array, skipBefore = -1): Decoded[] {
  return [...decodeAll(rx, undefined, DETECT_THRESHOLD, PHONE, skipBefore), ...decodeAll(rx, undefined, ULTRA.threshold, ULTRA, skipBefore)].sort((a, b) => a.stats.start - b.stats.start);
}

export function airtimeSeconds(len: number, p: MfskParams = DEFAULT): number {
  return frameSamples(len, p) / FS;
}

export { bitsPerSymbol };

// ---------- diagnostics (used by tools/, not by the receiver) ----------
/** Tones sent for each symbol (header first). */
export function txTones(data: Uint8Array, p: MfskParams = DEFAULT): Uint8Array[] {
  const h = new Uint8Array(HDR_BYTES);
  h[0] = (VERSION << 4) | p.id;
  h[1] = data.length >> 8;
  h[2] = data.length & 255;
  h[3] = crc8(h.subarray(0, 3));
  const hcw = scramble(rsEncode(h, HDR_PARITY), HDR_SEED);
  const lay = layout(data.length, p);
  const c = crc32(data);
  const full = new Uint8Array(data.length + 4);
  full.set(data);
  full.set([c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255], data.length);
  const cws: Uint8Array[] = [];
  let off = 0;
  for (const k of lay.codewords) {
    cws.push(rsEncode(full.subarray(off, off + k), p.parity));
    off += k;
  }
  const stream = scramble(interleave(cws), PAY_SEED);
  return [...bytesToSymbols(hcw, hdrSymbols(), HDR), ...bytesToSymbols(stream, lay.symbols, p)];
}

/** Hard tone decisions for nsyms symbols after a preamble found at `at`, with a given clock ratio. */
export function rxTones(rx: Float32Array, at: number, nsyms: number, ratio: number, p: MfskParams = DEFAULT, useEq = true): Uint8Array[] {
  const S = symLen(p);
  const re = new Float64Array(p.N);
  const im = new Float64Array(p.N);
  const eq = useEq ? chirpEqualiser(rx, at, p) : new Float64Array(p.N / 2).fill(1);
  const out: Uint8Array[] = [];
  const hs = hdrSymbols();
  const p0 = p;
  for (let k = 0; k < nsyms; k++) {
    p = k < hs ? HDR : p0;
    const hop = k < hs ? k % HDR.H : (k - hs) % p.H;
    const e = symbolEnergies(rx, at + (PRE_LEN + GAP + k * S) * ratio + p.G + p.evalOffset, p, re, im);
    const t = new Uint8Array(p.ng);
    for (let g = 0; g < p.ng; g++) {
      let best = 0;
      let bv = -1;
      for (let q = 0; q < p.M; q++) {
        const v = e[binOf(p, g, q, hop)]! / eq[binOf(p, g, q, hop)]!;
        if (v > bv) {
          bv = v;
          best = q;
        }
      }
      t[g] = best;
    }
    out.push(t);
  }
  return out;
}
export function findPreamble(rx: Float32Array, threshold = 0.25): number[] {
  return findChirps(prefilter(rx, 700, 8000), PRE, threshold, PRE_LEN).map((q) => q.index);
}
