// Synthetic room impulse responses: direct path, sparse early reflections and an
// exponentially decaying Gaussian tail (RT60), scaled to a direct-to-reverberant ratio.
import { Rng } from '../dsp/rng.ts';

export interface RoomSpec {
  name: string;
  rt60: number; // seconds, energy decays 60 dB
  drrDb: number; // direct-to-reverberant energy ratio
  label: string;
}

export const ROOMS: Record<string, RoomSpec> = {
  none: { name: 'none', rt60: 0, drrDb: Infinity, label: 'sin sala (campo libre)' },
  small: { name: 'small', rt60: 0.3, drrDb: 6, label: 'sala pequeña (RT60 0,3 s, DRR +6 dB)' },
  medium: { name: 'medium', rt60: 0.6, drrDb: 3, label: 'sala media (RT60 0,6 s, DRR +3 dB)' },
  large: { name: 'large', rt60: 1.0, drrDb: 0, label: 'aula grande (RT60 1,0 s, DRR 0 dB)' },
};

/**
 * airLpHz: cut-off of the one-pole low-pass on the diffuse tail (air absorption). The
 * near-ultrasound model passes 0 (no low-pass): the reverberant tail is as strong at 18 kHz as
 * the room's DRR says, which is pessimistic (real rooms reverberate less up there).
 */
export function makeRir(fs: number, spec: RoomSpec, seed: number, airLpHz = 7000): Float32Array {
  if (spec.rt60 <= 0) {
    const h = new Float32Array(1);
    h[0] = 1;
    return h;
  }
  const rng = new Rng(seed);
  const d0 = Math.round(0.003 * fs); // ~1 m between phones
  const len = Math.round(Math.min(1.3 * spec.rt60, 1.5) * fs) + d0;
  const direct = new Float32Array(len);
  direct[d0] = 1;
  const rev = new Float32Array(len);
  // early reflections in the first 25 ms
  const nEarly = 10;
  for (let i = 0; i < nEarly; i++) {
    const t = d0 + Math.round(rng.uniform(0.0008, 0.025) * fs);
    const a = rng.uniform(0.3, 0.8) * Math.exp((-6.9 * (t - d0)) / fs / spec.rt60) * (rng.next() < 0.5 ? -1 : 1);
    if (t < len) rev[t]! += a;
  }
  // diffuse tail from 5 ms on, with gentle air absorption (one-pole lowpass)
  const start = d0 + Math.round(0.005 * fs);
  let lp = 0;
  const alpha = airLpHz > 0 ? Math.exp((-2 * Math.PI * airLpHz) / fs) : 0;
  for (let n = start; n < len; n++) {
    const t = (n - d0) / fs;
    const ramp = Math.min(1, (n - start) / (0.01 * fs));
    const g = rng.gauss() * Math.exp((-6.908 * t) / spec.rt60) * ramp;
    lp = alpha * lp + (1 - alpha) * g;
    rev[n]! += lp * 2;
  }
  let er = 0;
  for (let n = 0; n < len; n++) er += rev[n]! * rev[n]!;
  const scale = Math.sqrt(1 / Math.pow(10, spec.drrDb / 10) / er);
  const h = new Float32Array(len);
  for (let n = 0; n < len; n++) h[n] = direct[n]! + rev[n]! * scale;
  return h;
}
