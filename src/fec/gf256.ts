// Arithmetic in GF(2^8) with primitive polynomial x^8+x^4+x^3+x^2+1 (0x11d), generator 2.
export const EXP = new Uint8Array(512);
export const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

export function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}
export function div(a: number, b: number): number {
  if (b === 0) throw new Error('GF division by zero');
  if (a === 0) return 0;
  return EXP[(LOG[a]! + 255 - LOG[b]!) % 255]!;
}
export function inv(a: number): number {
  return div(1, a);
}
/** alpha^e for any integer e. */
export function pow2(e: number): number {
  return EXP[((e % 255) + 255) % 255]!;
}
/** Evaluate little-endian polynomial p (p[i] is the coefficient of x^i) at x. */
export function evalLE(p: ArrayLike<number>, x: number): number {
  let y = 0;
  for (let i = p.length - 1; i >= 0; i--) y = mul(y, x) ^ p[i]!;
  return y;
}
/** Multiply two little-endian polynomials. */
export function polyMul(a: ArrayLike<number>, b: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) out[i + j]! ^= mul(a[i]!, b[j]!);
  }
  return out;
}
