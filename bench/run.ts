// Bench runner: sweeps every impairment, runs the composite scenarios and the false-detection
// tests, and writes bench/results/<git-short-sha>.json.
//
//   node bench/run.ts               full run (N=200 messages per step)
//   node bench/run.ts --quick       CI run (N=20)
//   options: --n N  --seed S  --only awgn,reverb  --workers W  --codec <repo dir>  --out <file>
//            --resume  --no-false  --no-scenarios  --sha <name>
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SWEEPS, SCENARIOS, FALSE_TESTS, LENGTHS } from './sweeps.ts';
import { BASELINE_SNR_DB, SNR_BAND, ROOM_VOLUME_M3 } from './channel/index.ts';
import type { Task, TrialRecord, FalseRecord } from './trial.ts';
import { wilson, quantile, mean, crossing } from './lib/stats.ts';

export const SCHEMA = 1;
const BENCH = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(BENCH, '..');
/** Codec files (CI trigger paths, CODEC.md). */
export const CODEC_PATHS = ['src/modem', 'src/fec', 'src/dsp', 'src/file', 'app/core.ts'];
/** Bench files that change the measurements (not the page, docs or this runner's bookkeeping). */
export const MEASURE_PATHS = ['bench/channel', 'bench/lib', 'bench/sweeps.ts', 'bench/trial.ts'];

