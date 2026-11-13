import { fitChecksum } from "./checksum.ts";
import { FitDecodeError } from "./error.ts";

export type FitValue = number | string | readonly (number | null)[] | Uint8Array;

export interface FitMessage {
  readonly globalNumber: number;
  readonly fields: ReadonlyMap<number, FitValue>;
  readonly developerFields: ReadonlyMap<string, FitValue>;
}

interface FieldDefinition {
  readonly number: number;
  readonly size: number;
  readonly baseType: number;
}

interface DeveloperFieldDefinition {
  readonly key: string;
  readonly size: number;
}

interface Definition {
  readonly globalNumber: number;
  readonly littleEndian: boolean;
  readonly fields: readonly FieldDefinition[];
  readonly developerFields: readonly DeveloperFieldDefinition[];
}

interface DeveloperFieldDescription {
  readonly name: string;
  readonly baseType: number;
  readonly scale: number | undefined;
  readonly offset: number | undefined;
}

const fitSignature = [0x2e, 0x46, 0x49, 0x54];
const timestampField = 253;
const fieldDescriptionMessage = 206;

const FieldDescription = {
  developerDataIndex: 0,
  fieldNumber: 1,
  baseType: 2,
  name: 3,
  scale: 6,
  offset: 7,
} as const;

const BaseType = {
  enum: 0,
  sint8: 1,
  uint8: 2,
  sint16: 3,
  uint16: 4,
  sint32: 5,
  uint32: 6,
  string: 7,
  float32: 8,
  float64: 9,
  uint8z: 10,
  uint16z: 11,
  uint32z: 12,
  byte: 13,
  sint64: 14,
  uint64: 15,
  uint64z: 16,
} as const;

const widths: Record<number, number> = {
  [BaseType.enum]: 1,
  [BaseType.sint8]: 1,
  [BaseType.uint8]: 1,
  [BaseType.sint16]: 2,
  [BaseType.uint16]: 2,
  [BaseType.sint32]: 4,
  [BaseType.uint32]: 4,
  [BaseType.string]: 1,
  [BaseType.float32]: 4,
  [BaseType.float64]: 8,
  [BaseType.uint8z]: 1,
  [BaseType.uint16z]: 2,
  [BaseType.uint32z]: 4,
  [BaseType.byte]: 1,
  [BaseType.sint64]: 8,
  [BaseType.uint64]: 8,
  [BaseType.uint64z]: 8,
};

const utf8 = new TextDecoder("utf-8");

function isByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xff;
}

function developerKey(developerDataIndex: number, fieldNumber: number): string {
  return `${developerDataIndex}:${fieldNumber}`;
}

function readElement(
  view: DataView,
  position: number,
  baseType: number,
  littleEndian: boolean,
): number | null {
  switch (baseType) {
    case BaseType.enum:
    case BaseType.uint8:
    case BaseType.byte: {
      const value = view.getUint8(position);
      return value === 0xff ? null : value;
    }
    case BaseType.sint8: {
      const value = view.getInt8(position);
      return value === 0x7f ? null : value;
    }
    case BaseType.uint8z: {
      const value = view.getUint8(position);
      return value === 0 ? null : value;
    }
    case BaseType.sint16: {
      const value = view.getInt16(position, littleEndian);
      return value === 0x7fff ? null : value;
    }
    case BaseType.uint16: {
      const value = view.getUint16(position, littleEndian);
      return value === 0xffff ? null : value;
    }
    case BaseType.uint16z: {
      const value = view.getUint16(position, littleEndian);
      return value === 0 ? null : value;
    }
    case BaseType.sint32: {
      const value = view.getInt32(position, littleEndian);
      return value === 0x7fffffff ? null : value;
    }
    case BaseType.uint32: {
      const value = view.getUint32(position, littleEndian);
      return value === 0xffffffff ? null : value;
    }
    case BaseType.uint32z: {
      const value = view.getUint32(position, littleEndian);
      return value === 0 ? null : value;
    }
    case BaseType.float32: {
      if (view.getUint32(position, littleEndian) === 0xffffffff) return null;
      return view.getFloat32(position, littleEndian);
    }
    case BaseType.float64: {
      if (view.getBigUint64(position, littleEndian) === 0xffffffffffffffffn) return null;
      return view.getFloat64(position, littleEndian);
    }
    case BaseType.sint64: {
      const value = view.getBigInt64(position, littleEndian);
      return value === 0x7fffffffffffffffn ? null : Number(value);
    }
    case BaseType.uint64: {
      const value = view.getBigUint64(position, littleEndian);
      return value === 0xffffffffffffffffn ? null : Number(value);
    }
    case BaseType.uint64z: {
      const value = view.getBigUint64(position, littleEndian);
      return value === 0n ? null : Number(value);
    }
    default:
      return null;
  }
}

