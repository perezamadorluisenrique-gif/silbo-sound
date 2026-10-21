// R3: a ~10 KB JPEG over sound in at most 60 s, as a carousel of chunk frames (profile 2,
// OFDM). Each trial renders 60 s of carousel audio, passes it through the channel simulator
// (medium room, SNR 15 dB, random clock drift ±200 ppm) and feeds every decoded frame to the
// receiver's Assembler in arrival order; the time is when the last missing chunk ends.
// Worker mode: node scoring/r3.ts --worker '<json>'
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Rng } from '../src/dsp/rng.ts';
import * as mf from '../src/modem/mfsk.ts';
import { simulate } from '../src/sim/channel.ts';
import { fileFrames, Assembler } from '../src/file/chunks.ts';
import { sha256 } from './lib.ts';

const FS = 48000;
export const PHOTO = new URL('../assets/foto.jpg', import.meta.url);
export const LIMIT_S = 60;
const FRAME_GAP_S = 0.1;

export interface R3Trial {
  seed: number;
  ok: boolean;
  seconds: number | null; // completion time (null if incomplete within the limit)
  frames: number; // frames sent within the limit
  decoded: number; // frames decoded
  firstPass: boolean; // complete after the first pass (no repeats needed)
}

/** The carousel: one pass = meta + data chunks; repeated while it fits in LIMIT_S. */
export function carousel(photo: Uint8Array, fileId: number, chunkSize: number): { audio: Float32Array; ends: number[]; perPass: number } {
  const frames = fileFrames(photo, { name: 'foto.jpg', type: 'image/jpeg' }, fileId, chunkSize).map((f) => mf.encodeWith(f, mf.OFDM_ID));
  const gap = Math.round(FRAME_GAP_S * FS);
  const max = LIMIT_S * FS;
  const parts: Float32Array[] = [];
  const ends: number[] = [];
  let t = 0;
  for (let i = 0; ; i++) {
    const f = frames[i % frames.length]!;
    if (t + f.length > max) break;
    parts.push(f);
    t += f.length;
    ends.push(t);
    t += gap;
  }
  const audio = new Float32Array(t);
  let o = 0;
  for (const p of parts) {
    audio.set(p, o);
    o += p.length + gap;
  }
  return { audio, ends, perPass: frames.length };
}

function trial(seed: number, chunkSize: number): R3Trial {
  const photo = new Uint8Array(readFileSync(PHOTO));
  const rng = new Rng(seed);
  const fileId = rng.int(65536);
  const { audio, ends, perPass } = carousel(photo, fileId, chunkSize);
  const lead = 0.5;
  const { rx, signalStart } = simulate(audio, FS, { room: 'medium', snrDb: 15, ppm: rng.uniform(-200, 200), saturation: false, agc: true, seed: rng.int(2 ** 31), leadSeconds: lead });
  const t0 = signalStart - 0.003 * FS;
  const got = mf.decodeAll(rx).sort((a, b) => a.stats.end - b.stats.end);
  const asm = new Assembler();
  let seconds: number | null = null;
  for (const d of got) {
    asm.add(d.data);
    const c = asm.complete(fileId);
    if (c && seconds === null) {
      seconds = (d.stats.end - t0) / FS;
      if (sha256(c.data) !== sha256(photo)) seconds = null;
      break;
    }
  }
  const ok = seconds !== null && seconds <= LIMIT_S + 0.5; // +0.5 s: the frame's own reverb tail
  return { seed, ok, seconds, frames: ends.length, decoded: got.length, firstPass: ok && seconds! <= ends[perPass - 1]! / FS + 0.5 };
}

function runWorker(seeds: number[], chunkSize: number): Promise<R3Trial[]> {
  return new Promise((resolve, reject) => {
    const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', JSON.stringify({ seeds, chunkSize })], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    ch.stdout.on('data', (d) => (out += d));
    ch.on('error', reject);
    ch.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`worker exit ${code}`))));
  });
}

export async function runR3(n: number, chunkSize = 1500): Promise<R3Trial[]> {
  const seeds = Array.from({ length: n }, (_, i) => 30000 + i);
  const w = Math.max(1, Math.min(n, availableParallelism()));
  const shares: number[][] = Array.from({ length: w }, () => []);
  seeds.forEach((s, i) => shares[i % w]!.push(s));
  return (await Promise.all(shares.map((s) => runWorker(s, chunkSize)))).flat();
}

if (process.argv[2] === '--worker' && process.argv[1] === fileURLToPath(import.meta.url)) {
  const job = JSON.parse(process.argv[3]!) as { seeds: number[]; chunkSize: number };
  process.stdout.write(JSON.stringify(job.seeds.map((s) => trial(s, job.chunkSize))));
}
