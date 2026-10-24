// Verifies each rung of the bench ladder and writes bench/SCORE.txt.
// Rule: never edit a check to make a failing rung pass; only add checks.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SWEEPS, SCENARIOS, FALSE_TESTS, LENGTHS } from './sweeps.ts';
import { CODEC_PATHS, MEASURE_PATHS, hashFiles, SCHEMA } from './run.ts';
import { loadCodec, messageFor } from './trial.ts';

const BENCH = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(BENCH, '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1]! : null;
const lines: string[] = [];
const say = (s: string) => {
  lines.push(s);
  console.log(s);
};
type Check = [boolean, string];
const rungs: { id: string; title: string; run: () => Promise<Check[]> | Check[] }[] = [];
const rung = (id: string, title: string, run: () => Promise<Check[]> | Check[]) => rungs.push({ id, title, run });
const read = (p: string) => (existsSync(join(BENCH, p)) ? readFileSync(join(BENCH, p), 'utf8') : '');

// ---------------------------------------------------------------- results helpers
interface Results {
  schema: number;
  sha: string;
  mode: string;
  n: number;
  seed: number;
  codecHash: string;
  benchHash: string;
  dirty: boolean;
  sweeps: { id: string; steps: { value: number; n: number; ok: number; rate: number }[]; limit50: number | null; limit90: number | null }[];
  scenarios: { id: string; n: number; ok: number; rate: number }[];
  falseDetections: { id: string; seconds: number; frames: number; alarms: number }[];
  [k: string]: unknown;
}
function allResults(): { file: string; r: Results }[] {
  const dir = join(BENCH, 'results');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('.') && !f.startsWith('ablation'))
    .map((f) => ({ file: f, r: JSON.parse(readFileSync(join(dir, f), 'utf8')) as Results }));
}
function validResults(r: Results, n: number): string[] {
  const errs: string[] = [];
  if (r.schema !== SCHEMA) errs.push(`schema ${r.schema}`);
  if (!(r.n >= n)) errs.push(`n ${r.n} < ${n}`);
  for (const s of SWEEPS) {
    const got = r.sweeps?.find((x) => x.id === s.id);
    if (!got) {
      errs.push(`sweep ${s.id} missing`);
      continue;
    }
    if (JSON.stringify(got.steps.map((x) => x.value)) !== JSON.stringify(s.values)) errs.push(`sweep ${s.id}: values differ from sweeps.ts`);
    for (const st of got.steps) if (st.n !== r.n || !(st.rate >= 0 && st.rate <= 1) || st.ok !== Math.round(st.rate * st.n)) errs.push(`sweep ${s.id}@${st.value}: bad counts`);
  }
  for (const s of SCENARIOS) if (!r.scenarios?.find((x) => x.id === s.id && x.n === r.n)) errs.push(`scenario ${s.id} missing`);
  if (!r.scenarios?.find((x) => x.id === 'worst')) errs.push('worst-case scenario missing');
  for (const f of FALSE_TESTS) if (!r.falseDetections?.find((x) => x.id === f.id && x.seconds > 0)) errs.push(`false-detection test ${f.id} missing`);
  return errs;
}
const codecHash = () => hashFiles(REPO, CODEC_PATHS);
const benchHash = () => hashFiles(REPO, MEASURE_PATHS);
function currentFull(): { file: string; r: Results } | undefined {
  return allResults().find(({ r }) => r.mode === 'full' && r.codecHash === codecHash() && r.benchHash === benchHash() && !r.dirty);
}

// ---------------------------------------------------------------- R0
rung('R0', 'score runs; CODEC.md; clean round trip 100/100', async () => {
  const codec = read('CODEC.md');
  const sections = ['modulation', 'frequenc', 'symbol', 'frame', 'error', 'entry point', 'headless'];
  const missing = sections.filter((s) => !codec.toLowerCase().includes(s));
  const c = await loadCodec(pathToFileURL(REPO + '/').href);
  let ok = 0;
  for (let i = 0; i < 100; i++) {
    const text = messageFor(12345, i);
    const plan = c.core.planText(text);
    const got = c.core.decodeWindow(plan.audio).payloads.map((p: Uint8Array) => new TextDecoder().decode(p));
    if (got.length === 1 && got[0] === text) ok++;
  }
  return [
    [true, 'bench/score runs'],
    [codec.length > 2000 && missing.length === 0, `CODEC.md covers modulation, frequencies, symbol rate, framing, error correction, entry points, headless${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}`],
    [ok === 100, `clean encode→decode round trip through the app path (planText → decodeWindow), lengths ${LENGTHS.join('/')} chars: ${ok}/100`],
  ];
});

