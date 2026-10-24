// One transmission: random text -> app encoder -> channel -> app decoder, plus diagnostics.
import { simulate, noiseOnly, type Condition, FS } from './channel/index.ts';
import { Rng, seedOf } from './lib/dsp.ts';
import { randomText, LENGTHS, SWEEPS, SCENARIOS, FALSE_TESTS } from './sweeps.ts';

export interface Codec {
  core: typeof import('../app/core.ts');
  mf: typeof import('../src/modem/mfsk.ts');
}

export async function loadCodec(root: string): Promise<Codec> {
  const core = await import(new URL('app/core.ts', root).href);
  const mf = await import(new URL('src/modem/mfsk.ts', root).href);
  return { core, mf };
}

export interface TrialRecord {
  i: number;
  len: number; // characters
  ok: boolean; // exact text delivered
  cer: number; // character error rate (lost message = 1)
  wrong: number; // payloads delivered that are not the message (undetected errors / false frames)
  sync: boolean | null; // preamble detected within ±10 ms of the truth (null when it was cut off)
  rawBer: number | null; // genie-timed pre-FEC bit error rate of the tones (null when not measurable)
  ms: number; // decodeWindow wall time
  airtime: number; // seconds of sound sent
}

function levenshtein(a: string[], b: string[]): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length]!;
}

function popcount(x: number): number {
  let c = 0;
  for (; x; x &= x - 1) c++;
  return c;
}

export function messageFor(seed: number, i: number): string {
  const rng = new Rng(seedOf(seed, 'msg', i));
  return randomText(LENGTHS[i % LENGTHS.length]!, rng);
}

export function runTrial(codec: Codec, cond: Condition, seed: number, i: number, text: string): TrialRecord {
  const { core, mf } = codec;
  const plan = core.planText(text);
  const frameOffset = Math.round(core.FRAME_GAP_S * FS);
  const sim = simulate(plan.audio, cond, seed, frameOffset);
  const t0 = performance.now();
  const { payloads } = core.decodeWindow(sim.rx);
  const ms = performance.now() - t0;
  const dec = new TextDecoder();
  const got = payloads.map((p: Uint8Array) => dec.decode(p));
  const ok = got.includes(text);
  const wrong = got.filter((g: string) => g !== text).length;
  let cer = ok ? 0 : 1;
  if (!ok && got.length) cer = Math.min(1, ...got.map((g: string) => levenshtein([...g], [...text]) / [...text].length));
  // diagnostics: where the preamble really is, and the raw tone errors with perfect timing
  // rounded: the codec's equaliser indexes rx with it
  const pre = Math.round(sim.frameStart + frameOffset * sim.ratio);
  let sync: boolean | null = null;
  let rawBer: number | null = null;
  if (pre >= 0) {
    const peaks: number[] = mf.findPreamble(sim.rx, mf.DETECT_THRESHOLD);
    sync = peaks.some((p) => Math.abs(p - pre) <= 0.01 * FS);
    const bytes = new TextEncoder().encode(text);
    const prof = mf.PROFILES[core.TEXT_PROFILE];
    const tx: Uint8Array[] = mf.txTones(bytes, prof);
    const rx: Uint8Array[] = mf.rxTones(sim.rx, pre, tx.length, sim.ratio, prof);
    let errs = 0;
    let bits = 0;
    const bpt = Math.log2(prof.M);
    for (let k = 0; k < tx.length; k++) for (let g = 0; g < tx[k]!.length; g++) {
      errs += popcount(tx[k]![g]! ^ rx[k]![g]!);
      bits += bpt;
    }
    rawBer = errs / bits;
  }
  return { i, len: [...text].length, ok, cer, wrong, sync, rawBer, ms, airtime: plan.audio.length / FS };
}

// ---------------------------------------------------------------- tasks (shared by worker and main)
export type Task =
  | { kind: 'sweep'; id: string; step: number; i0: number; i1: number; seed: number }
  | { kind: 'scenario'; id: string; i0: number; i1: number; seed: number }
  | { kind: 'false'; id: string; w0: number; w1: number; seed: number; windowS: number };

export interface FalseRecord {
  window: number;
  seconds: number;
  frames: number; // payloads delivered from pure noise
  alarms: number; // preamble detector peaks above threshold (each costs a header decode)
  ms: number;
}

export function runTask(codec: Codec, t: Task): (TrialRecord | FalseRecord)[] {
  if (t.kind === 'false') {
    const ft = FALSE_TESTS.find((f) => f.id === t.id)!;
    const out: FalseRecord[] = [];
    for (let w = t.w0; w < t.w1; w++) {
      const rx = noiseOnly(t.windowS, ft.cond, seedOf(t.seed, 'false', t.id, w));
      const t0 = performance.now();
      const { payloads } = codec.core.decodeWindow(rx);
      const ms = performance.now() - t0;
      const alarms = codec.mf.findPreamble(rx, codec.mf.DETECT_THRESHOLD).length;
      out.push({ window: w, seconds: t.windowS, frames: payloads.length, alarms, ms });
    }
    return out;
  }
  const out: TrialRecord[] = [];
  for (let i = t.i0; i < t.i1; i++) {
    let cond: Condition;
    let seed: number;
    if (t.kind === 'sweep') {
      const sw = SWEEPS.find((s) => s.id === t.id)!;
      const v = sw.values[t.step]!;
      seed = seedOf(t.seed, 'sweep', t.id, v, i);
      cond = sw.cond(v, new Rng(seedOf(seed, 'cond')));
    } else {
      const sc = SCENARIOS.find((s) => s.id === t.id)!;
      seed = seedOf(t.seed, 'scenario', t.id, i);
      cond = sc.cond(new Rng(seedOf(seed, 'cond')));
    }
    out.push(runTrial(codec, cond, seed, i, messageFor(t.seed, i)));
  }
  return out;
}
