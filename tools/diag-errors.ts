import { Rng } from '../src/dsp/rng.ts';
import { simulate } from '../src/sim/channel.ts';
import * as mf from '../src/modem/mfsk.ts';
import { randomText } from '../scoring/lib.ts';
const ov = JSON.parse(process.env.P ?? '{}');
const p = Object.keys(ov).length ? mf.custom(ov) : mf.DEFAULT;
const rng = new Rng(1);
const hist: Record<string, number> = {};
let errs = 0;
for (let i = 0; i < 4; i++) {
  const msg = new TextEncoder().encode(randomText(140, rng));
  const tx = mf.encode(msg, p);
  const sent = mf.txTones(msg, p);
  const { rx, signalStart } = simulate(tx, 48000, { room: process.argv[2] ?? 'medium', snrDb: null, ppm: 0, saturation: false, agc: true, seed: rng.int(1e9) });
  const a = mf.rxTones(rx, signalStart, sent.length, 1, p);
  sent.forEach((s, k) => s.forEach((t, g) => {
    const d = a[k]![g]!;
    if (d === t) return;
    errs++;
    let key = 'other';
    for (let back = 1; back <= 6; back++) if (k - back >= 0 && sent[k - back]![g] === d) { key = 'prev' + back; break; }
    if (key === 'other' && k + 1 < sent.length && sent[k + 1]![g] === d) key = 'next1';
    if (key === 'other' && Math.abs(d - t) === 1) key = 'adjacent';
    hist[key] = (hist[key] ?? 0) + 1;
  }));
}
console.log(errs, hist);
