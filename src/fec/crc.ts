// CRC-32 (IEEE 802.3, reflected 0xEDB88320) and CRC-8 (poly 0x07).
const T32 = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  T32[i] = c >>> 0;
}
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = T32[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function crc8(data: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  return c;
}
