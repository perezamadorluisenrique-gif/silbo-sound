// OFDM payload with genie timing and clock ratio: node tools/ofdm-genie.ts <room> <snr> <ppm> <bytes> <n>
import { ofdmEncode as E0, ofdmDecode as D0, ofdmSamples as S0, OFDM } from '../src/modem/ofdm.ts';
const P = { ...OFDM, ...JSON.parse(process.env.P ?? '{}') };
const ofdmEncode = (d: Uint8Array) => E0(d, P);
const ofdmDecode = (r: Float32Array, s: number, q: number, l: number) => D0(r, s, q, l, P);
const ofdmSamples = (l: number) => S0(l, P);
import { simulate } from '../src/sim/channel.ts';
import { Rng } from '../src/dsp/rng.ts';
const FS = 48000;
const [room = 'medium', snr = '15', ppm = '0', len = '2000', n = '5'] = process.argv.slice(2);
const rng = new Rng(11);
let ok = 0;
for (let t = 0; t < +n; t++) {
  const data = rng.bytes(+len);
  const tx = ofdmEncode(data);
  const ratio = 1 + +ppm * 1e-6;
  const { rx, signalStart } = simulate(tx, FS, { room, snrDb: snr === 'inf' ? null : +snr, ppm: +ppm, saturation: false, agc: true, seed: 100 + t });
  const start = signalStart - 0.003 * FS * ratio;
  const got = ofdmDecode(rx, start, ratio, data.length);
  if (got && Buffer.compare(Buffer.from(got), Buffer.from(data)) === 0) ok++;
}
console.log(`${room} ${snr} dB ${ppm} ppm ${len} B: ${ok}/${n}; ${(ofdmSamples(+len) / FS).toFixed(2)} s -> ${(8 * +len / (ofdmSamples(+len) / FS)).toFixed(0)} bit/s`);
