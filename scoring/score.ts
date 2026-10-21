// score: the only judge of the ladder in CHARTER.md. Every figure is measured against the
// channel simulator in src/sim (not real phones) and says so.
// Usage: ./score [--quick] [--only R0,R1]
import { writeFileSync } from 'node:fs';
import { simChecks } from './simcheck.ts';
import { runTrials, randomText, pct, type Modem } from './lib.ts';
import { fskEncode, fskDecode, FSK_NAME } from '../src/modem/fsk.ts';
import * as mf from '../src/modem/mfsk.ts';
import { ROOMS } from '../src/sim/rooms.ts';
import { Rng } from '../src/dsp/rng.ts';
import { runGrid, runFalsePositives, SNRS, GRID_ROOMS } from './grid.ts';
import { runR3, PHOTO, LIMIT_S } from './r3.ts';
import { statSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const onlyArg = args[args.indexOf('--only') + 1];
const only = args.includes('--only') && onlyArg ? new Set(onlyArg.split(',')) : null;
const want = (r: string) => !only || only.has(r);
const lines: string[] = [];
const log = (s = '') => {
  lines.push(s);
  console.log(s);
};
const enc = new TextEncoder();
const t0 = Date.now();

const fsk: Modem = { name: FSK_NAME, encode: fskEncode, decode: (rx) => { const d = fskDecode(rx); return d ? [d] : []; } };
const mfsk: Modem = { name: `MFSK con saltos, perfil «${mf.DEFAULT.name}»`, encode: (d) => mf.encode(d), decode: (rx) => mf.decodeAll(rx).map((x) => x.data) };

log(`# score — ${new Date().toISOString()}${quick ? ' (--quick: menos ensayos, no vale para subir peldaño)' : ''}`);
log('Todas las cifras son contra el simulador de canal acústico (src/sim), no con móviles reales.');
log('');
let rung = -1;
const passed: Record<string, boolean> = {};

// ---------- R0 ----------
if (want('R0')) {
  log('## R0: simulador y módem de referencia');
  const checks = simChecks();
  for (const c of checks) log(`- [${c.ok ? 'x' : ' '}] ${c.name}: ${c.detail}`);
  const n = quick ? 5 : 20;
  const clean = runTrials(fsk, { room: 'none', snrDb: 25, ppm: 'random', saturation: false, agc: true }, n, 1, (r) => enc.encode(randomText(32, r)));
  const med = runTrials(fsk, { room: 'medium', snrDb: 15, ppm: 'random', saturation: false, agc: true }, n, 2, (r) => enc.encode(randomText(32, r)));
  const rate = (clean.bytes * 8) / clean.airtime;
  log(`- ${FSK_NAME}: sin sala, SNR 25 dB: ${clean.ok}/${clean.n} (${pct(clean.ok, clean.n)}); ${ROOMS.medium!.label}, SNR 15 dB: ${med.ok}/${med.n} (${pct(med.ok, med.n)}); tasa útil ${rate.toFixed(0)} bit/s, ${clean.airtime.toFixed(1)} s por mensaje de ${clean.bytes.toFixed(0)} bytes`);
  passed.R0 = checks.every((c) => c.ok) && clean.ok >= 0.9 * clean.n;
  log(`R0: ${passed.R0 ? 'CUMPLE' : 'no cumple'}`);
  log('');
}

// ---------- R1 ----------
if (want('R1')) {
  log('## R1: texto de 140 caracteres');
  const n = quick ? 30 : 200;
  const r = runTrials(mfsk, { room: 'medium', snrDb: 15, ppm: 'random', saturation: false, agc: true }, n, 1001, (g) => enc.encode(randomText(140, g)));
  const rate = (r.bytes * 8) / r.airtime;
  log(`- ${mfsk.name}: ${ROOMS.medium!.label}, SNR 15 dB, deriva aleatoria ±200 ppm: ${r.ok}/${r.n} íntegros por SHA-256 (${pct(r.ok, r.n)})`);
  log(`- mensaje medio ${r.bytes.toFixed(0)} bytes UTF-8, ${r.airtime.toFixed(2)} s de sonido por mensaje, tasa útil ${rate.toFixed(0)} bit/s`);
  passed.R1 = !quick && r.ok >= 0.99 * r.n;
  log(`R1: ${passed.R1 ? 'CUMPLE' : 'no cumple'} (umbral 99 % de 200)`);
  log('');
}

// ---------- R2 ----------
// Grid: SNR {5,10,15,20,25} dB x rooms {small, medium, large} x clock {-200, 0, +200} ppm x
// saturation {no, yes} = 90 cells, 10 messages of 140 characters each (900), robust profile
// (the sender cannot know the channel, so the app sends robust unless the user picks fast).
// Pass: >= 95 % overall AND no cell below 8/10. False positives: 10 min of simulated ambient
// sound (babble, music, beeps, whistles that sweep like a chirp, clicks, thumps) through the
// channel: 0 decoded frames; the same minutes with one real frame mixed in at 0 dB must decode
// (positive control, >= 9/10) so a dead detector cannot pass.
if (want('R2')) {
  log('## R2: robustez');
  const n = quick ? 2 : 10;
  const prof = mf.PROFILES[1]!;
  const g = await runGrid(1, n);
  const ok = g.reduce((a, c) => a + c.ok, 0);
  const tot = g.reduce((a, c) => a + c.n, 0);
  const worst = Math.min(...g.map((c) => c.ok / c.n));
  log(`- MFSK con saltos, perfil «${prof.name}», texto de 140 caracteres: rejilla de ${g.length} condiciones × ${n} mensajes`);
  log('  (SNR 5-25 dB × salas pequeña/media/grande × deriva −200/0/+200 ppm × saturación no/sí)');
  log(`- global: ${ok}/${tot} íntegros por SHA-256 (${pct(ok, tot)}); peor condición ${(100 * worst).toFixed(0)} %`);
  const row = (f: (c: (typeof g)[number]) => boolean) => {
    const s = g.filter(f);
    const a = s.reduce((x, c) => x + c.ok, 0);
    const b = s.reduce((x, c) => x + c.n, 0);
    return `${a}/${b}`;
  };
  log(`  - por SNR: ${SNRS.map((v) => `${v} dB ${row((c) => c.snr === v)}`).join(' · ')}`);
  log(`  - por sala: ${GRID_ROOMS.map((v) => `${v} ${row((c) => c.room === v)}`).join(' · ')}`);
  log(`  - con saturación ${row((c) => c.sat)}, sin ${row((c) => !c.sat)}; deriva −200 ${row((c) => c.ppm === -200)}, 0 ${row((c) => c.ppm === 0)}, +200 ${row((c) => c.ppm === 200)}`);
  for (const c of g.filter((c) => c.ok < c.n)) log(`  - fallos: ${c.snr} dB, ${c.room}, ${c.ppm} ppm, saturación ${c.sat ? 'sí' : 'no'}: ${c.ok}/${c.n}`);
  log(`- tiempo por mensaje ${g[0]!.airtime.toFixed(2)} s, tasa útil ${((g[0]!.bytes * 8) / g[0]!.airtime).toFixed(0)} bit/s`);
  const mins = quick ? 2 : 10;
  const fp = await runFalsePositives(mins);
  const frames = fp.reduce((a, c) => a + c.frames, 0);
  const peaks = fp.reduce((a, c) => a + c.chirpPeaks, 0);
  const maxN = Math.max(...fp.map((c) => c.maxNcc));
  const ctrl = fp.filter((c) => c.control).length;
  log(`- falsos positivos: ${mins} min de ambiente simulado (voces, música, pitidos, silbidos que barren, clics, golpes; sala media, mitad con saturación): ${frames} tramas decodificadas, ${peaks} candidatos del detector de chirp por encima de su umbral ${mf.DETECT_THRESHOLD} (NCC máxima ${maxN.toFixed(2)}), todos descartados por las comprobaciones de la cabecera`);
  log(`- control positivo: con una trama real mezclada a 0 dB en cada minuto, decodificada en ${ctrl}/${fp.length}`);
  passed.R2 = !quick && ok >= 0.95 * tot && worst >= 0.8 && frames === 0 && ctrl >= 0.9 * fp.length;
  log(`R2: ${passed.R2 ? 'CUMPLE' : 'no cumple'} (≥95 % global, ninguna condición <8/10, 0 tramas falsas, control ≥9/10)`);
  log('');
}

// ---------- R3 ----------
// A ~10 KB JPEG (assets/foto.jpg, synthetic) as a carousel of 1500-byte chunk frames with the
// OFDM profile; 60 s of audio per trial through the medium room at SNR 15 dB with random clock
// drift. Pass: the photo is complete and identical (SHA-256) within 60 s in >= 19 of 20 trials.
if (want('R3')) {
  log('## R3: foto de 10 KB');
  const n = quick ? 4 : 20;
  const t = await runR3(n);
  const ok = t.filter((x) => x.ok);
  const secs = ok.map((x) => x.seconds!).sort((a, b) => a - b);
  const size = statSync(PHOTO).size;
  const med = secs.length ? secs[Math.floor(secs.length / 2)]! : NaN;
  log(`- foto JPEG de ${size} bytes en trozos de 1500 bytes, perfil «archivo» (OFDM con DQPSK diferencial, Viterbi), en carrusel (los trozos perdidos llegan en la vuelta siguiente)`);
  log(`- ${ROOMS.medium!.label}, SNR 15 dB, deriva aleatoria ±200 ppm: completa e idéntica por SHA-256 en ≤${LIMIT_S} s en ${ok.length}/${n} ensayos (${pct(ok.length, n)}); a la primera vuelta en ${t.filter((x) => x.firstPass).length}/${n}`);
  if (secs.length) log(`- tiempo hasta tener la foto: mediana ${med.toFixed(1)} s, máximo ${secs[secs.length - 1]!.toFixed(1)} s; tasa útil ${((size * 8) / med).toFixed(0)} bit/s`);
  const fr = t.reduce((a, x) => a + x.frames, 0);
  const de = t.reduce((a, x) => a + x.decoded, 0);
  log(`- tramas decodificadas ${de}/${fr} (incluye las repeticiones del carrusel)`);
  passed.R3 = !quick && ok.length >= 0.95 * n;
  log(`R3: ${passed.R3 ? 'CUMPLE' : 'no cumple'} (≥19/20 en ≤${LIMIT_S} s)`);
  log('');
}

// ---------- R4 ----------
// The PWA end to end in real Chromium with a phone viewport: tests/e2e/run.ts (sender page ->
// exact samples -> channel simulator, medium room, SNR 15 dB, ±200 ppm -> WAV as the receiver's
// fake microphone), plus manifest, offline reload through the service worker, spectrogram,
// progress bar and axe-core. Runs after R2/R3 so their workers don't starve the browser.
if (want('R4')) {
  log('## R4: app (PWA) de punta a punta en Chromium');
  const out = new URL('../tmp/e2e/score.json', import.meta.url);
  rmSync(out, { force: true });
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../tests/e2e/run.ts', import.meta.url)), '--json', fileURLToPath(out)], { encoding: 'utf8', timeout: 15 * 60 * 1000 });
  let res: { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] } | null = null;
  try {
    res = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    log(`- la prueba no terminó (código ${r.status}): ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' / ')}`);
  }
  if (res) for (const c of res.checks) log(`- [${c.ok ? 'x' : ' '}] ${c.name}: ${c.detail}`);
  passed.R4 = !quick && !!res?.ok && r.status === 0;
  log(`R4: ${passed.R4 ? 'CUMPLE' : 'no cumple'} (todas las comprobaciones de tests/e2e/run.ts)`);
  log('');
}

