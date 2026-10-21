// R6 (presentation) checks: DEMO.md (a 60-second script), the landing page app/acerca.html for
// non-technical readers (Spanish, with an English summary; axe-core in a phone viewport; linked
// from the app and cached offline), PRUEBA-CON-MOVILES.md, and an honest results table whose
// every "n/m" figure appears in SCORE.txt (so the page can't claim what score didn't measure).
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const CHROME = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';

export interface R6Check {
  name: string;
  ok: boolean;
  detail: string;
}

const read = (f: string) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '');

function demoCheck(): R6Check {
  const s = read('DEMO.md');
  // rows like "| 0-8 s |": contiguous ranges from 0 to 60
  const ranges = [...s.matchAll(/^\|\s*(\d+)\s*-\s*(\d+)\s*s\s*\|/gm)].map((m) => [Number(m[1]), Number(m[2])] as const);
  let ok = ranges.length >= 3 && ranges[0]![0] === 0 && ranges[ranges.length - 1]![1] === 60;
  for (let i = 1; i < ranges.length; i++) ok &&= ranges[i]![0] === ranges[i - 1]![1];
  ok &&= /60 segundos/.test(s) && /falla/i.test(s);
  return { name: 'DEMO.md: guion de 60 segundos', ok, detail: s ? `${ranges.length} tramos (${ranges.map((r) => `${r[0]}-${r[1]}`).join(', ')} s), con plan B si algo falla: ${/falla/i.test(s)}` : 'no existe' };
}

function pruebaCheck(): R6Check {
  const s = read('PRUEBA-CON-MOVILES.md');
  const need = ['Poner la app en los móviles', 'Preparación', 'Qué medir', 'Qué esperar', 'Si algo falla'];
  const miss = need.filter((h) => !new RegExp(`^##.*${h}`, 'm').test(s));
  const rows = (s.match(/^\|\s*\d+\s*\|/gm) ?? []).length;
  return { name: 'PRUEBA-CON-MOVILES.md: cómo probarlo con dos móviles y qué medir', ok: !!s && miss.length === 0 && rows >= 4 && /HTTPS/.test(s), detail: s ? `secciones que faltan: ${miss.join(', ') || 'ninguna'}; ${rows} pruebas en la tabla; explica que el micrófono pide HTTPS: ${/HTTPS/.test(s)}` : 'no existe' };
}

export async function runR6(): Promise<R6Check[]> {
  const checks: R6Check[] = [demoCheck(), pruebaCheck()];
  const b = spawnSync(process.execPath, [join(ROOT, 'tools/build-app.ts')], { encoding: 'utf8' });
  if (b.status !== 0 || !existsSync(join(DIST, 'acerca.html'))) {
    checks.push({ name: 'página de inicio app/acerca.html', ok: false, detail: b.status !== 0 ? `build falló: ${b.stderr.slice(-200)}` : 'no está en dist/' });
    return checks;
  }
  // honest table: every n/m figure on the page must appear in SCORE.txt
  const html = readFileSync(join(DIST, 'acerca.html'), 'utf8');
  const score = read('SCORE.txt');
  const table = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
  const figs = [...new Set(table.match(/\d+\/\d+/g) ?? [])];
  const missing = figs.filter((f) => !score.includes(f));
  const rows = [...table.matchAll(/<tr><td>(.*?)<\/td><td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/g)];
  const unmeasured = rows.filter((r) => /sin medir/i.test(r[2]!)).length;
  checks.push({
    name: 'tabla de resultados honesta (simulación frente a real)',
    ok: rows.length >= 6 && figs.length >= 5 && missing.length === 0 && unmeasured >= 1 && rows.every((r) => r[3]!.trim().length > 0) && !/__\w+__/.test(html),
    detail: `${rows.length} filas, ${unmeasured} marcadas «sin medir»; ${figs.length} cifras n/m, todas en SCORE.txt: ${missing.length === 0 ? 'sí' : `no (${missing.join(', ')})`}; cada fila dice dónde se midió`,
  });
  // the page in a phone viewport
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const server = createServer((req, res) => {
    let p = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    if (p.endsWith('/')) p += 'index.html';
    const f = join(DIST, p);
    if (!f.startsWith(DIST) || !existsSync(f)) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://localhost:${(server.address() as { port: number }).port}/`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'es-ES' });
    const page = await ctx.newPage();
    await page.goto(url);
    const link = await page.evaluate(() => !!document.querySelector('a[href="acerca.html"], a[href="./acerca.html"]'));
    await page.click('a[href$="acerca.html"]').catch(() => {});
    await page.waitForURL(/acerca\.html/, { timeout: 5000 }).catch(() => {});
    const info = await page.evaluate(() => {
      const en = document.querySelector('[lang="en"]');
      const words = (en?.textContent ?? '').trim().split(/\s+/).length;
      return { url: location.pathname, lang: document.documentElement.lang, h1: document.querySelector('h1')?.textContent?.trim(), en: words, sections: document.querySelectorAll('main section h2').length, noH: document.documentElement.scrollWidth <= window.innerWidth, app: !!document.querySelector('a[href="./"]') };
    });
    checks.push({ name: 'página de inicio para no técnicos, en español con resumen en inglés', ok: link && info.url.endsWith('acerca.html') && info.lang === 'es' && info.en >= 80 && info.sections >= 5 && info.noH && info.app, detail: `enlace desde la app: ${link}; ${info.url}, lang ${info.lang}, ${info.sections} secciones, resumen en inglés de ${info.en} palabras, sin scroll horizontal a 390 px: ${info.noH}, enlace de vuelta a la app: ${info.app}` });
    await page.addScriptTag({ path: join(ROOT, 'node_modules/axe-core/axe.min.js') });
    const r = (await page.evaluate(() => (window as unknown as { axe: { run: (o: unknown) => Promise<unknown> } }).axe.run({ resultTypes: ['violations'] }))) as { violations: { id: string; impact: string }[] };
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    checks.push({ name: 'axe-core en la página de inicio', ok: bad.length === 0, detail: `infracciones serious/critical: ${bad.length}; todas: ${r.violations.map((v) => `${v.id}(${v.impact})`).join(', ') || 'ninguna'}` });
    // offline: the service worker caches it
    await page.goto(url);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await ctx.setOffline(true);
    let off = false;
    try {
      await page.goto(url + 'acerca.html');
      off = (await page.evaluate(() => document.title)).startsWith('Qué es Silbo');
    } catch {
      off = false;
    }
    checks.push({ name: 'la página de inicio también funciona sin conexión', ok: off, detail: off ? 'servida por el service worker sin red' : 'no carga sin red' });
  } finally {
    await browser.close();
    server.close();
  }
  return checks;
}
