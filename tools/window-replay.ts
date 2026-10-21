// Replays a received WAV through the app's sliding-window receiver logic (no browser) to tell
// modem losses from windowing losses. Usage: node tools/window-replay.ts <wav> [windowS] [stepS]
import { readFileSync } from 'node:fs';
import * as mf from '../src/modem/mfsk.ts';
import { Receiver, WINDOW_S, DECODE_EVERY_S } from '../app/core.ts';
const b = readFileSync(process.argv[2]!);
const x = new Float32Array((b.length - 44) / 2);
for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(44 + i * 2) / 32767;
const W = Number(process.argv[3] ?? WINDOW_S) * 48000, step = Number(process.argv[4] ?? DECODE_EVERY_S) * 48000;
const full = mf.decodeAll(x);
console.log('decodeAll on the whole file:', full.length, 'frames at', full.map((d) => (d.stats.start / 48000).toFixed(1)).join(' '));
const rx = new Receiver();
for (let end = 48000; end <= x.length; end += step) {
  const win = x.subarray(Math.max(0, end - W), end);
  for (const d of mf.decodeAll(win)) for (const ev of rx.feed(d.data)) if (ev.type !== 'text') console.log((end / 48000).toFixed(1), ev.type, 'have' in ev ? ev.have : '');
}