function listFiles(root: string, paths: string[]): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    if (!existsSync(p)) return;
    if (statSync(p).isDirectory()) for (const f of readdirSync(p).sort()) walk(join(p, f));
    else out.push(p);
  };
  for (const p of paths) walk(join(root, p));
  return out;
}
export function hashFiles(root: string, paths: string[]): string {
  const h = createHash('sha256');
  for (const f of listFiles(root, paths)) h.update(relative(root, f)).update('\0').update(readFileSync(f)).update('\0');
  return h.digest('hex').slice(0, 16);
}
function git(root: string, ...args: string[]): string {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export interface Options {
  quick: boolean;
  n: number;
  seed: number;
  only: string[] | null;
  workers: number;
  codecRoot: string;
  out: string | null;
  resume: boolean;
  falseTests: boolean;
  scenarios: boolean;
  sha: string | null;
  quiet: boolean;
}

export function parseArgs(argv: string[]): Options {
  const o: Options = { quick: false, n: 0, seed: 1, only: null, workers: availableParallelism(), codecRoot: REPO, out: null, resume: false, falseTests: true, scenarios: true, sha: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const v = () => argv[++i]!;
    if (a === '--quick') o.quick = true;
    else if (a === '--n') o.n = Number(v());
    else if (a === '--seed') o.seed = Number(v());
    else if (a === '--only') o.only = v().split(',');
    else if (a === '--workers') o.workers = Number(v());
    else if (a === '--codec') o.codecRoot = resolve(v());
    else if (a === '--out') o.out = resolve(v());
    else if (a === '--resume') o.resume = true;
    else if (a === '--no-false') o.falseTests = false;
    else if (a === '--no-scenarios') o.scenarios = false;
    else if (a === '--sha') o.sha = v();
    else if (a === '--quiet') o.quiet = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (!o.n) o.n = o.quick ? 20 : 200;
  return o;
}

// ---------------------------------------------------------------- aggregation
export function aggregate(recs: TrialRecord[]) {
  const n = recs.length;
  const ok = recs.filter((r) => r.ok).length;
  const [lo, hi] = wilson(ok, n);
  const byLength: Record<string, { n: number; ok: number }> = {};
  for (const L of LENGTHS) {
    const rs = recs.filter((r) => r.len === L);
    byLength[L] = { n: rs.length, ok: rs.filter((r) => r.ok).length };
  }
  const raw = recs.map((r) => r.rawBer).filter((x): x is number => x !== null);
  const sync = recs.map((r) => r.sync).filter((x): x is boolean => x !== null);
  const ms = recs.map((r) => r.ms);
  const r4 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);
  return {
    n,
    ok,
    rate: r4(ok / n),
    ci95: [r4(lo), r4(hi)],
    byLength,
    cer: r4(mean(recs.map((r) => r.cer))),
    rawBer: raw.length ? r4(mean(raw)) : null,
    rawBerP90: raw.length ? r4(quantile(raw, 0.9)) : null,
    syncRate: sync.length ? r4(sync.filter(Boolean).length / sync.length) : null,
    wrong: recs.reduce((a, r) => a + r.wrong, 0),
    decodeMs: { median: Math.round(quantile(ms, 0.5)), p95: Math.round(quantile(ms, 0.95)) },
    airtimeS: r4(mean(recs.map((r) => r.airtime))),
  };
}

// ---------------------------------------------------------------- pool
async function pool(tasks: (Task & { key: string })[], o: Options, onDone: (key: string, recs: unknown[]) => void): Promise<void> {
  const W = Math.max(1, Math.min(o.workers, tasks.length));
  let next = 0;
  let failed: Error | null = null;
  await Promise.all(
    Array.from({ length: W }, () =>
      new Promise<void>((res, rej) => {
        const w = new Worker(new URL('./worker.ts', import.meta.url), { workerData: { codecRoot: pathToFileURL(o.codecRoot + '/').href } });
        const give = () => {
          if (failed || next >= tasks.length) {
            void w.terminate().then(() => (failed ? rej(failed) : res()));
            return;
          }
          const t = tasks[next++]!;
          w.postMessage({ ...t, tid: next - 1 });
        };
        w.on('message', (m: { ready?: boolean; tid?: number; records?: unknown[]; error?: string }) => {
          if (m.ready) return give();
          if (m.error) {
            failed = new Error(m.error);
            return give();
          }
          onDone(tasks[m.tid!]!.key, m.records!);
          give();
        });
        w.on('error', (e) => {
          failed = e;
          rej(e);
        });
      }),
    ),
  );
}

// ---------------------------------------------------------------- main
export async function runBench(o: Options) {
  const t0 = Date.now();
  const sha = o.sha ?? (git(o.codecRoot, 'rev-parse', '--short=7', 'HEAD') || 'nogit');
  const dirty = !!git(REPO, 'status', '--porcelain', '--', ...CODEC_PATHS, ...MEASURE_PATHS) || (o.codecRoot !== REPO && !!git(o.codecRoot, 'status', '--porcelain', '--', ...CODEC_PATHS));
  const mode = o.quick ? 'quick' : o.n === 200 ? 'full' : `n${o.n}`;
  const codecHash = hashFiles(o.codecRoot, CODEC_PATHS);
  const benchHash = hashFiles(REPO, MEASURE_PATHS);
  const configKey = JSON.stringify({ sha, mode, n: o.n, seed: o.seed, codecHash, benchHash, only: o.only });
  const resDir = join(BENCH, 'results');
  mkdirSync(resDir, { recursive: true });
  const partialPath = join(resDir, `.partial-${sha}-${mode}.json`);

  const sweeps = SWEEPS.filter((s) => !o.only || o.only.includes(s.id));
  const scenarios = o.scenarios ? SCENARIOS.filter((s) => !o.only || o.only.includes(s.id) || o.only.includes('scenarios')) : [];
  const falseTests = o.falseTests && !o.only ? FALSE_TESTS : [];
  const windowS = 14; // the app's receive window
  const falseWindows = o.quick ? 4 : 43; // ~1 min / ~10 min of noise per test

  // checkpoint: completed units -> records
  let done: Record<string, unknown[]> = {};
  if (o.resume && existsSync(partialPath)) {
    const p = JSON.parse(readFileSync(partialPath, 'utf8'));
    if (p.configKey === configKey) done = p.done;
  }
  const chunk = o.quick ? 10 : 25;
  const tasks: (Task & { key: string })[] = [];
  const unitSize: Record<string, number> = {};
  for (const s of sweeps)
    s.values.forEach((_, step) => {
      const unit = `sweep:${s.id}:${step}`;
      unitSize[unit] = o.n;
      if (done[unit]) return;
      for (let i0 = 0; i0 < o.n; i0 += chunk) tasks.push({ kind: 'sweep', id: s.id, step, i0, i1: Math.min(o.n, i0 + chunk), seed: o.seed, key: unit });
    });
  for (const s of scenarios) {
    const unit = `scenario:${s.id}`;
    unitSize[unit] = o.n;
    if (done[unit]) continue;
    for (let i0 = 0; i0 < o.n; i0 += chunk) tasks.push({ kind: 'scenario', id: s.id, i0, i1: Math.min(o.n, i0 + chunk), seed: o.seed, key: unit });
  }
  for (const f of falseTests) {
    const unit = `false:${f.id}`;
    unitSize[unit] = falseWindows;
    if (done[unit]) continue;
    for (let w0 = 0; w0 < falseWindows; w0 += 2) tasks.push({ kind: 'false', id: f.id, w0, w1: Math.min(falseWindows, w0 + 2), seed: o.seed, windowS, key: unit });
  }
  // biggest units first would balance better, but keeping sweep order makes checkpoints useful
  const pending: Record<string, unknown[]> = {};
  let lastSave = Date.now();
  const save = () => writeFileSync(partialPath, JSON.stringify({ configKey, done }));
  const log = (s: string) => o.quiet || process.stderr.write(s + '\n');
  log(`bench ${mode}: sha ${sha}${dirty ? ' (dirty)' : ''}, N=${o.n}, seed ${o.seed}, ${tasks.length} tasks on ${Math.min(o.workers, tasks.length)} workers`);
  await pool(tasks, o, (key, recs) => {
    (pending[key] ??= []).push(...recs);
    if (pending[key]!.length >= unitSize[key]!) {
      done[key] = pending[key]!.sort((a, b) => ((a as TrialRecord).i ?? (a as FalseRecord).window) - ((b as TrialRecord).i ?? (b as FalseRecord).window));
      delete pending[key];
      if (key.startsWith('sweep:') || key.startsWith('scenario:')) {
        const a = aggregate(done[key] as TrialRecord[]);
        log(`  ${key.padEnd(22)} ${a.ok}/${a.n}  rawBER ${a.rawBer ?? '-'}  ${a.decodeMs.median} ms`);
      } else log(`  ${key}`);
      if (Date.now() - lastSave > 5000) {
        save();
        lastSave = Date.now();
      }
    }
  });
  save();

  const result = {
    schema: SCHEMA,
    sha,
    dirty,
    date: new Date().toISOString(),
    mode,
    n: o.n,
    seed: o.seed,
    lengths: LENGTHS,
    codecHash,
    benchHash,
    codecRoot: o.codecRoot === REPO ? '.' : o.codecRoot,
    path: 'app/core.ts planText() → bench channel → decodeWindow() (profile 1 «robusto», one MFSK frame)',
    baseline: { awgnDb: BASELINE_SNR_DB, snrBandHz: SNR_BAND, leadS: [0.2, 1.0], roomVolumeM3: ROOM_VOLUME_M3, reverbDistanceM: 0.5, quantisationBits: 16 },
    env: { node: process.version, cpus: availableParallelism(), platform: process.platform, workers: o.workers },
    durationS: 0,
    sweeps: sweeps.map((s) => {
      const steps = s.values.map((v, step) => ({ value: v, ...aggregate(done[`sweep:${s.id}:${step}`] as TrialRecord[]) }));
      const rates = steps.map((x) => x.rate ?? 0);
      return { id: s.id, label: s.label, param: s.param, unit: s.unit, worse: s.worse, note: s.note, steps, limit90: crossing(s.values, rates, 0.9), limit50: crossing(s.values, rates, 0.5) };
    }),
    scenarios: scenarios.map((s) => ({ id: s.id, label: s.label, note: s.note, cond: s.cond({ next: () => 0.9 } as never), ...aggregate(done[`scenario:${s.id}`] as TrialRecord[]) })),
    falseDetections: falseTests.map((f) => {
      const rs = done[`false:${f.id}`] as FalseRecord[];
      const seconds = rs.reduce((a, r) => a + r.seconds, 0);
      const alarms = rs.reduce((a, r) => a + r.alarms, 0);
      return {
        id: f.id,
        label: f.label,
        cond: f.cond,
        seconds,
        frames: rs.reduce((a, r) => a + r.frames, 0),
        alarms,
        alarmsPerMin: Math.round((alarms / seconds) * 60 * 100) / 100,
        decodeMsPerWindow: Math.round(quantile(rs.map((r) => r.ms), 0.5)),
      };
    }),
  };
  result.durationS = Math.round((Date.now() - t0) / 100) / 10;
  let out = o.out;
  if (!out) {
    const name = dirty ? `${sha}-dirty` : sha;
    out = join(resDir, `${name}.json`);
    // a quick run never overwrites a full run of the same commit
    if (mode !== 'full' && existsSync(out) && JSON.parse(readFileSync(out, 'utf8')).mode === 'full') out = join(resDir, `${name}.${mode}.json`);
  }
  const tmp = out + '.tmp';
  writeFileSync(tmp, JSON.stringify(result, null, 1) + '\n');
  renameSync(tmp, out);
  if (!o.only) rmSync(partialPath, { force: true });
  log(`wrote ${relative(process.cwd(), out)} in ${result.durationS} s`);
  return { out, result };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runBench(parseArgs(process.argv.slice(2)));
}