function readValue(
  bytes: Uint8Array,
  view: DataView,
  position: number,
  size: number,
  baseType: number,
  littleEndian: boolean,
): FitValue | undefined {
  if (baseType === BaseType.string) {
    const raw = bytes.subarray(position, position + size);
    const terminator = raw.indexOf(0);
    const text = raw.subarray(0, terminator === -1 ? raw.length : terminator);
    return text.length === 0 ? undefined : utf8.decode(text);
  }
  if (baseType === BaseType.byte && size > 1) {
    const raw = bytes.slice(position, position + size);
    return raw.every((byte) => byte === 0xff) ? undefined : raw;
  }
  const width = widths[baseType];
  if (width === undefined || size === 0 || size % width !== 0) return undefined;
  if (size === width) return readElement(view, position, baseType, littleEndian) ?? undefined;
  const elements: (number | null)[] = [];
  for (let offset = 0; offset < size; offset += width) {
    elements.push(readElement(view, position + offset, baseType, littleEndian));
  }
  return elements.every((element) => element === null) ? undefined : elements;
}

function scaled(value: FitValue, scale: number | undefined, offset: number | undefined): FitValue {
  const apply = (element: number) => element / (scale || 1) - (offset ?? 0);
  if (typeof value === "number") return apply(value);
  if (Array.isArray(value))
    return value.map((element) => (element === null ? null : apply(element)));
  return value;
}

