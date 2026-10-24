// Builds the results page (bench/site/out/index.html): one self-contained HTML file with inline
// SVG charts, styled with Silbo's «Tinta» tokens (app/app.css), light and dark.
//
//   node bench/site/build.ts [--out dir]
//
// "Current" is the newest results file along HEAD's first-parent history; "previous" is the
// next older commit in that history that has results (the comparison the page shows).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { twoProportionP } from '../lib/stats.ts';

const BENCH = fileURLToPath(new URL('..', import.meta.url));
const REPO = resolve(BENCH, '..');
const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? resolve(argv[argv.indexOf('--out') + 1]!) : join(BENCH, 'site', 'out');

interface Step {
  value: number;
  n: number;
  ok: number;
  rate: number;
  ci95: [number, number];
  cer: number;
  rawBer: number | null;
  syncRate: number | null;
  wrong: number;
  decodeMs: { median: number; p95: number };
  airtimeS: number;
}
interface Sweep {
  id: string;
  label: string;
  param: string;
  unit: string;
  worse: string;
  note: string;
  steps: Step[];
  limit90: number | null;
  limit50: number | null;
}
interface Results {
  sha: string;
  date: string;
  mode: string;
  n: number;
  seed: number;
  codecHash: string;
  benchHash: string;
  durationS: number;
  env: { node: string; cpus: number };
  sweeps: Sweep[];
  scenarios: (Step & { id: string; label: string; note: string })[];
  falseDetections: { id: string; label: string; seconds: number; frames: number; alarms: number; alarmsPerMin: number; decodeMsPerWindow: number }[];
  file?: string;
}

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pct = (x: number | null | undefined, d = 0) => (x === null || x === undefined ? '—' : `${(100 * x).toFixed(d)} %`);
const fmt = (x: number | null, unit = '') => (x === null ? '—' : `${Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10}${unit ? ' ' + unit : ''}`);

// ---------------------------------------------------------------- pick current / previous
function loadAll(): Results[] {
  const dir = join(BENCH, 'results');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('.') && !f.startsWith('ablation') && !f.includes('-dirty'))
    .map((f) => ({ ...(JSON.parse(readFileSync(join(dir, f), 'utf8')) as Results), file: f }));
}
function history(): string[] {
  try {
    return execFileSync('git', ['-C', REPO, 'rev-list', '--first-parent', '--abbrev-commit', '--abbrev=7', 'HEAD'], { encoding: 'utf8' }).trim().split('\n');
  } catch {
    return [];
  }
}
export function pick(all: Results[], hist: string[]): { cur: Results | null; prev: Results | null } {
  const rank = (r: Results) => (r.mode === 'full' ? 0 : 1);
  const bySha = new Map<string, Results>();
  for (const r of all) {
    const k = r.sha.slice(0, 7);
    const have = bySha.get(k);
    if (!have || rank(r) < rank(have)) bySha.set(k, r);
  }
  const inHist = hist.map((s) => bySha.get(s.slice(0, 7))).filter((r): r is Results => !!r);
  if (inHist.length) return { cur: inHist[0]!, prev: inHist[1] ?? null };
  const byDate = [...bySha.values()].sort((a, b) => b.date.localeCompare(a.date));
  return { cur: byDate[0] ?? null, prev: byDate[1] ?? null };
}

