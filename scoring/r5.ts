// R5 measurements (all against the channel simulator):
//  * BROADCAST: one phone plays the photo carousel and many receivers listen at once, all in the
//    same room but each from its own spot (its own impulse response, SNR, clock and saturation)
//    and each switched on at a random moment. Nothing goes back to the sender, so this is exactly
//    how the app works with N listeners: every receiver keeps what it hears and fills the gaps on
//    the next pass. Each receiver hears LISTEN_S seconds from its join time; pass = photo
//    complete and identical (SHA-256).
//  * DISCREET MODE (profile 3, 17.4-19.6 kHz) with its own channel model (band 'ultrasonic'):
//    a grid of rooms x SNR x ±200 ppm x saturation, false positives in 10 min of near-ultrasound
//    ambience (with a positive control), and phones whose microphone cuts below 20 kHz.
// Worker mode: node scoring/r5.ts --worker '<json job>'
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Rng } from '../src/dsp/rng.ts';
import { Fft } from '../src/dsp/fft.ts';
import * as mf from '../src/modem/mfsk.ts';
import { simulate } from '../src/sim/channel.ts';
import { ultraAmbience } from '../src/sim/noise.ts';
import { applyBiquads, bandpassSections, power } from '../src/dsp/filters.ts';
import { findChirps, prefilter } from '../src/modem/chirp.ts';
import { fileFrames, Assembler } from '../src/file/chunks.ts';
import { sha256, randomText } from './lib.ts';
import { PHOTO } from './r3.ts';

const FS = 48000;
export const LISTEN_S = Number(process.env.R5_LISTEN ?? 60);
export const MAX_JOIN_S = 30;
const GAP_S = 0.1;
const enc = new TextEncoder();

// ---------------- broadcast ----------------
export interface ListenerSpec {
  trial: number;
  rx: number;
  room: string;
  snr: number;
  ppm: number;
  sat: boolean;
  join: number;
}
export interface Listener extends ListenerSpec {
  ok: boolean;
  seconds: number | null; // from switching on to having the photo
}

/** The sender's carousel, long enough for the latest joiner. */
function carouselAudio(photo: Uint8Array, fileId: number): Float32Array {
  const frames = fileFrames(photo, { name: 'foto.jpg', type: 'image/jpeg' }, fileId).map((f) => mf.encodeWith(f, mf.OFDM_ID));
  const gap = Math.round(GAP_S * FS);
  const need = (MAX_JOIN_S + LISTEN_S + 2) * FS;
  const parts: Float32Array[] = [];
  let t = 0;
  for (let i = 0; t < need; i++) {
    const f = frames[i % frames.length]!;
    parts.push(f);
    t += f.length + gap;
  }
  const audio = new Float32Array(t);
  let o = 0;
  for (const p of parts) {
    audio.set(p, o);
    o += p.length + gap;
  }
  return audio;
}

/** One room per trial (cycling through `rooms`); receivers differ in position, SNR, clock, join time. */
export function listenerSpecs(trials: number, receivers: number, rooms: string[], seed = 50000): ListenerSpec[] {
  const specs: ListenerSpec[] = [];
  for (let t = 0; t < trials; t++) {
    const rng = new Rng(seed + t);
    const room = rooms[t % rooms.length]!;
    for (let r = 0; r < receivers; r++)
      specs.push({ trial: t, rx: r, room, snr: Math.round(rng.uniform(10, 25)), ppm: Math.round(rng.uniform(-200, 200)), sat: rng.uniform(0, 1) < 0.3, join: Math.round(rng.uniform(0, MAX_JOIN_S) * 10) / 10 });
  }
  return specs;
}

function listen(s: ListenerSpec, audio: Float32Array, photo: Uint8Array, fileId: number): Listener {
  const a = Math.round(s.join * FS);
  const seg = audio.subarray(a, a + LISTEN_S * FS);
  // seed per (trial, receiver): its own impulse response (spot in the room) and noise
  const { rx } = simulate(seg, FS, { room: s.room, snrDb: s.snr, ppm: s.ppm, saturation: s.sat, agc: true, seed: 7000 + s.trial * 100 + s.rx, leadSeconds: 0.05 });
  const lead = 0.05 * FS;
  const got = mf.decodeAll(rx).sort((x, y) => x.stats.end - y.stats.end);
  const asm = new Assembler();
  let seconds: number | null = null;
  for (const d of got) {
    asm.add(d.data);
    const c = asm.complete(fileId);
    if (c) {
      if (sha256(c.data) === sha256(photo)) seconds = (d.stats.end - lead) / FS;
      break;
    }
  }
  return { ...s, ok: seconds !== null, seconds };
}

function broadcastWork(specs: ListenerSpec[]): Listener[] {
  const photo = new Uint8Array(readFileSync(PHOTO));
  const cache = new Map<number, { audio: Float32Array; fileId: number }>();
  return specs.map((s) => {
    let c = cache.get(s.trial);
    if (!c) {
      const fileId = new Rng(900 + s.trial).int(65536);
      c = { audio: carouselAudio(photo, fileId), fileId };
      cache.set(s.trial, c);
    }
    return listen(s, c.audio, photo, c.fileId);
  });
}

// ---------------- discreet mode ----------------
export interface DCell {
  room: string;
  snr: number;
  ppm: number;
  sat: boolean;
  micHz?: number;
}
export interface DCellResult extends DCell {
  n: number;
  ok: number;
}
export const D_SNRS = [5, 10, 15, 20, 25];
export function discreetCells(): DCell[] {
  const cells: DCell[] = [];
  for (const room of ['small', 'medium', 'large']) for (const snr of D_SNRS) for (const ppm of [-200, 200]) for (const sat of [false, true]) cells.push({ room, snr, ppm, sat });
  return cells;
}