// ---------- R5 ----------
// Broadcast (one sender, N simulated receivers in the same room, each from its own spot and
// switched on at a random moment) and the discreet mode (near ultrasound, own channel model),
// then both in real Chromium (tests/e2e/r5.ts).
if (want('R5')) {
  log('## R5: modo difusión y modo discreto');
  const r5 = await import('./r5.ts');
  const ok5: boolean[] = [];
  // broadcast
  const trials = quick ? 2 : 10;
  const nrx = quick ? 3 : 6;
  const L = await r5.runBroadcast(trials, nrx);
  const good = L.filter((x) => x.ok);
  const secs = good.map((x) => x.seconds!).sort((a, b) => a - b);
  const byRoom = ['small', 'medium'].map((room) => `${ROOMS[room]!.label}: ${L.filter((x) => x.room === room && x.ok).length}/${L.filter((x) => x.room === room).length}`).join('; ');
  const bOk = good.length >= 0.95 * L.length;
  ok5.push(bOk);
  log(`- [${bOk ? 'x' : ' '}] difusión: ${trials} emisiones de la foto de 10 KB en carrusel, ${nrx} receptores simulados a la vez en cada una (misma sala, cada uno en su sitio: su respuesta al impulso, SNR 10-25 dB, deriva ±200 ppm, 30 % con saturación, se encienden en un momento al azar de los primeros ${r5.MAX_JOIN_S} s); foto completa e idéntica por SHA-256 en ≤${r5.LISTEN_S} s desde que se encienden: ${good.length}/${L.length} (${pct(good.length, L.length)}); ${byRoom}; tiempo mediana ${secs.length ? secs[Math.floor(secs.length / 2)]!.toFixed(1) : '-'} s, máximo ${secs.length ? secs[secs.length - 1]!.toFixed(1) : '-'} s`);
  if (!quick) {
    const LL = await r5.runBroadcast(2, 6, ['large']);
    log(`- [i] difusión en aula grande (RT60 1,0 s, DRR 0 dB; no cuenta para el peldaño): ${LL.filter((x) => x.ok).length}/${LL.length} en ≤${r5.LISTEN_S} s. El perfil «archivo» (OFDM) sufre con tanta reverberación: en un aula grande hay que acercar los móviles o mandar texto con el perfil robusto.`);
  }
  // discreet: audible leakage
  const dtx = mf.encodeWith(enc.encode(randomText(140, new Rng(5))), mf.DISCRETO_ID);
  const leak = r5.energyBelowDb(dtx, 16000);
  const leakOk = leak <= -40;
  ok5.push(leakOk);
  const dsec = mf.airtimeWith(140, mf.DISCRETO_ID);
  log(`- [${leakOk ? 'x' : ' '}] modo discreto (perfil 3, MFSK 17,6-19,3 kHz, chirps 17,4-19,5 kHz): 140 bytes en ${dsec.toFixed(2)} s (${Math.round((140 * 8) / dsec)} bit/s útiles); energía por debajo de 16 kHz ${leak.toFixed(1)} dB respecto al total (umbral −40 dB)`);
  // discreet: grid
  const dn = quick ? 1 : 5;
  const G = await r5.runDiscreetGrid(dn);
  const gok = G.reduce((a, c) => a + c.ok, 0);
  const gtot = G.reduce((a, c) => a + c.n, 0);
  const worst = Math.min(...G.map((c) => c.ok / c.n));
  const gOk = gok >= 0.95 * gtot && worst >= 0.8;
  ok5.push(gOk);
  const perSnr = r5.D_SNRS.map((s) => `${s} dB ${G.filter((c) => c.snr === s).reduce((a, c) => a + c.ok, 0)}/${G.filter((c) => c.snr === s).reduce((a, c) => a + c.n, 0)}`).join(', ');
  log(`- [${gOk ? 'x' : ' '}] modo discreto en su modelo de canal (altavoz que cae desde 18,5 kHz con valle en 19,5 kHz, micrófono hasta 20 kHz, cola de reverberación sin absorción del aire, que es lo pesimista): rejilla de ${G.length} condiciones (3 salas × SNR 5-25 dB en la banda 16,5-20,5 kHz × ±200 ppm × saturación) × ${dn}: ${gok}/${gtot} (${pct(gok, gtot)}), peor condición ${(worst * 100).toFixed(0)} %; por SNR: ${perSnr}`);
  // discreet: false positives
  const mins = quick ? 2 : 10;
  const F = await r5.runDiscreetFp(mins);
  const fFrames = F.reduce((a, f) => a + f.frames, 0);
  const fPeaks = F.reduce((a, f) => a + f.chirpPeaks, 0);
  const fCtrl = F.filter((f) => f.control).length;
  const fOk = fFrames === 0 && fCtrl >= 0.9 * F.length;
  ok5.push(fOk);
  log(`- [${fOk ? 'x' : ' '}] modo discreto sin falsos positivos: ${mins} min de ambiente con agudos (llaves, roces, sibilantes, balizas de 16,5-20 kHz, silbidos y saltos de tono dentro de la banda): ${fFrames} tramas falsas (${fPeaks} candidatos del detector, todos descartados por la cabecera); control positivo (una trama discreta a 0 dB del ambiente en su banda) decodificado en ${fCtrl}/${F.length} minutos`);
  // discreet: phones that cut lower (honest warning)
  if (!quick) {
    const W = await r5.runDiscreetGrid(10, [19000, 18000, 17000].map((micHz) => ({ room: 'medium', snr: 15, ppm: 100, sat: false, micHz })));
    log(`- [i] aviso honesto: con un micrófono que corta antes (sala media, 15 dB): ${W.map((c) => `corte en ${c.micHz! / 1000} kHz ${c.ok}/${c.n}`).join(', ')}. Ojo con leer esto como una garantía: en el simulador el filtro del micrófono atenúa por igual la señal y el ruido de la sala, y no hay ruido propio del micrófono ni del conversor detrás, así que un corte suave casi no hace daño. En un móvil real que corta en 16-18 kHz, o cuyo altavoz apenas emite ahí, la señal puede quedar por debajo de ese ruido propio y no llegar: por eso la app lo avisa junto al interruptor, y la prueba real es la de PRUEBA-CON-MOVILES.md.`);
  }
  // in real Chromium
  const out = new URL('../tmp/e2e-r5/score.json', import.meta.url);
  rmSync(out, { force: true });
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../tests/e2e/r5.ts', import.meta.url)), '--json', fileURLToPath(out), '--receivers', quick ? '2' : '3'], { encoding: 'utf8', timeout: 15 * 60 * 1000 });
  let res: { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] } | null = null;
  try {
    res = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    log(`- la prueba en Chromium no terminó (código ${r.status}): ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' / ')}`);
  }
  if (res) for (const c of res.checks) log(`- [${c.ok ? 'x' : ' '}] Chromium: ${c.name}: ${c.detail}`);
  ok5.push(!!res?.ok && r.status === 0);
  passed.R5 = !quick && ok5.every(Boolean);
  log(`R5: ${passed.R5 ? 'CUMPLE' : 'no cumple'} (difusión ≥95 % de receptores; discreto: fuga audible ≤−40 dB, rejilla ≥95 % y peor condición ≥80 %, 0 tramas falsas con control ≥90 %; prueba en Chromium)`);
  log('');
}

