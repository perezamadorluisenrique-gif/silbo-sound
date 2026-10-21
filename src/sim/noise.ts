// Noise sources: white, pink, and a "10 minutes of a room" ambience generator for
// false-positive tests (babble-like modulated noise, music-like tones, clicks, beeps, glides).
import { Rng } from '../dsp/rng.ts';
import { applyBiquads, bandpassSections } from '../dsp/filters.ts';

export function whiteNoise(n: number, rng: Rng): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = rng.gauss();
  return x;
}

/** Pink (1/f) noise: white noise through a 3-pole/3-zero IIR approximation (J. O. Smith). */
export function pinkNoise(n: number, rng: Rng): Float32Array {
  const b = [0.049922035, -0.095993537, 0.050612699, -0.004408786];
  const a = [1, -2.494956002, 2.017265875, -0.5221894];
  const x = new Float32Array(n);
  const xs = [0, 0, 0, 0];
  const ys = [0, 0, 0, 0];
  for (let i = 0; i < n + 2000; i++) {
    xs.unshift(rng.gauss());
    xs.pop();
    const y = b[0]! * xs[0]! + b[1]! * xs[1]! + b[2]! * xs[2]! + b[3]! * xs[3]! - a[1]! * ys[0]! - a[2]! * ys[1]! - a[3]! * ys[2]!;
    ys.unshift(y);
    ys.pop();
    if (i >= 2000) x[i - 2000] = y * 8;
  }
  return x;
}

function addTone(out: Float32Array, fs: number, start: number, len: number, f0: number, f1: number, amp: number): void {
  let ph = 0;
  for (let i = 0; i < len && start + i < out.length; i++) {
    const f = f0 + ((f1 - f0) * i) / len;
    ph += (2 * Math.PI * f) / fs;
    const env = Math.min(1, i / (0.005 * fs), (len - i) / (0.005 * fs));
    out[start + i]! += amp * env * Math.sin(ph);
  }
}

/**
 * Ambient sound for false-positive tests. Deliberately includes the things most
 * likely to fool a chirp detector: whistles that glide in frequency, beeps, music.
 */
export function ambience(seconds: number, fs: number, seed: number): Float32Array {
  const rng = new Rng(seed);
  const n = Math.round(seconds * fs);
  const out = pinkNoise(n, rng);
  for (let i = 0; i < n; i++) out[i]! *= 0.05;
  // babble: band-limited noise with syllable-rate amplitude modulation, 4 talkers
  for (let t = 0; t < 4; t++) {
    const bp = applyBiquads(whiteNoise(n, rng), bandpassSections(fs, 200 + 100 * t, 3500, 2));
    let phase = rng.uniform(0, 6.28);
    const rate = rng.uniform(3, 6);
    for (let i = 0; i < n; i++) {
      phase += (2 * Math.PI * rate) / fs;
      const m = Math.max(0, Math.sin(phase)) ** 2;
      out[i]! += bp[i]! * 0.15 * m;
    }
  }
  // events
  let tt = 0;
  while (tt < seconds) {
    tt += rng.uniform(0.2, 2.0);
    const start = Math.round(tt * fs);
    const kind = rng.int(5);
    if (kind === 0) {
      // music-like: a chord of harmonics for 0.2-1 s
      const len = Math.round(rng.uniform(0.2, 1) * fs);
      const f = 110 * Math.pow(2, rng.int(36) / 12);
      for (let h = 1; h <= 8; h++) addTone(out, fs, start, len, f * h, f * h, 0.2 / h);
    } else if (kind === 1) {
      // beep
      const f = rng.uniform(800, 7000);
      addTone(out, fs, start, Math.round(rng.uniform(0.05, 0.4) * fs), f, f, 0.3);
    } else if (kind === 2) {
      // whistle / glide (up or down, the chirp detector's natural enemy)
      const f0 = rng.uniform(1000, 7000);
      const f1 = rng.uniform(1000, 7000);
      addTone(out, fs, start, Math.round(rng.uniform(0.05, 0.6) * fs), f0, f1, 0.3);
    } else if (kind === 3) {
      // clicks / keyboard
      for (let c = 0; c < 6; c++) {
        const p = start + Math.round(rng.uniform(0, 0.5) * fs);
        for (let i = 0; i < 200 && p + i < n; i++) out[p + i]! += rng.gauss() * 0.5 * Math.exp(-i / 30);
      }
    } else {
      // door slam / thump: low-frequency burst
      const len = Math.round(0.2 * fs);
      for (let i = 0; i < len && start + i < n; i++) out[start + i]! += Math.sin((2 * Math.PI * 80 * i) / fs) * Math.exp(-i / (0.05 * fs)) * 0.8;
    }
  }
  return out;
}

/**
 * Near-ultrasound ambience for the discreet mode's false-positive test: the ordinary room
 * ambience plus what does reach 16-20 kHz in real rooms: jingling keys and rustling (high-passed
 * noise bursts), sibilants, steady beacon-like tones (some TVs, shops and apps emit 18-20 kHz
 * beacons), switching-supply whine and short glides inside the band (the chirp's natural enemy).
 */
export function ultraAmbience(seconds: number, fs: number, seed: number): Float32Array {
  const rng = new Rng(seed ^ 0x17a);
  const out = ambience(seconds, fs, seed);
  const n = out.length;
  const hp = bandpassSections(fs, 12000, 22000, 2);
  let tt = 0;
  while (tt < seconds) {
    tt += rng.uniform(0.3, 2.5);
    const start = Math.round(tt * fs);
    const kind = rng.int(5);
    if (kind === 0 || kind === 1) {
      // keys / rustle / sibilant: high-passed noise burst 30-400 ms
      const len = Math.round(rng.uniform(0.03, 0.4) * fs);
      const b = applyBiquads(whiteNoise(len, rng), hp);
      const amp = rng.uniform(0.1, 0.6);
      for (let i = 0; i < len && start + i < n; i++) out[start + i]! += amp * b[i]! * Math.min(1, i / (0.003 * fs), (len - i) / (0.003 * fs));
    } else if (kind === 2) {
      // beacon / whine: steady tone 16.5-20 kHz for 0.2-3 s
      const f = rng.uniform(16500, 20000);
      addTone(out, fs, start, Math.round(rng.uniform(0.2, 3) * fs), f, f, rng.uniform(0.05, 0.3));
    } else if (kind === 3) {
      // glide inside the band
      addTone(out, fs, start, Math.round(rng.uniform(0.05, 0.5) * fs), rng.uniform(16500, 20000), rng.uniform(16500, 20000), rng.uniform(0.05, 0.3));
    } else {
      // FSK-like beacon: random tones hopping every 10-50 ms for 0.3-1.5 s
      const len = Math.round(rng.uniform(0.3, 1.5) * fs);
      const hop = Math.round(rng.uniform(0.01, 0.05) * fs);
      for (let o = 0; o < len; o += hop) {
        const f = rng.uniform(17000, 20000);
        addTone(out, fs, start + o, hop, f, f, 0.15);
      }
    }
  }
  return out;
}
