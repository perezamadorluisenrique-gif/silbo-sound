// Feasibility probe for OFDM + time-differential PSK (genie timing, ppm 0).
// node tools/ofdm-probe.ts <room> <snr> <N> <CP> [bitsPerSym=1|2] [nsym=60]
import { Fft } from '../src/dsp/fft.ts';
import { Rng } from '../src/dsp/rng.ts';
import { simulate } from '../src/sim/channel.ts';
const FS = 48000;
const [room = 'medium', snrS = '15', NS = '4096', CPS = '512', bS = '1', nsS = '60'] = process.argv.slice(2);
const N = +NS, CP = +CPS, B = +bS, NSYM = +nsS;
const k0 = Math.ceil(1000 / (FS / N)), k1 = Math.floor(8000 / (FS / N));
const K = k1 - k0 + 1;
const f = new Fft(N);
const rng = new Rng(42);
const M = 1 << B;
// symbols: phase index per bin; first symbol is reference
const data: number[][] = [];
const ph: number[][] = [];
let cur = Array.from({ length: K }, () => rng.int(M));
ph.push(cur.slice());
for (let s = 0; s < NSYM; s++) {
  const d = Array.from({ length: K }, () => rng.int(M));
  data.push(d);
  cur = cur.map((c, i) => (c + d[i]!) % M);
  ph.push(cur.slice());
}
const L = N + CP;
const tx = new Float32Array(L * ph.length);
for (let s = 0; s < ph.length; s++) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < K; i++) {
    const a = (2 * Math.PI * ph[s]![i]!) / M + (B === 2 ? Math.PI / 4 : 0);
    re[k0 + i] = Math.cos(a); im[k0 + i] = Math.sin(a);
    re[N - k0 - i] = Math.cos(a); im[N - k0 - i] = -Math.sin(a);
  }
  f.transform(re, im, true);
  let pk = 0;
  for (let n = 0; n < N; n++) pk = Math.max(pk, Math.abs(re[n]!));
  for (let n = 0; n < L; n++) tx[s * L + n] = re[(n - CP + N) % N]!;
}
let pk = 0;
for (const v of tx) pk = Math.max(pk, Math.abs(v));
for (let i = 0; i < tx.length; i++) tx[i]! *= 0.5 / pk;
const { rx, signalStart } = simulate(tx, FS, { room, snrDb: snrS === 'inf' ? null : +snrS, ppm: 0, saturation: false, agc: true, seed: 7 });
const Y: [Float64Array, Float64Array][] = [];
for (let s = 0; s < ph.length; s++) {
  const re = new Float64Array(N), im = new Float64Array(N);
  const st = signalStart - Math.round(0.003 * FS) + s * L + CP - Math.round(CP / 4);
  for (let n = 0; n < N; n++) re[n] = rx[st + n] ?? 0;
  f.transform(re, im);
  Y.push([re, im]);
}
let errs = 0, tot = 0;
const perBand = new Array(7).fill(0), perBandT = new Array(7).fill(0);
for (let s = 1; s < ph.length; s++) {
  for (let i = 0; i < K; i++) {
    const k = k0 + i;
    const [ar, ai] = [Y[s]![0][k]!, Y[s]![1][k]!];
    const [br, bi] = [Y[s - 1]![0][k]!, -Y[s - 1]![1][k]!];
    const zr = ar * br - ai * bi, zi = ar * bi + ai * br;
    let a = Math.atan2(zi, zr);
    const d = ((Math.round((a * M) / (2 * Math.PI)) % M) + M) % M;
    const want = data[s - 1]![i]!;
    const be = B === 1 ? (d !== want ? 1 : 0) : (((d ^ (d >> 1)) ^ (want ^ (want >> 1))) & 1) + ((((d ^ (d >> 1)) ^ (want ^ (want >> 1))) >> 1) & 1);
    errs += be; tot += B;
    const band = Math.min(6, Math.floor((k * FS) / N / 1000) - 1);
    perBand[band] += be; perBandT[band] += B;
  }
}
console.log(`${room} ${snrS} dB N=${N} CP=${CP} ${B === 1 ? 'DBPSK' : 'DQPSK'}: BER ${(100 * errs / tot).toFixed(2)} % (${K} bins, raw ${(K * B * FS / L).toFixed(0)} bit/s)  per kHz: ${perBand.map((e, i) => (100 * e / perBandT[i]).toFixed(1)).join(' ')}`);