// ---------------------------------------------------------------- charts
function sweepChart(s: Sweep, prev: Sweep | undefined): string {
  const W = 340;
  const H = 210;
  const m = { l: 40, r: 12, t: 12, b: 40 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const n = s.steps.length;
  const x = (i: number) => m.l + (n === 1 ? pw / 2 : (i * pw) / (n - 1));
  const y = (v: number) => m.t + (1 - v) * ph;
  const grid = [0, 0.5, 0.9, 1]
    .map((v) => `<line class="grid${v === 0.9 ? ' grid-90' : ''}" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v * 100}</text>`)
    .join('');
  const xt = s.steps.map((st, i) => `<text class="tick" x="${x(i)}" y="${H - m.b + 16}" text-anchor="middle">${esc(st.value)}</text>`).join('');
  const band = `<path class="band" d="M${s.steps.map((st, i) => `${x(i)},${y(st.ci95[1])}`).join('L')}L${[...s.steps].reverse().map((st, j) => `${x(n - 1 - j)},${y(st.ci95[0])}`).join('L')}Z"/>`;
  const line = (steps: Step[], cls: string) => {
    const pts = steps.map((st) => ({ i: s.steps.findIndex((q) => q.value === st.value), r: st.rate })).filter((p) => p.i >= 0);
    if (!pts.length) return '';
    return `<path class="${cls}" d="M${pts.map((p) => `${x(p.i)},${y(p.r)}`).join('L')}"/>` + pts.map((p) => `<circle class="${cls}-dot" cx="${x(p.i)}" cy="${y(p.r)}" r="4"/>`).join('');
  };
  const data = s.steps.map((st) => {
    const p = prev?.steps.find((q) => q.value === st.value);
    return { v: st.value, r: st.rate, lo: st.ci95[0], hi: st.ci95[1], ok: st.ok, n: st.n, ber: st.rawBer, pr: p ? p.rate : null };
  });
  return `<figure class="chart" id="chart-${esc(s.id)}">
<figcaption><span class="chart-title">${esc(s.label)}</span><span class="chart-sub">success rate (%) vs ${esc(s.param)} (${esc(s.unit)}) · worse →</span></figcaption>
<svg data-chart="sweep" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.label)}: message success rate against ${esc(s.param)}" data-points='${esc(JSON.stringify(data))}' data-unit="${esc(s.unit)}">
${grid}${xt}<text class="axis" x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle">${esc(s.param)} (${esc(s.unit)})</text>
${band}${prev ? line(prev.steps, 'prev') : ''}${line(s.steps, 'cur')}
<line class="xhair" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" visibility="hidden"/>
<rect class="hit" x="${m.l - 10}" y="${m.t}" width="${pw + 20}" height="${ph}" fill="transparent"/>
</svg>
<p class="note">${esc(s.note)}</p>
</figure>`;
}

// ---------------------------------------------------------------- markdown (WRITEUP.md)
function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}
function markdown(md: string): string {
  const out: string[] = [];
  let list: 'ol' | 'ul' | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of md.split('\n')) {
    const l = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^(#{2,3}) (.*)$/))) {
      flush();
      close();
      const id = m[2]!.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
      out.push(`<h${m[1]!.length} id="${id}">${inline(m[2]!)}</h${m[1]!.length}>`);
    } else if ((m = l.match(/^(\d+)\. (.*)$/)) || (m = l.match(/^([-*]) (.*)$/))) {
      flush();
      const kind = /\d/.test(m[1]!) ? 'ol' : 'ul';
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline(m[2]!)}</li>`);
    } else if (/^\s+\S/.test(l) && list) {
      out[out.length - 1] = out[out.length - 1]!.replace(/<\/li>$/, ' ' + inline(l.trim()) + '</li>');
    } else if (!l.trim()) {
      flush();
      close();
    } else if (!l.startsWith('# ')) {
      close();
      para.push(l);
    }
  }
  flush();
  close();
  return out.join('\n');
}

// ---------------------------------------------------------------- page
function build(): string {
  const { cur, prev } = pick(loadAll(), history());
  if (!cur) throw new Error('no results in bench/results/: run node bench/run.ts --quick first');
  const writeup = existsSync(join(BENCH, 'WRITEUP.md')) ? readFileSync(join(BENCH, 'WRITEUP.md'), 'utf8') : '## Method\n\nSee bench/DECISIONS.md.\n\n## Findings\n\n(not written yet)\n\n## Limitations\n\n(not written yet)\n';
  const pSweep = (id: string) => prev?.sweeps.find((s) => s.id === id);
  const worst = cur.scenarios.find((s) => s.id === 'worst');
  const falseFrames = cur.falseDetections.reduce((a, f) => a + f.frames, 0);
  const falseMin = cur.falseDetections.reduce((a, f) => a + f.seconds, 0) / 60;
  const totalMsgs = cur.sweeps.reduce((a, s) => a + s.steps.reduce((b, st) => b + st.n, 0), 0) + cur.scenarios.reduce((a, s) => a + s.n, 0);
  const wrong = cur.sweeps.reduce((a, s) => a + s.steps.reduce((b, st) => b + st.wrong, 0), 0) + cur.scenarios.reduce((a, s) => a + s.wrong, 0);
  const medMs = cur.sweeps[0]?.steps[0]?.decodeMs.median ?? 0;

  // comparison: per step, two-proportion test
  const changes: { sweep: string; value: number; unit: string; a: Step; b: Step; p: number }[] = [];
  if (prev) {
    for (const s of cur.sweeps) {
      const ps = pSweep(s.id);
      if (!ps) continue;
      for (const st of s.steps) {
        const q = ps.steps.find((x) => x.value === st.value);
        if (!q) continue;
        const p = twoProportionP(st.ok, st.n, q.ok, q.n);
        if (st.ok / st.n !== q.ok / q.n) changes.push({ sweep: s.label, value: st.value, unit: s.unit, a: q, b: st, p });
      }
    }
  }
  const sig = changes.filter((c) => c.p < 0.05);
  const better = sig.filter((c) => c.b.rate > c.a.rate).length;
  const worse = sig.length - better;
  const sameCodec = prev && prev.codecHash === cur.codecHash;
  const verdict = !prev
    ? 'No earlier results in this branch\'s history yet: the next codec change will be compared with this run.'
    : sig.length === 0
      ? `No step changed significantly (two-proportion test, p < 0.05)${sameCodec ? ' — as expected: both runs measured the same codec files.' : '.'}`
      : `${better} step${better === 1 ? '' : 's'} significantly better and ${worse} significantly worse (p < 0.05).`;

  const summaryRows = cur.sweeps
    .map((s) => {
      const ps = pSweep(s.id);
      const lim = (x: number | null, px: number | null | undefined) => `${fmt(x, s.unit)}${prev ? `<span class="was">${px === undefined ? '' : 'was ' + fmt(px ?? null)}</span>` : ''}`;
      const harsh = s.steps[s.steps.length - 1]!;
      return `<tr><th scope="row"><a href="#chart-${esc(s.id)}">${esc(s.label)}</a></th><td>${lim(s.limit90, ps?.limit90)}</td><td>${lim(s.limit50, ps?.limit50)}</td><td>${pct(harsh.rate)} <span class="was">at ${esc(harsh.value)}</span></td></tr>`;
    })
    .join('');
  const scenRows = cur.scenarios
    .map((s) => {
      const p = prev?.scenarios.find((q) => q.id === s.id);
      return `<tr><th scope="row">${esc(s.label)}</th><td>${pct(s.rate)} <span class="was">${s.ok}/${s.n}, 95 % CI ${pct(s.ci95[0])}–${pct(s.ci95[1])}</span>${p ? `<span class="was">was ${pct(p.rate)}</span>` : ''}</td><td>${s.rawBer === null ? '—' : (100 * s.rawBer).toFixed(1) + ' %'}</td><td class="wrap">${esc(s.note)}</td></tr>`;
    })
    .join('');
  const falseRows = cur.falseDetections
    .map((f) => `<tr><th scope="row">${esc(f.label)}</th><td>${(f.seconds / 60).toFixed(1)} min</td><td>${f.frames}</td><td>${f.alarms} <span class="was">${f.alarmsPerMin}/min</span></td><td>${f.decodeMsPerWindow} ms</td></tr>`)
    .join('');
  const changeRows = sig
    .slice(0, 30)
    .map((c) => `<tr><th scope="row">${esc(c.sweep)} @ ${esc(c.value)} ${esc(c.unit)}</th><td>${pct(c.a.rate)}</td><td>${pct(c.b.rate)}</td><td>${c.b.rate > c.a.rate ? '▲ better' : '▼ worse'}</td><td>${c.p < 0.001 ? '< 0.001' : c.p.toFixed(3)}</td></tr>`)
    .join('');
  const charts = cur.sweeps.map((s) => sweepChart(s, pSweep(s.id))).join('\n');
  const shaLink = (r: Results) => `<a href="https://github.com/perezamadorluisenrique-gif/silbo-sound/commit/${esc(r.sha)}"><code>${esc(r.sha)}</code></a>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Silbo reliability bench</title>
<meta name="description" content="How reliably Silbo's acoustic codec survives noise, reverb, cheap microphones and other real-world sound conditions, measured in simulation on every codec change.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Schibsted+Grotesk:wght@400;600;800&display=swap" rel="stylesheet">
<style>
:root {
  --paper: #F5F4F0; --sheet: #FCFCFA; --ink: #121417; --ink-muted: #50555C; --divider: #D6D4CC;
  --ochre: #F2C14E; --ochre-soft: #F7E2AE; --receive: #2343A8; --grid-empty: #EEECE6;
  --series-cur: #3557C4; --series-prev: #B07A08; --band: rgba(53, 87, 196, 0.13);
  --font-sans: "Schibsted Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #111214; --sheet: #1A1C1F; --ink: #EDEBE5; --ink-muted: #A4A7AC; --divider: #34373C;
    --ochre-soft: #5A4A22; --receive: #9DB1F5; --grid-empty: #24262A;
    --series-cur: #6F8BE6; --series-prev: #B8892A; --band: rgba(111, 139, 230, 0.18);
  }
}
:root[data-theme="dark"] {
  --paper: #111214; --sheet: #1A1C1F; --ink: #EDEBE5; --ink-muted: #A4A7AC; --divider: #34373C;
  --ochre-soft: #5A4A22; --receive: #9DB1F5; --grid-empty: #24262A;
  --series-cur: #6F8BE6; --series-prev: #B8892A; --band: rgba(111, 139, 230, 0.18);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 16px/24px var(--font-sans); }
.wrap-page { max-width: 1040px; margin: 0 auto; padding: 0 16px 48px; }
header { margin-top: 20px; padding-bottom: 12px; border-bottom: 1.5px solid var(--ink); display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: flex-end; justify-content: space-between; }
h1 { margin: 0; font-size: 26px; line-height: 30px; font-weight: 800; letter-spacing: -0.03em; }
h2 { font-size: 20px; line-height: 26px; font-weight: 800; letter-spacing: -0.02em; margin: 36px 0 8px; }
h3 { font-size: 16px; margin: 20px 0 6px; }
.meta, .chart-sub, .tick, .axis, .was, th.col, .kicker { font-family: var(--font-mono); font-size: 11.5px; line-height: 16px; letter-spacing: 0.03em; color: var(--ink-muted); }
.meta { text-transform: uppercase; }
a { color: var(--receive); }
code { font-family: var(--font-mono); font-size: 0.86em; background: var(--grid-empty); padding: 1px 4px; border-radius: 4px; overflow-wrap: anywhere; }
p, li { max-width: 72ch; }
.lede { font-size: 18px; line-height: 27px; max-width: 64ch; margin-top: 16px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 20px 0 8px; }
.tile { background: var(--sheet); border: 1px solid var(--divider); border-radius: 10px; padding: 12px 14px; }
.tile .big { font-size: 30px; line-height: 36px; font-weight: 800; letter-spacing: -0.02em; }
.tile .kicker { text-transform: uppercase; }
.charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.chart { margin: 0; background: var(--sheet); border: 1px solid var(--divider); border-radius: 10px; padding: 12px; position: relative; min-width: 0; }
.chart figcaption { display: flex; flex-direction: column; margin-bottom: 4px; }
.chart-title { font-weight: 600; }
.chart svg { width: 100%; height: auto; display: block; overflow: visible; }
.chart .note { font-size: 13px; line-height: 18px; color: var(--ink-muted); margin: 6px 0 0; }
.grid { stroke: var(--divider); stroke-width: 1; }
.grid-90 { stroke-dasharray: 2 3; }
.tick, .axis { fill: var(--ink-muted); font-size: 10.5px; }
.band { fill: var(--band); }
.cur { fill: none; stroke: var(--series-cur); stroke-width: 2; stroke-linejoin: round; }
.cur-dot { fill: var(--series-cur); stroke: var(--sheet); stroke-width: 2; }
.prev { fill: none; stroke: var(--series-prev); stroke-width: 2; stroke-dasharray: 5 4; }
.prev-dot { fill: var(--sheet); stroke: var(--series-prev); stroke-width: 2; }
.xhair { stroke: var(--ink-muted); stroke-width: 1; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 4px 0 12px; font-size: 14px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend svg { width: 26px; height: 10px; }
.tip { position: absolute; pointer-events: none; background: var(--ink); color: var(--paper); border-radius: 6px; padding: 6px 8px; font: 500 12px/16px var(--font-mono); white-space: nowrap; z-index: 2; }
.tip strong { font-size: 14px; }
.tablewrap { overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid var(--divider); border-radius: 10px; background: var(--sheet); }
table { border-collapse: collapse; width: 100%; font-size: 14px; line-height: 20px; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--divider); vertical-align: top; white-space: nowrap; }
td.wrap { white-space: normal; min-width: 220px; }
tr:last-child th, tr:last-child td { border-bottom: 0; }
th.col { text-transform: uppercase; font-weight: 500; }
.was { display: block; }
.verdict { background: var(--ochre-soft); border-radius: 10px; padding: 10px 14px; max-width: 72ch; }
footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid var(--divider); color: var(--ink-muted); font-size: 14px; }
pre { background: var(--sheet); border: 1px solid var(--divider); border-radius: 10px; padding: 12px; overflow-x: auto; font: 13px/19px var(--font-mono); }
</style>
</head>
<body>
<div class="wrap-page">
<header>
  <h1>Silbo reliability bench</h1>
  <div class="meta">codec ${shaLink(cur)} · ${esc(cur.date.slice(0, 10))} · ${esc(cur.mode)} run, N=${cur.n}/step</div>
