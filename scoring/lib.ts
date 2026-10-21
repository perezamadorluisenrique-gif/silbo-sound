// Shared helpers for score and experiments: trials through the channel simulator.
import { createHash } from 'node:crypto';
import { Rng } from '../src/dsp/rng.ts';
import { simulate, type ChannelOptions } from '../src/sim/channel.ts';
import { FS } from '../src/modem/chirp.ts';

export const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:¿?¡!ñáéíóúü-()';

/** Random text of exactly n characters (UTF-8 may be longer: accents take 2 bytes). */
export function randomText(n: number, rng: Rng): string {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[rng.int(ALPHABET.length)];
  return s;
}

export interface Modem {
  name: string;
  encode(data: Uint8Array): Float32Array;
  decode(rx: Float32Array): Uint8Array[];
}

export interface TrialSpec extends Omit<ChannelOptions, 'seed' | 'ppm'> {
  ppm: number | 'random';
}

export interface TrialStats {
  n: number;
  ok: number;
  airtime: number; // mean seconds of sound per message
  bytes: number; // mean payload bytes
}

export function runTrials(m: Modem, spec: TrialSpec, n: number, seed: number, makeMsg: (rng: Rng) => Uint8Array): TrialStats {
  const rng = new Rng(seed);
  let ok = 0;
  let air = 0;
  let bytes = 0;
  for (let i = 0; i < n; i++) {
    const msg = makeMsg(rng);
    const tx = m.encode(msg);
    air += tx.length / FS;
    bytes += msg.length;
    const ppm = spec.ppm === 'random' ? rng.uniform(-200, 200) : spec.ppm;
    const { rx } = simulate(tx, FS, { ...spec, ppm, seed: rng.int(2 ** 31) });
    const got = m.decode(rx);
    const h = sha256(msg);
    if (got.some((g) => sha256(g) === h)) ok++;
  }
  return { n, ok, airtime: air / n, bytes: bytes / n };
}

export const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)} %`;
