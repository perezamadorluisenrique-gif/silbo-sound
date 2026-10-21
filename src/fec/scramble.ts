// Additive scrambler: XOR with a PN sequence from a 16-bit Galois LFSR (taps 0xB400).
// Keeps the tone pattern random even for constant data.
export function scramble(data: Uint8Array, seed = 0xace1): Uint8Array {
  const out = new Uint8Array(data.length);
  let s = seed & 0xffff || 1;
  for (let i = 0; i < data.length; i++) {
    let b = 0;
    for (let k = 0; k < 8; k++) {
      const lsb = s & 1;
      s >>>= 1;
      if (lsb) s ^= 0xb400;
      b = (b << 1) | lsb;
    }
    out[i] = data[i]! ^ b;
  }
  return out;
}
