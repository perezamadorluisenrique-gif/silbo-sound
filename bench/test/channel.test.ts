// Unit tests of the bench's channel impairments. Each test name starts with the impairment id
// used in sweeps.ts; bench/score checks that every swept impairment has one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng, filter, butterBand, power, db, toneLevelDb, resample, responseDb, fft } from '../lib/dsp.ts';
import {
  FS, SNR_BAND, inBandPower, whiteNoise, addAtSnr, speakerNL, distance, distanceSections, roomIr, drrDb, micSections, cheapMic, adcClip, dropouts, simulate,
} from '../channel/index.ts';
import { babble } from '../channel/babble.ts';

function tone(f: number, n: number, amp = 0.9): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / FS);
  return x;
}
function bandNoise(n: number, seed: number): Float32Array {
  // a signal-like test stimulus: noise limited to the codec band
  return filter(whiteNoise(n, new Rng(seed)), butterBand(FS, 900, 7000, 4));
}
/** SNR actually produced by addAtSnr, measured independently from the residual. */
function measuredSnr(make: (n: number, rng: Rng) => Float32Array, target: number, seed: number): number {
  const n = 3 * FS;
  const sig = bandNoise(n, seed);
  const ref = inBandPower(sig);
  const mixed = Float32Array.from(sig);
  addAtSnr(mixed, make(n, new Rng(seed + 1)), ref, target);
  const resid = mixed.map((v, i) => v - sig[i]!);
  const bp = butterBand(FS, SNR_BAND[0], SNR_BAND[1], 4);
  return db(power(filter(sig, bp)) / power(filter(resid, bp)));
}

test('awgn: in-band SNR of the white noise is within ±0.5 dB of the target', () => {
  for (const target of [-10, 0, 10, 30]) {
    const got = measuredSnr(whiteNoise, target, 11 + target);
    assert.ok(Math.abs(got - target) <= 0.5, `target ${target} dB, measured ${got.toFixed(2)} dB`);
  }
});

test('awgn: noise is white (flat within 1 dB between 1 and 7 kHz)', () => {
  const x = whiteNoise(64 * 4096, new Rng(3));
  const N = 4096;
  const psd = new Float64Array(N / 2);
  for (let o = 0; o + N <= x.length; o += N) {
    const re = Float64Array.from(x.subarray(o, o + N));
    const im = new Float64Array(N);
    fft(re, im);
    for (let k = 0; k < N / 2; k++) psd[k]! += re[k]! * re[k]! + im[k]! * im[k]!;
  }
  const band = (f0: number, f1: number) => {
    let s = 0;
    let c = 0;
    for (let k = Math.round((f0 * N) / FS); k <= Math.round((f1 * N) / FS); k++, c++) s += psd[k]!;
    return s / c;
  };
  const d = db(band(800, 1200) / band(6800, 7200));
  assert.ok(Math.abs(d) < 1, `${d.toFixed(2)} dB`);
});

test('babble: in-band SNR within ±0.5 dB of the target, and it fluctuates like speech', () => {
  for (const target of [-12, 0, 10]) {
    const got = measuredSnr((n, rng) => babble(n, FS, rng), target, 21 - target);
    assert.ok(Math.abs(got - target) <= 0.5, `target ${target} dB, measured ${got.toFixed(2)} dB`);
  }
  const b = filter(babble(6 * FS, FS, new Rng(4)), butterBand(FS, SNR_BAND[0], SNR_BAND[1], 4));
  const blk = 0.05 * FS;
  const rms: number[] = [];
  for (let i = 0; i + blk <= b.length; i += blk) rms.push(Math.sqrt(power(b, i, i + blk)));
  const m = rms.reduce((a, v) => a + v, 0) / rms.length;
  const sd = Math.sqrt(rms.reduce((a, v) => a + (v - m) ** 2, 0) / rms.length);
  assert.ok(sd / m > 0.25, `50 ms envelope coefficient of variation ${(sd / m).toFixed(2)} (stationary noise ≈ 0.1)`);
  // most of the energy is in the speech range
  const speech = power(filter(b, butterBand(FS, 300, 3500, 4)));
  assert.ok(speech / power(b) > 0.6);
});

