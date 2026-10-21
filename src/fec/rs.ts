// Reed-Solomon over GF(256), systematic, roots alpha^0..alpha^(nsym-1).
// Decoder: syndromes, Berlekamp-Massey with erasures (Blahut), Chien search, Forney.
// Written from the algebra (Blahut, "Algebraic Codes for Data Transmission"); no code copied.
import { EXP, LOG, mul, div, pow2, evalLE, polyMul } from './gf256.ts';

const genCache = new Map<number, Uint8Array>();

/** Generator polynomial, big-endian (g[0] = 1 is the x^nsym coefficient). */
function generator(nsym: number): Uint8Array {
  let g = genCache.get(nsym);
  if (g) return g;
  let le: Uint8Array = Uint8Array.of(1);
  for (let i = 0; i < nsym; i++) le = polyMul(le, Uint8Array.of(pow2(i), 1));
  g = Uint8Array.from(le).reverse();
  genCache.set(nsym, g);
  return g;
}

export function rsEncode(msg: Uint8Array, nsym: number): Uint8Array {
  if (msg.length + nsym > 255) throw new Error('RS codeword longer than 255');
  const g = generator(nsym);
  const out = new Uint8Array(msg.length + nsym);
  out.set(msg);
  // long division by g; remainder lands in the parity slots
  const work = new Uint8Array(msg.length + nsym);
  work.set(msg);
  for (let i = 0; i < msg.length; i++) {
    const c = work[i]!;
    if (c === 0) continue;
    for (let j = 1; j < g.length; j++) work[i + j]! ^= mul(g[j]!, c);
  }
  out.set(work.subarray(msg.length), msg.length);
  return out;
}

export interface RsResult {
  ok: boolean;
  data: Uint8Array; // message part (corrected when ok)
  corrected: number;
}

function syndromes(cw: Uint8Array, nsym: number): Uint8Array {
  const n = cw.length;
  const s = new Uint8Array(nsym);
  for (let j = 0; j < nsym; j++) {
    const x = pow2(j);
    let y = 0;
    for (let p = 0; p < n; p++) y = mul(y, x) ^ cw[p]!; // Horner, big-endian positions
    s[j] = y;
  }
  return s;
}

/**
 * Decode a codeword (message followed by nsym parity bytes).
 * erasures: positions (array indices) known to be unreliable.
 */
export function rsDecode(received: Uint8Array, nsym: number, erasures: number[] = []): RsResult {
  const n = received.length;
  const k = n - nsym;
  const cw = Uint8Array.from(received);
  const S = syndromes(cw, nsym);
  if (S.every((v) => v === 0)) return { ok: true, data: cw.slice(0, k), corrected: 0 };
  const eras = [...new Set(erasures)].filter((p) => p >= 0 && p < n);
  const f = eras.length;
  if (f > nsym) return { ok: false, data: cw.slice(0, k), corrected: 0 };
  // erasure locator Gamma(x) = prod (1 - X x), X = alpha^(n-1-pos)
  let gamma: Uint8Array = Uint8Array.of(1);
  for (const p of eras) gamma = polyMul(gamma, Uint8Array.of(1, pow2(n - 1 - p)));
  // Berlekamp-Massey initialised with the erasure locator
  let lambda = new Uint8Array(nsym + 1);
  lambda.set(gamma);
  let B = new Uint8Array(nsym + 1);
  B.set(gamma);
  let L = f;
  for (let r = f + 1; r <= nsym; r++) {
    let delta = 0;
    for (let j = 0; j <= L; j++) {
      const si = r - 1 - j;
      if (si >= 0) delta ^= mul(lambda[j]!, S[si]!);
    }
    // xB
    const xB = new Uint8Array(nsym + 1);
    for (let i = nsym; i > 0; i--) xB[i] = B[i - 1]!;
    if (delta === 0) {
      B = xB;
      continue;
    }
    const T = new Uint8Array(nsym + 1);
    for (let i = 0; i <= nsym; i++) T[i] = lambda[i]! ^ mul(delta, xB[i]!);
    if (2 * L <= r + f - 1) {
      const dinv = div(1, delta);
      for (let i = 0; i <= nsym; i++) B[i] = mul(dinv, lambda[i]!);
      L = r - L + f;
      // note: Blahut: L <- r - L + f  (with erasures folded into the initial L)
    } else {
      B = xB;
    }
    lambda = T;
  }
  let deg = nsym;
  while (deg > 0 && lambda[deg] === 0) deg--;
  if (deg === 0 || 2 * (deg - f) + f > nsym) return { ok: false, data: cw.slice(0, k), corrected: 0 };
  // Chien search
  const positions: number[] = [];
  for (let p = 0; p < n; p++) {
    const Xinv = pow2(-(n - 1 - p));
    if (evalLE(lambda.subarray(0, deg + 1), Xinv) === 0) positions.push(p);
  }
  if (positions.length !== deg) return { ok: false, data: cw.slice(0, k), corrected: 0 };
  // Omega = S(x) * Lambda(x) mod x^nsym
  const omega = polyMul(S, lambda.subarray(0, deg + 1)).subarray(0, nsym);
  // formal derivative of Lambda
  const dl = new Uint8Array(Math.max(1, deg));
  for (let i = 1; i <= deg; i += 2) dl[i - 1] = lambda[i]!;
  for (const p of positions) {
    const X = pow2(n - 1 - p);
    const Xinv = pow2(-(n - 1 - p));
    const den = evalLE(dl, Xinv);
    if (den === 0) return { ok: false, data: cw.slice(0, k), corrected: 0 };
    const mag = mul(X, div(evalLE(omega, Xinv), den));
    cw[p]! ^= mag;
  }
  const S2 = syndromes(cw, nsym);
  if (!S2.every((v) => v === 0)) return { ok: false, data: received.slice(0, k), corrected: 0 };
  return { ok: true, data: cw.slice(0, k), corrected: positions.length };
}

// keep tables referenced for tree-shaking-free builds
export const _tables = { EXP, LOG };