function discreetCell(c: DCell, n: number): DCellResult {
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const seed = 60000 + i * 977 + c.snr * 31 + (c.ppm > 0 ? 7 : 0) + (c.sat ? 1300 : 0) + c.room.length * 101 + (c.micHz ?? 0);
    const rng = new Rng(seed);
    const msg = enc.encode(randomText(140, rng));
    const tx = mf.encodeWith(msg, mf.DISCRETO_ID);
    const { rx } = simulate(tx, FS, { room: c.room, snrDb: c.snr, ppm: c.ppm, saturation: c.sat, agc: true, seed, band: 'ultrasonic', ultraMicHz: c.micHz });
    const want = Buffer.from(msg).toString('hex');
    if (mf.decodeAll(rx, undefined, mf.ULTRA.threshold, mf.ULTRA).some((d) => Buffer.from(d.data).toString('hex') === want)) ok++;
  }
  return { ...c, n, ok };
}

export interface DFpResult {
  chunk: number;
  seconds: number;
  chirpPeaks: number;
  frames: number;
  control: boolean;
}
function discreetFp(k: number, seconds: number): DFpResult {
  const amb = ultraAmbience(seconds, FS, 8100 + k);
  let peak = 0;
  for (const v of amb) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < amb.length; i++) amb[i]! *= 0.5 / peak;
  const opts = { room: 'medium', snrDb: 20, ppm: 0, saturation: k % 2 === 1, agc: true, seed: 950 + k, leadSeconds: 0, band: 'ultrasonic' as const };
  const { rx } = simulate(amb, FS, opts);
  const chirpPeaks = findChirps(prefilter(rx, mf.ULTRA.lo, mf.ULTRA.hi), mf.ULTRA.pre, mf.ULTRA.threshold, mf.ULTRA.preLen).length;
  const frames = mf.decodeAll(rx, undefined, mf.ULTRA.threshold, mf.ULTRA).length;
  // positive control: a discreet frame at the ambience's own in-band (16.5-20.5 kHz) RMS (0 dB), at 30 s
  const msg = enc.encode(randomText(140, new Rng(k)));
  const tx = mf.encodeWith(msg, mf.DISCRETO_ID);
  const band = bandpassSections(FS, 16500, 20500, 4);
  const g = Math.sqrt(power(applyBiquads(amb, band)) / power(applyBiquads(tx, band)));
  const mix = Float32Array.from(amb);
  const at = Math.round(30 * FS);
  for (let i = 0; i < tx.length && at + i < mix.length; i++) mix[at + i]! += g * tx[i]!;
  const want = Buffer.from(msg).toString('hex');
  const control = mf.decodeAll(simulate(mix, FS, opts).rx, undefined, mf.ULTRA.threshold, mf.ULTRA).some((d) => Buffer.from(d.data).toString('hex') === want);
  return { chunk: k, seconds, chirpPeaks, frames, control };
}

// ---------------- workers ----------------
type Job = { kind: 'broadcast'; specs: ListenerSpec[] } | { kind: 'dgrid'; cells: DCell[]; n: number } | { kind: 'dfp'; chunks: number[]; seconds: number };

function runJob(job: Job): unknown[] {
  if (job.kind === 'broadcast') return broadcastWork(job.specs);
  if (job.kind === 'dgrid') return job.cells.map((c) => discreetCell(c, job.n));
  return job.chunks.map((k) => discreetFp(k, job.seconds));
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

async function parallel<T>(items: T[], make: (share: T[]) => Job): Promise<unknown[]> {
  const w = Math.max(1, Math.min(items.length, availableParallelism()));
  const shares: T[][] = Array.from({ length: w }, () => []);
  items.forEach((it, i) => shares[i % w]!.push(it));
  return (await Promise.all(shares.map((s) => runWorker(make(s))))).flat();
}

export async function runBroadcast(trials: number, receivers: number, rooms = ['small', 'medium']): Promise<Listener[]> {
  return (await parallel(listenerSpecs(trials, receivers, rooms), (specs) => ({ kind: 'broadcast', specs }))) as Listener[];
}
export async function runDiscreetGrid(n: number, cells = discreetCells()): Promise<DCellResult[]> {
  return (await parallel(cells, (s) => ({ kind: 'dgrid', cells: s, n }))) as DCellResult[];
}
export async function runDiscreetFp(minutes: number): Promise<DFpResult[]> {
  return (await parallel(Array.from({ length: minutes }, (_, i) => i), (chunks) => ({ kind: 'dfp', chunks, seconds: 60 }))) as DFpResult[];
}

/** Share of the signal's energy below `hz`, in dB, from one long FFT (audible leakage of the discreet mode). */
export function energyBelowDb(x: Float32Array, hz: number): number {
  const N = 1 << Math.ceil(Math.log2(x.length));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  re.set(x);
  Fft.of(N).transform(re, im);
  let lo = 0;
  let tot = 0;
  for (let k = 1; k < N / 2; k++) {
    const e = re[k]! ** 2 + im[k]! ** 2;
    tot += e;
    if ((k * FS) / N < hz) lo += e;
  }
  return 10 * Math.log10(Math.max(lo, 1e-30) / tot);
}

if (process.argv[2] === '--worker' && process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(JSON.stringify(runJob(JSON.parse(process.argv[3]!) as Job)));
