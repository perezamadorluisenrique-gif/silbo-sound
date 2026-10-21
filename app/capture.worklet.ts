// AudioWorklet that forwards microphone samples to the page in 4096-sample blocks. It runs on
// the audio thread, so a busy page (drawing, decoding results) can't make the capture skip:
// with the old ScriptProcessorNode the browser inserted 10 ms gaps under load, which broke
// long OFDM frames.
declare const registerProcessor: (name: string, ctor: unknown) => void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class Capture extends AudioWorkletProcessor {
  private buf = new Float32Array(4096);
  private n = 0;
  process(inputs: Float32Array[][]): boolean {
    const x = inputs[0]?.[0];
    if (x) {
      for (let i = 0; i < x.length; i++) {
        this.buf[this.n++] = x[i]!;
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(4096);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('silbo-capture', Capture);
