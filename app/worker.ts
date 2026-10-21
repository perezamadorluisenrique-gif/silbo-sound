// Decoder worker: runs the modem's receiver on each sliding window off the UI thread.
import { decodeWindow } from './core.ts';

const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, t?: Transferable[]): void };

scope.onmessage = (e: MessageEvent<{ id: number; win: Float32Array; skip: number }>) => {
  const t0 = performance.now();
  let payloads: Uint8Array[] = [];
  let lastEnd = -1;
  try {
    ({ payloads, lastEnd } = decodeWindow(e.data.win, e.data.skip));
  } catch (err) {
    console.error(err);
  }
  scope.postMessage({ id: e.data.id, payloads, lastEnd, ms: performance.now() - t0 }, payloads.map((p) => p.buffer as ArrayBuffer));
};
