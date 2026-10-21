// Acoustic channel simulator for phone-to-phone transmission.
// speaker (soft clip + band limit) -> room (RIR) -> clock drift -> ambient noise at a given
// in-band SNR -> microphone band -> preamp + ADC clipping -> AGC -> 16-bit quantisation.
import { Rng } from '../dsp/rng.ts';
import { convolve } from '../dsp/fft.ts';
import { applyBiquads, bandpassSections, highpass, lowpass, peaking, butterworthQs, power } from '../dsp/filters.ts';
import { ROOMS, makeRir } from './rooms.ts';
import { pinkNoise, whiteNoise } from './noise.ts';

export interface ChannelOptions {
  snrDb: number | null; // in-band (500-8000 Hz) SNR during the transmission; null = no noise
  room: keyof typeof ROOMS | string;
  ppm: number; // receiver clock offset relative to the sender
  saturation: boolean; // overdriven speaker and clipping microphone ADC
  agc: boolean;
  seed: number;
  noise?: 'pink' | 'white';
  band?: 'phone' | 'ultrasonic';
  leadSeconds?: number; // silence (noise) before the signal; random 0.3-0.8 s if absent
  ultraMicHz?: number; // near-ultrasound model only: microphone cut-off (default 20 kHz; many phones cut lower)
}

export const SNR_BAND: [number, number] = [500, 8000];

/** Speaker + microphone response of a cheap phone (assumption, documented in CANAL.md). */
function phoneSpeaker(fs: number) {
  return [
    ...butterworthQs(4).map((q) => highpass(fs, 450, q)),
    ...butterworthQs(4).map((q) => lowpass(fs, 9000, q)),
    peaking(fs, 2500, 4, 1.2), // small-speaker resonance
    peaking(fs, 5500, -5, 2), // and a dip
  ];
}
function phoneMic(fs: number) {
  return [highpass(fs, 100), lowpass(fs, 15000)];
}
/** Near-ultrasound: cheap speakers and mics roll off steeply above ~18 kHz. */
function ultraSpeaker(fs: number) {
  return [
    ...butterworthQs(4).map((q) => highpass(fs, 450, q)),
    ...butterworthQs(4).map((q) => lowpass(fs, 18500, q)),
    peaking(fs, 19500, -6, 1),
  ];
}
function ultraMic(fs: number, cut = 20000) {
  return [highpass(fs, 100), ...butterworthQs(4).map((q) => lowpass(fs, cut, q))];
}

export function resample(x: Float32Array, ratio: number): Float32Array {
  // y[m] = x(m / ratio): windowed-sinc interpolation (Blackman, 32 taps)
  if (ratio === 1) return Float32Array.from(x);
  const outLen = Math.floor((x.length - 1) * ratio);
  const y = new Float32Array(outLen);
  const half = 16;
  for (let m = 0; m < outLen; m++) {
    const t = m / ratio;
    const i0 = Math.floor(t);
    let acc = 0;
    for (let k = i0 - half + 1; k <= i0 + half; k++) {
      if (k < 0 || k >= x.length) continue;
      const d = t - k;
      const s = d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d);
      const w = 0.42 + 0.5 * Math.cos((Math.PI * d) / half) + 0.08 * Math.cos((2 * Math.PI * d) / half);
      acc += x[k]! * s * w;
    }
    y[m] = acc;
  }
  return y;
}

export interface ChannelResult {
  rx: Float32Array;
  signalStart: number; // index in rx where the direct sound of the first tx sample arrives (approx.)
}

export function simulate(tx: Float32Array, fs: number, o: ChannelOptions): ChannelResult {
  const rng = new Rng(o.seed ^ 0x5eed);
  const ultra = o.band === 'ultrasonic';
  const lead = Math.round((o.leadSeconds ?? rng.uniform(0.3, 0.8)) * fs);
  const tail = Math.round(0.5 * fs);
  // 1. speaker
  let s: Float32Array = new Float32Array(lead + tx.length + tail);
  const drive = o.saturation ? 3 : 1;
  for (let i = 0; i < tx.length; i++) s[lead + i] = o.saturation ? Math.tanh(drive * tx[i]!) : tx[i]!;
  s = applyBiquads(s, ultra ? ultraSpeaker(fs) : phoneSpeaker(fs));
  // 2. room
  const spec = ROOMS[o.room];
  if (!spec) throw new Error(`unknown room ${o.room}`);
  if (spec.rt60 > 0) s = convolve(s, makeRir(fs, spec, o.seed ^ 0x51a, ultra ? 0 : 7000)).subarray(0, s.length + Math.round(spec.rt60 * fs));
  // 3. clock drift
  const ratio = 1 + o.ppm * 1e-6;
  s = resample(s, ratio);
  const signalStart = Math.round((lead + 0.003 * fs) * ratio);
  const sigEnd = Math.round((lead + tx.length) * ratio);
  // 4. noise at the requested in-band SNR
  const band = ultra ? bandpassSections(fs, 16500, 20500, 4) : bandpassSections(fs, SNR_BAND[0], SNR_BAND[1], 4);
  if (o.snrDb !== null) {
    const nz = o.noise === 'white' ? whiteNoise(s.length, rng) : pinkNoise(s.length, rng);
    const ps = power(applyBiquads(s, band), signalStart, sigEnd);
    const pn = power(applyBiquads(nz, band));
    const g = Math.sqrt(ps / pn / Math.pow(10, o.snrDb / 10));
    for (let i = 0; i < s.length; i++) s[i]! += g * nz[i]!;
  }
  // 5. microphone
  s = applyBiquads(s, ultra ? ultraMic(fs, o.ultraMicHz) : phoneMic(fs));
  // 6. preamp + ADC clipping
  let peak = 0;
  for (let i = 0; i < s.length; i++) peak = Math.max(peak, Math.abs(s[i]!));
  const pre = (o.saturation ? 2.5 : 0.5) / (peak || 1);
  for (let i = 0; i < s.length; i++) s[i] = Math.max(-1, Math.min(1, s[i]! * pre));
  // 7. AGC (block RMS follower: attack 50 ms, release 500 ms, target RMS 0.1)
  if (o.agc) {
    const blk = Math.round(0.01 * fs);
    let env = 0.1;
    let gPrev = 1;
    for (let b0 = 0; b0 < s.length; b0 += blk) {
      const e = Math.sqrt(power(s, b0, Math.min(s.length, b0 + blk))) + 1e-6;
      const tc = e > env ? 0.05 : 0.5;
      env += (e - env) * (1 - Math.exp(-0.01 / tc));
      const g = Math.max(0.05, Math.min(30, 0.1 / env));
      const end = Math.min(s.length, b0 + blk);
      for (let i = b0; i < end; i++) {
        const gi = gPrev + ((g - gPrev) * (i - b0)) / blk;
        s[i] = Math.max(-1, Math.min(1, s[i]! * gi));
      }
      gPrev = g;
    }
  }
  // 8. 16-bit quantisation
  for (let i = 0; i < s.length; i++) s[i] = Math.round(s[i]! * 32767) / 32767;
  return { rx: s, signalStart };
}
