import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileFrames, Assembler, parseChunk } from '../src/file/chunks.ts';
import { Rng } from '../src/dsp/rng.ts';

test('chunks reassemble in any order, with duplicates, and text is never a chunk', () => {
  const data = new Rng(1).bytes(4000);
  const frames = fileFrames(data, { name: 'x.bin', type: 'application/octet-stream' }, 77, 1500);
  assert.equal(frames.length, 1 + 3);
  const asm = new Assembler();
  for (const f of [frames[3]!, frames[1]!, frames[1]!, frames[0]!]) asm.add(f);
  assert.equal(asm.complete(77), null);
  assert.deepEqual(asm.progress(77), { have: 2, count: 3 });
  asm.add(frames[2]!);
  const c = asm.complete(77)!;
  assert.deepEqual(c.data, data);
  assert.equal(c.meta?.name, 'x.bin');
  assert.equal(parseChunk(new TextEncoder().encode('hola ñandú')), null);
});
