import { ActivityFileError, type ActivityFileFormat } from "./error.ts";

export type XmlAttributes = ReadonlyMap<string, string>;

export interface XmlHandler {
  named?(name: string): void;
  open(name: string, attributes: XmlAttributes, ancestors: readonly string[]): void;
  close(name: string, text: string, ancestors: readonly string[]): void;
}

export const maxElementDepth = 64;
export const maxAttributesPerElement = 64;
export const maxTextBytesPerElement = 4096;

const Byte = {
  tab: 0x09,
  lineFeed: 0x0a,
  carriageReturn: 0x0d,
  space: 0x20,
  doubleQuote: 0x22,
  apostrophe: 0x27,
  slash: 0x2f,
  lessThan: 0x3c,
  equals: 0x3d,
  greaterThan: 0x3e,
  question: 0x3f,
  bracket: 0x5b,
  exclamation: 0x21,
} as const;

const utf8 = new TextDecoder();
const noAttributes: XmlAttributes = new Map();
const predefinedEntities: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};
const entityPattern = /&(#x[0-9a-fA-F]{1,8}|#[0-9]{1,10}|[A-Za-z][A-Za-z0-9]{0,31});/g;

function bytesOf(text: string): readonly number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

const processingInstructionEnd = bytesOf("?>");
const commentStart = bytesOf("!--");
const commentEnd = bytesOf("-->");
const cdataStart = bytesOf("![CDATA[");
const cdataEnd = bytesOf("]]>");
const doctypeStart = bytesOf("!DOCTYPE");

function isSpace(byte: number | undefined): boolean {
  return (
    byte === Byte.space ||
    byte === Byte.tab ||
    byte === Byte.lineFeed ||
    byte === Byte.carriageReturn
  );
}

function localName(name: string): string {
  const colon = name.lastIndexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

function replaceEntity(entity: string, body: string): string {
  if (body.startsWith("#")) {
    const codePoint = body.startsWith("#x")
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10);
    return codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff)
      ? String.fromCodePoint(codePoint)
      : "�";
  }
  return predefinedEntities[body] ?? entity;
}

function withEntitiesReplaced(text: string): string {
  return text.includes("&") ? text.replace(entityPattern, replaceEntity) : text;
}

class Scanner {
  private readonly bytes: Uint8Array;
  private readonly format: ActivityFileFormat | undefined;

  constructor(bytes: Uint8Array, format: ActivityFileFormat | undefined) {
    this.bytes = bytes;
    this.format = format;
  }

  fail(code: "truncated" | "malformed"): never {
    throw new ActivityFileError(code, this.format);
  }

  find(sequence: readonly number[], from: number): number {
    const first = sequence[0]!;
    let index = from;
    for (;;) {
      index = this.bytes.indexOf(first, index);
      if (index < 0) this.fail("truncated");
      if (this.startsWith(sequence, index)) return index;
      index += 1;
    }
  }

  startsWith(sequence: readonly number[], at: number): boolean {
    for (let offset = 0; offset < sequence.length; offset++) {
      const byte = this.bytes[at + offset];
      if (byte === undefined) this.fail("truncated");
      if (byte !== sequence[offset]) return false;
    }
    return true;
  }

  byteAt(index: number): number {
    const byte = this.bytes[index];
    if (byte === undefined) this.fail("truncated");
    return byte;
  }

  skipSpace(from: number): number {
    let index = from;
    while (isSpace(this.bytes[index])) index += 1;
    return index;
  }

  onlySpace(start: number, end: number): boolean {
    for (let index = start; index < end; index++) {
      if (!isSpace(this.bytes[index])) return false;
    }
    return true;
  }

  name(start: number, end: number): string {
    return utf8.decode(this.bytes.subarray(start, end));
  }

  text(start: number, end: number): string {
    return withEntitiesReplaced(utf8.decode(this.bytes.subarray(start, end)));
  }

  cdata(start: number, end: number): string {
    return utf8.decode(this.bytes.subarray(start, end));
  }

  nameEnd(from: number): number {
    let index = from;
    for (;;) {
      const byte = this.byteAt(index);
      if (
        isSpace(byte) ||
        byte === Byte.greaterThan ||
        byte === Byte.slash ||
        byte === Byte.equals
      ) {
        return index;
      }
      index += 1;
    }
  }
}

