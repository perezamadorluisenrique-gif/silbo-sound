// Ablations: targeted experiments behind the write-up's findings and suggestions.
// They change the experiment, never the app: a receiver-side tweak is applied to the captured
// buffer here, and alternative MFSK profiles go through the codec's own experiment hook
// (mf.custom, header id 15), exactly as tools/explore.ts does.
//
//   node bench/ablations.ts [--n 200] [--seed 1] [--workers 4] [--only a,b]
//
// Writes bench/results/ablations-<codecHash>.json. Every arm reuses the main sweep's messages
// and channel seeds, so arms are paired comparisons on identical sound.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulate, FS, type Condition } from './channel/index.ts';
import { Rng, seedOf } from './lib/dsp.ts';
import { SWEEPS, SCENARIOS } from './sweeps.ts';
import { loadCodec, messageFor, runTrial, type Codec } from './trial.ts';
import { wilson } from './lib/stats.ts';

const BENCH = dirname(fileURLToPath(import.meta.url));
const REPO = join(BENCH, '..');

/** Receiver variants (what is done to the capture before decodeWindow). */
type Rx = 'app' | 'pad';
/** Codec variants: the app's profile, or a custom MFSK profile through the experiment hook. */
interface Arm { rx: Rx; profile: null | Record<string, number> }

interface Job { arm: string; armDef: Arm; group: string; key: string; source: { kind: 'sweep'; id: string; value: number } | { kind: 'scenario'; id: string; drop: string[] }; i: number }

const PAD_S = 0.5;

/** Alternative profiles on the same symbol grid (the header grid is shared, so N/G/bin0 stay). */
const PROFILES: Record<string, Record<string, number>> = {
  robusto: {}, // the app's text profile through the experiment path (control: must match 'app')
  'hops-7': { H: 7 }, // one more hop set: echoes of the last 6 symbols miss the compared bins
  'parity-64': { parity: 64 }, // a third more Reed-Solomon parity
  'slow-8bit': { ng: 4, H: 7 }, // 8 bit/symbol, 7 hop sets
};

const LEAVE_OUT = ['babbleDb', 'rt60', 'distanceM', 'micHiHz', 'speakerDb', 'clipDb', 'ppm', 'dropoutsPerS'];

function plan(only: string[] | null): Job[] {
  const jobs: Job[] = [];
  const want = (g: string) => !only || only.includes(g);
  const n = N;
  // 1. late start: the app's receiver vs the same capture with 0.5 s of silence in front
  if (want('pad')) {
    const late = SWEEPS.find((s) => s.id === 'late')!;
    for (const rx of ['app', 'pad'] as Rx[])
      for (const v of late.values) for (let i = 0; i < n; i++) jobs.push({ arm: rx, armDef: { rx, profile: null }, group: 'pad', key: String(v), source: { kind: 'sweep', id: 'late', value: v }, i });
  }
  // 2. leave-one-out on the scenarios: which ingredient costs the most
  if (want('loo')) {
    for (const sc of ['worst', 'cafe', 'quiet'])
      for (const drop of [[], ...LEAVE_OUT.map((k) => [k])]) {
        const has = SCENARIOS.find((s) => s.id === sc)!.cond(new Rng(1));
        if (drop.length && (has as Record<string, unknown>)[drop[0]!] === undefined) continue;
        for (let i = 0; i < n; i++) jobs.push({ arm: 'app', armDef: { rx: 'app', profile: null }, group: `loo-${sc}`, key: drop.length ? `no-${drop[0]}` : 'all', source: { kind: 'scenario', id: sc, drop }, i });
      }
  }
  // 3. profile variants on reverb, band-limited microphone and the scenarios
  if (want('profiles')) {
    for (const [name, over] of Object.entries(PROFILES)) {
      const armDef: Arm = { rx: 'app', profile: over };
      for (const [id, values] of [['reverb', [1.5, 2, 2.5, 3]], ['mic', [2000, 1750, 1500]], ['dropouts', [6, 10]]] as [string, number[]][])
        for (const v of values) for (let i = 0; i < n; i++) jobs.push({ arm: name, armDef, group: 'profiles', key: `${id}-${v}`, source: { kind: 'sweep', id, value: v }, i });
      for (const sc of ['quiet', 'cafe', 'worst']) for (let i = 0; i < n; i++) jobs.push({ arm: name, armDef, group: 'profiles', key: sc, source: { kind: 'scenario', id: sc, drop: [] }, i });
    }
  }
  return jobs;
}

function condFor(j: Job): { cond: Condition; seed: number } {
  if (j.source.kind === 'sweep') {
    const sw = SWEEPS.find((s) => s.id === (j.source as { id: string }).id)!;
    const seed = seedOf(SEED, 'sweep', sw.id, j.source.value, j.i);
    return { cond: sw.cond(j.source.value, new Rng(seedOf(seed, 'cond'))), seed };
  }
  const sc = SCENARIOS.find((s) => s.id === (j.source as { id: string }).id)!;
  const seed = seedOf(SEED, 'scenario', sc.id, j.i);
  const cond = { ...sc.cond(new Rng(seedOf(seed, 'cond'))) } as Record<string, unknown>;
  for (const k of j.source.drop) delete cond[k];
  return { cond: cond as Condition, seed };
}

