// Tone error rate of the MFSK modem through the simulator, with the true preamble position
// and clock ratio known (isolates demodulation from synchronisation).
// node tools/diag.ts <room> <snr|inf> <n> [ppm]
import { Rng } from '../src/dsp/rng.ts';
import { simulate } from '../src/sim/channel.ts';
import * as mf from '../src/modem/mfsk.ts';
import { randomText } from '../scoring/lib.ts';

const [room = 'medium', snr = 'inf', n = '5', ppm = '0'] = process.argv.slice(2);
const ov = JSON.parse(process.env.P ?? '{}');
const p = Object.keys(ov).length ? mf.custom(ov) : mf.DEFAULT;
const rng = new Rng(1);
let errs = 0;
let tot = 0;
let errsTrue = 0;
let errsNoEq = 0;
let offs: number[] = [];
for (let i = 0; i < Number(n); i++) {
  const msg = new TextEncoder().encode(randomText(140, rng));
  const tx = mf.encode(msg, p);
  const sent = mf.txTones(msg, p);
  const ratio = 1 + Number(ppm) * 1e-6;
  const { rx, signalStart } = simulate(tx, 48000, { room, snrDb: snr === 'inf' ? null : Number(snr), ppm: Number(ppm), saturation: false, agc: true, seed: rng.int(1e9) });
  const found = mf.findPreamble(rx)[0] ?? -1;
  offs.push(found - signalStart);
  const a = mf.rxTones(rx, found, sent.length, ratio, p);
  const b = mf.rxTones(rx, signalStart, sent.length, ratio, p);
  const c = mf.rxTones(rx, signalStart, sent.length, ratio, p, false);
  sent.forEach((s, k) => s.forEach((t, g) => {
    tot++;
    if (a[k]![g] !== t) errs++;
    if (b[k]![g] !== t) errsTrue++;
    if (c[k]![g] !== t) errsNoEq++;
  }));
}
console.log(JSON.stringify({ room, snr, ppm, toneErr: (errs / tot).toFixed(4), toneErrTrueSync: (errsTrue / tot).toFixed(4), noEq: (errsNoEq / tot).toFixed(4), syncOffsets: offs, p: process.env.P ?? '' }));