// ---------------------------------------------------------------- R1
rung('R1', '≥6 impairments, each with a passing unit test', () => {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...readdirSync(join(BENCH, 'test')).filter((f) => f.endsWith('.test.ts')).map((f) => join(BENCH, 'test', f))], { encoding: 'utf8' });
  const passed = [...r.stdout.matchAll(/^ok \d+ - (.*)$/gm)].map((m) => m[1]!);
  const failed = [...r.stdout.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]!);
  const checks: Check[] = [[SWEEPS.length >= 6, `${SWEEPS.length} impairments swept: ${SWEEPS.map((s) => s.id).join(', ')}`]];
  for (const s of SWEEPS) {
    const t = passed.filter((n) => n.startsWith(s.id + ':'));
    checks.push([t.length > 0 && !failed.some((n) => n.startsWith(s.id + ':')), `${s.id}: ${t.length ? t.join('; ') : 'no passing test'}`]);
  }
  checks.push([failed.length === 0 && r.status === 0, `unit tests: ${passed.length} pass, ${failed.length} fail`]);
  return checks;
});

// ---------------------------------------------------------------- R2
function stripTiming(r: Record<string, unknown>): unknown {
  return JSON.parse(JSON.stringify(r, (k, v) => (['decodeMs', 'decodeMsPerWindow', 'date', 'durationS', 'env', 'dirty'].includes(k) ? undefined : v)));
}
rung('R2', 'full sweep JSON valid for the current codec; reproducible with the same seed', () => {
  const full = currentFull();
  const checks: Check[] = [];
  checks.push([!!full, full ? `full results ${full.file} (N=${full.r.n}, codec ${full.r.codecHash}, bench ${full.r.benchHash})` : `no clean full results for codec ${codecHash()} / bench ${benchHash()} (run: node bench/run.ts)`]);
  if (full) {
    const errs = validResults(full.r, 200);
    checks.push([errs.length === 0, `schema and contents valid${errs.length ? ': ' + errs.slice(0, 5).join('; ') : ''}`]);
  }
  const tmp = mkdtempSync(join(tmpdir(), 'bench-repro-'));
  const run = (out: string, seed: number) => execFileSync(process.execPath, [join(BENCH, 'run.ts'), '--n', '6', '--only', 'reverb,dropouts,drift', '--no-false', '--seed', String(seed), '--sha', 'repro', '--out', out, '--quiet'], { stdio: 'inherit' });
  run(join(tmp, 'a.json'), 7);
  run(join(tmp, 'b.json'), 7);
  run(join(tmp, 'c.json'), 8);
  const [a, b, c] = ['a', 'b', 'c'].map((x) => JSON.stringify(stripTiming(JSON.parse(readFileSync(join(tmp, x + '.json'), 'utf8')))));
  checks.push([a === b, 'same seed twice (reverb, drift, dropouts sweeps + scenarios, N=6): identical results apart from timings']);
  checks.push([a !== c, 'a different seed gives different raw results (the seed is really used)']);
  return checks;
});