</header>

<p class="lede">How often does a Silbo text message, sent from one phone's speaker to another's microphone, arrive intact when the sound gets noisy, echoey, distorted or glitchy? Every number below is from a <strong>simulated</strong> acoustic channel driving the app's real encoder and decoder, re-measured on every codec change.</p>

<div class="tiles">
  <div class="tile"><div class="kicker">Worst realistic case</div><div class="big">${pct(worst?.rate)}</div><div class="meta">${worst ? `${worst.ok}/${worst.n} delivered` : ''}</div></div>
  <div class="tile"><div class="kicker">Messages simulated</div><div class="big">${totalMsgs.toLocaleString('en')}</div><div class="meta">${cur.sweeps.length} impairments, ${cur.scenarios.length} scenarios</div></div>
  <div class="tile"><div class="kicker">Wrong text delivered</div><div class="big">${wrong}</div><div class="meta">CRC-32 caught every error</div></div>
  <div class="tile"><div class="kicker">False messages from noise</div><div class="big">${falseFrames}</div><div class="meta">in ${falseMin.toFixed(0)} min of pure noise</div></div>
  <div class="tile"><div class="kicker">Decode time</div><div class="big">${medMs} ms</div><div class="meta">median per message, ${esc(cur.env.node)}</div></div>
</div>

