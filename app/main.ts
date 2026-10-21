// Silbo page: two big buttons (Enviar / Recibir), a spectrogram and a progress bar.
import { FS, WINDOW_S, DECODE_EVERY_S, TEXT_MAX_BYTES, DISCRETO_MAX_BYTES, PACKED, planText, planFile, planFileAuto, unpackFile, estimateSeconds, Receiver, type TxPlan, type RxEvent } from './core.ts';
import { resample } from '../src/sim/channel.ts';

const MAX_FILE = 64 * 1024;
const PHOTO_TARGET = 14 * 1024;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const modeSend = $<HTMLButtonElement>('mode-send');
const modeRecv = $<HTMLButtonElement>('mode-recv');
const sendPanel = $<HTMLElement>('send-panel');
const recvPanel = $<HTMLElement>('recv-panel');
const textEl = $<HTMLTextAreaElement>('text');
const fileEl = $<HTMLInputElement>('file');
const discretoEl = $<HTMLInputElement>('discreto');
const estimateEl = $<HTMLParagraphElement>('estimate');
const playBtn = $<HTMLButtonElement>('play');
const stopSendBtn = $<HTMLButtonElement>('stop-send');
const stopRecvBtn = $<HTMLButtonElement>('stop-recv');
const inbox = $<HTMLUListElement>('inbox');
const canvas = $<HTMLCanvasElement>('spectro');
const progress = $<HTMLProgressElement>('progress');
const progressLabel = $<HTMLLabelElement>('progress-label');
const statusEl = $<HTMLParagraphElement>('status');

// Test and debugging hook (read by the Playwright end-to-end test).
const hook = {
  lastPass: null as Float32Array | null,
  sampleRate: 0,
  windows: 0,
  frames: 0,
  captured: 0, // samples received from the microphone since Recibir
  lastDecodeMs: 0,
  events: [] as { type: string; [k: string]: unknown }[],
  /** Set to [] before Recibir to keep every captured block (debugging). */
  record: null as Float32Array[] | null,
  /** One pass of the last transmission as 16-bit PCM in base64 (at 48 kHz). */
  lastPassPcm16(): string {
    const a = hook.lastPass;
    if (!a) return '';
    const b = new Uint8Array(a.length * 2);
    const v = new DataView(b.buffer);
    for (let i = 0; i < a.length; i++) v.setInt16(i * 2, Math.max(-32767, Math.min(32767, Math.round(a[i]! * 32767))), true);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  },
};
(window as unknown as { __silbo: typeof hook }).__silbo = hook;

function setStatus(s: string) {
  statusEl.textContent = s;
}
function setProgress(v: number, label: string) {
  progress.value = Math.max(0, Math.min(1, v));
  progressLabel.textContent = label;
}

// ---------- audio context and spectrogram ----------
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;

