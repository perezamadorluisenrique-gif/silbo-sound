import test from 'node:test';
import assert from 'node:assert/strict';
import { rsEncode, rsDecode } from '../src/fec/rs.ts';
import { crc32, crc8 } from '../src/fec/crc.ts';
import { scramble } from '../src/fec/scramble.ts';
import { Rng } from '../src/dsp/rng.ts';

test('crc32 check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc8(new TextEncoder().encode('123456789')), 0xf4);
});

test('scramble is an involution', () => {
  const d = new Rng(1).bytes(300);
  assert.deepEqual(scramble(scramble(d)), d);
});

test('RS corrects up to nsym/2 errors', () => {
  const rng = new Rng(7);
  for (let trial = 0; trial < 200; trial++) {
    const k = 1 + rng.int(200);
    const nsym = 2 + 2 * rng.int(26);
    if (k + nsym > 255) continue;
    const msg = rng.bytes(k);
    const cw = rsEncode(msg, nsym);
    const ne = rng.int(nsym / 2 + 1);
    const pos = new Set<number>();
    while (pos.size < ne) pos.add(rng.int(cw.length));
    for (const p of pos) cw[p]! ^= 1 + rng.int(255);
    const r = rsDecode(cw, nsym);
    assert.ok(r.ok, `trial ${trial} k=${k} nsym=${nsym} ne=${ne}`);
    assert.deepEqual(r.data, msg);
  }
});

test('RS corrects errors and erasures with 2e+f <= nsym', () => {
  const rng = new Rng(11);
  for (let trial = 0; trial < 300; trial++) {
    const k = 1 + rng.int(150);
    const nsym = 4 + 2 * rng.int(30);
    if (k + nsym > 255) continue;
    const msg = rng.bytes(k);
    const cw = rsEncode(msg, nsym);
    const f = rng.int(nsym + 1);
    const e = Math.floor((nsym - f) / 2);
    const pos = new Set<number>();
    while (pos.size < f + e) pos.add(rng.int(cw.length));
    const all = [...pos];
    const eras = all.slice(0, f);
    for (const p of all.slice(f)) cw[p]! ^= 1 + rng.int(255);
    for (const p of eras) if (rng.next() < 0.7) cw[p]! ^= 1 + rng.int(255);
    const r = rsDecode(cw, nsym, eras);
    assert.ok(r.ok, `trial ${trial} k=${k} nsym=${nsym} f=${f} e=${e}`);
    assert.deepEqual(r.data, msg);
  }
});

test('RS reports failure (or a different codeword) beyond capacity, never crashes', () => {
  const rng = new Rng(3);
  let fails = 0;
  for (let trial = 0; trial < 100; trial++) {
    const msg = rng.bytes(50);
    const cw = rsEncode(msg, 10);
    for (let i = 0; i < 12; i++) cw[rng.int(cw.length)]! ^= 1 + rng.int(255);
    const r = rsDecode(cw, 10);
    if (!r.ok) fails++;
  }
  assert.ok(fails > 80);
});