<h2 id="summary">Summary</h2>
<p>Where each impairment starts to hurt: the strength at which the success rate first falls below 90 % and below 50 % (interpolated between steps; “—” means it never did within the tested range).</p>
<div class="tablewrap"><table>
<thead><tr><th class="col">Impairment</th><th class="col">90 % limit</th><th class="col">50 % limit</th><th class="col">Harshest step</th></tr></thead>
<tbody>${summaryRows}</tbody></table></div>

<h3>Scenarios</h3>
<div class="tablewrap"><table>
<thead><tr><th class="col">Scenario</th><th class="col">Delivered</th><th class="col">Raw bit errors</th><th class="col">Conditions</th></tr></thead>
<tbody>${scenRows}</tbody></table></div>

<h3>False detections on pure noise</h3>
<div class="tablewrap"><table>
<thead><tr><th class="col">Noise</th><th class="col">Duration</th><th class="col">False messages</th><th class="col">Preamble alarms</th><th class="col">Decode / 14 s window</th></tr></thead>
<tbody>${falseRows}</tbody></table></div>

<h2 id="curves">Success rate per impairment</h2>
<div class="legend" aria-label="legend">
  <span><svg viewBox="0 0 26 10" aria-hidden="true"><line x1="0" y1="5" x2="26" y2="5" stroke="var(--series-cur)" stroke-width="2"/><circle cx="13" cy="5" r="3.5" fill="var(--series-cur)"/></svg>this commit ${shaLink(cur)}</span>
  ${prev ? `<span><svg viewBox="0 0 26 10" aria-hidden="true"><line x1="0" y1="5" x2="26" y2="5" stroke="var(--series-prev)" stroke-width="2" stroke-dasharray="5 4"/><circle cx="13" cy="5" r="3.5" fill="var(--sheet)" stroke="var(--series-prev)" stroke-width="2"/></svg>previous ${shaLink(prev)}</span>` : ''}
  <span><svg viewBox="0 0 26 10" aria-hidden="true"><rect x="0" y="0" width="26" height="10" fill="var(--band)"/></svg>95 % confidence band</span>
