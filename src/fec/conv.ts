// Rate-1/2 convolutional code, constraint length 7 (generators 171, 133 octal: the classic
// NASA/802.11 pair), zero-terminated, with a soft-decision Viterbi decoder.
// Written from the textbook definition (no code reused).

const K = 7;
const NSTATES = 1 << (K - 1);
const G0 = 0o171;
const G1 = 0o133;

function parity(x: number): number {
  x ^= x >> 4;
  x ^= x >> 2;
  x ^= x >> 1;
  return x & 1;
}

// For state s (last 6 input bits, newest in the MSB) and input bit b: output pair.
const OUT0 = new Uint8Array(NSTATES * 2);
const OUT1 = new Uint8Array(NSTATES * 2);
for (let s = 0; s < NSTATES; s++) {
  for (let b = 0; b < 2; b++) {
    const reg = (b << (K - 1)) | s; // 7 bits: input then the 6 previous inputs
    OUT0[s * 2 + b] = parity(reg & G0);
    OUT1[s * 2 + b] = parity(reg & G1);
  }
}
const next = (s: number, b: number) => ((b << (K - 1)) | s) >> 1;

/** Number of coded bits for n data bits (including the 6 tail bits). */
export function convCodedBits(nbits: number): number {
  return 2 * (nbits + K - 1);
}

/** Encode bytes (MSB first) into coded bits (0/1), zero tail appended. */
export function convEncode(data: Uint8Array): Uint8Array {
  const n = data.length * 8;
  const out = new Uint8Array(convCodedBits(n));
  let s = 0;
  for (let i = 0; i < n + K - 1; i++) {
    const b = i < n ? (data[i >> 3]! >> (7 - (i & 7))) & 1 : 0;
    out[2 * i] = OUT0[s * 2 + b]!;
    out[2 * i + 1] = OUT1[s * 2 + b]!;
    s = next(s, b);
  }
  return out;
}

/**
 * Soft Viterbi. llr[i] > 0 means coded bit i is more likely 0 (magnitude = reliability);
 * 0 means erased/unknown. Returns nbytes decoded bytes.
 */
export function viterbiDecode(llr: ArrayLike<number>, nbytes: number): Uint8Array {
  const n = nbytes * 8 + K - 1;
  const NEG = -1e300;
  let pm = new Float64Array(NSTATES).fill(NEG);
  let nm = new Float64Array(NSTATES);
  pm[0] = 0;
  // survivor: for each step and new state, which predecessor bit (the dropped LSB) was chosen
  const surv = new Uint8Array(n * NSTATES);
  for (let i = 0; i < n; i++) {
    const l0 = llr[2 * i] ?? 0;
    const l1 = llr[2 * i + 1] ?? 0;
    nm.fill(NEG);
    const tail = i >= nbytes * 8;
    for (let s = 0; s < NSTATES; s++) {
      const m = pm[s]!;
      if (m === NEG) continue;
      for (let b = 0; b < (tail ? 1 : 2); b++) {
        // correlation metric: +llr when the expected bit is 0, -llr when 1
        const o0 = OUT0[s * 2 + b]!;
        const o1 = OUT1[s * 2 + b]!;
        const v = m + (o0 ? -l0 : l0) + (o1 ? -l1 : l1);
        const t = next(s, b);
        if (v > nm[t]!) {
          nm[t] = v;
          surv[i * NSTATES + t] = s & 1;
        }
      }
    }
    const tmp = pm;
    pm = nm;
    nm = tmp;
  }
  // trace back from state 0 (zero-terminated)
  const bits = new Uint8Array(n);
  let s = 0;
  for (let i = n - 1; i >= 0; i--) {
    bits[i] = s >> (K - 2); // the newest input bit is the MSB of the state
    const lsb = surv[i * NSTATES + s]!;
    s = ((s << 1) & (NSTATES - 1)) | lsb;
  }
  const out = new Uint8Array(nbytes);
  for (let i = 0; i < nbytes * 8; i++) if (bits[i]) out[i >> 3]! |= 1 << (7 - (i & 7));
  return out;
}
