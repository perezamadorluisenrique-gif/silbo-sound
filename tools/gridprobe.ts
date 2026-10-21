// Quick probe of the R2 grid: node tools/gridprobe.ts <profile> <n> [snr,...] [room,...]
import { runGrid, gridCells } from '../scoring/grid.ts';
const [prof = '1', n = '5', snrs, rooms] = process.argv.slice(2);
let cells = gridCells();
if (snrs) cells = cells.filter((c) => snrs.split(',').map(Number).includes(c.snr));
if (rooms) cells = cells.filter((c) => rooms.split(',').includes(c.room));
const t0 = Date.now();
const r = await runGrid(Number(prof), Number(n), cells);
let ok = 0, tot = 0;
for (const c of r) { ok += c.ok; tot += c.n; if (c.ok < c.n) console.log(`${c.snr} dB ${c.room} ${c.ppm} ppm sat=${c.sat}: ${c.ok}/${c.n}`); }
console.log(`total ${ok}/${tot} (${(100 * ok / tot).toFixed(1)} %) en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
