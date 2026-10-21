// How long decodeAll takes on a W-second window (decides the app's sliding-window cadence).
import * as mf from '../src/modem/mfsk.ts';
import { simulate } from '../src/sim/channel.ts';
const W = Number(process.argv[2] ?? 12);
const data = new Uint8Array(1509).map((_, i) => (i * 37) & 255);
const tx = mf.encodeWith(data, mf.OFDM_ID);
const { rx } = simulate(tx, 48000, { room: 'medium', snrDb: 15, ppm: 100, saturation: false, agc: true, seed: 5, leadSeconds: 2 });
const win = new Float32Array(W * 48000);
win.set(rx.subarray(0, win.length));
let t = performance.now();
const got = mf.decodeAll(win);
console.log('frame', tx.length / 48000, 's; window', W, 's; decodeAll', (performance.now() - t).toFixed(0), 'ms; got', got.length);
const quiet = new Float32Array(W * 48000).map(() => (Math.random() - 0.5) * 0.01);
t = performance.now();
mf.decodeAll(quiet);
console.log('noise-only', (performance.now() - t).toFixed(0), 'ms');
