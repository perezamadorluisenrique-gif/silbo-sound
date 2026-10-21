// Debug: what does the receiver page actually capture from a fake-microphone WAV?
// node tests/e2e/capture-debug.ts <wav> <seconds> <out.wav>   (needs dist/ built)
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = join(ROOT, 'dist');
const [wav, secs, outWav] = process.argv.slice(2);
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = (req.url ?? '/').split('?')[0]!;
  if (p.endsWith('/')) p += 'index.html';
  const f = join(DIST, p);
  if (!existsSync(f)) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const url = `http://localhost:${(server.address() as { port: number }).port}/`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ permissions: ['microphone'], viewport: { width: 390, height: 844 } })).newPage();
await page.goto(url);
await page.evaluate(() => ((window as any).__silbo.record = []));
await page.click('#mode-recv');
await page.waitForTimeout(Number(secs) * 1000);
const b64 = await page.evaluate(() => {
  const r = (window as any).__silbo.record as Float32Array[];
  const n = r.reduce((a, x) => a + x.length, 0);
  const out = new Int16Array(n);
  let o = 0;
  for (const x of r) for (let i = 0; i < x.length; i++) out[o++] = Math.max(-32767, Math.min(32767, Math.round(x[i]! * 32767)));
  let s = '';
  const u = new Uint8Array(out.buffer);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
});
const ev = await page.evaluate(() => (window as any).__silbo.events.map((e: any) => `${e.at}s ${e.type}${e.have ?? ''}`).join(' | '));
console.log('events:', ev);
const pcm = Buffer.from(b64, 'base64');
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(48000, 24); h.writeUInt32LE(96000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
writeFileSync(outWav!, Buffer.concat([h, pcm]));
console.log('captured', (pcm.length / 2 / 48000).toFixed(2), 's');
await browser.close();
server.close();
