// Synthetic café noise: several "talkers" (glottal pulse trains through moving formant
// resonators, with syllable-rate envelopes and pauses, plus unvoiced fricatives), dish and
// cutlery clinks, and a low room rumble. Everything is synthesised from the seed: no recorded
// (or copyrighted) audio.
import { Rng, filter, resonator, butterBand, butterLow, butterHigh } from '../lib/dsp.ts';

// first three formants (Hz) of five Spanish-like vowels
const VOWELS: [number, number, number][] = [
  [750, 1300, 2600], // a
  [500, 1900, 2600], // e
  [300, 2300, 3000], // i
  [500, 900, 2500], // o
  [320, 800, 2400], // u
];

function talker(n: number, fs: number, rng: Rng): Float32Array {
  const out = new Float32Array(n);
  const f0base = rng.uniform(95, 240);
  let phase = 0;
  let i = 0;
  // state of the three formant resonators (direct form, coefficients change per syllable)
  const y1 = [0, 0, 0];
  const y2 = [0, 0, 0];
  const x1 = [0, 0, 0];
  const x2 = [0, 0, 0];
  while (i < n) {
    // a syllable 120-300 ms, sometimes a pause 100-600 ms
    if (rng.next() < 0.18) {
      i += Math.round(rng.uniform(0.1, 0.6) * fs);
      continue;
    }
    const len = Math.round(rng.uniform(0.12, 0.3) * fs);
    const v = VOWELS[rng.int(VOWELS.length)]!;
    const fric = rng.next() < 0.3; // starts with an unvoiced consonant (s, f, j...)
    const fricLen = fric ? Math.round(rng.uniform(0.04, 0.1) * fs) : 0;
    const secs = v.map((f, k) => resonator(fs, f * rng.uniform(0.9, 1.1), 60 + 40 * k));
    const pitch = f0base * rng.uniform(0.85, 1.2);
    const amp = rng.uniform(0.5, 1);
    for (let j = 0; j < len && i + j < n; j++) {
      const env = Math.sin((Math.PI * j) / len) ** 1.5 * amp;
      let src: number;
      if (j < fricLen) src = rng.gauss() * 0.25;
      else {
        phase += (pitch * (1 + 0.01 * Math.sin((2 * Math.PI * 5 * j) / fs))) / fs;
        // glottal pulse: a sharp decaying excitation once per period
        const fr = phase - Math.floor(phase);
        src = fr < 0.4 ? Math.sin(Math.PI * (fr / 0.4)) ** 2 - 0.3 : -0.3;
        src += rng.gauss() * 0.02;
      }
      let y = 0;
      for (let k = 0; k < 3; k++) {
        const s = secs[k]!;
        const yk = s.b0 * src + s.b1 * x1[k]! + s.b2 * x2[k]! - s.a1 * y1[k]! - s.a2 * y2[k]!;
        x2[k] = x1[k]!;
        x1[k] = src;
        y2[k] = y1[k]!;
        y1[k] = yk;
        y += yk / (k + 1);
      }
      out[i + j] = env * y;
    }
    i += len;
  }
  // fricative energy sits high: let it through, but tame the low end like a distant voice
  return filter(out, butterBand(fs, 120, 7000, 2));
}

function clinks(n: number, fs: number, rng: Rng, ratePerS: number): Float32Array {
  const out = new Float32Array(n);
  let t = 0;
  for (;;) {
    t += -Math.log(1 - rng.next()) / ratePerS;
    const s = Math.round(t * fs);
    if (s >= n) break;
    const amp = rng.uniform(0.3, 1.5);
    const partials = Array.from({ length: 3 }, () => ({ f: rng.uniform(1800, 7000), tau: rng.uniform(0.01, 0.08) * fs, ph: rng.uniform(0, 6.28) }));
    const len = Math.round(0.25 * fs);
    for (let j = 0; j < len && s + j < n; j++) {
      let v = 0;
      for (const p of partials) v += Math.exp(-j / p.tau) * Math.sin((2 * Math.PI * p.f * j) / fs + p.ph);
      out[s + j]! += amp * v;
    }
  }
  return out;
}

/** n samples of café noise (unit-free; the channel scales it to the requested SNR). */
export function babble(n: number, fs: number, rng: Rng, talkers = 6): Float32Array {
  const out = new Float32Array(n);
  for (let k = 0; k < talkers; k++) {
    const t = talker(n, fs, rng);
    const g = rng.uniform(0.4, 1); // nearer and farther talkers
    for (let i = 0; i < n; i++) out[i]! += g * t[i]!;
  }
  // normalise talkers to unit RMS before adding the other sources at fixed ratios
  let p = 0;
  for (let i = 0; i < n; i++) p += out[i]! * out[i]!;
  const g = 1 / Math.sqrt(p / n + 1e-20);
  for (let i = 0; i < n; i++) out[i]! *= g;
  const c = clinks(n, fs, rng, 0.6);
  const rumbleSrc = new Float32Array(n);
  for (let i = 0; i < n; i++) rumbleSrc[i] = rng.gauss();
  const rumble = filter(filter(rumbleSrc, butterLow(fs, 250, 2)), butterHigh(fs, 30, 2));
  for (let i = 0; i < n; i++) out[i]! += 0.25 * c[i]! + 0.6 * rumble[i]!;
  return out;
}
