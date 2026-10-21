// R2 grid and false-positive check, split across worker processes.
// Worker mode: node scoring/grid.ts --worker '<json job>' prints one JSON line with results.
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runTrials, randomText, type Modem } from './lib.ts';
import * as mf from '../src/modem/mfsk.ts';
import { simulate } from '../src/sim/channel.ts';
import { ambience } from '../src/sim/noise.ts';
import { findChirps, prefilter, ncc, FS } from '../src/modem/chirp.ts';
import { Rng } from '../src/dsp/rng.ts';

export interface Cell {
  snr: number;
  room: string;
  ppm: number;
  sat: boolean;
}
export interface CellResult extends Cell {
  ok: number;
  n: number;
  airtime: number;
  bytes: number;
}
export interface FpResult {
  chunk: number;
  seconds: number;
  chirpPeaks: number; // candidates above the receiver's detection threshold (rejected by the header checks)
  maxNcc: number;
  frames: number;
  control: boolean; // same chunk with one real frame mixed in: was it decoded intact?
}

export const SNRS = [5, 10, 15, 20, 25];
export const GRID_ROOMS = ['small', 'medium', 'large'];
export const PPMS = [-200, 0, 200];
export function gridCells(): Cell[] {
  const out: Cell[] = [];
  for (const snr of SNRS) for (const room of GRID_ROOMS) for (const ppm of PPMS) for (const sat of [false, true]) out.push({ snr, room, ppm, sat });
  return out;
}

type Job = { kind: 'grid'; profile: number; n: number; cells: Cell[] } | { kind: 'fp'; chunks: number[]; seconds: number };

const enc = new TextEncoder();

function runJob(job: Job): unknown[] {
  if (job.kind === 'grid') {
    const p = mf.PROFILES[job.profile]!;
    const m: Modem = { name: p.name, encode: (d) => mf.encode(d, p), decode: (rx) => mf.decodeAll(rx).map((x) => x.data) };
    return job.cells.map((c) => {
      const seed = 20000 + c.snr * 1000 + GRID_ROOMS.indexOf(c.room) * 100 + (c.ppm + 200) / 4 + (c.sat ? 7 : 0);
      const r = runTrials(m, { room: c.room, snrDb: c.snr, ppm: c.ppm, saturation: c.sat, agc: true }, job.n, seed, (g) => enc.encode(randomText(140, g)));
      return { ...c, ...r } satisfies CellResult;
    });
  }
  // False positives: simulated ambient sound (no transmission) heard by the receiving phone.
  // The ambience is fed through the channel as if it were played in a medium room, plus pink
  // noise 20 dB below it, then the microphone, clipping, AGC and quantisation.
  return job.chunks.map((k) => {
    const amb = ambience(job.seconds, FS, 7000 + k);
    let peak = 0;
    for (const v of amb) peak = Math.max(peak, Math.abs(v));
    for (let i = 0; i < amb.length; i++) amb[i]! *= 0.5 / peak;
    const opts = { room: 'medium', snrDb: 20, ppm: 0, saturation: k % 2 === 1, agc: true, seed: 900 + k, leadSeconds: 0 };
    const { rx } = simulate(amb, FS, opts);
    const xf = prefilter(rx, 700, 8000);
    const pre = mf.preamble();
    const peaks = findChirps(xf, pre, mf.DETECT_THRESHOLD, 4096);
    let maxNcc = 0;
    for (const v of ncc(xf, pre)) maxNcc = Math.max(maxNcc, v);
    const frames = mf.decodeAll(rx).length;
    // positive control: a robust-profile frame at the same RMS as the ambience (0 dB), at 30 s
    const msg = enc.encode(randomText(140, new Rng(k)));
    const tx = mf.encode(msg, mf.PROFILES[1]);
    let ea = 0;
    let et = 0;
    for (const v of amb) ea += v * v;
    for (const v of tx) et += v * v;
    const g = Math.sqrt(ea / amb.length / (et / tx.length));
    const mix = Float32Array.from(amb);
    const at = Math.round(30 * FS);
    for (let i = 0; i < tx.length && at + i < mix.length; i++) mix[at + i]! += g * tx[i]!;
    const want = Buffer.from(msg).toString('hex');
    const control = mf.decodeAll(simulate(mix, FS, opts).rx).some((d) => Buffer.from(d.data).toString('hex') === want);
    return { chunk: k, seconds: job.seconds, chirpPeaks: peaks.length, maxNcc, frames, control } satisfies FpResult;
  });
}

function runWorker(job: Job): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    ch.stdout.on('data', (d) => (out += d));
    ch.on('error', reject);
    ch.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`worker exit ${code}`))));
  });
}

/** Split items round-robin over the available cores and run each share in its own process. */
async function parallel<T>(items: T[], make: (share: T[]) => Job): Promise<unknown[]> {
  const w = Math.max(1, Math.min(items.length, availableParallelism()));
  const shares: T[][] = Array.from({ length: w }, () => []);
  items.forEach((it, i) => shares[i % w]!.push(it));
  return (await Promise.all(shares.map((s) => runWorker(make(s))))).flat();
}

export async function runGrid(profile: number, n: number, cells = gridCells()): Promise<CellResult[]> {
  return (await parallel(cells, (s) => ({ kind: 'grid', profile, n, cells: s }))) as CellResult[];
}
export async function runFalsePositives(minutes: number): Promise<FpResult[]> {
  const chunks = Array.from({ length: minutes }, (_, i) => i);
  return (await parallel(chunks, (s) => ({ kind: 'fp', chunks: s, seconds: 60 }))) as FpResult[];
}

if (process.argv[2] === '--worker') {
  process.stdout.write(JSON.stringify(runJob(JSON.parse(process.argv[3]!) as Job)));
}
