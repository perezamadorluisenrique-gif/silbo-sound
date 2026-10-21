import test from 'node:test';
import assert from 'node:assert/strict';
import * as mf from '../src/modem/mfsk.ts';
import { simulate } from '../src/sim/channel.ts';
import { Rng } from '../src/dsp/rng.ts';
import { Receiver, planText, planFile } from '../app/core.ts';

/** Insert (n > 0) or drop (n < 0) |n| samples at position at, like an audio underrun. */
function gap(x: Float32Array, at: number, n: number): Float32Array {
  if (n > 0) {
    const y = new Float32Array(x.length + n);
    y.set(x.subarray(0, at));
    y.set(x.subarray(at), at + n);
    return y;
  }
  return Float32Array.from([...x.subarray(0, at), ...x.subarray(at - n)]);
}

test('OFDM frame survives a 10-20 ms audio gap in the middle (inserted or dropped samples)', () => {
  const rng = new Rng(77);
  const d = rng.bytes(1509);
  const tx = mf.encodeWith(d, mf.OFDM_ID);
  let ok = 0;
  const cases = [480, 917, -480, 700];
  cases.forEach((n, i) => {
    const { rx } = simulate(tx, 48000, { room: 'small', snrDb: 25, ppm: 50 * (i - 1), saturation: false, agc: true, seed: 100 + i, leadSeconds: 0.5 });
    const g = gap(rx, Math.round(rx.length * (0.35 + 0.1 * i)), n);
    const got = mf.decodeAll(g);
    if (got.length === 1 && Buffer.from(got[0]!.data).equals(Buffer.from(d))) ok++;
  });
  assert.equal(ok, cases.length);
});

test('app Receiver: text, then a file in any order with repeats', () => {
  const r = new Receiver();
  const t = planText('hola');
  assert.deepEqual(r.feed(t.frames[0]!), [{ type: 'text', text: 'hola' }]);
  assert.deepEqual(r.feed(t.frames[0]!), []); // same frame heard again
  const data = new Rng(3).bytes(4000);
  const f = planFile(data, 'x.bin', 'application/octet-stream', 4321);
  const order = [2, 3, 1, 2, 0];
  const evs = order.flatMap((i) => r.feed(f.frames[i]!));
  const file = evs.find((e) => e.type === 'file');
  assert.ok(file && file.type === 'file');
  assert.equal(file.name, 'x.bin');
  assert.deepEqual(file.data, data);
});

test('long text goes as a file carousel', () => {
  const p = planText('a'.repeat(1000));
  assert.equal(p.kind, 'file');
  assert.ok(p.loop);
});