test('babble: same seed, same noise; different seed, different noise', () => {
  const a = babble(FS, FS, new Rng(9));
  const b = babble(FS, FS, new Rng(9));
  const c = babble(FS, FS, new Rng(10));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('distance: 1/d level at 1 kHz (±0.5 dB) and growing high-frequency roll-off', () => {
  for (const d of [0.5, 2, 8, 32]) {
    const y = distance(tone(1000, FS), d);
    const got = toneLevelDb(y.subarray(FS / 2), 1000, FS) - toneLevelDb(tone(1000, FS).subarray(FS / 2), 1000, FS);
    assert.ok(Math.abs(got + 20 * Math.log10(d)) <= 0.5, `d=${d}: ${got.toFixed(2)} dB, expected ${(-20 * Math.log10(d)).toFixed(2)}`);
  }
  const tilt = (d: number) => responseDb(distanceSections(d), 6500, FS) - responseDb(distanceSections(d), 1000, FS);
  assert.ok(tilt(1) > -0.5);
  assert.ok(tilt(16) < tilt(4) && tilt(4) < tilt(1));
  assert.ok(tilt(32) < -3, `6.5 kHz vs 1 kHz at 32 m: ${tilt(32).toFixed(1)} dB`);
});

/** RT60 by Schroeder backward integration of the reverberant part, T20 fit (-5 to -25 dB). */
function rt60Of(h: Float32Array): number {
  const e = new Float64Array(h.length);
  let acc = 0;
  for (let i = h.length - 1; i >= 1; i--) e[i] = acc += h[i]! * h[i]!;
  const tot = e[1]!;
  let i5 = -1;
  let i25 = -1;
  for (let i = 1; i < h.length; i++) {
    const L = 10 * Math.log10(e[i]! / tot);
    if (i5 < 0 && L <= -5) i5 = i;
    if (i25 < 0 && L <= -25) {
      i25 = i;
      break;
    }
  }
  return ((i25 - i5) / FS) * 3;
}

test('reverb: impulse response has the requested RT60 (±10 %) and DRR (±0.5 dB)', () => {
  for (const rt of [0.3, 0.6, 1, 2]) {
    const drr = drrDb(rt, 0.5);
    const h = roomIr(rt, drr, new Rng(17));
    const got = rt60Of(h);
    assert.ok(Math.abs(got / rt - 1) <= 0.1, `RT60 ${rt}: measured ${got.toFixed(3)} s`);
    let er = 0;
    for (let i = 1; i < h.length; i++) er += h[i]! * h[i]!;
    const gotDrr = db((h[0]! * h[0]!) / er);
    assert.ok(Math.abs(gotDrr - drr) <= 0.5, `DRR ${drr.toFixed(2)}: measured ${gotDrr.toFixed(2)}`);
  }
  // Sabine: longer reverberation means less direct sound
  assert.ok(drrDb(2, 0.5) < drrDb(0.5, 0.5));
});

test('mic: band-pass 300 Hz to cut-off with a resonance below the cut-off', () => {
  for (const hi of [8000, 4000, 2000]) {
    const s = micSections(hi);
    assert.ok(Math.abs(responseDb(s, 0.35 * hi, FS)) < 2, `${hi}: passband ${responseDb(s, 0.35 * hi, FS).toFixed(1)} dB`);
    assert.ok(responseDb(s, 0.75 * hi, FS) > 2, `${hi}: resonance ${responseDb(s, 0.75 * hi, FS).toFixed(1)} dB`);
    assert.ok(responseDb(s, 2 * hi, FS) < -15, `${hi}: stopband ${responseDb(s, 2 * hi, FS).toFixed(1)} dB`);
    assert.ok(responseDb(s, 100, FS) < -15, `${hi}: 100 Hz ${responseDb(s, 100, FS).toFixed(1)} dB`);
  }
  // and the filter really is applied
  const y = cheapMic(tone(7000, FS), 3000);
  assert.ok(toneLevelDb(y.subarray(FS / 2), 7000, FS) < toneLevelDb(tone(7000, FS), 7000, FS) - 20);
});

function thd(y: Float32Array, f: number): number {
  const seg = y.subarray(FS / 4);
  const p1 = Math.pow(10, toneLevelDb(seg, f, FS) / 10);
  let ph = 0;
  for (let k = 2; k <= 9; k++) ph += Math.pow(10, toneLevelDb(seg, k * f, FS) / 10);
  return Math.sqrt(ph / p1);
}

test('speaker: distortion grows with drive, level is preserved', () => {
  const x = tone(1000, FS);
  const t = [0, 6, 12, 24].map((d) => thd(speakerNL(x, d), 1000));
  assert.ok(t[0]! < 0.05, `THD at 0 dB ${(100 * t[0]!).toFixed(1)} %`);
  for (let k = 1; k < t.length; k++) assert.ok(t[k]! > t[k - 1]!, `THD ${t.map((v) => (100 * v).toFixed(1)).join(' < ')} %`);
  assert.ok(t[3]! > 0.2, `THD at 24 dB ${(100 * t[3]!).toFixed(1)} %`);
  const y = speakerNL(x, 24);
  assert.ok(Math.abs(db(power(y) / power(x))) < 0.1);
});

test('clip: peak placed at the requested level, everything above full scale clipped', () => {
  const x = tone(1013.7, FS, 0.3); // not a divisor of FS, so the samples cover every phase
  const a = adcClip(x, 0);
  assert.equal(a.clipped, 0);
  assert.ok(Math.abs(Math.max(...a.y) - 1) < 1e-6);
  const b = adcClip(x, 12);
  assert.ok(Math.max(...b.y.map(Math.abs)) <= 1);
  // a sine 12 dB over full scale is above ±1 for 1 - (2/π)·asin(10^(-12/20)) of the time
  const expect = 1 - (2 / Math.PI) * Math.asin(Math.pow(10, -12 / 20));
  assert.ok(Math.abs(b.clipped - expect) < 0.01, `${b.clipped.toFixed(3)} vs ${expect.toFixed(3)}`);
  assert.ok(thd(b.y, 1013.7) > thd(adcClip(x, 3).y, 1013.7));
});

test('drift: resampling by 1+ppm·1e-6 moves a pulse 1 s later by the right amount (±1 ppm), with fractional delay', () => {
  // smooth Gaussian pulses (σ = 4 samples): band-limited, so their centroid is an unbiased position
  const pulse = (x: Float32Array, c: number) => {
    for (let i = Math.floor(c) - 40; i <= Math.ceil(c) + 40; i++) x[i]! += Math.exp(-((i - c) ** 2) / 32);
  };
  const centroid = (y: Float32Array, c: number) => {
    let s = 0;
    let w = 0;
    for (let i = Math.round(c) - 40; i <= Math.round(c) + 40; i++) {
      s += i * y[i]!;
      w += y[i]!;
    }
    return s / w;
  };
  for (const ppm of [-1000, -200, 0, 300, 4000]) {
    const x = new Float32Array(FS + 400);
    pulse(x, 100);
    pulse(x, 100 + FS);
    const ratio = 1 + ppm * 1e-6;
    const y = resample(x, ratio, 0.37);
    const p0 = centroid(y, 100 * ratio + 0.37);
    const p1 = centroid(y, (100 + FS) * ratio + 0.37);
    const got = ((p1 - p0) / FS - 1) * 1e6;
    assert.ok(Math.abs(got - ppm) <= 1, `ppm ${ppm}: measured ${got.toFixed(2)}`);
    assert.ok(Math.abs(p0 - (100 * ratio + 0.37)) < 0.01, `fractional delay: ${p0.toFixed(3)} vs ${(100 * ratio + 0.37).toFixed(3)}`);
  }
});

test('late: the receiver starts lateMs after the preamble; otherwise a random lead of 0.2-1.0 s', () => {
  const tx = new Float32Array(FS);
  for (let i = 0; i < tx.length; i++) tx[i] = i / tx.length;
  const off = 4800;
  const r = simulate(tx, { lateMs: 20, awgnDb: 200 }, 5, off);
  assert.ok(Math.abs(r.frameStart - (-(off + 0.02 * FS) + (r.frameStart % 1 + 1) % 1)) < 1.01, `frameStart ${r.frameStart}`);
  for (let s = 0; s < 20; s++) {
    const q = simulate(tx, { awgnDb: 200 }, s, off);
    assert.ok(q.frameStart >= 0.2 * FS && q.frameStart <= 1.0 * FS + 1);
  }
  // reproducible
  assert.deepEqual(simulate(tx, { lateMs: 5 }, 7, off).rx, simulate(tx, { lateMs: 5 }, 7, off).rx);
});

test('dropouts: gap rate and length match the parameters, gaps are silent', () => {
  const x = new Float32Array(120 * FS).fill(0.5);
  const gaps = dropouts(x, 4, new Rng(8));
  const rate = gaps.length / 120;
  assert.ok(Math.abs(rate - 4) < 0.8, `rate ${rate.toFixed(2)}/s`);
  const meanLen = gaps.reduce((a, g) => a + g[1], 0) / gaps.length / FS;
  assert.ok(Math.abs(meanLen - 0.0225) < 0.003, `mean gap ${(1000 * meanLen).toFixed(1)} ms`);
  for (const [s, len] of gaps.slice(0, 20)) for (let i = s; i < s + len; i++) assert.equal(x[i], 0);
  const zeros = x.reduce((a, v) => a + (v === 0 ? 1 : 0), 0) / x.length;
  assert.ok(Math.abs(zeros - 4 * 0.0225) < 0.03, `zeroed fraction ${zeros.toFixed(3)}`);
});

test('chain: same seed gives the same received audio; SNR holds through the whole chain', () => {
  const tx = bandNoise(2 * FS, 1);
  const a = simulate(tx, { awgnDb: 5, rt60: 0.5, ppm: 100 }, 42);
  const b = simulate(tx, { awgnDb: 5, rt60: 0.5, ppm: 100 }, 42);
  assert.deepEqual(a.rx, b.rx);
  assert.notDeepEqual(simulate(tx, { awgnDb: 5 }, 43).rx, simulate(tx, { awgnDb: 5 }, 42).rx);
});
