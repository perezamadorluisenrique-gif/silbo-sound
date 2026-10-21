// Reference modem: slow binary FSK (50 baud, 1500/2000 Hz), no error correction.
// Frame: up-chirp, 1 length byte, data, CRC-32. Only here to be measured against.
import { chirp, findChirps, prefilter, FS } from './chirp.ts';
import { crc32 } from '../fec/crc.ts';

const SYM = 960; // 50 baud at 48 kHz
const F = [1500, 2000];
const PRE = chirp(4096, 1500, 6500);
const GAP = 480;

export const FSK_NAME = 'FSK binaria 50 baudios (referencia)';

export function fskEncode(data: Uint8Array): Float32Array {
  if (data.length > 255) throw new Error('FSK reference frame holds at most 255 bytes');
  const c = crc32(data);
  const bytes = Uint8Array.from([data.length, ...data, c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255]);
  const nb = bytes.length * 8;
  const out = new Float32Array(PRE.length + GAP + nb * SYM + 480);
  for (let i = 0; i < PRE.length; i++) out[i] = 0.8 * PRE[i]!;
  let ph = 0;
  let p = PRE.length + GAP;
  for (let b = 0; b < nb; b++) {
    const bit = (bytes[b >> 3]! >> (7 - (b & 7))) & 1;
    for (let i = 0; i < SYM; i++) {
      ph += (2 * Math.PI * F[bit]!) / FS; // continuous phase
      const edge = b === 0 ? Math.min(1, i / 96) : b === nb - 1 ? Math.min(1, (SYM - i) / 96) : 1;
      out[p++] = 0.8 * edge * Math.sin(ph);
    }
  }
  return out;
}

function goertzelPower(x: Float32Array, start: number, len: number, f: number): number {
  const w = (2 * Math.PI * f) / FS;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < len; i++) {
    const s0 = (x[start + i] ?? 0) + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

export function fskDecode(rx: Float32Array): Uint8Array | null {
  const xf = prefilter(rx, 1000, 7000);
  const peaks = findChirps(xf, PRE, 0.3, 4096);
  for (const pk of peaks) {
    const base = pk.index + PRE.length + GAP;
    const bitAt = (b: number) => {
      const s = base + b * SYM + SYM / 4;
      return goertzelPower(rx, s, SYM / 2, F[1]!) > goertzelPower(rx, s, SYM / 2, F[0]!) ? 1 : 0;
    };
    const byteAt = (i: number) => {
      let v = 0;
      for (let k = 0; k < 8; k++) v = (v << 1) | bitAt(i * 8 + k);
      return v;
    };
    const len = byteAt(0);
    if (base + (len + 5) * 8 * SYM > rx.length) continue;
    const bytes = new Uint8Array(len + 4);
    for (let i = 0; i < len + 4; i++) bytes[i] = byteAt(1 + i);
    const data = bytes.slice(0, len);
    const c = ((bytes[len]! << 24) | (bytes[len + 1]! << 16) | (bytes[len + 2]! << 8) | bytes[len + 3]!) >>> 0;
    if (crc32(data) === c) return data;
  }
  return null;
}
