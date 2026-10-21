// Re-run the R1 trials with decoder debug output: node tools/r1debug.ts [n] [room] [snr]
import { runTrials, randomText } from '../scoring/lib.ts';
import * as mf from '../src/modem/mfsk.ts';
const [n = '200', room = 'medium', snr = '15'] = process.argv.slice(2);
const ov = JSON.parse(process.env.P ?? '{}');
const p = Object.keys(ov).length ? mf.custom(ov) : mf.DEFAULT;
const enc = new TextEncoder();
const r = runTrials({ name: 'x', encode: (d) => mf.encode(d, p), decode: (rx) => { const g = mf.decodeAll(rx, p); if (!g.length) console.error('[fail]'); return g.map((x) => x.data); } }, { room, snrDb: Number(snr), ppm: 'random', saturation: false, agc: true }, Number(n), 1001, (g) => enc.encode(randomText(140, g)));
console.log(JSON.stringify(r));
