// Builds the Silbo PWA into dist/ (regenerable, not committed): bundles app/main.ts and
// app/worker.ts with esbuild, copies the static files, renders PNG icons with Chromium and
// writes the service worker with the list of files and a content hash as cache version.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const app = join(root, 'app');
const out = join(root, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out);

await build({
  entryPoints: { app: join(app, 'main.ts'), worker: join(app, 'worker.ts'), capture: join(app, 'capture.worklet.ts') },
  outdir: out,
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['chrome90', 'safari15', 'firefox90'],
  logLevel: 'warning',
});
for (const f of ['index.html', 'acerca.html', 'app.css', 'manifest.webmanifest', 'icon.svg']) cpSync(join(app, f), join(out, f));

// PNG icons (Android install prompt wants PNGs); cached in app/ so builds work without a browser.
for (const s of [192, 512]) {
  const png = join(app, `icon-${s}.png`);
  if (!existsSync(png)) {
    const { chromium } = await import('playwright-core');
    const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
    const p = await b.newPage({ viewport: { width: s, height: s } });
    await p.setContent(`<html><body style="margin:0">${readFileSync(join(app, 'icon.svg'), 'utf8').replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
    writeFileSync(png, await p.screenshot({ omitBackground: true }));
    await b.close();
  }
  cpSync(png, join(out, `icon-${s}.png`));
}

const files = readdirSync(out).sort();
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(join(out, f)));
const version = 'silbo-' + hash.digest('hex').slice(0, 12);
const list = JSON.stringify(['./', ...files.filter((f) => f !== 'sw.js')]);
writeFileSync(join(out, 'sw.js'), readFileSync(join(app, 'sw.template.js'), 'utf8').replace('__VERSION__', version).replace('__FILES__', list));
console.log(`dist/ listo (${files.length + 1} ficheros, caché ${version})`);
