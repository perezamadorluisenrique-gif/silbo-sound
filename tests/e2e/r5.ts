// R5 end-to-end in real Chromium (mobile viewport), no real speakers:
//  A. DISCREET MODE: the sender page, with «Modo discreto» ticked, plays a 140-character text
//     in the near-ultrasound band; the test checks the honest warning is on screen and measures
//     how much of what the page played falls in the audible range (< 16 kHz). The samples go
//     through the near-ultrasound channel model (band 'ultrasonic', medium room, SNR 15 dB,
//     clock drift) into a WAV that a receiver Chromium hears as its microphone.
//  B. BROADCAST: the photo carousel the page plays is heard by N receiver Chromiums at once,
//     each from its own spot in the same room (its own impulse response, SNR, clock drift and
//     moment it switched on). All N must show a byte-identical photo.
// Usage: node tests/e2e/r5.ts [--json out.json] [--receivers 3] [--no-build]
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { simulate } from '../../src/sim/channel.ts';
import { Rng } from '../../src/dsp/rng.ts';
import { Fft } from '../../src/dsp/fft.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = join(ROOT, 'dist');
const TMP = join(ROOT, 'tmp', 'e2e-r5');
const CHROME = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const FS = 48000;
const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const N_RX = Number(opt('--receivers') ?? 3);
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'es-ES' };
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const TEXT = 'Silbo en modo discreto: este mensaje viajó casi en ultrasonido, entre 17 y 20 kHz, y casi nadie lo oyó. ¿Llegó? Ñandú, acción y pingüino.';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '[x]' : '[ ]'} ${name}: ${detail}`);
};

export function serve(): Promise<{ server: Server; url: string }> {
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const server = createServer((req, res) => {
    let p = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    if (p.endsWith('/')) p += 'index.html';
    const f = join(DIST, p);
    if (!f.startsWith(DIST) || !existsSync(f)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(readFileSync(f));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: `http://localhost:${(server.address() as { port: number }).port}/` })));
}

export function wav16(x: Float32Array, fs: number): Buffer {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + x.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(fs, 24);
  b.writeUInt32LE(fs * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i]! * 32767))), 44 + i * 2);
  return b;
}

/** Fraction of the energy below `hz`, in dB, from one long FFT. */
export function energyBelowDb(x: Float32Array, hz: number, fs = FS): number {
  const N = 1 << Math.ceil(Math.log2(x.length));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  re.set(x);
  Fft.of(N).transform(re, im);
  let lo = 0;
  let tot = 0;
  for (let k = 1; k < N / 2; k++) {
    const e = re[k]! ** 2 + im[k]! ** 2;
    tot += e;
    if ((k * fs) / N < hz) lo += e;
  }
  return 10 * Math.log10(Math.max(lo, 1e-30) / tot);
}

async function axe(page: Page, label: string) {
  await page.addScriptTag({ path: join(ROOT, 'node_modules/axe-core/axe.min.js') });
  const r = (await page.evaluate(() => (window as unknown as { axe: { run: (o: unknown) => Promise<unknown> } }).axe.run({ resultTypes: ['violations'] }))) as { violations: { id: string; impact: string }[] };
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(`axe-core ${label}`, bad.length === 0, `infracciones serious/critical: ${bad.length}; todas: ${r.violations.map((v) => `${v.id}(${v.impact})`).join(', ') || 'ninguna'}`);
}

