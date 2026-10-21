// End-to-end test of the Silbo PWA in real Chromium (mobile viewport), no real speakers:
//  1. the SENDER page (Enviar) turns a 140-character text and assets/foto.jpg into sound; the
//     test reads back the exact samples the page played;
//  2. Node passes them through the acoustic channel simulator (medium room, SNR 15 dB, random
//     clock drift within ±200 ppm, AGC) and writes a 48 kHz WAV;
//  3. a RECEIVER Chromium gets that WAV as its microphone (--use-file-for-fake-audio-capture),
//     presses Recibir and must show the same text and a byte-identical photo (SHA-256);
//  4. axe-core on both screens (no serious/critical violations) and an offline reload through
//     the service worker.
// Usage: node tests/e2e/run.ts [--json out.json] [--seed N] [--headed]
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { simulate } from '../../src/sim/channel.ts';
import { Rng } from '../../src/dsp/rng.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = join(ROOT, 'dist');
const TMP = join(ROOT, 'tmp', 'e2e');
const CHROME = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const FS = 48000;
const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const SEED = Number(opt('--seed') ?? 4242);
const HEADED = args.includes('--headed');
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'es-ES' };
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

// 140 characters with accents and an emoji-free mix of punctuation (UTF-8 > 140 bytes)
const TEXT = 'Hola desde Silbo: este mensaje viajó de un móvil a otro solo con sonido, sin internet ni Bluetooth. ¿Llegó bien? Ñandú, acción, pingüino.';

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

