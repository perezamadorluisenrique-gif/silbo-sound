// Worker thread: loads the codec once, then runs tasks posted by run.ts.
import { parentPort, workerData } from 'node:worker_threads';
import { loadCodec, runTask, type Task } from './trial.ts';

const codec = await loadCodec(workerData.codecRoot as string);
parentPort!.on('message', (t: Task & { tid: number }) => {
  try {
    parentPort!.postMessage({ tid: t.tid, records: runTask(codec, t) });
  } catch (e) {
    parentPort!.postMessage({ tid: t.tid, error: String((e as Error)?.stack ?? e) });
  }
});
parentPort!.postMessage({ ready: true });
