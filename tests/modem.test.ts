import test from 'node:test';
import assert from 'node:assert/strict';
import * as mf from '../src/modem/mfsk.ts';
import { fskEncode, fskDecode } from '../src/modem/fsk.ts';
import { Rng } from '../src/dsp/rng.ts';

test('MFSK round trip on a clean channel, any length', () => {
  const rng = new Rng(5);
  for (const len of [0, 1, 7, 140, 300, 700]) {
    const d = rng.bytes(len);
    const tx = mf.encode(d);
    const rx = new Float32Array(tx.length + 20000);
    rx.set(tx, 9000);
    const got = mf.decodeAll(rx);
    assert.equal(got.length, 1, `len ${len}`);
    assert.deepEqual(got[0]!.data, d);
  }
});

test('MFSK finds two frames back to back', () => {
  const a = mf.encode(new TextEncoder().encode('hola'));
  const b = mf.encode(new TextEncoder().encode('adiós'));
  const rx = new Float32Array(a.length + b.length + 30000);
  rx.set(a, 5000);
  rx.set(b, 5000 + a.length + 4000);
  const got = mf.decodeAll(rx).map((x) => new TextDecoder().decode(x.data));
  assert.deepEqual(got, ['hola', 'adiós']);
});

test('FSK reference round trip', () => {
  const d = new TextEncoder().encode('referencia');
  const tx = fskEncode(d);
  const rx = new Float32Array(tx.length + 10000);
  rx.set(tx, 3000);
  assert.deepEqual(fskDecode(rx), d);
});

test('discreet profile: round trip, and decodeAny separates it from a phone-band frame', () => {
  const rng = new Rng(77);
  const a = rng.bytes(140);
  const b = rng.bytes(60);
  const ta = mf.encodeWith(a, mf.DISCRETO_ID);
  const tb = mf.encodeWith(b, 1);
  const rx = new Float32Array(ta.length + tb.length + 40000);
  rx.set(ta, 5000);
  for (let i = 0; i < tb.length; i++) rx[ta.length + 20000 + i]! += tb[i]!;
  // the phone receiver ignores the discreet frame and vice versa
  assert.deepEqual(mf.decodeAll(rx).map((d) => d.data), [b]);
  assert.deepEqual(mf.decodeAll(rx, undefined, mf.ULTRA.threshold, mf.ULTRA).map((d) => d.data), [a]);
  const any = mf.decodeAny(rx);
  assert.equal(any.length, 2);
  assert.deepEqual(any[0]!.data, a);
  assert.equal(any[0]!.stats.profile, mf.DISCRETO_ID);
});
