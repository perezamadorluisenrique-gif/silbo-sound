// Raw bit error rate of the OFDM payload (genie timing): node tools/ofdm-ber.ts <room> <snr> <ppm> <bytes>
import { ofdmEncode, ofdmSoft, carriers } from '../src/modem/ofdm.ts';
import { simulate } from '../src/sim/channel.ts';
import { Rng } from '../src/dsp/rng.ts';
const FS = 48000;
const [room = 'medium', snr = '15', ppm = '0', len = '2000', off = '0'] = process.argv.slice(2);
const data = new Rng(5).bytes(+len);
const tx = ofdmEncode(data);
const pad = new Float32Array(tx.length + 10); pad.set(tx);
const ref = ofdmSoft(pad, 0, 1, +len).soft;
const ratio = 1 + +ppm * 1e-6;
const { rx, signalStart } = simulate(tx, FS, { room, snrDb: snr === 'inf' ? null : +snr, ppm: +ppm, saturation: false, agc: true, seed: 3 });
const start = signalStart - 0.003 * FS * ratio + +off;
const s = ofdmSoft(rx, start, ratio, +len).soft;
let e = 0; const K = s.length;
const perSym: number[] = [];
const nsym = K / (2 * 1161);
for (let q = 0; q < nsym; q++) { let es = 0; for (let i = q * 2 * carriers(); i < (q + 1) * 2 * carriers(); i++) if (Math.sign(s[i]!) !== Math.sign(ref[i]!)) es++; perSym.push(es / (2 * carriers())); e += es; }
console.log(`${room} ${snr} ${ppm} ppm off ${off}: raw BER ${(100 * e / K).toFixed(2)} %  per symbol: ${perSym.map((v) => (100 * v).toFixed(0)).join(' ')}`);
