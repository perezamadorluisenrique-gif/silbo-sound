// App logic shared by the page, the decoder worker and the Node tests (no DOM here).
import * as mf from '../src/modem/mfsk.ts';
import { fileFrames, Assembler, parseChunk, META } from '../src/file/chunks.ts';

export const FS = 48000;
/** Texts up to this many UTF-8 bytes go in one robust MFSK frame (≈8 s); longer ones as a file. */
export const TEXT_MAX_BYTES = 300;
export const TEXT_PROFILE = 1; // «robusto»: survives the large room too
/** Discreet mode (near ultrasound, profile 3): texts only, short enough to fit one receive window. */
export const DISCRETO_MAX_BYTES = 200;
export const FRAME_GAP_S = 0.1;
/** Receiver sliding window and cadence. */
export const WINDOW_S = 14;
export const DECODE_EVERY_S = 1.5;

export interface TxPlan {
  kind: 'text' | 'file';
  frames: Uint8Array[];
  /** One pass of audio (frames separated by FRAME_GAP_S of silence), at FS. */
  audio: Float32Array;
  /** Seconds where each frame ends inside the pass. */
  ends: number[];
  /** Repeat the pass until stopped (files: carousel, so late or unlucky receivers catch up). */
  loop: boolean;
  fileId?: number;
}

export function randomId(): number {
  return Math.floor(Math.random() * 65536);
}

function join(frames: Float32Array[]): { audio: Float32Array; ends: number[] } {
  const gap = Math.round(FRAME_GAP_S * FS);
  const total = frames.reduce((a, f) => a + f.length + gap, 0) + gap;
  const audio = new Float32Array(total);
  const ends: number[] = [];
  let o = gap;
  for (const f of frames) {
    audio.set(f, o);
    o += f.length;
    ends.push(o / FS);
    o += gap;
  }
  return { audio, ends };
}

export function planText(text: string, discreto = false): TxPlan {
  const bytes = new TextEncoder().encode(text);
  if (discreto) {
    if (bytes.length > DISCRETO_MAX_BYTES) throw new Error(`el modo discreto admite hasta ${DISCRETO_MAX_BYTES} bytes`);
    return { kind: 'text', frames: [bytes], ...join([mf.encodeWith(bytes, mf.DISCRETO_ID)]), loop: false };
  }
  if (bytes.length > TEXT_MAX_BYTES) return planFile(bytes, 'mensaje.txt', 'text/plain;charset=utf-8');
  const frames = [bytes];
  return { kind: 'text', frames, ...join([mf.encodeWith(bytes, TEXT_PROFILE)]), loop: false };
}

export function planFile(data: Uint8Array, name: string, type: string, fileId = randomId()): TxPlan {
  const frames = fileFrames(data, { name, type }, fileId);
  return { kind: 'file', frames, ...join(frames.map((f) => mf.encodeWith(f, mf.OFDM_ID))), loop: true, fileId };
}

/**
 * Files that compress (text, documents) travel deflate-raw compressed with the browser's standard
 * CompressionStream; the meta chunk's type gets this suffix so the receiver knows to inflate.
 * Node's zlib (deflateRawSync) writes the same format, which is how score measures it.
 */
export const PACKED = ';silbo=deflate';