</div>
<p class="meta">Steps are evenly spaced on the x axis; harsher to the right. Dotted line: 90 %.</p>
<div class="charts">
${charts}
</div>

<h2 id="compare" data-prev-sha="${esc(prev?.sha ?? '')}">Compared with the previous commit</h2>
${prev ? `<p>This run ${shaLink(cur)} (${esc(cur.mode)}, N=${cur.n}) against ${shaLink(prev)} (${esc(prev.mode)}, N=${prev.n}, ${esc(prev.date.slice(0, 10))}). Codec files ${sameCodec ? '<strong>identical</strong>' : '<strong>changed</strong>'}; bench ${prev.benchHash === cur.benchHash ? 'identical' : 'changed'}.</p>` : ''}
<p class="verdict">${esc(verdict)}</p>
${changeRows ? `<div class="tablewrap"><table><thead><tr><th class="col">Step</th><th class="col">Before</th><th class="col">After</th><th class="col">Change</th><th class="col">p</th></tr></thead><tbody>${changeRows}</tbody></table></div>` : ''}
${prev && (prev.mode !== 'full' || cur.mode !== 'full') ? '<p class="meta">Quick runs (N=20 per step) can only flag large changes; the full run (N=200) resolves differences of a few percent.</p>' : ''}

<div class="writeup">
${markdown(writeup)}
</div>

