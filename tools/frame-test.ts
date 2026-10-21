// Whole frames with any profile through the simulator: node tools/frame-test.ts <id> <room> <snr> <bytes> <n> [sat]
import * as mf from '../src/modem/mfsk.ts';
import { simulate } from '../src/sim/channel.ts';
import { Rng } from '../src/dsp/rng.ts';
const [id = '2', room = 'medium', snr = '15', len = '1500', n = '5', sat] = process.argv.slice(2);
const rng = new Rng(77);
let ok = 0;
for (let t = 0; t < +n; t++) {
  const d = rng.bytes(+len);
  const tx = mf.encodeWith(d, +id);
  const ppm = rng.uniform(-200, 200);
  const { rx } = simulate(tx, 48000, { room, snrDb: snr === 'inf' ? null : +snr, ppm, saturation: sat === 'sat', agc: true, seed: rng.int(1e9) });
  const got = mf.decodeAll(rx);
  const good = got.some((g) => Buffer.compare(Buffer.from(g.data), Buffer.from(d)) === 0);
  if (good) ok++;
  else console.log(`  fallo: ppm ${ppm.toFixed(0)}, decodificadas ${got.length}`, got.map((g) => g.stats.ppmEstimate.toFixed(0)));
}
console.log(`perfil ${id} ${room} ${snr} dB ${len} B${sat ? ' sat' : ''}: ${ok}/${n}, ${mf.airtimeWith(+len, +id).toFixed(2)} s -> ${(8 * +len / mf.airtimeWith(+len, +id)).toFixed(0)} bit/s`);
