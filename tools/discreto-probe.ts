// Discreet (near-ultrasound) profile probe: success over a small grid and audible leakage.
// node tools/discreto-probe.ts [n] [snrs] [rooms] [sat:0|1|both]
import * as mf from '../src/modem/mfsk.ts';
import { simulate } from '../src/sim/channel.ts';
import { Rng } from '../src/dsp/rng.ts';
import { Fft } from '../src/dsp/fft.ts';

const n = Number(process.argv[2] ?? 4);
const snrs = (process.argv[3] ?? '5,10,15,25').split(',').map(Number);
const rooms = (process.argv[4] ?? 'small,medium,large').split(',');
const satArg = process.argv[5] ?? 'both';
const sats = satArg === 'both' ? [false, true] : [satArg === '1'];
const FS = 48000;

function text(rng: Rng): Uint8Array {
  const abc = 'abcdefghijklmnopqrstuvwxyzáéíóúñ ¿?¡!.,0123456789';
  let s = '';
  while (new TextEncoder().encode(s).length < 140) s += abc[rng.int(abc.length)];
  return new TextEncoder().encode(s).slice(0, 140);
}

// audible leakage: energy below 16 kHz relative to total, from a long FFT
{
  const tx = mf.encodeWith(text(new Rng(1)), mf.DISCRETO_ID);
  const N = 1 << Math.ceil(Math.log2(tx.length));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  re.set(tx);
  Fft.of(N).transform(re, im);
  let lo = 0, tot = 0, lo15 = 0;
  for (let k = 1; k < N / 2; k++) {
    const e = re[k]! ** 2 + im[k]! ** 2;
    const f = (k * FS) / N;
    tot += e;
    if (f < 16000) lo += e;
    if (f < 15000) lo15 += e;
  }
  console.log(`airtime ${mf.airtimeWith(140, mf.DISCRETO_ID).toFixed(2)} s; energy <16 kHz ${(10 * Math.log10(lo / tot)).toFixed(1)} dB, <15 kHz ${(10 * Math.log10(lo15 / tot)).toFixed(1)} dB`);
}

let ok = 0, tot = 0;
for (const room of rooms)
  for (const snr of snrs)
    for (const sat of sats) {
      let k = 0;
      for (let i = 0; i < n; i++) {
        const seed = 11000 + i * 7 + snr * 101 + (sat ? 5000 : 0) + room.length * 13;
        const rng = new Rng(seed);
        const msg = text(rng);
        const tx = mf.encodeWith(msg, mf.DISCRETO_ID);
        const ppm = i % 2 ? 200 : -200;
        const { rx } = simulate(tx, FS, { room, snrDb: snr, ppm, saturation: sat, agc: true, seed, band: 'ultrasonic' });
        const got = mf.decodeAll(rx, undefined, mf.ULTRA.threshold, mf.ULTRA);
        if (got.some((g) => g.data.length === msg.length && g.data.every((v, j) => v === msg[j]))) k++;
      }
      ok += k;
      tot += n;
      console.log(`${room} ${snr} dB sat=${sat}: ${k}/${n}`);
    }
console.log(`total ${ok}/${tot}`);