class Reader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private position: number;
  private readonly end: number;
  private readonly definitions = new Map<number, Definition>();
  private readonly descriptions: Map<string, DeveloperFieldDescription>;
  private lastTimestamp = 0;

  constructor(
    bytes: Uint8Array,
    start: number,
    end: number,
    descriptions: Map<string, DeveloperFieldDescription>,
  ) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.position = start;
    this.end = end;
    this.descriptions = descriptions;
  }

  read(visit: (message: FitMessage) => void): void {
    while (this.position < this.end) {
      const header = this.byte();
      const compressed = (header & 0x80) !== 0;
      if (!compressed && header & 0x40) {
        this.definitions.set(header & 0x0f, this.definition((header & 0x20) !== 0));
        continue;
      }
      const message = this.message(
        this.definitionFor(compressed ? (header >> 5) & 0x03 : header & 0x0f),
      );
      const carriesData = message.fields.size > 0 || message.developerFields.size > 0;
      if (compressed) {
        this.advanceClock(header & 0x1f);
        message.fields.set(timestampField, this.lastTimestamp);
      } else {
        const timestamp = message.fields.get(timestampField);
        if (typeof timestamp === "number") this.lastTimestamp = timestamp;
      }
      if (carriesData) visit(message);
    }
  }

  private definitionFor(localType: number): Definition {
    const definition = this.definitions.get(localType);
    if (!definition) throw new FitDecodeError("malformed");
    return definition;
  }

  private advanceClock(offset: number): void {
    let timestamp = (this.lastTimestamp & ~0x1f) + offset;
    if (offset < (this.lastTimestamp & 0x1f)) timestamp += 0x20;
    this.lastTimestamp = timestamp >>> 0;
  }

  private definition(hasDeveloperFields: boolean): Definition {
    this.byte();
    const littleEndian = this.byte() === 0;
    this.require(2);
    const globalNumber = this.view.getUint16(this.position, littleEndian);
    this.position += 2;
    const fieldCount = this.byte();
    const fields: FieldDefinition[] = [];
    for (let index = 0; index < fieldCount; index++) {
      const field = { number: this.byte(), size: this.byte(), baseType: this.byte() & 0x1f };
      if (field.size > 0) fields.push(field);
    }
    const developerFields: DeveloperFieldDefinition[] = [];
    if (hasDeveloperFields) {
      const developerFieldCount = this.byte();
      for (let index = 0; index < developerFieldCount; index++) {
        const fieldNumber = this.byte();
        const size = this.byte();
        const key = developerKey(this.byte(), fieldNumber);
        if (size > 0) developerFields.push({ key, size });
      }
    }
    return { globalNumber, littleEndian, fields, developerFields };
  }

  private message(definition: Definition): FitMessage & { fields: Map<number, FitValue> } {
    const fields = new Map<number, FitValue>();
    for (const field of definition.fields) {
      this.require(field.size);
      const value = readValue(
        this.bytes,
        this.view,
        this.position,
        field.size,
        field.baseType,
        definition.littleEndian,
      );
      if (value !== undefined) fields.set(field.number, value);
      this.position += field.size;
    }
    const developerFields = new Map<string, FitValue>();
    for (const field of definition.developerFields) {
      this.require(field.size);
      const description = this.descriptions.get(field.key);
      if (description) {
        const value = readValue(
          this.bytes,
          this.view,
          this.position,
          field.size,
          description.baseType,
          definition.littleEndian,
        );
        if (value !== undefined) {
          developerFields.set(
            description.name,
            scaled(value, description.scale, description.offset),
          );
        }
      }
      this.position += field.size;
    }
    const message = { globalNumber: definition.globalNumber, fields, developerFields };
    if (definition.globalNumber === fieldDescriptionMessage) this.describe(message);
    return message;
  }

  private describe(message: FitMessage): void {
    const index = message.fields.get(FieldDescription.developerDataIndex);
    const number = message.fields.get(FieldDescription.fieldNumber);
    const baseType = message.fields.get(FieldDescription.baseType);
    const name = message.fields.get(FieldDescription.name);
    if (
      typeof index !== "number" ||
      typeof number !== "number" ||
      typeof baseType !== "number" ||
      typeof name !== "string"
    ) {
      return;
    }
    const scale = message.fields.get(FieldDescription.scale);
    const offset = message.fields.get(FieldDescription.offset);
    if (!isByte(index) || !isByte(number)) return;
    this.descriptions.set(developerKey(index, number), {
      name,
      baseType: baseType & 0x1f,
      scale: typeof scale === "number" ? scale : undefined,
      offset: typeof offset === "number" ? offset : undefined,
    });
  }

  private require(size: number): void {
    if (this.position + size > this.end) throw new FitDecodeError("truncated");
  }

  private byte(): number {
    this.require(1);
    return this.bytes[this.position++]!;
  }
}

function readFile(
  bytes: Uint8Array,
  start: number,
  visit: (message: FitMessage) => void,
  descriptions: Map<string, DeveloperFieldDescription>,
): number {
  const available = bytes.length - start;
  if (available < 14) throw new FitDecodeError("truncated");
  const headerSize = bytes[start]!;
  if (
    headerSize < 12 ||
    headerSize > available ||
    fitSignature.some((byte, index) => bytes[start + 8 + index] !== byte)
  ) {
    throw new FitDecodeError("notAFitFile");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = start + headerSize + view.getUint32(start + 4, true);
  if (end + 2 > bytes.length) throw new FitDecodeError("truncated");
  if (fitChecksum(bytes, start, end) !== view.getUint16(end, true)) {
    throw new FitDecodeError("badChecksum");
  }
  new Reader(bytes, start + headerSize, end, descriptions).read(visit);
  return end + 2;
}

export function forEachFitMessage(
  data: Uint8Array | ArrayBuffer,
  visit: (message: FitMessage) => void,
): void {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const descriptions = new Map<string, DeveloperFieldDescription>();
  let position = 0;
  do {
    position = readFile(bytes, position, visit, descriptions);
  } while (position < bytes.length);
}

export function readFitMessages(data: Uint8Array | ArrayBuffer): FitMessage[] {
  const messages: FitMessage[] = [];
  forEachFitMessage(data, (message) => messages.push(message));
  return messages;
}
