// Self-checks of the channel simulator: does each impairment do what it claims?
import { simulate } from '../src/sim/channel.ts';
import { ROOMS, makeRir } from '../src/sim/rooms.ts';
import { applyBiquads, bandpassSections, power } from '../src/dsp/filters.ts';
import { Rng } from '../src/dsp/rng.ts';

const FS = 48000;

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

function rt60(h: Float32Array): number {
  // Schroeder backward integration, T20 fit (-5 to -25 dB) extrapolated to 60 dB
  const e = new Float64Array(h.length);
  let acc = 0;
  for (let i = h.length - 1; i >= 0; i--) {
    acc += h[i]! * h[i]!;
    e[i] = acc;
  }
  const db = (i: number) => 10 * Math.log10(e[i]! / e[0]!);
  let i5 = 0;
  while (db(i5) > -5) i5++;
  let i25 = i5;
  while (i25 < h.length - 1 && db(i25) > -25) i25++;
  return ((i25 - i5) / FS) * 3;
}

function tone(sec: number, f: number, amp = 0.5): Float32Array {
  const x = new Float32Array(Math.round(sec * FS));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / FS);
  return x;
}

export function simChecks(): Check[] {
  const out: Check[] = [];
  // rooms: RT60 and DRR of the synthetic impulse responses
  for (const r of ['small', 'medium', 'large']) {
    const spec = ROOMS[r]!;
    let t = 0;
    let drr = 0;
    for (let s = 0; s < 5; s++) {
      const h = makeRir(FS, spec, 100 + s);
      t += rt60(h) / 5;
      let peak = 0;
      let pi = 0;
      for (let i = 0; i < h.length; i++) if (Math.abs(h[i]!) > peak) {
        peak = Math.abs(h[i]!);
        pi = i;
      }
      let rest = 0;
      for (let i = 0; i < h.length; i++) if (i !== pi) rest += h[i]! * h[i]!;
      drr += (10 * Math.log10((peak * peak) / rest)) / 5;
    }
    const ok = Math.abs(t - spec.rt60) / spec.rt60 < 0.15 && Math.abs(drr - spec.drrDb) < 1;
    out.push({ name: `sala ${r}`, ok, detail: `RT60 medido ${t.toFixed(2)} s (pedido ${spec.rt60}), DRR ${drr.toFixed(1)} dB (pedido ${spec.drrDb})` });
  }
  // SNR: noise-only lead-in vs signal+noise, in the 500-8000 Hz band
  for (const snr of [5, 15, 25]) {
    const { rx, signalStart } = simulate(tone(2, 3000), FS, { room: 'none', snrDb: snr, ppm: 0, saturation: false, agc: false, seed: 7, leadSeconds: 1, noise: 'pink' });
    const b = applyBiquads(rx, bandpassSections(FS, 500, 8000, 4));
    const pn = power(b, 4800, signalStart - 4800);
    const psn = power(b, signalStart + 4800, signalStart + FS);
    const est = 10 * Math.log10((psn - pn) / pn);
    out.push({ name: `SNR ${snr} dB`, ok: Math.abs(est - snr) < 1, detail: `medido ${est.toFixed(2)} dB en 500-8000 Hz` });
  }
  // clock drift: two clicks 2 s apart arrive 2 s * (1 + ppm) apart
  for (const ppm of [-200, 200]) {
    const x = new Float32Array(2 * FS + 10);
    x[0] = 1;
    x[2 * FS] = 1;
    const { rx } = simulate(x, FS, { room: 'none', snrDb: null, ppm, saturation: false, agc: false, seed: 1, leadSeconds: 0.5 });
    const peakNear = (c: number) => {
      let bi = c - 2000;
      for (let i = c - 2000; i < c + 2000; i++) if (Math.abs(rx[i]!) > Math.abs(rx[bi]!)) bi = i;
      const a = Math.abs(rx[bi - 1]!);
      const b = Math.abs(rx[bi]!);
      const c2 = Math.abs(rx[bi + 1]!);
      return bi + (0.5 * (a - c2)) / (a - 2 * b + c2);
    };
    const p0 = peakNear(Math.round(0.5 * FS * (1 + ppm * 1e-6)) + 200);
    const p1 = peakNear(Math.round(2.5 * FS * (1 + ppm * 1e-6)) + 200);
    const est = ((p1 - p0) / (2 * FS) - 1) * 1e6;
    out.push({ name: `deriva ${ppm} ppm`, ok: Math.abs(est - ppm) < 10, detail: `medida ${est.toFixed(1)} ppm` });
  }
  // saturation: clipping happens only when asked
  for (const sat of [false, true]) {
    const { rx } = simulate(tone(1, 2000, 0.9), FS, { room: 'none', snrDb: 30, ppm: 0, saturation: sat, agc: false, seed: 3, leadSeconds: 0.2 });
    let clipped = 0;
    for (let i = 0; i < rx.length; i++) if (Math.abs(rx[i]!) >= 0.999) clipped++;
    const frac = clipped / rx.length;
    out.push({ name: `saturación ${sat ? 'sí' : 'no'}`, ok: sat ? frac > 0.05 : frac === 0, detail: `${(100 * frac).toFixed(1)} % de muestras recortadas` });
  }
  // AGC: a 40 dB quieter input ends up at a similar level
  const levels = [0.9, 0.009].map((a) => {
    const { rx } = simulate(tone(2, 2000, a), FS, { room: 'none', snrDb: null, ppm: 0, saturation: false, agc: true, seed: 3, leadSeconds: 0.2 });
    return 10 * Math.log10(power(rx, FS, 2 * FS));
  });
  out.push({ name: 'control automático de ganancia', ok: Math.abs(levels[0]! - levels[1]!) < 3, detail: `nivel de salida ${levels.map((l) => l.toFixed(1)).join(' / ')} dBFS con entradas a 0 y -40 dB` });
  void Rng;
  return out;
}