// ---------------------------------------------------------------- R3
rung('R3', 'results page builds with charts and the previous-commit comparison', async () => {
  const checks: Check[] = [];
  const b = spawnSync(process.execPath, [join(BENCH, 'site', 'build.ts')], { encoding: 'utf8' });
  checks.push([b.status === 0, `site build: ${b.status === 0 ? 'ok' : b.stderr.slice(-300)}`]);
  const html = existsSync(join(BENCH, 'site', 'out', 'index.html')) ? readFileSync(join(BENCH, 'site', 'out', 'index.html'), 'utf8') : '';
  const charts = (html.match(/<svg[^>]*data-chart="sweep"/g) ?? []).length;
  checks.push([charts >= SWEEPS.length, `${charts} success-rate charts (one per impairment: ${SWEEPS.length})`]);
  checks.push([/id="compare"/.test(html) && /data-prev-sha="[0-9a-f]{7}/.test(html), `comparison with the previous commit's results${(html.match(/data-prev-sha="([^"]+)"/) ?? [])[1] ? ' (' + html.match(/data-prev-sha="([^"]+)"/)![1] + ')' : ''}`]);
  checks.push([/id="summary"/.test(html) && /<table/.test(html), 'summary table']);
  checks.push([['id="method"', 'id="findings"', 'id="limitations"'].every((s) => html.includes(s)), 'write-up sections: method, findings, limitations']);
  checks.push([/prefers-color-scheme:\s*dark/.test(html) && /name="viewport"/.test(html), 'dark mode and viewport meta']);
  // phone width and dark mode, in a real browser when one is available
  const exe = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
  let browser: unknown = null;
  try {
    const { chromium } = await import('playwright-core');
    const b2 = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
    browser = b2;
    for (const scheme of ['light', 'dark'] as const) {
      const p = await b2.newPage({ viewport: { width: 360, height: 740 }, colorScheme: scheme });
      await p.goto(pathToFileURL(join(BENCH, 'site', 'out', 'index.html')).href);
      const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, bg: getComputedStyle(document.body).backgroundColor }));
      checks.push([m.sw <= 360, `${scheme} mode at 360 px: page width ${m.sw} px (no horizontal scroll), background ${m.bg}`]);
      await p.close();
    }
    await b2.close();
  } catch (e) {
    checks.push([false, `browser check failed: ${String(e).slice(0, 200)}`]);
  }
  void browser;
  return checks;
});

// ---------------------------------------------------------------- R4
rung('R4', 'CI workflow valid; --quick under 5 min', () => {
  const checks: Check[] = [];
  const wf = join(REPO, '.github', 'workflows', 'bench.yml');
  if (!existsSync(wf)) return [[false, '.github/workflows/bench.yml missing']];
  const py = spawnSync('python3', ['-c', 'import sys, yaml, json; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', wf], { encoding: 'utf8' });
  if (py.status !== 0) return [[false, `bench.yml is not valid YAML: ${py.stderr.slice(-200)}`]];
  const y = JSON.parse(py.stdout);
  const on = y.on ?? y.true; // YAML 1.1 reads a bare `on` as true
  const text = readFileSync(wf, 'utf8');
  const paths = (on?.push?.paths ?? []) as string[];
  const prPaths = (on?.pull_request?.paths ?? []) as string[];
  const covers = (ps: string[]) => CODEC_PATHS.every((c) => ps.some((p) => p === c || p === c + '/**'));
  checks.push([!!on?.push && covers(paths), `push trigger on the codec paths (${CODEC_PATHS.join(', ')})`]);
  checks.push([!!on?.pull_request && covers(prPaths), 'pull_request trigger on the codec paths']);
  checks.push(['workflow_dispatch' in (on ?? {}), 'workflow_dispatch']);
  checks.push([/bench\/run\.ts --quick/.test(text), 'runs bench/run.ts --quick']);
  checks.push([/upload-artifact/.test(text), 'uploads the results as a workflow artifact']);
  checks.push([/git (-c [^ ]+ )*commit/.test(text) && /github\.event_name != 'pull_request'/.test(text), 'commits the results JSON, but not on pull requests']);
  checks.push([/deploy-pages/.test(text) && /site\/build\.ts/.test(text), 'rebuilds the page and deploys it to GitHub Pages']);
  const posts = /(github-script|gh (pr|issue) comment|create-or-update-comment|pull-requests:\s*write|issues:\s*write)/.test(text);
  checks.push([!posts, 'posts nothing externally on PRs (no comment actions, no PR/issue write permission)']);
  const pages = readFileSync(join(REPO, '.github', 'workflows', 'pages.yml'), 'utf8');
  checks.push([/site\/build\.ts/.test(pages), 'the app\'s Pages workflow also publishes /bench (so app deploys do not drop it)']);
  if (!args.includes('--skip-slow')) {
    const tmp = mkdtempSync(join(tmpdir(), 'bench-quick-'));
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [join(BENCH, 'run.ts'), '--quick', '--out', join(tmp, 'q.json'), '--quiet'], { stdio: 'inherit' });
    const s = (Date.now() - t0) / 1000;
    checks.push([r.status === 0 && s < 300, `bench/run.ts --quick: ${s.toFixed(0)} s (limit 300 s) on ${process.env.CI ? 'CI' : 'this machine'} with ${(globalThis as any).navigator?.hardwareConcurrency ?? '?'} cores`]);
    if (r.status === 0) checks.push([validResults(JSON.parse(readFileSync(join(tmp, 'q.json'), 'utf8')), 20).length === 0, 'quick results JSON is valid']);
  }
  return checks;
});