function serve(): Promise<{ server: Server; url: string }> {
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

function wav16(x: Float32Array, fs: number): Buffer {
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

async function axe(page: Page, label: string) {
  await page.addScriptTag({ path: join(ROOT, 'node_modules/axe-core/axe.min.js') });
  const r = (await page.evaluate(() => (window as unknown as { axe: { run: (o: unknown) => Promise<unknown> } }).axe.run({ resultTypes: ['violations'] }))) as { violations: { id: string; impact: string; nodes: unknown[] }[] };
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const all = r.violations.map((v) => `${v.id}(${v.impact})`).join(', ') || 'ninguna';
  check(`axe-core ${label}`, bad.length === 0, `infracciones serious/critical: ${bad.length}; todas: ${all}`);
}

/** Sender side: returns one pass of what the page played, as float samples at 48 kHz. */
async function sendAndCapture(page: Page, what: 'text' | 'photo'): Promise<Float32Array> {
  await page.evaluate(() => ((window as unknown as { __silbo: { lastPass: unknown } }).__silbo.lastPass = null));
  if (what === 'text') {
    await page.setInputFiles('#file', []);
    await page.fill('#text', TEXT);
  } else {
    await page.fill('#text', '');
    await page.setInputFiles('#file', join(ROOT, 'assets/foto.jpg'));
  }
  await page.click('#play');
  await page.waitForFunction(() => (window as unknown as { __silbo: { lastPass: unknown } }).__silbo.lastPass !== null, null, { timeout: 30000 });
  const b64 = await page.evaluate(() => (window as unknown as { __silbo: { lastPassPcm16(): string } }).__silbo.lastPassPcm16());
  const status = await page.textContent('#status');
  await page.click('#stop-send').catch(() => {});
  const raw = Buffer.from(b64, 'base64');
  const x = new Float32Array(raw.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = raw.readInt16LE(i * 2) / 32767;
  check(`emisor (${what === 'text' ? 'texto' : 'foto'}) genera sonido`, x.length > FS, `${(x.length / FS).toFixed(1)} s por vuelta; estado: «${status}»`);
  return x;
}

function channel(tx: Float32Array, passes: number, seed: number, name: string): { file: string; ppm: number; seconds: number } {
  const all = new Float32Array(tx.length * passes);
  for (let i = 0; i < passes; i++) all.set(tx, i * tx.length);
  const rng = new Rng(seed);
  const ppm = rng.uniform(-200, 200);
  const { rx } = simulate(all, FS, { room: 'medium', snrDb: 15, ppm, saturation: false, agc: true, seed: rng.int(2 ** 31), leadSeconds: 1 });
  // a little silence-with-noise tail so the fake device loops with a gap
  const file = join(TMP, `${name}.wav`);
  writeFileSync(file, wav16(rx, FS));
  return { file, ppm, seconds: rx.length / FS };
}

async function receiver(wav: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: !HEADED,
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
  try {
    // ---- sender ----
    const sb = await chromium.launch({ executablePath: CHROME, headless: !HEADED, args: ['--autoplay-policy=no-user-gesture-required'] });
    const sctx = await sb.newContext(MOBILE);
    const sp = await sctx.newPage();
    sp.on('pageerror', (e) => console.error('[emisor] error de página:', e.message));
    await sp.goto(url);
    const btns = await sp.evaluate(() => ['#mode-send', '#mode-recv'].map((s) => {
      const r = document.querySelector(s)!.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    }));
    const noHScroll = await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check('viewport de móvil (390×844)', btns.every((b) => b.h >= 64 && b.w >= 150) && noHScroll, `botones Enviar ${btns[0]!.w}×${btns[0]!.h} y Recibir ${btns[1]!.w}×${btns[1]!.h} px; sin scroll horizontal: ${noHScroll}`);
    const man = await sp.evaluate(async () => {
      const href = document.querySelector('link[rel=manifest]')?.getAttribute('href');
      const m = href ? await fetch(href).then((r) => r.json()) : null;
      return m ? { name: m.name, display: m.display, start: m.start_url, icons: (m.icons ?? []).map((i: { sizes: string }) => i.sizes) } : null;
    });
    check('manifest de PWA', !!man && man.display === 'standalone' && !!man.start && man.icons.includes('192x192') && man.icons.includes('512x512'), man ? `«${man.name}», display ${man.display}, iconos ${man.icons.join(' ')}` : 'sin manifest');
    const big = await sp.evaluate(() => ['#mode-send', '#mode-recv'].map((q) => document.querySelector(q)!.textContent!.trim()));
    check('dos botones grandes: Enviar y Recibir', big[0]!.endsWith('Enviar') && big[1]!.endsWith('Recibir'), big.join(' / '));
    await axe(sp, 'pantalla inicial');
    await sp.click('#mode-send');
    await axe(sp, 'pantalla Enviar');
    const txText = await sendAndCapture(sp, 'text');
    const txPhoto = await sendAndCapture(sp, 'photo');

    // ---- offline through the service worker ----
    await sp.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await sp.reload(); // now controlled by the worker
    await sp.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await sctx.setOffline(true);
    let offlineOk = false;
    let offlineDetail = '';
    try {
      await sp.reload();
      const ok = await sp.evaluate(async () => {
        const scripts = await Promise.all(['app.js', 'worker.js', 'app.css', 'manifest.webmanifest'].map((f) => fetch(f).then((r) => r.ok).catch(() => false)));
        return { title: document.title, send: !!document.querySelector('#mode-send'), scripts, controlled: !!navigator.serviceWorker.controller };
      });
      offlineOk = ok.send && ok.controlled && ok.scripts.every(Boolean) && ok.title.startsWith('Silbo');
      offlineDetail = `sin red: título «${ok.title}», controlada por el service worker: ${ok.controlled}, recursos en caché: ${ok.scripts.filter(Boolean).length}/4`;
    } catch (e) {
      offlineDetail = `fallo al recargar sin red: ${(e as Error).message.split('\n')[0]}`;
    }
    check('funciona sin conexión (service worker)', offlineOk, offlineDetail);
    // and it still makes sound offline
    if (offlineOk) {
      await sp.click('#mode-send');
      const again = await sendAndCapture(sp, 'text');
      check('sin conexión el emisor sigue sonando', again.length === txText.length, `${(again.length / FS).toFixed(1)} s`);
    }
    await sb.close();

    // ---- channel ----
    const chT = channel(txText, 1, SEED, 'texto');
    const chP = channel(txPhoto, 2, SEED + 1, 'foto');
    console.log(`canal simulado: sala media, SNR 15 dB; texto ${chT.seconds.toFixed(1)} s a ${chT.ppm.toFixed(0)} ppm, foto (2 vueltas) ${chP.seconds.toFixed(1)} s a ${chP.ppm.toFixed(0)} ppm`);

    // ---- receiver: text ----
    {
      const { browser, page } = await receiver(chT.file);
      await page.goto(url);
      await page.click('#mode-recv');
      await axe(page, 'pantalla Recibir');
      const t = Date.now();
      const got = await page.waitForSelector('.received-text', { timeout: 40000 }).then(() => page.textContent('.received-text')).catch(() => null);
      const sec = (Date.now() - t) / 1000;
      const lit = await page.evaluate(() => {
        const c = document.querySelector('#spectro') as HTMLCanvasElement;
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 1]! > 120) n++;
        return n / (d.length / 4);
      });
      check('espectrograma dibuja el sonido recibido', lit > 0.01, `${(lit * 100).toFixed(1)} % de píxeles encendidos`);
      const hk = await page.evaluate(() => (window as unknown as { __silbo: { windows: number; lastDecodeMs: number; sampleRate: number } }).__silbo);
      check('texto de 140 caracteres recibido íntegro', got === TEXT, got === null ? 'no llegó en 40 s' : `${got === TEXT ? 'idéntico' : 'DISTINTO'} (SHA-256 ${sha256(Buffer.from(got)).slice(0, 12)}), en pantalla a los ${sec.toFixed(1)} s; contexto de audio ${hk.sampleRate} Hz, ${hk.windows} ventanas, última decodificación ${hk.lastDecodeMs.toFixed(0)} ms`);
      await browser.close();
    }

    // ---- receiver: photo ----
    {
      const { browser, page } = await receiver(chP.file);
      await page.goto(url);
      await page.click('#mode-recv');
      const t = Date.now();
      let maxProgress = 0;
      const poll = setInterval(() => void page.evaluate(() => (document.querySelector('#progress') as HTMLProgressElement).value).then((v) => (maxProgress = Math.max(maxProgress, v))).catch(() => {}), 1000);
      const ok = await page.waitForSelector('#inbox img', { timeout: 150000 }).then(() => true).catch(() => false);
      clearInterval(poll);
      const sec = (Date.now() - t) / 1000;
      const photo = new Uint8Array(readFileSync(join(ROOT, 'assets/foto.jpg')));
      let detail = 'no llegó en 150 s';
      let same = false;
      if (ok) {
        const info = await page.evaluate(async () => {
          const img = document.querySelector('#inbox img') as HTMLImageElement;
          await img.decode().catch(() => {});
          const buf = await fetch(img.src).then((r) => r.arrayBuffer());
          const h = await crypto.subtle.digest('SHA-256', buf);
          return { hex: [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''), w: img.naturalWidth, h: img.naturalHeight, alt: img.alt, bar: (document.querySelector('#progress') as HTMLProgressElement).value };
        });
        same = info.hex === sha256(photo);
        detail = `${same ? 'idéntica' : 'DISTINTA'} por SHA-256, ${info.w}×${info.h} px, «${info.alt}», en pantalla a los ${sec.toFixed(1)} s de pulsar Recibir; barra de progreso al final ${info.bar}`;
      }
      check('foto JPEG de 10 KB recibida íntegra', ok && same, detail);
      const evs = await page.evaluate(() => (window as unknown as { __silbo: { events: { type: string; have?: number; at: number }[] } }).__silbo.events);
      console.log('eventos:', evs.map((e) => `${e.at}s ${e.type}${e.have ?? ''}`).join(' | '));
      check('barra de progreso avanza durante la recepción', maxProgress > 0, `máximo visto ${maxProgress.toFixed(2)}`);
      await browser.close();
    }
  } finally {
    server.close();
  }
  const ok = checks.every((c) => c.ok);
  console.log(`e2e: ${checks.filter((c) => c.ok).length}/${checks.length} comprobaciones, ${((Date.now() - t0) / 1000).toFixed(0)} s → ${ok ? 'PASA' : 'FALLA'}`);
  const json = opt('--json');
  if (json) writeFileSync(json, JSON.stringify({ ok, checks, seed: SEED }, null, 2));
  process.exit(ok ? 0 : 1);
}

await main();
