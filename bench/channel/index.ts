// Composable acoustic channel for the bench. Each impairment is a pure function with a strength
// parameter and an explicit Rng; simulate() chains the active ones in a fixed physical order:
//
//   speaker nonlinearity → distance → room reverb → café babble (acoustic) → cheap microphone
//   → clock drift + fractional start delay → white noise floor → ADC gain/clipping
//   → dropouts → 16-bit quantisation
//
// SNRs are in-band (500-8000 Hz, the codec's band) and relative to the emitted signal as heard
// at the 1 m reference point, so distance and microphone roll-off lower the effective SNR
// against a fixed noise floor, as they do in a room.
import { Rng, filter, butterBand, butterLow, butterHigh, peaking, power, resample, convolve, type Biquad } from '../lib/dsp.ts';
import { babble } from './babble.ts';

export const FS = 48000;
export const SNR_BAND: [number, number] = [500, 8000];
/** White noise floor present in every condition unless awgnDb overrides it (quiet room, phone at 1 m). */
export const BASELINE_SNR_DB = 30;

export interface Condition {
  awgnDb?: number; // white noise floor, in-band SNR (replaces the baseline floor)
  babbleDb?: number; // café noise, in-band SNR
  distanceM?: number; // speaker-to-mic distance (reference 1 m)
  rt60?: number; // room reverberation time (s)
  micHiHz?: number; // cheap microphone upper cut-off
  speakerDb?: number; // speaker overdrive (dB of drive into the soft saturator)
  clipDb?: number; // ADC overdrive: received peak this many dB above full scale
  ppm?: number; // receiver clock offset relative to the sender
  lateMs?: number; // receiver starts recording this long after the frame began
  dropoutsPerS?: number; // rate of 5-40 ms silent gaps
}

const bandSecs = (fs: number) => butterBand(fs, SNR_BAND[0], SNR_BAND[1], 4);
export function inBandPower(x: Float32Array, fs = FS, start = 0, end = x.length): number {
  return power(filter(x, bandSecs(fs)), start, end);
}

// ---------------------------------------------------------------- noise
export function whiteNoise(n: number, rng: Rng): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = rng.gauss();
  return x;
}
/** Adds `noise` to `s` in place, scaled so that in-band refPower / noise power = snrDb. Returns the gain used. */
export function addAtSnr(s: Float32Array, noise: Float32Array, refPower: number, snrDb: number, fs = FS): number {
  const pn = inBandPower(noise, fs);
  const g = Math.sqrt(refPower / pn / Math.pow(10, snrDb / 10));
  for (let i = 0; i < s.length; i++) s[i]! += g * noise[i]!;
  return g;
}

// ---------------------------------------------------------------- speaker
/**
 * Small phone speaker driven hard: asymmetric soft saturation tanh(g·x) with a second-order
 * term (even harmonics), then the speaker's low-frequency limit (high-pass 350 Hz). Output RMS
 * is matched to the input, so only the waveform changes, not the level.
 */
export function speakerNL(x: Float32Array, driveDb: number): Float32Array {
  const g = Math.pow(10, driveDb / 20);
  const tg = Math.tanh(g);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const t = Math.tanh(g * x[i]!) / tg;
    y[i] = t + 0.12 * (1 - 1 / g) * t * t;
  }
  const z = filter(y, butterHigh(FS, 350, 2));
  const k = Math.sqrt(power(x) / Math.max(power(z), 1e-30));
  for (let i = 0; i < z.length; i++) z[i]! *= k;
  return z;
}

// ---------------------------------------------------------------- distance
/** High-frequency cut-off of the distance model: beaming of a small speaker plus air absorption (assumption). */
export function distanceCutoffHz(d: number): number {
  return Math.min(20000, 16000 / Math.sqrt(Math.max(d, 0.0625)));
}
export function distanceSections(d: number, fs = FS): Biquad[] {
  return butterLow(fs, distanceCutoffHz(d), 2);
}
/** Spherical spreading 1/d (0 dB at 1 m) and a 2nd-order low-pass at 16 kHz/√d. */
export function distance(x: Float32Array, d: number, fs = FS): Float32Array {
  const y = filter(x, distanceSections(d, fs));
  const g = 1 / d;
  for (let i = 0; i < y.length; i++) y[i]! *= g;
  return y;
}