// ---------------------------------------------------------------- R5
/** Evidence references in the write-up: `key = value`, checked against the current full results. */
export function resolveEvidence(key: string, full: Results, ablations: Record<string, unknown>): number | null {
  let m = key.match(/^([a-z]+)\.(limit50|limit90)$/);
  if (m) return (full.sweeps.find((s) => s.id === m![1])?.[m[2] as 'limit50'] as number | null) ?? null;
  m = key.match(/^([a-z]+)\[(-?[\d.]+)\]\.(rate|rawBer|syncRate|cer)$/);
  if (m) {
    const st = full.sweeps.find((s) => s.id === m![1])?.steps.find((x) => x.value === Number(m![2])) as Record<string, number> | undefined;
    return st ? st[m[3]!]! : null;
  }
  // success rate for one message length: `awgn[-7].len140 = 0`, `scenario.cafe.len16 = 0.597`
  m = key.match(/^([a-z]+)\[(-?[\d.]+)\]\.len(\d+)$/) ?? key.match(/^scenario\.([a-z]+)()\.len(\d+)$/);
  if (m) {
    const row = (key.startsWith('scenario.') ? full.scenarios.find((s) => s.id === m![1]) : full.sweeps.find((s) => s.id === m![1])?.steps.find((x) => x.value === Number(m![2]))) as { byLength?: Record<string, { n: number; ok: number }> } | undefined;
    const b = row?.byLength?.[m[3]!];
    return b ? b.ok / b.n : null;
  }
  m = key.match(/^scenario\.([a-z]+)\.(rate|rawBer|syncRate|cer)$/);
  if (m) return ((full.scenarios.find((s) => s.id === m![1]) as Record<string, unknown> | undefined)?.[m[2]!] as number) ?? null;
  m = key.match(/^false\.([a-z]+)\.(frames|alarms|alarmsPerMin)$/);
  if (m) return ((full.falseDetections.find((s) => s.id === m![1]) as Record<string, unknown> | undefined)?.[m[2]!] as number) ?? null;
  m = key.match(/^ablation\.([\w-]+)\.([\w.\[\]-]+)$/);
  if (m) {
    let v: unknown = ablations[m[1]!];
    for (const part of m[2]!.split('.')) v = (v as Record<string, unknown> | undefined)?.[part];
    return typeof v === 'number' ? v : null;
  }
  return null;
}
function close(a: number, b: number): boolean {
  // the write-up rounds; accept the displayed precision
  const digits = (String(b).split('.')[1] ?? '').length;
  return Math.abs(a - b) <= 0.5 * Math.pow(10, -digits) + 1e-9 || Math.abs(a * 100 - b) <= 0.5 * Math.pow(10, -digits) + 1e-9;
}
rung('R5', 'write-up: findings ranked by impact, 3 evidence-backed suggestions', () => {
  const w = read('WRITEUP.md');
  const checks: Check[] = [];
  const full = currentFull();
  if (!w) return [[false, 'bench/WRITEUP.md missing']];
  for (const h of ['Question', 'Method', 'Findings', 'Suggestions', 'Limitations']) checks.push([new RegExp(`^## ${h}`, 'm').test(w), `section «${h}»`]);
  const sec = (h: string) => (w.split(new RegExp(`^## ${h}.*$`, 'm'))[1] ?? '').split(/^## /m)[0]!;
  const findings = sec('Findings').match(/^\d+\. .*/gm) ?? [];
  const sugg = sec('Suggestions').match(/^\d+\. .*/gm) ?? [];
  checks.push([findings.length >= 5, `${findings.length} numbered findings (ranked by impact; need ≥ 5)`]);
  checks.push([/rank/i.test(sec('Findings')), 'the findings section states how they are ranked']);
  checks.push([sugg.length === 3, `${sugg.length} numbered suggestions (need exactly 3)`]);
  let ablations: Record<string, unknown> = {};
  const abl = full ? join(BENCH, 'results', `ablations-${full.r.codecHash}.json`) : '';
  if (abl && existsSync(abl)) ablations = JSON.parse(readFileSync(abl, 'utf8'));
  const refs = [...w.matchAll(/`([\w.\[\]-]+) = (-?[\d.]+)%?`/g)];
  let bad: string[] = [];
  if (full) for (const [, k, v] of refs) {
    const got = resolveEvidence(k!, full.r, ablations);
    if (got === null || !close(got, Number(v))) bad.push(`${k} = ${v} (results: ${got})`);
  }
  checks.push([!!full && refs.length >= 10 && bad.length === 0, `${refs.length} evidence references checked against ${full?.file ?? '(no full results)'}${bad.length ? '; mismatched: ' + bad.slice(0, 4).join('; ') : ''}`]);
  const evid = (items: string[], body: string) => {
    // every item (up to the next item) must cite at least one reference
    const parts = body.split(/^\d+\. /m).slice(1);
    return parts.length === items.length && parts.every((p) => /`[\w.\[\]-]+ = -?[\d.]+%?`/.test(p));
  };
  checks.push([evid(findings, sec('Findings')), 'every finding cites evidence']);
  checks.push([evid(sugg, sec('Suggestions')), 'every suggestion cites evidence']);
  const tag = execFileSync('git', ['-C', REPO, 'diff', '--name-only', 'HEAD', '--', ...CODEC_PATHS], { encoding: 'utf8' }).trim();
  checks.push([tag === '', 'the codec is untouched on this branch (suggestions not implemented here)']);
  return checks;
});

// ---------------------------------------------------------------- R6 (optional)
rung('R6', 'OPTIONAL: best suggestion implemented on bench/improve-<name>, before/after reported', () => {
  const imp = read('IMPROVE.md');
  if (!imp) return [[false, 'bench/IMPROVE.md missing (optional rung)']];
  const branch = (imp.match(/branch `(bench\/improve-[\w-]+)`/) ?? [])[1];
  const checks: Check[] = [[!!branch, `names its branch: ${branch ?? '?'}`]];
  if (!branch) return checks;
  const have = spawnSync('git', ['-C', REPO, 'rev-parse', '--verify', '--quiet', `origin/${branch}`], { encoding: 'utf8' }).status === 0 || spawnSync('git', ['-C', REPO, 'rev-parse', '--verify', '--quiet', branch]).status === 0;
  checks.push([have, `branch ${branch} exists`]);
  const before = (imp.match(/before: `([\w.-]+\.json)`/) ?? [])[1];
  const after = (imp.match(/after: `([\w.-]+\.json)`/) ?? [])[1];
  const load = (f?: string) => (f && existsSync(join(BENCH, 'results', f)) ? (JSON.parse(readFileSync(join(BENCH, 'results', f), 'utf8')) as Results) : null);
  const b = load(before);
  const a = load(after);
  checks.push([!!b && !!a && b.mode === 'full' && a.mode === 'full' && b.codecHash !== a.codecHash && b.benchHash === a.benchHash, `before (${before}) and after (${after}) are full runs of different codecs with the same bench`]);
  return checks;
});

// ---------------------------------------------------------------- run
say(`# bench/score — ${new Date().toISOString()}`);
say(`codec ${codecHash()} · bench ${benchHash()} · git ${execFileSync('git', ['-C', REPO, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim()}`);
let top = 'none';
let broken = false;
for (const r of rungs) {
  if (only && r.id !== only) continue;
  say(`\n## ${r.id}: ${r.title}`);
  let checks: Check[];
  try {
    checks = await r.run();
  } catch (e) {
    checks = [[false, `crashed: ${String((e as Error)?.stack ?? e).slice(0, 400)}`]];
  }
  for (const [ok, msg] of checks) say(`- [${ok ? 'x' : ' '}] ${msg}`);
  const pass = checks.every(([ok]) => ok);
  say(`${r.id}: ${pass ? 'PASS' : 'FAIL'}`);
  if (pass && !broken) top = r.id;
  else if (r.id !== 'R6') broken = true;
}
if (!only) {
  say(`\nHighest rung with every lower rung passing: ${top}`);
  writeFileSync(join(BENCH, 'SCORE.txt'), lines.join('\n') + '\n');
}
