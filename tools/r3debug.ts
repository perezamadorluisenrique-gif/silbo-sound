// Which carousel frames decode in one R3 trial: MFSK_DEBUG=1 node tools/r3debug.ts <seed>
import { readFileSync } from 'node:fs';
import { carousel, PHOTO } from '../scoring/r3.ts';
import * as mf from '../src/modem/mfsk.ts';
import { simulate } from '../src/sim/channel.ts';
import { Rng } from '../src/dsp/rng.ts';
import { parseChunk } from '../src/file/chunks.ts';
const seed = Number(process.argv[2] ?? 30000);
const rng = new Rng(seed);
const fileId = rng.int(65536);
const { audio, ends } = carousel(new Uint8Array(readFileSync(PHOTO)), fileId, 1500);
const ppm = rng.uniform(-200, 200);
const { rx, signalStart } = simulate(audio, 48000, { room: 'medium', snrDb: 15, ppm, saturation: false, agc: true, seed: rng.int(2 ** 31), leadSeconds: 0.5 });
console.log('ppm', ppm.toFixed(0), 'ends (s)', ends.map((e) => (e / 48000).toFixed(1)).join(' '));
for (const d of mf.decodeAll(rx)) { const c = parseChunk(d.data)!; console.log(`kind ${c.kind} idx ${c.index} start ${((d.stats.start - signalStart) / 48000).toFixed(2)} s ppmEst ${d.stats.ppmEstimate.toFixed(0)}`); }