// ---------------------------------------------------------------- room
export const ROOM_VOLUME_M3 = 100;
/** Direct-to-reverberant ratio from Sabine's critical distance r_c = 0.057·√(V/RT60). */
export function drrDb(rt60: number, r: number, volume = ROOM_VOLUME_M3): number {
  const rc = 0.057 * Math.sqrt(volume / rt60);
  return 20 * Math.log10(rc / r);
}
/**
 * Synthetic room impulse response: direct path at t=0, 8 early reflections in 1-20 ms, and an
 * exponentially decaying Gaussian tail with RT60, slightly low-passed (absorption). The
 * reverberant part is scaled to the given direct-to-reverberant ratio.
 */
export function roomIr(rt60: number, drr: number, rng: Rng, fs = FS): Float32Array {
  const len = Math.round(Math.min(1.5 * rt60, 3) * fs) + 1;
  const rev = new Float64Array(len);
  for (let k = 0; k < 8; k++) {
    const t = Math.round(rng.uniform(0.001, 0.02) * fs);
    rev[t]! += rng.uniform(0.3, 0.8) * Math.exp((-6.908 * t) / fs / rt60) * (rng.next() < 0.5 ? -1 : 1);
  }
  const start = Math.round(0.002 * fs);
  const a = Math.exp((-2 * Math.PI * 6000) / fs);
  let lp = 0;
  for (let n = start; n < len; n++) {
    const t = n / fs;
    const ramp = Math.min(1, (n - start) / (0.005 * fs));
    lp = a * lp + (1 - a) * rng.gauss();
    rev[n]! += 0.5 * lp * Math.exp((-6.908 * t) / rt60) * ramp;
  }
  let e = 0;
  for (let n = 0; n < len; n++) e += rev[n]! * rev[n]!;
  const k = Math.sqrt(Math.pow(10, -drr / 10) / e);
  const h = new Float32Array(len);
  for (let n = 0; n < len; n++) h[n] = rev[n]! * k;
  h[0]! += 1;
  return h;
}
export function reverb(x: Float32Array, rt60: number, r: number, rng: Rng, fs = FS): Float32Array {
  return convolve(x, roomIr(rt60, drrDb(rt60, r), rng, fs)).subarray(0, x.length);
}

// ---------------------------------------------------------------- microphone
/** Cheap MEMS/electret capsule + phone audio path: 4th-order band-pass 300 Hz–hiHz with a +5 dB resonance at 0.75·hiHz. */
export function micSections(hiHz: number, fs = FS): Biquad[] {
  return [...butterHigh(fs, 300, 4), ...butterLow(fs, hiHz, 4), peaking(fs, 0.75 * hiHz, 5, 2.5)];
}
export function cheapMic(x: Float32Array, hiHz: number, fs = FS): Float32Array {
  return filter(x, micSections(hiHz, fs));
}

// ---------------------------------------------------------------- ADC
/** Scales so the peak sits at 10^(overDb/20) of full scale, then hard-clips to ±1. */
export function adcClip(x: Float32Array, overDb: number): { y: Float32Array; clipped: number } {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]!));
  const g = Math.pow(10, overDb / 20) / (peak || 1);
  const y = new Float32Array(x.length);
  let clipped = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]! * g;
    if (v > 1 || v < -1) clipped++;
    y[i] = Math.max(-1, Math.min(1, v));
  }
  return { y, clipped: clipped / Math.max(1, x.length) };
}
export function quantise16(x: Float32Array): void {
  for (let i = 0; i < x.length; i++) x[i] = Math.round(x[i]! * 32767) / 32767;
}

// ---------------------------------------------------------------- dropouts
/** Poisson-distributed silent gaps (5-40 ms) at ratePerS; returns the gaps applied. */
export function dropouts(x: Float32Array, ratePerS: number, rng: Rng, fs = FS): [number, number][] {
  const gaps: [number, number][] = [];
  if (ratePerS <= 0) return gaps;
  let t = 0;
  for (;;) {
    t += -Math.log(1 - rng.next()) / ratePerS;
    const s = Math.round(t * fs);
    if (s >= x.length) break;
    const len = Math.round(rng.uniform(0.005, 0.04) * fs);
    x.fill(0, s, Math.min(x.length, s + len));
    gaps.push([s, len]);
  }
  return gaps;
}