export function scanXml(
  bytes: Uint8Array,
  handler: XmlHandler,
  format: ActivityFileFormat | undefined,
): void {
  const scanner = new Scanner(bytes, format);
  const names: string[] = [];
  const qualifiedNames: string[] = [];
  let textParts: string[] = [];
  let textBytes = 0;
  const keepText = (start: number, end: number, decode: (start: number, end: number) => string) => {
    const kept = Math.min(end, start + maxTextBytesPerElement - textBytes);
    if (kept <= start) return;
    textParts.push(decode(start, kept));
    textBytes += kept - start;
  };
  let rootSeen = false;
  let position = 0;

  for (;;) {
    const tagStart = bytes.indexOf(Byte.lessThan, position);
    const textEnd = tagStart < 0 ? bytes.length : tagStart;
    if (textEnd > position) {
      if (names.length > 0) keepText(position, textEnd, (start, end) => scanner.text(start, end));
      else if (!scanner.onlySpace(position, textEnd)) scanner.fail("malformed");
    }
    if (tagStart < 0) {
      if (rootSeen && names.length === 0) return;
      scanner.fail(rootSeen || bytes.length === 0 ? "truncated" : "malformed");
    }

    position = tagStart + 1;
    const marker = scanner.byteAt(position);

    if (marker === Byte.question) {
      position =
        scanner.find(processingInstructionEnd, position + 1) + processingInstructionEnd.length;
      continue;
    }

    if (marker === Byte.exclamation) {
      if (scanner.startsWith(commentStart, position)) {
        position = scanner.find(commentEnd, position + commentStart.length) + commentEnd.length;
      } else if (scanner.startsWith(cdataStart, position)) {
        if (names.length === 0) scanner.fail("malformed");
        const end = scanner.find(cdataEnd, position + cdataStart.length);
        keepText(position + cdataStart.length, end, (start, stop) => scanner.cdata(start, stop));
        position = end + cdataEnd.length;
      } else if (!rootSeen && scanner.startsWith(doctypeStart, position)) {
        const end = bytes.indexOf(Byte.greaterThan, position);
        if (end < 0) scanner.fail("truncated");
        if (bytes.subarray(position, end).includes(Byte.bracket)) scanner.fail("malformed");
        position = end + 1;
      } else {
        scanner.fail("malformed");
      }
      continue;
    }

    if (marker === Byte.slash) {
      const end = bytes.indexOf(Byte.greaterThan, position);
      if (end < 0) scanner.fail("truncated");
      const qualifiedName = scanner.name(position + 1, end).trim();
      if (qualifiedName !== qualifiedNames.at(-1)) scanner.fail("malformed");
      qualifiedNames.pop();
      const name = names.pop()!;
      handler.close(name, textParts.length === 1 ? textParts[0]! : textParts.join(""), names);
      textParts = [];
      textBytes = 0;
      position = end + 1;
      continue;
    }

    if (rootSeen && names.length === 0) scanner.fail("malformed");
    const nameEnd = scanner.nameEnd(position);
    if (nameEnd === position) scanner.fail("malformed");
    const qualifiedName = scanner.name(position, nameEnd);
    handler.named?.(localName(qualifiedName));
    let attributes = noAttributes;
    let selfClosing = false;
    let index = nameEnd;
    for (;;) {
      const afterSpace = scanner.skipSpace(index);
      const byte = scanner.byteAt(afterSpace);
      if (byte === Byte.greaterThan) {
        index = afterSpace + 1;
        break;
      }
      if (byte === Byte.slash) {
        if (scanner.byteAt(afterSpace + 1) !== Byte.greaterThan) scanner.fail("malformed");
        selfClosing = true;
        index = afterSpace + 2;
        break;
      }
      if (afterSpace === index) scanner.fail("malformed");
      const attributeEnd = scanner.nameEnd(afterSpace);
      if (attributeEnd === afterSpace) scanner.fail("malformed");
      const equals = scanner.skipSpace(attributeEnd);
      if (scanner.byteAt(equals) !== Byte.equals) scanner.fail("malformed");
      const valueStart = scanner.skipSpace(equals + 1);
      const quote = scanner.byteAt(valueStart);
      if (quote !== Byte.doubleQuote && quote !== Byte.apostrophe) scanner.fail("malformed");
      const valueEnd = bytes.indexOf(quote, valueStart + 1);
      if (valueEnd < 0) scanner.fail("truncated");
      const attributeName = localName(scanner.name(afterSpace, attributeEnd));
      if (attributes === noAttributes) attributes = new Map();
      if (attributes.size >= maxAttributesPerElement) scanner.fail("malformed");
      if (!attributes.has(attributeName)) {
        (attributes as Map<string, string>).set(
          attributeName,
          scanner.text(valueStart + 1, valueEnd),
        );
      }
      index = valueEnd + 1;
    }

    if (names.length >= maxElementDepth) scanner.fail("malformed");
    rootSeen = true;
    const name = localName(qualifiedName);
    handler.open(name, attributes, names);
    textParts = [];
    textBytes = 0;
    position = index;
    if (selfClosing) {
      handler.close(name, "", names);
    } else {
      names.push(name);
      qualifiedNames.push(qualifiedName);
    }
  }
}

class RootFound {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }
}

export function rootElementName(bytes: Uint8Array): string | undefined {
  try {
    scanXml(
      bytes,
      {
        named(name) {
          throw new RootFound(name);
        },
        open() {},
        close() {},
      },
      undefined,
    );
  } catch (error) {
    if (error instanceof RootFound) return error.name;
    if (error instanceof ActivityFileError) return undefined;
    throw error;
  }
  return undefined;
}

const utf8ByteOrderMark = [0xef, 0xbb, 0xbf];

export function asUtf8(bytes: Uint8Array): Uint8Array {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextEncoder().encode(new TextDecoder("utf-16le").decode(bytes.subarray(2)));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextEncoder().encode(new TextDecoder("utf-16be").decode(bytes.subarray(2)));
  }
  if (utf8ByteOrderMark.every((byte, index) => bytes[index] === byte)) return bytes.subarray(3);
  return bytes;
}
