import { fitChecksum } from "../src/checksum.ts";

const baseTypes = {
  enum: { id: 0x00, width: 1 },
  sint8: { id: 0x01, width: 1 },
  uint8: { id: 0x02, width: 1 },
  sint16: { id: 0x83, width: 2 },
  uint16: { id: 0x84, width: 2 },
  sint32: { id: 0x85, width: 4 },
  uint32: { id: 0x86, width: 4 },
  string: { id: 0x07, width: 1 },
  float32: { id: 0x88, width: 4 },
  uint8z: { id: 0x0a, width: 1 },
  uint32z: { id: 0x8c, width: 4 },
  byte: { id: 0x0d, width: 1 },
  uint64: { id: 0x8f, width: 8 },
} as const;

export type BaseTypeName = keyof typeof baseTypes;

export interface FieldSpec {
  readonly number: number;
  readonly type: BaseTypeName;
  readonly size?: number;
}

export interface DeveloperFieldSpec {
  readonly number: number;
  readonly size: number;
  readonly index: number;
}

type Value = number | string | null | readonly (number | null)[];

interface Definition {
  readonly fields: readonly FieldSpec[];
  readonly developerFields: readonly DeveloperFieldSpec[];
  readonly littleEndian: boolean;
}

const invalid: Record<BaseTypeName, bigint> = {
  enum: 0xffn,
  sint8: 0x7fn,
  uint8: 0xffn,
  sint16: 0x7fffn,
  uint16: 0xffffn,
  sint32: 0x7fffffffn,
  uint32: 0xffffffffn,
  string: 0n,
  float32: 0xffffffffn,
  uint8z: 0n,
  uint32z: 0n,
  byte: 0xffn,
  uint64: 0xffffffffffffffffn,
};

function sizeOf(field: FieldSpec): number {
  return field.size ?? baseTypes[field.type].width;
}

export const fitEpochInUnixSeconds = 631_065_600;

export function fitTime(isoDate: string): number {
  return Date.parse(isoDate) / 1000 - fitEpochInUnixSeconds;
}

export function semicircles(degrees: number): number {
  return Math.round((degrees * 2 ** 31) / 180);
}

export class FitWriter {
  private readonly bytes: number[] = [];
  private readonly definitions = new Map<number, Definition>();

  define(
    local: number,
    global: number,
    fields: readonly FieldSpec[],
    options: { bigEndian?: boolean; developerFields?: readonly DeveloperFieldSpec[] } = {},
  ): this {
    const developerFields = options.developerFields ?? [];
    const littleEndian = !options.bigEndian;
    this.bytes.push(0x40 | (developerFields.length > 0 ? 0x20 : 0) | local, 0);
    this.bytes.push(littleEndian ? 0 : 1);
    this.bytes.push(...this.integer(BigInt(global), 2, littleEndian));
    this.bytes.push(fields.length);
    for (const field of fields) {
      this.bytes.push(field.number, sizeOf(field), baseTypes[field.type].id);
    }
    if (developerFields.length > 0) {
      this.bytes.push(developerFields.length);
      for (const field of developerFields) this.bytes.push(field.number, field.size, field.index);
    }
    this.definitions.set(local, { fields, developerFields, littleEndian });
    return this;
  }

  data(local: number, values: readonly Value[], developerValues: readonly number[] = []): this {
    this.bytes.push(local);
    this.payload(local, values, developerValues);
    return this;
  }

  compressed(local: number, timeOffset: number, values: readonly Value[]): this {
    this.bytes.push(0x80 | (local << 5) | (timeOffset & 0x1f));
    this.payload(local, values, []);
    return this;
  }

  raw(...bytes: number[]): this {
    this.bytes.push(...bytes);
    return this;
  }

  file({ headerSize = 14 }: { headerSize?: 12 | 14 } = {}): Uint8Array {
    const header = [headerSize, 0x20, ...this.integer(2140n, 2, true)];
    header.push(...this.integer(BigInt(this.bytes.length), 4, true), 0x2e, 0x46, 0x49, 0x54);
    if (headerSize === 14) {
      const headerChecksum = fitChecksum(new Uint8Array(header));
      header.push(...this.integer(BigInt(headerChecksum), 2, true));
    }
    const body = new Uint8Array([...header, ...this.bytes]);
    const checksum = fitChecksum(body);
    return new Uint8Array([...body, checksum & 0xff, checksum >> 8]);
  }

  private payload(local: number, values: readonly Value[], developerValues: readonly number[]) {
    const definition = this.definitions.get(local);
    if (!definition) throw new Error(`No definition for local message ${local}`);
    definition.fields.forEach((field, index) => {
      this.bytes.push(...this.encode(field, values[index] ?? null, definition.littleEndian));
    });
    definition.developerFields.forEach((field, index) => {
      this.bytes.push(
        ...this.integer(BigInt(developerValues[index] ?? 0), field.size, definition.littleEndian),
      );
    });
  }

  private encode(field: FieldSpec, value: Value, littleEndian: boolean): number[] {
    const size = sizeOf(field);
    if (field.type === "string") {
      const encoded = [...new TextEncoder().encode(typeof value === "string" ? value : "")];
      return Array.from({ length: size }, (_, index) => encoded[index] ?? 0);
    }
    const width = baseTypes[field.type].width;
    const elements = Array.isArray(value) ? value : [value];
    return elements.flatMap((element) => {
      if (element === null) return this.integer(invalid[field.type], width, littleEndian);
      if (field.type === "float32") {
        const view = new DataView(new ArrayBuffer(4));
        view.setFloat32(0, element as number, littleEndian);
        return [...new Uint8Array(view.buffer)];
      }
      const bits = BigInt(width * 8);
      const raw = BigInt(element as number);
      return this.integer(raw < 0n ? (1n << bits) + raw : raw, width, littleEndian);
    });
  }

  private integer(value: bigint, width: number, littleEndian: boolean): number[] {
    const bytes: number[] = [];
    for (let index = 0; index < width; index++) {
      bytes.push(Number((value >> BigInt(index * 8)) & 0xffn));
    }
    return littleEndian ? bytes : bytes.reverse();
  }
}