function runJob(codec: Codec, j: Job): { ok: boolean; rawBer: number | null; airtime: number } {
  const { cond, seed } = condFor(j);
  const text = messageFor(SEED, j.i);
  if (j.armDef.rx === 'app' && !j.armDef.profile) {
    const r = runTrial(codec, cond, seed, j.i, text);
    return { ok: r.ok, rawBer: r.rawBer, airtime: r.airtime };
  }
  const { core, mf } = codec;
  const gap = Math.round(core.FRAME_GAP_S * FS);
  let audio: Float32Array;
  let prof: unknown = null;
  if (j.armDef.profile) {
    prof = mf.custom({ ...mf.PROFILES[core.TEXT_PROFILE], ...j.armDef.profile });
    const f = mf.encode(new TextEncoder().encode(text), prof as never);
    audio = new Float32Array(f.length + 2 * gap);
    audio.set(f, gap);
  } else audio = core.planText(text).audio;
  const sim = simulate(audio, cond, seed, gap);
  let rx = sim.rx;
  if (j.armDef.rx === 'pad') {
    rx = new Float32Array(sim.rx.length + Math.round(PAD_S * FS));
    rx.set(sim.rx, Math.round(PAD_S * FS));
  }
  const dec = new TextDecoder();
  const got = prof ? mf.decodeAll(rx, prof as never).map((d: { data: Uint8Array }) => d.data) : core.decodeWindow(rx).payloads;
  return { ok: got.some((p: Uint8Array) => dec.decode(p) === text), rawBer: null, airtime: audio.length / FS };
}

const args = isMainThread ? process.argv.slice(2) : (workerData.args as string[]);
const opt = (name: string, d: string) => (args.includes(name) ? args[args.indexOf(name) + 1]! : d);
const N = Number(opt('--n', '200'));
const SEED = Number(opt('--seed', '1'));

if (!isMainThread) {
  const codec = await loadCodec(new URL('../', import.meta.url).href);
  parentPort!.on('message', (m: { tid: number; jobs: Job[] }) => {
    try {
      parentPort!.postMessage({ tid: m.tid, out: m.jobs.map((j) => ({ ...runJob(codec, j), arm: j.arm, group: j.group, key: j.key })) });
    } catch (e) {
      parentPort!.postMessage({ tid: m.tid, error: String((e as Error)?.stack ?? e) });
    }
  });
} else {
  const { hashFiles, CODEC_PATHS } = await import('./run.ts');
  const only = args.includes('--only') ? opt('--only', '').split(',') : null;
  const jobs = plan(only);
  const workers = Number(opt('--workers', String(availableParallelism())));
  const chunks: Job[][] = [];
  for (let k = 0; k < jobs.length; k += 25) chunks.push(jobs.slice(k, k + 25));
  const results: { ok: boolean; rawBer: number | null; airtime: number; arm: string; group: string; key: string }[] = [];
  const t0 = Date.now();
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(workers, chunks.length) }, () => new Promise<void>((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { args } });
    const feed = () => {
      if (next >= chunks.length) { w.terminate(); res(); return; }
      const tid = next++;
      w.postMessage({ tid, jobs: chunks[tid] });
    };
    w.on('message', (m: { tid: number; out?: typeof results; error?: string }) => {
      if (m.error) { rej(new Error(m.error)); return; }
      results.push(...m.out!);
      if (++done % 20 === 0) process.stderr.write(`  ${done}/${chunks.length} chunks, ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
      feed();
    });
    w.on('error', rej);
    feed();
  })));
  // aggregate: out[group][key][arm] = { n, ok, rate, ci95 }
  const out: Record<string, unknown> = {};
  for (const r of results) {
    const g = ((out[r.group] ??= {}) as Record<string, Record<string, { n: number; ok: number; rate?: number; ci95?: [number, number]; airtimeS?: number }>>);
    const cell = ((g[r.key] ??= {})[r.arm] ??= { n: 0, ok: 0, airtimeS: 0 });
    cell.n++;
    if (r.ok) cell.ok++;
    cell.airtimeS! += r.airtime;
  }
  for (const g of Object.values(out) as Record<string, Record<string, { n: number; ok: number; rate?: number; ci95?: [number, number]; airtimeS?: number }>>[])
    for (const k of Object.values(g)) for (const c of Object.values(k)) {
      c.rate = c.ok / c.n;
      c.ci95 = wilson(c.ok, c.n) as [number, number];
      c.airtimeS = Math.round((c.airtimeS! / c.n) * 1000) / 1000;
    }
  const codecHash = hashFiles(REPO, CODEC_PATHS);
  const meta = { codecHash, n: N, seed: SEED, padS: PAD_S, profiles: PROFILES, date: new Date().toISOString(), durationS: Math.round((Date.now() - t0) / 1000) };
  mkdirSync(join(BENCH, 'results'), { recursive: true });
  const file = join(BENCH, 'results', `ablations-${codecHash}.json`);
  let prev: Record<string, unknown> = {};
  try { prev = JSON.parse((await import('node:fs')).readFileSync(file, 'utf8')); } catch {}
  writeFileSync(file, JSON.stringify({ ...prev, ...out, meta }, null, 1) + '\n');
  console.log(`ablations: ${results.length} trials in ${meta.durationS} s -> ${file}`);
}
