// R7: a whole chapter of the first sprint's Python book (assets/capitulo-09-listas.md, CC BY-NC-SA
// 4.0) sent by sound, the way the app sends it: compressed with deflate-raw (the browser's
// standard CompressionStream; Node's zlib makes the same format), cut into chunks and played
// in a carousel. Each trial: medium room, SNR 15 dB, random ±200 ppm, the receiver switches on
// at a random moment of the first pass; pass = inflated text identical by SHA-256 within LIMIT_S.
// Worker mode: node scoring/r7.ts --worker '<json>'
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { Rng } from '../src/dsp/rng.ts';
import * as mf from '../src/modem/mfsk.ts';
import { simulate } from '../src/sim/channel.ts';
import { fileFrames, Assembler } from '../src/file/chunks.ts';
import { sha256 } from './lib.ts';

const FS = 48000;
export const CHAPTER = new URL('../assets/capitulo-09-listas.md', import.meta.url);
export const LIMIT_S = 60;
const GAP_S = 0.1;

export interface R7Trial {
  seed: number;
  join: number;
  ok: boolean;
  seconds: number | null;
}

export function chapterInfo() {
  const raw = new Uint8Array(readFileSync(CHAPTER));
  const packed = new Uint8Array(deflateRawSync(raw, { level: 9 }));
  const frames = fileFrames(packed, { name: 'capitulo-09-listas.md', type: 'text/markdown;charset=utf-8;silbo=deflate' }, 1);
  const pass = frames.reduce((a, f) => a + mf.airtimeWith(f.length, mf.OFDM_ID) + GAP_S, 0);
  const words = new TextDecoder().decode(raw).split(/\s+/).filter(Boolean).length;
  return { raw, packed, frames: frames.length, pass, words };
}

function trial(seed: number): R7Trial {
  const { raw, packed, pass } = chapterInfo();
  const rng = new Rng(seed);
  const fileId = rng.int(65536);
  const frames = fileFrames(packed, { name: 'capitulo-09-listas.md', type: 'text/markdown;charset=utf-8;silbo=deflate' }, fileId).map((f) => mf.encodeWith(f, mf.OFDM_ID));
  const join = Math.round(rng.uniform(0, pass) * 10) / 10;
  const gap = Math.round(GAP_S * FS);
  const need = (join + LIMIT_S + 1) * FS;
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
  const a = Math.round(join * FS);
  const lead = 0.05;
  const { rx } = simulate(audio.subarray(a, a + LIMIT_S * FS), FS, { room: 'medium', snrDb: 15, ppm: rng.uniform(-200, 200), saturation: false, agc: true, seed: rng.int(2 ** 31), leadSeconds: lead });
  const asm = new Assembler();
  let seconds: number | null = null;
  for (const d of mf.decodeAll(rx).sort((x, y) => x.stats.end - y.stats.end)) {
    asm.add(d.data);
    const c = asm.complete(fileId);
    if (c && c.meta) {
      let text: Uint8Array | null = null;
      try {
        text = new Uint8Array(inflateRawSync(c.data));
      } catch {
        text = null;
      }
      if (text && sha256(text) === sha256(raw)) seconds = d.stats.end / FS - lead;
      break;
    }
  }
  return { seed, join, ok: seconds !== null, seconds };
}

function runWorker(seeds: number[]): Promise<R7Trial[]> {
  return new Promise((resolve, reject) => {
    const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', JSON.stringify(seeds)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    ch.stdout.on('data', (d) => (out += d));
    ch.on('error', reject);
    ch.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`worker exit ${code}`))));
  });
}

export async function runR7(n: number): Promise<R7Trial[]> {
  const seeds = Array.from({ length: n }, (_, i) => 70000 + i);
  const w = Math.max(1, Math.min(n, availableParallelism()));
  const shares: number[][] = Array.from({ length: w }, () => []);
  seeds.forEach((s, i) => shares[i % w]!.push(s));
  return (await Promise.all(shares.map(runWorker))).flat();
}

if (process.argv[2] === '--worker' && process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(JSON.stringify((JSON.parse(process.argv[3]!) as number[]).map(trial)));
