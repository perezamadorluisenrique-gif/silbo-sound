// Re-run the R2 positive control of one ambience minute with decoder debug output.
// MFSK_DEBUG=1 node tools/ctrl-debug.ts <chunk>
import * as mf from '../src/modem/mfsk.ts';
import { simulate } from '../src/sim/channel.ts';
import { ambience } from '../src/sim/noise.ts';
import { randomText } from '../scoring/lib.ts';
import { Rng } from '../src/dsp/rng.ts';
const k = Number(process.argv[2] ?? 4);
const FS = 48000;
const amb = ambience(60, FS, 7000 + k);
let peak = 0;
for (const v of amb) peak = Math.max(peak, Math.abs(v));
for (let i = 0; i < amb.length; i++) amb[i]! *= 0.5 / peak;
const opts = { room: 'medium', snrDb: 20, ppm: 0, saturation: k % 2 === 1, agc: true, seed: 900 + k, leadSeconds: 0 };
const msg = new TextEncoder().encode(randomText(140, new Rng(k)));
const tx = mf.encode(msg, mf.PROFILES[1]);
let ea = 0, et = 0;
for (const v of amb) ea += v * v;
for (const v of tx) et += v * v;
const g = Math.sqrt(ea / amb.length / (et / tx.length));
const mix = Float32Array.from(amb);
const at = Math.round(30 * FS);
for (let i = 0; i < tx.length; i++) mix[at + i]! += g * tx[i]!;
// local SNR: frame energy vs ambience energy in the same 4.4 s
let ew = 0; for (let i = at; i < at + tx.length; i++) ew += amb[i]! ** 2;
console.log('local signal/ambience', (10 * Math.log10((g * g * et) / ew)).toFixed(1), 'dB, frame at', at);
const r = mf.decodeAll(simulate(mix, FS, opts).rx);
console.log('decoded', r.length);
import { ncc, prefilter } from '../src/modem/chirp.ts';
{
  const rx = simulate(mix, FS, opts).rx;
  const c = ncc(prefilter(rx, 700, 8000), mf.preamble(), at - 5000, at + 10000);
  let m = 0, mi = 0; c.forEach((v, i) => { if (v > m) { m = v; mi = i; } });
  console.log('NCC max near frame', m.toFixed(3), 'at', at - 5000 + mi);
}
