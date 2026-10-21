// Ad-hoc measurements: node tools/explore.ts <modem> <room> <snr> <n> [sat]
import { Rng } from '../src/dsp/rng.ts';
import { runTrials, randomText, type Modem } from '../scoring/lib.ts';
import * as mf from '../src/modem/mfsk.ts';
import { fskEncode, fskDecode } from '../src/modem/fsk.ts';

const [which = 'mfsk', room = 'medium', snr = '15', n = '20', sat = ''] = process.argv.slice(2);
const overrides = JSON.parse(process.env.P ?? '{}');
const p = Object.keys(overrides).length ? mf.custom(overrides) : mf.DEFAULT;
const modems: Record<string, Modem> = {
  mfsk: { name: 'mfsk', encode: (d) => mf.encode(d, p), decode: (rx) => mf.decodeAll(rx, p).map((x) => x.data) },
  fsk: { name: 'fsk', encode: fskEncode, decode: (rx) => { const d = fskDecode(rx); return d ? [d] : []; } },
};
const enc = new TextEncoder();
const t0 = Date.now();
const r = runTrials(modems[which]!, { room, snrDb: snr === 'inf' ? null : Number(snr), ppm: 'random', saturation: sat === 'sat', agc: true }, Number(n), 42, (rng: Rng) => enc.encode(randomText(which === 'fsk' ? 32 : 140, rng)));
console.log(JSON.stringify({ which, room, snr, sat, ...r, ms: Date.now() - t0, p: overrides }));