// ---------- R6 ----------
// Presentation: DEMO.md, the landing page (app/acerca.html, Spanish + English, axe-core, offline),
// PRUEBA-CON-MOVILES.md and a results table whose every n/m figure appears in SCORE.txt. The
// table is checked against the SCORE.txt on disk (the previous full run), so a figure that this
// run changes is caught on the next one.
if (want('R6')) {
  log('## R6: presentación');
  const { runR6 } = await import('./r6.ts');
  const C = await runR6();
  for (const c of C) log(`- [${c.ok ? 'x' : ' '}] ${c.name}: ${c.detail}`);
  passed.R6 = !quick && C.every((c) => c.ok);
  log(`R6: ${passed.R6 ? 'CUMPLE' : 'no cumple'} (todas las comprobaciones de scoring/r6.ts)`);
  log('');
}

// ---------- R7 ----------
// A whole chapter of the first sprint's Python book, compressed and sent as a carousel, in the
// simulator (random join time, medium room, 15 dB, ±200 ppm) and in real Chromium (tests/e2e/r7.ts).
if (want('R7')) {
  log('## R7: un capítulo del libro de Python por sonido');
  const r7 = await import('./r7.ts');
  const info = r7.chapterInfo();
  const n = quick ? 4 : 20;
  const T = await r7.runR7(n);
  const good = T.filter((x) => x.ok);
  const secs = good.map((x) => x.seconds!).sort((a, b) => a - b);
  const simOk = good.length >= 0.95 * n;
  log(`- [${simOk ? 'x' : ' '}] capítulo 9 «Listas» (${info.words} palabras, ${info.raw.length} bytes; comprimido con deflate a ${info.packed.length} bytes, ${info.frames} tramas OFDM, ${info.pass.toFixed(1)} s por vuelta del carrusel): sala media (RT60 0,6 s, DRR +3 dB), SNR 15 dB, deriva aleatoria ±200 ppm, el receptor se enciende en un momento al azar de la primera vuelta; íntegro por SHA-256 tras descomprimir en ≤${r7.LIMIT_S} s: ${good.length}/${n} (${pct(good.length, n)}); tiempo mediana ${secs.length ? secs[Math.floor(secs.length / 2)]!.toFixed(1) : '-'} s, máximo ${secs.length ? secs[secs.length - 1]!.toFixed(1) : '-'} s; tasa útil equivalente ${secs.length ? Math.round((info.raw.length * 8) / secs[Math.floor(secs.length / 2)]!) : '-'} bit/s de texto`);
  const out = new URL('../tmp/e2e-r7/score.json', import.meta.url);
  rmSync(out, { force: true });
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../tests/e2e/r7.ts', import.meta.url)), '--json', fileURLToPath(out)], { encoding: 'utf8', timeout: 10 * 60 * 1000 });
  let res: { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] } | null = null;
  try {
    res = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    log(`- la prueba en Chromium no terminó (código ${r.status}): ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' / ')}`);
  }
  if (res) for (const c of res.checks) log(`- [${c.ok ? 'x' : ' '}] Chromium: ${c.name}: ${c.detail}`);
  passed.R7 = !quick && simOk && !!res?.ok && r.status === 0;
  log(`R7: ${passed.R7 ? 'CUMPLE' : 'no cumple'} (≥95 % de ${n} en ≤${r7.LIMIT_S} s en el simulador y prueba en Chromium)`);
  log('');
}
for (const k of ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']) {
  if (passed[k]) rung = Number(k.slice(1));
  else break;
}
log('');
log(`Peldaño confirmado: ${rung >= 0 ? 'R' + rung : 'ninguno'} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
if (!quick && !only) writeFileSync(new URL('../SCORE.txt', import.meta.url), lines.join('\n') + '\n');
