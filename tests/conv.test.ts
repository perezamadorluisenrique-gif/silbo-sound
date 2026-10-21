import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convEncode, viterbiDecode } from '../src/fec/conv.ts';
import { Rng } from '../src/dsp/rng.ts';

test('viterbi decodes clean and noisy soft input', () => {
  const rng = new Rng(3);
  const data = rng.bytes(200);
  const c = convEncode(data);
  const clean = Array.from(c, (b) => (b ? -1 : 1));
  assert.deepEqual(viterbiDecode(clean, data.length), data);
  // BPSK over AWGN at Eb/N0 ~ 4.4 dB (sigma 0.6 per coded bit): rate 1/2 K=7 should fix it
  const noisy = clean.map((v) => v + 0.6 * rng.gauss());
  assert.deepEqual(viterbiDecode(noisy, data.length), data);
  // 10 % erasures
  const er = clean.map((v, i) => (i % 10 === 3 ? 0 : v));
  assert.deepEqual(viterbiDecode(er, data.length), data);
});