// ---------------------------------------------------------------- chain
export interface SimResult {
  rx: Float32Array;
  frameStart: number; // sample in rx where the transmitted audio's first sample arrives (negative if cut)
  ratio: number; // receiver/sender clock ratio
  clipped: number; // fraction of ADC samples clipped
}

/**
 * Pass `tx` (48 kHz, as the app plays it) through the channel. `tx` is placed after a random
 * 0.2-1.0 s lead (the receiver was already listening) with a random fractional-sample delay;
 * lateMs instead cuts tx so recording starts lateMs after the frame itself begins (the frame
 * begins frameOffset samples into tx: the app pads frames with silence).
 */
export function simulate(tx: Float32Array, c: Condition, seed: number, frameOffset = 0, fs = FS): SimResult {
  const rng = new Rng(seed);
  // independent streams so adding one impairment does not reshuffle the others' randomness
  const sub = (k: number) => new Rng((seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0);
  const late = Math.round(((c.lateMs ?? 0) / 1000) * fs);
  const lead = late > 0 ? 0 : Math.round(rng.uniform(0.2, 1.0) * fs);
  const frac = rng.next();
  const cut = late > 0 ? Math.min(frameOffset + late, tx.length) : 0;
  const sig = tx.subarray(cut);
  const tail = Math.round((0.5 + Math.min(1.5 * (c.rt60 ?? 0), 3)) * fs);
  let s = new Float32Array(lead + sig.length + tail);
  s.set(sig, lead);
  const refPower = inBandPower(s, fs, lead, lead + sig.length);
  if (c.speakerDb !== undefined) s = speakerNL(s, c.speakerDb);
  if (c.distanceM !== undefined) s = distance(s, c.distanceM, fs);
  if (c.rt60 !== undefined && c.rt60 > 0) s = reverb(s, c.rt60, c.distanceM ?? 0.5, sub(1), fs);
  if (c.babbleDb !== undefined) addAtSnr(s, babble(s.length, fs, sub(2)), refPower, c.babbleDb, fs);
  if (c.micHiHz !== undefined) s = cheapMic(s, c.micHiHz, fs);
  const ratio = 1 + (c.ppm ?? 0) * 1e-6;
  s = resample(s, ratio, frac);
  addAtSnr(s, whiteNoise(s.length, sub(3)), refPower, c.awgnDb ?? BASELINE_SNR_DB, fs);
  const adc = adcClip(s, c.clipDb ?? -6);
  s = adc.y;
  if (c.dropoutsPerS) dropouts(s, c.dropoutsPerS, sub(4), fs);
  quantise16(s);
  return { rx: s, frameStart: (lead - cut) * ratio + frac, ratio, clipped: adc.clipped };
}

/** Pure channel noise with no transmission (false-detection tests): same chain, tx = silence of `seconds`. */
export function noiseOnly(seconds: number, c: Condition, seed: number, fs = FS): Float32Array {
  // a unit-power in-band reference so SNR-defined noise lands at the level it has during a message
  const n = Math.round(seconds * fs);
  const rng = new Rng(seed);
  const sub = (k: number) => new Rng((seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0);
  const refPower = 0.08; // ≈ in-band power of a Silbo text frame at the reference point
  let s = new Float32Array(n);
  if (c.babbleDb !== undefined) addAtSnr(s, babble(n, fs, sub(2)), refPower, c.babbleDb, fs);
  if (c.micHiHz !== undefined) s = cheapMic(s, c.micHiHz, fs);
  addAtSnr(s, whiteNoise(n, sub(3)), refPower, c.awgnDb ?? BASELINE_SNR_DB, fs);
  void rng;
  const adc = adcClip(s, c.clipDb ?? -6);
  s = adc.y;
  if (c.dropoutsPerS) dropouts(s, c.dropoutsPerS, sub(4), fs);
  quantise16(s);
  return s;
}
