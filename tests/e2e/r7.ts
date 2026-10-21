// R7 end-to-end in real Chromium: the sender page gets the book chapter (assets/capitulo-09-listas.md)
// as a file, compresses it and plays the carousel; the samples go through the channel simulator
// (medium room, SNR 15 dB, ±200 ppm) and a receiver Chromium must offer the chapter for download,
// byte-identical (SHA-256) after inflating, with a readable preview.
// Usage: node tests/e2e/r7.ts [--json out.json] [--no-build]
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { simulate } from '../../src/sim/channel.ts';
import { Rng } from '../../src/dsp/rng.ts';
import { serve, wav16, capture, receiver } from './r5.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TMP = join(ROOT, 'tmp', 'e2e-r7');
const CHROME = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const FS = 48000;
const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'es-ES' };
const CHAPTER = join(ROOT, 'assets/capitulo-09-listas.md');
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '[x]' : '[ ]'} ${name}: ${detail}`);
};

async function main() {
  mkdirSync(TMP, { recursive: true });
  if (!args.includes('--no-build')) {
    const b = spawnSync(process.execPath, [join(ROOT, 'tools/build-app.ts')], { stdio: 'inherit' });
    if (b.status !== 0) throw new Error('build falló');
  }
  const raw = new Uint8Array(readFileSync(CHAPTER));
  const { server, url } = await serve();
  const t0 = Date.now();
  try {
    const sb = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const sp = await (await sb.newContext(MOBILE)).newPage();
    sp.on('pageerror', (e) => console.error('[emisor] error de página:', e.message));
    await sp.goto(url);
    await sp.click('#mode-send');
    await sp.setInputFiles('#file', CHAPTER);
    const tx = await capture(sp);
    await sb.close();
    check('emisor: el capítulo suena comprimido, en carrusel', tx.x.length > 5 * FS && tx.x.length < 45 * FS, `${raw.length} bytes de texto, ${(tx.x.length / FS).toFixed(1)} s por vuelta; estado «${tx.status}»`);

    const passes = 3;
    const all = new Float32Array(tx.x.length * passes);
    for (let i = 0; i < passes; i++) all.set(tx.x, i * tx.x.length);
    const rng = new Rng(9090);
    const ppm = rng.uniform(-200, 200);
    const { rx } = simulate(all, FS, { room: 'medium', snrDb: 15, ppm, saturation: false, agc: true, seed: rng.int(2 ** 31), leadSeconds: 1 });
    const file = join(TMP, 'capitulo.wav');
    writeFileSync(file, wav16(rx, FS));

    const { browser, page } = await receiver(file);
    await page.goto(url);
    await page.click('#mode-recv');
    const t = Date.now();
    const ok = await page.waitForSelector('#inbox a[download$=".md"]', { timeout: 150000 }).then(() => true).catch(() => false);
    const sec = (Date.now() - t) / 1000;
    let detail = 'no llegó en 150 s';
    let same = false;
    if (ok) {
      const info = await page.evaluate(async () => {
        const a = document.querySelector('#inbox a[download$=".md"]') as HTMLAnchorElement;
        const buf = await fetch(a.href).then((r) => r.arrayBuffer());
        const h = await crypto.subtle.digest('SHA-256', buf);
        return { hex: [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''), bytes: buf.byteLength, title: document.querySelector('.received-doc-title')?.textContent ?? '', preview: (document.querySelector('.received-doc')?.textContent ?? '').slice(0, 40) };
      });
      same = info.hex === sha256(raw);
      detail = `${same ? 'idéntico' : 'DISTINTO'} por SHA-256 (${info.bytes} bytes), a los ${sec.toFixed(0)} s de pulsar Recibir; «${info.title}»; vista previa «${info.preview}…»; sala media, 15 dB, ${ppm.toFixed(0)} ppm`;
      same &&= /palabras/.test(info.title) && info.preview.startsWith('# Capítulo 9');
    }
    check('receptor: capítulo del libro recibido íntegro, con vista previa y para guardar', ok && same, detail);
    await browser.close();
  } finally {
    server.close();
  }
  const ok = checks.every((c) => c.ok);
  console.log(`e2e R7: ${checks.filter((c) => c.ok).length}/${checks.length} comprobaciones, ${((Date.now() - t0) / 1000).toFixed(0)} s → ${ok ? 'PASA' : 'FALLA'}`);
  const json = opt('--json');
  if (json) writeFileSync(json, JSON.stringify({ ok, checks }, null, 2));
  process.exit(ok ? 0 : 1);
}

await main();