async function deflate(b: Uint8Array, inflate = false): Promise<Uint8Array> {
  const stream = new Blob([b as Uint8Array<ArrayBuffer>]).stream().pipeThrough(inflate ? new DecompressionStream('deflate-raw') : new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** planFile, compressing first when it pays (not for photos, audio, video or archives). */
export async function planFileAuto(data: Uint8Array, name: string, type: string, fileId = randomId()): Promise<TxPlan> {
  if (!/^(image|audio|video)\/|zip|compressed|gzip/.test(type) && typeof CompressionStream !== 'undefined') {
    try {
      const z = await deflate(data);
      if (z.length < 0.9 * data.length) return planFile(z, name, (type || 'application/octet-stream') + PACKED, fileId);
    } catch {
      /* send it as it is */
    }
  }
  return planFile(data, name, type, fileId);
}

/** Receiver side of planFileAuto. */
export async function unpackFile(data: Uint8Array, mime: string): Promise<{ data: Uint8Array; mime: string }> {
  if (!mime.endsWith(PACKED)) return { data, mime };
  return { data: await deflate(data, true), mime: mime.slice(0, -PACKED.length) };
}

/** Seconds of sound for one pass, before encoding (for the estimate shown under the picker). */
export function estimateSeconds(bytes: number, asText: boolean, discreto = false): number {
  if (asText && discreto) return mf.airtimeWith(bytes, mf.DISCRETO_ID) + 2 * FRAME_GAP_S;
  if (asText && bytes <= TEXT_MAX_BYTES) return mf.airtimeWith(bytes, TEXT_PROFILE) + 2 * FRAME_GAP_S;
  const chunks = Math.max(1, Math.ceil(bytes / 1500));
  let s = mf.airtimeWith(60, mf.OFDM_ID) + FRAME_GAP_S;
  for (let i = 0; i < chunks; i++) s += mf.airtimeWith(Math.min(1500, bytes - i * 1500) + 9, mf.OFDM_ID) + FRAME_GAP_S;
  return s;
}

/** FNV-1a over the bytes: dedupes the same frame heard in overlapping windows or carousel passes. */
export function frameKey(b: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 0x01000193);
  return `${b.length}:${(h >>> 0).toString(16)}`;
}

export type RxEvent =
  | { type: 'text'; text: string }
  | { type: 'progress'; fileId: number; have: number; count: number; name?: string }
  | { type: 'file'; fileId: number; name: string; mime: string; data: Uint8Array };

/** Turns decoded frame payloads (in any order, with repeats) into what the UI shows. */
export class Receiver {
  private seen = new Set<string>();
  private done = new Set<number>();
  readonly asm = new Assembler();
  frames = 0;

  feed(payload: Uint8Array): RxEvent[] {
    const key = frameKey(payload);
    if (this.seen.has(key)) return [];
    this.seen.add(key);
    this.frames++;
    const c = parseChunk(payload);
    if (!c) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(payload);
      return [{ type: 'text', text }];
    }
    if (this.done.has(c.fileId)) return [];
    this.asm.add(payload);
    const out: RxEvent[] = [];
    const pr = this.asm.progress(c.fileId);
    const meta = this.asm.meta(c.fileId);
    out.push({ type: 'progress', fileId: c.fileId, have: pr.have, count: pr.count, name: meta?.name });
    const full = this.asm.complete(c.fileId);
    // Wait for the meta chunk too (name and type), unless it is the only thing missing for long:
    // the carousel sends it first in every pass, so it arrives soon.
    if (full && (full.meta || c.kind === META)) {
      this.done.add(c.fileId);
      out.push({ type: 'file', fileId: c.fileId, name: full.meta?.name ?? 'archivo', mime: full.meta?.type ?? 'application/octet-stream', data: full.data });
    }
    return out;
  }
}

/** Zeros put in front of each window, one preamble long (85 ms). */
const LEAD_PAD = 4096;

/**
 * Decode one receive window (48 kHz). skip: samples at the start of the window already covered
 * by frames decoded in earlier windows. Returns the payloads and the sample where the last one
 * ends (−1 if none), so the next window can skip it.
 */
export function decodeWindow(win: Float32Array, skip = -1): { payloads: Uint8Array[]; lastEnd: number } {
  // don't filter and correlate again what was already decoded: keep 0.5 s before the skip point
  // (filter warm-up, early arrivals), which roughly halves the work on a carousel
  const cut = skip > FS ? skip - FS / 2 : 0;
  // silence in front: the preamble correlator can't look before sample 0, so a frame whose
  // preamble began a few ms before listening started was lost (bench: late start)
  const x = new Float32Array(LEAD_PAD + win.length - cut);
  x.set(cut ? win.subarray(cut) : win, LEAD_PAD);
  const got = mf.decodeAny(x, skip < 0 ? -1 : skip - cut + LEAD_PAD); // phone band and discreet band
  return { payloads: got.map((d) => d.data), lastEnd: got.reduce((m, d) => Math.max(m, d.stats.end + cut - LEAD_PAD), -1) };
}
