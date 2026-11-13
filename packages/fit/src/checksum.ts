const table = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401,
  0x5000, 0x9c01, 0x8801, 0x4400,
] as const;

function nibble(crc: number, value: number): number {
  const shifted = (crc >> 4) & 0x0fff;
  return shifted ^ table[crc & 0xf]! ^ table[value & 0xf]!;
}

export function fitChecksum(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0;
  for (let index = start; index < end; index++) {
    const byte = bytes[index]!;
    crc = nibble(nibble(crc, byte), byte >> 4);
  }
  return crc;
}
