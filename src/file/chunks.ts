// Files over sound: split into chunks, each sent as its own frame, repeated as a carousel.
// There is no return channel, so "retry" means the sender loops over the chunks and every
// receiver keeps what it already has: a chunk lost on the first pass arrives on the next one,
// and several receivers can listen at once (broadcast).
//
// Chunk frame payload: F0 5B | kind(1) | fileId(2) | index(2) | count(2) | body
// F0 5B can never start valid UTF-8 text (0xF0 needs a continuation byte 0x80-0xBF), so plain
// text messages and file chunks share the same frames without ambiguity.
// kind 1 = data (body = bytes index*chunkSize ...), kind 2 = meta (body = JSON {name, type, size}).

const MAGIC0 = 0xf0;
const MAGIC1 = 0x5b;
const HEAD = 9;
export const DATA = 1;
export const META = 2;

export interface FileMeta {
  name: string;
  type: string;
  size: number;
}

export interface Chunk {
  kind: number;
  fileId: number;
  index: number;
  count: number;
  body: Uint8Array;
}

function pack(c: Chunk): Uint8Array {
  const out = new Uint8Array(HEAD + c.body.length);
  out.set([MAGIC0, MAGIC1, c.kind, c.fileId >> 8, c.fileId & 255, c.index >> 8, c.index & 255, c.count >> 8, c.count & 255]);
  out.set(c.body, HEAD);
  return out;
}

export function parseChunk(b: Uint8Array): Chunk | null {
  if (b.length < HEAD || b[0] !== MAGIC0 || b[1] !== MAGIC1) return null;
  return { kind: b[2]!, fileId: (b[3]! << 8) | b[4]!, index: (b[5]! << 8) | b[6]!, count: (b[7]! << 8) | b[8]!, body: b.subarray(HEAD) };
}

/** Frame payloads for one pass over the file: meta first, then the data chunks. */
export function fileFrames(data: Uint8Array, meta: Omit<FileMeta, 'size'>, fileId: number, chunkSize = 1500): Uint8Array[] {
  const count = Math.max(1, Math.ceil(data.length / chunkSize));
  const m: FileMeta = { ...meta, size: data.length };
  const frames = [pack({ kind: META, fileId, index: 0, count, body: new TextEncoder().encode(JSON.stringify(m)) })];
  for (let i = 0; i < count; i++) frames.push(pack({ kind: DATA, fileId, index: i, count, body: data.subarray(i * chunkSize, (i + 1) * chunkSize) }));
  return frames;
}

/** Collects chunks of one or more files; complete() returns the bytes once every chunk is in. */
export class Assembler {
  private files = new Map<number, { count: number; parts: (Uint8Array | undefined)[]; meta?: FileMeta }>();

  /** Feed one decoded frame payload. Returns the chunk if it belonged to a file. */
  add(payload: Uint8Array): Chunk | null {
    const c = parseChunk(payload);
    if (!c || c.count === 0) return null;
    let f = this.files.get(c.fileId);
    if (!f || f.count !== c.count) {
      f = { count: c.count, parts: Array.from({ length: c.count }, () => undefined) };
      this.files.set(c.fileId, f);
    }
    if (c.kind === META) {
      try {
        f.meta = JSON.parse(new TextDecoder().decode(c.body)) as FileMeta;
      } catch {
        /* ignore a malformed meta chunk */
      }
    } else if (c.kind === DATA && c.index < c.count) f.parts[c.index] ??= c.body.slice();
    return c;
  }

  progress(fileId: number): { have: number; count: number } {
    const f = this.files.get(fileId);
    return { have: f ? f.parts.filter(Boolean).length : 0, count: f?.count ?? 0 };
  }

  complete(fileId: number): { data: Uint8Array; meta?: FileMeta } | null {
    const f = this.files.get(fileId);
    if (!f || f.parts.some((p) => !p)) return null;
    const total = f.parts.reduce((a, p) => a + p!.length, 0);
    const data = new Uint8Array(total);
    let off = 0;
    for (const p of f.parts) {
      data.set(p!, off);
      off += p!.length;
    }
    return { data, meta: f.meta };
  }

  meta(fileId: number): FileMeta | undefined {
    return this.files.get(fileId)?.meta;
  }

  ids(): number[] {
    return [...this.files.keys()];
  }
}
