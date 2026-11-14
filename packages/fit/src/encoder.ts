import { fitChecksum } from "./checksum.ts";

export const fitProfileVersion = 2140;
const fitProtocolVersion = 0x20;
const headerSize = 14;
export const longestStringBytes = 255;

const baseTypes = {
  enum: { id: 0x00, width: 1, max: 0xfe, min: 0 },
  uint8: { id: 0x02, width: 1, max: 0xfe, min: 0 },
  uint16: { id: 0x84, width: 2, max: 0xfffe, min: 0 },
  uint32: { id: 0x86, width: 4, max: 0xfffffffe, min: 0 },
  uint32z: { id: 0x8c, width: 4, max: 0xffffffff, min: 1 },
} as const;

export type IntegerType = keyof typeof baseTypes;

export type EncodedField =
  | { readonly number: number; readonly type: IntegerType; readonly value: number }
  | { readonly number: number; readonly type: "string"; readonly value: string };

const stringBaseType = 0x07;
const utf8 = new TextEncoder();

export function fitString(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of text) {
    const encoded = utf8.encode(character);
    if (bytes.length + encoded.length + 1 > longestStringBytes) break;
    bytes.push(...encoded);
  }
  bytes.push(0);
  return new Uint8Array(bytes);
}

function encodedValue(field: EncodedField): Uint8Array {
  if (field.type === "string") return fitString(field.value);
  const { width, max, min } = baseTypes[field.type];
  if (!Number.isInteger(field.value) || field.value < min || field.value > max) {
    throw new RangeError(`FIT field ${field.number} cannot hold ${field.value} as ${field.type}`);
  }
  const bytes = new Uint8Array(width);
  let remaining = field.value;
  for (let index = 0; index < width; index++) {
    bytes[index] = remaining % 0x100;
    remaining = Math.floor(remaining / 0x100);
  }
  return bytes;
}

const localTypes = 16;

export class FitEncoder {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;
  private readonly layouts = new Map<string, number>();
  private readonly localLayouts: (string | undefined)[] = [];
  private nextLocal = 0;

  message(globalNumber: number, fields: readonly EncodedField[]): this {
    const values = fields.map(encodedValue);
    const layout = [
      globalNumber,
      ...fields.map((field, index) => `${field.number}:${field.type}:${values[index]!.length}`),
    ].join(",");
    let local = this.layouts.get(layout);
    if (local === undefined) {
      local = this.nextLocal;
      this.nextLocal = (this.nextLocal + 1) % localTypes;
      const replaced = this.localLayouts[local];
      if (replaced !== undefined) this.layouts.delete(replaced);
      this.layouts.set(layout, local);
      this.localLayouts[local] = layout;
      this.definition(local, globalNumber, fields, values);
    }
    this.push(new Uint8Array([local]));
    for (const value of values) this.push(value);
    return this;
  }

  file(): Uint8Array {
    const header = new Uint8Array(headerSize);
    const headerView = new DataView(header.buffer);
    header[0] = headerSize;
    header[1] = fitProtocolVersion;
    headerView.setUint16(2, fitProfileVersion, true);
    headerView.setUint32(4, this.length, true);
    header.set([0x2e, 0x46, 0x49, 0x54], 8);
    headerView.setUint16(12, fitChecksum(header, 0, 12), true);
    const bytes = new Uint8Array(headerSize + this.length + 2);
    bytes.set(header);
    let position = headerSize;
    for (const chunk of this.chunks) {
      bytes.set(chunk, position);
      position += chunk.length;
    }
    new DataView(bytes.buffer).setUint16(position, fitChecksum(bytes, 0, position), true);
    return bytes;
  }

  private definition(
    local: number,
    globalNumber: number,
    fields: readonly EncodedField[],
    values: readonly Uint8Array[],
  ): void {
    const definition = new Uint8Array(6 + fields.length * 3);
    definition[0] = 0x40 | local;
    definition[2] = 0;
    new DataView(definition.buffer).setUint16(3, globalNumber, true);
    definition[5] = fields.length;
    fields.forEach((field, index) => {
      const offset = 6 + index * 3;
      definition[offset] = field.number;
      definition[offset + 1] = values[index]!.length;
      definition[offset + 2] = field.type === "string" ? stringBaseType : baseTypes[field.type].id;
    });
    this.push(definition);
  }

  private push(chunk: Uint8Array): void {
    this.chunks.push(chunk);
    this.length += chunk.length;
  }
}