export async function capture(page: Page): Promise<{ x: Float32Array; status: string }> {
  await page.evaluate(() => ((window as unknown as { __silbo: { lastPass: unknown } }).__silbo.lastPass = null));
  await page.click('#play');
  await page.waitForFunction(() => (window as unknown as { __silbo: { lastPass: unknown } }).__silbo.lastPass !== null, null, { timeout: 30000 });
  const b64 = await page.evaluate(() => (window as unknown as { __silbo: { lastPassPcm16(): string } }).__silbo.lastPassPcm16());
  const status = (await page.textContent('#status')) ?? '';
  await page.click('#stop-send').catch(() => {});
  const raw = Buffer.from(b64, 'base64');
  const x = new Float32Array(raw.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = raw.readInt16LE(i * 2) / 32767;
  return { x, status };
}

export async function receiver(wav: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ ...MOBILE, permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[receptor] error de página:', e.message));
  return { browser, page };
}

async function main() {
  mkdirSync(TMP, { recursive: true });
  if (!args.includes('--no-build')) {
    const b = spawnSync(process.execPath, [join(ROOT, 'tools/build-app.ts')], { stdio: 'inherit' });
    if (b.status !== 0) throw new Error('build falló');
  }
  const { server, url } = await serve();
  const t0 = Date.now();
  const photo = new Uint8Array(readFileSync(join(ROOT, 'assets/foto.jpg')));
  try {
    // ---- sender ----
    const sb = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const sp = await (await sb.newContext(MOBILE)).newPage();
    sp.on('pageerror', (e) => console.error('[emisor] error de página:', e.message));
    await sp.goto(url);
    await sp.click('#mode-send');
    await sp.check('#discreto');
    await sp.fill('#text', TEXT);
    const warn = await sp.evaluate(() => {
      const el = document.querySelector('#discreto-aviso') as HTMLElement | null;
      const box = document.querySelector('#discreto') as HTMLInputElement | null;
      return { text: el?.textContent ?? '', visible: !!el && el.offsetParent !== null, described: box?.getAttribute('aria-describedby') === 'discreto-aviso' };
    });
    check('aviso honesto del modo discreto en pantalla', warn.visible && warn.described && /no emiten o no captan/.test(warn.text), `«${warn.text.trim()}»`);
    await axe(sp, 'pantalla Enviar con modo discreto');
    const d = await capture(sp);
    const below16 = energyBelowDb(d.x, 16000);
    const below12 = energyBelowDb(d.x, 12000);
    check('modo discreto: lo que suena es casi inaudible', d.x.length > FS && below16 <= -40, `${(d.x.length / FS).toFixed(1)} s; energía por debajo de 16 kHz ${below16.toFixed(1)} dB y de 12 kHz ${below12.toFixed(1)} dB respecto al total; estado «${d.status}»`);
    await sp.uncheck('#discreto');
    await sp.fill('#text', '');
    await sp.setInputFiles('#file', join(ROOT, 'assets/foto.jpg'));
    const ph = await capture(sp);
    check('emisor de la foto (carrusel para difusión)', ph.x.length > 10 * FS, `${(ph.x.length / FS).toFixed(1)} s por vuelta`);
    await sb.close();

    // ---- A. discreet receiver ----
    {
      const rng = new Rng(5151);
      const ppm = rng.uniform(-200, 200);
      const { rx } = simulate(d.x, FS, { room: 'medium', snrDb: 15, ppm, saturation: false, agc: true, seed: rng.int(2 ** 31), leadSeconds: 1, band: 'ultrasonic' });
      const file = join(TMP, 'discreto.wav');
      writeFileSync(file, wav16(rx, FS));
      const { browser, page } = await receiver(file);
      await page.goto(url);
      await page.click('#mode-recv');
      const t = Date.now();
      const got = await page.waitForSelector('.received-text', { timeout: 40000 }).then(() => page.textContent('.received-text')).catch(() => null);
      const hk = await page.evaluate(() => (window as unknown as { __silbo: { sampleRate: number; lastDecodeMs: number } }).__silbo);
      check('modo discreto: texto recibido íntegro en Chromium', got === TEXT, got === null ? 'no llegó en 40 s' : `${got === TEXT ? 'idéntico' : 'DISTINTO'} (SHA-256 ${sha256(Buffer.from(got)).slice(0, 12)}), a los ${((Date.now() - t) / 1000).toFixed(1)} s; canal casi ultrasónico, sala media, 15 dB, ${ppm.toFixed(0)} ppm; audio ${hk.sampleRate} Hz, decodificación ${hk.lastDecodeMs.toFixed(0)} ms`);
      await browser.close();
    }

    // ---- B. broadcast: N receivers at once ----
    {
      const passes = 4;
      const all = new Float32Array(ph.x.length * passes);
      for (let i = 0; i < passes; i++) all.set(ph.x, i * ph.x.length);
      const rng = new Rng(777);
      const specs = Array.from({ length: N_RX }, (_, i) => ({ i, snr: Math.round(rng.uniform(12, 25)), ppm: Math.round(rng.uniform(-200, 200)), join: Math.round(rng.uniform(0, ph.x.length / FS) * 10) / 10, seed: rng.int(2 ** 31) }));
      const files = specs.map((s) => {
        const seg = all.subarray(Math.round(s.join * FS), Math.round(s.join * FS) + 105 * FS);
        const { rx } = simulate(seg, FS, { room: 'medium', snrDb: s.snr, ppm: s.ppm, saturation: false, agc: true, seed: s.seed, leadSeconds: 0.5 });
        const f = join(TMP, `difusion-${s.i}.wav`);
        writeFileSync(f, wav16(rx, FS));
        return f;
      });
      const rxs = await Promise.all(files.map((f) => receiver(f)));
      await Promise.all(rxs.map(async ({ page }) => {
        await page.goto(url);
        await page.click('#mode-recv');
      }));
      const t = Date.now();
      const res = await Promise.all(rxs.map(async ({ page }) => {
        const ok = await page.waitForSelector('#inbox img', { timeout: 180000 }).then(() => true).catch(() => false);
        const sec = (Date.now() - t) / 1000;
        if (!ok) {
          const hk = await page.evaluate(() => {
            const h = (window as unknown as { __silbo: { windows: number; lastDecodeMs: number; frames: number; captured: number; sampleRate: number; events: { type: string; have?: number; at: number }[] } }).__silbo;
            return { windows: h.windows, ms: h.lastDecodeMs, frames: h.frames, capturedS: h.captured / h.sampleRate, ev: h.events.map((e) => `${e.at}s ${e.type}${e.have ?? ''}`).join(' | ') };
          });
          console.log('[difusión] receptor sin foto:', JSON.stringify(hk));
          return { ok: false, sec };
        }
        const hex = await page.evaluate(async () => {
          const img = document.querySelector('#inbox img') as HTMLImageElement;
          const buf = await fetch(img.src).then((r) => r.arrayBuffer());
          return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
        });
        return { ok: hex === sha256(photo), sec };
      }));
      await Promise.all(rxs.map(({ browser }) => browser.close()));
      const detail = specs.map((s, k) => `receptor ${k + 1} (${s.snr} dB, ${s.ppm} ppm, se une a los ${s.join} s): ${res[k]!.ok ? `foto idéntica a los ${res[k]!.sec.toFixed(0)} s` : 'NO'}`).join('; ');
      check(`difusión: ${N_RX} receptores a la vez reciben la foto íntegra`, res.every((r) => r.ok), `sala media, un solo emisor en bucle; ${detail}`);
    }
  } finally {
    server.close();
  }
  const ok = checks.every((c) => c.ok);
  console.log(`e2e R5: ${checks.filter((c) => c.ok).length}/${checks.length} comprobaciones, ${((Date.now() - t0) / 1000).toFixed(0)} s → ${ok ? 'PASA' : 'FALLA'}`);
  const json = opt('--json');
  if (json) writeFileSync(json, JSON.stringify({ ok, checks }, null, 2));
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