<h2 id="reproduce">Reproduce</h2>
<pre>git clone https://github.com/perezamadorluisenrique-gif/silbo-sound
cd silbo-sound && npm ci            # Node ≥ 22.18
git checkout ${esc(cur.sha)}
node bench/run.ts ${cur.mode === 'quick' ? '--quick ' : ''}--seed ${cur.seed}   # writes bench/results/&lt;sha&gt;.json
node bench/site/build.ts             # this page, in bench/site/out/</pre>

<footer>Silbo bench · channel model and every assumption in <a href="https://github.com/perezamadorluisenrique-gif/silbo-sound/tree/main/bench">bench/</a> (DECISIONS.md, CODEC.md) · codec ${esc(cur.codecHash)} · bench ${esc(cur.benchHash)} · run took ${esc(cur.durationS)} s on ${esc(cur.env.cpus)} cores</footer>
</div>
<script>
// hover layer: crosshair snapping to the nearest step, one tooltip with both commits
for (const svg of document.querySelectorAll('svg[data-chart="sweep"]')) {
  const pts = JSON.parse(svg.dataset.points);
  const fig = svg.closest('figure');
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  fig.appendChild(tip);
  const hair = svg.querySelector('.xhair');
  const xs = [...svg.querySelectorAll('.cur-dot')].map((c) => Number(c.getAttribute('cx')));
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * svg.viewBox.baseVal.width;
    let k = 0;
    xs.forEach((x, i) => { if (Math.abs(x - vx) < Math.abs(xs[k] - vx)) k = i; });
    const p = pts[k];
    hair.setAttribute('x1', xs[k]); hair.setAttribute('x2', xs[k]); hair.setAttribute('visibility', 'visible');
    tip.textContent = '';
    const head = document.createElement('div'); head.textContent = p.v + ' ' + svg.dataset.unit; tip.appendChild(head);
    const row = (label, val) => { const d = document.createElement('div'); const s = document.createElement('strong'); s.textContent = val; d.append(s, ' ' + label); tip.appendChild(d); };
    row('this commit (' + p.ok + '/' + p.n + ')', Math.round(p.r * 100) + ' %');
    if (p.pr !== null) row('previous', Math.round(p.pr * 100) + ' %');
    if (p.ber !== null) row('raw bit errors', (p.ber * 100).toFixed(1) + ' %');
    tip.hidden = false;
    const fr = fig.getBoundingClientRect();
    const px = r.left - fr.left + (xs[k] / svg.viewBox.baseVal.width) * r.width;
    tip.style.left = Math.max(4, Math.min(fr.width - tip.offsetWidth - 4, px - tip.offsetWidth / 2)) + 'px';
    tip.style.top = (r.top - fr.top + 4) + 'px';
  };
  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', () => { tip.hidden = true; hair.setAttribute('visibility', 'hidden'); });
  svg.tabIndex = 0;
  svg.addEventListener('focus', () => { const r = svg.getBoundingClientRect(); show(r.left + r.width / 2); });
  svg.addEventListener('blur', () => { tip.hidden = true; hair.setAttribute('visibility', 'hidden'); });
}
</script>
</body>
</html>
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'index.html'), build());
  console.log(`bench page: ${join(OUT, 'index.html')}`);
}