function audio(): AudioContext {
  if (!ctx) {
    try {
      ctx = new AudioContext({ sampleRate: FS, latencyHint: 'playback' });
    } catch {
      ctx = new AudioContext(); // the modem works at 48 kHz; other rates are resampled
    }
    hook.sampleRate = ctx.sampleRate;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    drawLoop();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function drawLoop() {
  const g = canvas.getContext('2d')!;
  const bins = new Uint8Array(analyser!.frequencyBinCount);
  const fMax = 20000; // up to the discreet band (17.4-19.6 kHz)
  const step = () => {
    if (analyser && ctx) {
      analyser.getByteFrequencyData(bins);
      const W = canvas.width;
      const H = canvas.height;
      g.drawImage(canvas, -2, 0);
      const top = Math.min(bins.length, Math.floor((fMax / (ctx.sampleRate / 2)) * bins.length));
      for (let y = 0; y < H; y++) {
        const v = bins[Math.floor(((H - 1 - y) / H) * top)]! / 255;
        // dark teal -> teal -> pale yellow
        const r = Math.round(255 * Math.max(0, v * 1.6 - 0.6));
        const gr = Math.round(40 + 200 * v);
        const b = Math.round(40 + 120 * Math.min(1, v * 1.3) - 60 * Math.max(0, v - 0.7));
        g.fillStyle = `rgb(${r},${gr},${b})`;
        g.fillRect(W - 2, y, 2, 1);
      }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- modes ----------
function showMode(m: 'send' | 'recv') {
  modeSend.setAttribute('aria-pressed', String(m === 'send'));
  modeRecv.setAttribute('aria-pressed', String(m === 'recv'));
  sendPanel.hidden = m !== 'send';
  recvPanel.hidden = m !== 'recv';
}
modeSend.addEventListener('click', () => {
  stopListening();
  showMode('send');
  setProgress(0, 'Progreso del envío');
  setStatus('Escribe un mensaje o elige una foto, y pulsa Sonar.');
  updateEstimate();
});
modeRecv.addEventListener('click', () => {
  stopSending();
  showMode('recv');
  void startListening();
});

// ---------- sending ----------
let source: AudioBufferSourceNode | null = null;
let sendTimer = 0;

/** Some phones give no MIME type for .md or .txt files. */
function guessType(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const t: Record<string, string> = { md: 'text/markdown;charset=utf-8', markdown: 'text/markdown;charset=utf-8', txt: 'text/plain;charset=utf-8', csv: 'text/csv;charset=utf-8', html: 'text/html;charset=utf-8', json: 'application/json' };
  return t[ext] ?? 'application/octet-stream';
}

async function shrinkPhoto(f: File): Promise<{ data: Uint8Array; name: string; type: string }> {
  const raw = new Uint8Array(await f.arrayBuffer());
  if (!f.type.startsWith('image/') || raw.length <= PHOTO_TARGET) return { data: raw, name: f.name, type: f.type || guessType(f.name) };
  const bmp = await createImageBitmap(f);
  let side = 640;
  for (let attempt = 0; attempt < 8; attempt++) {
    const s = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.7, 0.55, 0.4]) {
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= PHOTO_TARGET) return { data: new Uint8Array(await blob.arrayBuffer()), name: f.name.replace(/\.[^.]*$/, '') + '.jpg', type: 'image/jpeg' };
    }
    side = Math.round(side * 0.75);
  }
  return { data: raw, name: f.name, type: f.type };
}

function updateEstimate() {
  const f = fileEl.files?.[0];
  if (f) {
    const n = f.type.startsWith('image/') ? Math.min(f.size, PHOTO_TARGET) : f.size;
    estimateEl.textContent = f.size > MAX_FILE && !f.type.startsWith('image/') ? `Demasiado grande: ${Math.round(f.size / 1024)} KB (máximo 64 KB).` : `Unos ${Math.round(estimateSeconds(n, false))} s de sonido por vuelta.`;
    return;
  }
  const n = new TextEncoder().encode(textEl.value).length;
  if (discretoEl.checked) {
    estimateEl.textContent = n > DISCRETO_MAX_BYTES ? `Demasiado largo para el modo discreto: ${n} bytes (máximo ${DISCRETO_MAX_BYTES}, unos 190 caracteres).` : n ? `Unos ${Math.max(1, Math.round(estimateSeconds(n, true, true)))} s de sonido casi inaudible.` : '';
    return;
  }
  estimateEl.textContent = n ? `Unos ${Math.max(1, Math.round(estimateSeconds(n, true)))} s de sonido${n > TEXT_MAX_BYTES ? ' por vuelta (texto largo: va en trozos, en bucle)' : ''}.` : '';
}
textEl.addEventListener('input', updateEstimate);
fileEl.addEventListener('change', updateEstimate);
discretoEl.addEventListener('change', updateEstimate);

async function buildPlan(): Promise<TxPlan | null> {
  const f = fileEl.files?.[0];
  if (f && discretoEl.checked) {
    setStatus('El modo discreto solo envía texto: quita la foto o el archivo, o quita el modo discreto.');
    return null;
  }
  if (f) {
    const p = await shrinkPhoto(f);
    // texts and documents go compressed: a 28 KB book chapter becomes ~8 KB of sound
    const plan = await planFileAuto(p.data, p.name, p.type);
    const bytes = plan.frames.reduce((a, fr) => a + fr.length, 0);
    if (bytes > MAX_FILE + 2048) {
      setStatus('El archivo pasa de 64 KB (ya comprimido): tardaría demasiado en sonar.');
      return null;
    }
    return plan;
  }
  if (!textEl.value.trim()) {
    setStatus('Escribe un mensaje o elige una foto primero.');
    return null;
  }
  if (discretoEl.checked) {
    if (new TextEncoder().encode(textEl.value).length > DISCRETO_MAX_BYTES) {
      setStatus(`El modo discreto solo lleva textos cortos (unos 190 caracteres). Acórtalo o quita el modo discreto.`);
      return null;
    }
    return planText(textEl.value, true);
  }
  return planText(textEl.value);
}

playBtn.addEventListener('click', async () => {
  const ac = audio(); // inside the click: unlocks audio on phones
  stopSending();
  playBtn.disabled = true;
  setStatus('Preparando el sonido…');
  await new Promise((r) => setTimeout(r, 20));
  const plan = await buildPlan();
  if (!plan) {
    playBtn.disabled = false;
    return;
  }
  hook.lastPass = plan.audio;
  const pcm = ac.sampleRate === FS ? plan.audio : resample(plan.audio, ac.sampleRate / FS);
  const buf = ac.createBuffer(1, pcm.length, ac.sampleRate);
  buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.loop = plan.loop;
  const gain = ac.createGain();
  gain.gain.value = 0.9;
  src.connect(gain);
  gain.connect(ac.destination);
  gain.connect(analyser!);
  const t0 = ac.currentTime;
  const dur = buf.duration;
  src.start();
  source = src;
  stopSendBtn.disabled = false;
  const what = plan.kind === 'text' ? (discretoEl.checked ? 'el mensaje en modo discreto (casi inaudible)' : 'el mensaje') : `${plan.frames.length - 1} trozos`;
  setStatus(plan.loop ? `Sonando ${what} en bucle. Pulsa Parar cuando el otro móvil lo tenga.` : `Sonando ${what}…`);
  src.onended = () => {
    if (source !== src) return;
    finishSend(plan.loop ? 'Parado.' : 'Enviado. Si no llegó, acércalos y pulsa Sonar otra vez.');
  };
  const tick = () => {
    const t = ac.currentTime - t0;
    const pass = Math.floor(t / dur) + 1;
    const frac = (t % dur) / dur;
    setProgress(plan.loop ? frac : Math.min(1, t / dur), plan.loop ? `Vuelta ${pass}: ${Math.round(frac * 100)} %` : `Enviando: ${Math.round(Math.min(1, t / dur) * 100)} %`);
  };
  sendTimer = window.setInterval(tick, 200);
});

function finishSend(msg: string) {
  clearInterval(sendTimer);
  source = null;
  playBtn.disabled = false;
  stopSendBtn.disabled = true;
  setStatus(msg);
}
function stopSending() {
  if (source) {
    const s = source;
    source = null;
    try {
      s.stop();
    } catch {
      /* already stopped */
    }
    finishSend('Parado.');
  }
}
stopSendBtn.addEventListener('click', stopSending);

// ---------- receiving ----------
let stream: MediaStream | null = null;
let capNode: AudioNode | null = null;
let ring = new Float32Array(0);
let written = 0; // samples written since start (ring index = written % ring.length)
let decodeTimer = 0;
let worker: Worker | null = null;
let busy = false;
let rx = new Receiver();
let listenT0 = 0;
let winStart = 0; // absolute capture sample where the window being decoded starts
let decodedUntil = 0; // absolute capture sample where the last decoded frame ended
const progressItems = new Map<number, HTMLLIElement>();

async function startListening() {
  const ac = audio();
  if (stream) return;
  setStatus('Pidiendo el micrófono…');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  } catch {
    setStatus('Sin permiso para el micrófono: no se puede escuchar.');
    return;
  }
  listenT0 = performance.now();
  ring = new Float32Array(Math.round(WINDOW_S * ac.sampleRate));
  written = 0;
  decodedUntil = 0;
  const mic = ac.createMediaStreamSource(stream);
  mic.connect(analyser!);
  const onBlock = (x: Float32Array) => {
    for (let i = 0; i < x.length; i++) ring[(written + i) % ring.length] = x[i]!;
    written += x.length;
    hook.captured = written;
    hook.record?.push(x.slice());
  };
  const mute = ac.createGain();
  mute.gain.value = 0;
  try {
    // audio thread: no gaps when the page is busy
    await ac.audioWorklet.addModule('capture.js');
    const node = new AudioWorkletNode(ac, 'silbo-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    node.port.onmessage = (e: MessageEvent<Float32Array>) => onBlock(e.data);
    capNode = node;
  } catch {
    // old browsers without AudioWorklet
    const sp = ac.createScriptProcessor(4096, 1, 1);
    sp.onaudioprocess = (e) => onBlock(e.inputBuffer.getChannelData(0));
    capNode = sp;
  }
  mic.connect(capNode);
  capNode.connect(mute);
  mute.connect(ac.destination);
  worker ??= new Worker('worker.js');
  worker.onmessage = (e: MessageEvent<{ payloads: Uint8Array[]; lastEnd: number; ms: number }>) => {
    busy = false;
    hook.lastDecodeMs = e.data.ms;
    // remember (in absolute capture samples) where the last decoded frame ended
    if (e.data.lastEnd >= 0 && ctx) decodedUntil = Math.max(decodedUntil, winStart + Math.round((e.data.lastEnd * ctx.sampleRate) / FS));
    for (const p of e.data.payloads) for (const ev of rx.feed(new Uint8Array(p))) show(ev);
    hook.frames = rx.frames;
  };
  decodeTimer = window.setInterval(decodeTick, DECODE_EVERY_S * 1000);
  stopRecvBtn.disabled = false;
  setProgress(0, 'Esperando un archivo');
  setStatus('Escuchando… acerca el otro móvil.');
}

function decodeTick() {
  if (busy || !worker || !ctx || written < ctx.sampleRate) return;
  const n = Math.min(written, ring.length);
  const win = new Float32Array(n);
  const start = written - n;
  for (let i = 0; i < n; i++) win[i] = ring[(start + i) % ring.length]!;
  const w48 = ctx.sampleRate === FS ? win : resample(win, FS / ctx.sampleRate);
  busy = true;
  hook.windows++;
  winStart = start;
  const skip = decodedUntil > start ? Math.round(((decodedUntil - start) * FS) / ctx.sampleRate) : -1;
  worker.postMessage({ id: hook.windows, win: w48, skip }, [w48.buffer]);
}

function stopListening() {
  clearInterval(decodeTimer);
  capNode?.disconnect();
  capNode = null;
  stream?.getTracks().forEach((t) => t.stop());
  if (stream) setStatus('Ya no escucho.');
  stream = null;
  stopRecvBtn.disabled = true;
}
stopRecvBtn.addEventListener('click', stopListening);

function show(ev: RxEvent) {
  if (ev.type === 'file' && ev.mime.endsWith(PACKED)) {
    // compressed on the way (texts, documents): inflate, then show as usual
    void unpackFile(ev.data, ev.mime)
      .then((u) => show({ ...ev, data: u.data, mime: u.mime }))
      .catch(() => show({ ...ev, mime: 'application/octet-stream' }));
    return;
  }
  const at = Math.round(performance.now() - listenT0) / 1000;
  hook.events.push(ev.type === 'file' ? { type: 'file', name: ev.name, mime: ev.mime, size: ev.data.length, at } : { ...ev, at });
  if (ev.type === 'text') {
    const li = document.createElement('li');
    const p = document.createElement('p');
    p.className = 'received-text';
    p.textContent = ev.text;
    li.append(p);
    inbox.prepend(li);
    setStatus('Mensaje recibido.');
    return;
  }
  if (ev.type === 'progress') {
    let li = progressItems.get(ev.fileId);
    if (!li) {
      li = document.createElement('li');
      progressItems.set(ev.fileId, li);
      inbox.prepend(li);
    }
    if (!li.dataset.done) li.textContent = `Recibiendo ${ev.name ?? 'archivo'}: ${ev.have} de ${ev.count} trozos…`;
    setProgress(ev.have / ev.count, `${ev.name ?? 'Archivo'}: ${ev.have} de ${ev.count} trozos`);
    setStatus(`Recibiendo ${ev.name ?? 'un archivo'}…`);
    return;
  }
  const li = progressItems.get(ev.fileId) ?? document.createElement('li');
  if (!li.isConnected) inbox.prepend(li);
  li.dataset.done = '1';
  li.textContent = '';
  const blob = new Blob([ev.data as Uint8Array<ArrayBuffer>], { type: ev.mime });
  const url = URL.createObjectURL(blob);
  if (ev.mime.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Foto recibida: ${ev.name}`;
    li.append(img);
  } else if (ev.mime.startsWith('text/plain')) {
    const p = document.createElement('p');
    p.className = 'received-text';
    p.textContent = new TextDecoder().decode(ev.data);
    li.append(p);
  } else if (ev.mime.startsWith('text/')) {
    // a document (e.g. a book chapter): a preview, the whole thing is in the download link
    const text = new TextDecoder().decode(ev.data);
    const words = text.split(/\s+/).filter(Boolean).length;
    const h = document.createElement('p');
    h.className = 'received-doc-title';
    h.textContent = `${ev.name}: ${words.toLocaleString('es')} palabras`;
    const pre = document.createElement('p');
    pre.className = 'received-doc';
    pre.textContent = text.length > 600 ? text.slice(0, 600) + '…' : text;
    li.append(h, pre);
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = ev.name;
  a.textContent = `Guardar ${ev.name} (${(ev.data.length / 1024).toFixed(1)} KB)`;
  li.append(a);
  setProgress(1, `${ev.name}: completo`);
  setStatus(`${ev.name} recibido completo.`);
}

// ---------- offline ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// keep a fresh receiver per page load; exposed for tests that reset between runs
(window as unknown as { __silboReset: () => void }).__silboReset = () => {
  rx = new Receiver();
  progressItems.clear();
  inbox.textContent = '';
};
