export type XmlElement = {
  name: string;
  attributes: Map<string, string>;
  children: XmlElement[];
  text: string;
  line: number;
};

export class XmlSyntaxError extends Error {
  override readonly name = "XmlSyntaxError";

  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} on line ${line}`);
  }
}

const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const nameStart = /[A-Za-z_:]/;
const nameCharacters = /[A-Za-z0-9_:.-]/;

class Reader {
  private position = 0;

  constructor(private readonly source: string) {}

  get line(): number {
    let line = 1;
    for (let index = 0; index < this.position; index += 1) {
      if (this.source[index] === "\n") line += 1;
    }
    return line;
  }

  fail(message: string): never {
    throw new XmlSyntaxError(message, this.line);
  }

  get done(): boolean {
    return this.position >= this.source.length;
  }

  startsWith(text: string): boolean {
    return this.source.startsWith(text, this.position);
  }

  expect(text: string): void {
    if (!this.startsWith(text)) this.fail(`Expected "${text}"`);
    this.position += text.length;
  }

  skipPast(terminator: string, what: string): string {
    const end = this.source.indexOf(terminator, this.position);
    if (end === -1) this.fail(`Unterminated ${what}`);
    const skipped = this.source.slice(this.position, end);
    this.position = end + terminator.length;
    return skipped;
  }

  skipWhitespace(): void {
    while (!this.done && /\s/.test(this.source[this.position] ?? "")) this.position += 1;
  }

  name(): string {
    const first = this.source[this.position] ?? "";
    if (!nameStart.test(first)) this.fail("Expected a name");
    const start = this.position;
    while (!this.done && nameCharacters.test(this.source[this.position] ?? "")) {
      this.position += 1;
    }
    return this.source.slice(start, this.position);
  }

  quoted(): string {
    const quote = this.source[this.position];
    if (quote !== '"' && quote !== "'") this.fail("Expected a quoted attribute value");
    this.position += 1;
    const raw = this.skipPast(quote, "attribute value");
    if (raw.includes("<")) this.fail('Attribute values cannot contain "<"');
    return this.decode(raw);
  }

  textUntilTag(): string {
    const end = this.source.indexOf("<", this.position);
    const stop = end === -1 ? this.source.length : end;
    const raw = this.source.slice(this.position, stop);
    this.position = stop;
    return this.decode(raw);
  }

  decode(raw: string): string {
    return raw.replace(/&([^;\s&]*);?/g, (match, entity: string) => {
      if (!match.endsWith(";")) this.fail(`Unterminated entity "${match}"`);
      if (entity.startsWith("#x")) return this.codePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return this.codePoint(Number.parseInt(entity.slice(1), 10));
      const named = namedEntities[entity];
      if (named === undefined) this.fail(`Unknown entity "&${entity};"`);
      return named;
    });
  }

  codePoint(value: number): string {
    if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) {
      this.fail("Invalid character reference");
    }
    return String.fromCodePoint(value);
  }
}

function skipMisc(reader: Reader): void {
  for (;;) {
    reader.skipWhitespace();
    if (reader.startsWith("<?")) reader.skipPast("?>", "processing instruction");
    else if (reader.startsWith("<!--")) reader.skipPast("-->", "comment");
    else if (reader.startsWith("<!DOCTYPE"))
      reader.fail("Document type declarations are not supported");
    else return;
  }
}

function readElement(reader: Reader): XmlElement {
  const line = reader.line;
  reader.expect("<");
  const name = reader.name();
  const attributes = new Map<string, string>();
  for (;;) {
    reader.skipWhitespace();
    if (reader.startsWith("/>")) {
      reader.expect("/>");
      return { name, attributes, children: [], text: "", line };
    }
    if (reader.startsWith(">")) {
      reader.expect(">");
      break;
    }
    const attribute = reader.name();
    reader.skipWhitespace();
    reader.expect("=");
    reader.skipWhitespace();
    if (attributes.has(attribute)) reader.fail(`Duplicate attribute "${attribute}"`);
    attributes.set(attribute, reader.quoted());
  }
  const children: XmlElement[] = [];
  let text = "";
  for (;;) {
    if (reader.done) reader.fail(`Unclosed element <${name}>`);
    if (reader.startsWith("</")) {
      reader.expect("</");
      const closing = reader.name();
      if (closing !== name) reader.fail(`Expected </${name}> but found </${closing}>`);
      reader.skipWhitespace();
      reader.expect(">");
      return { name, attributes, children, text, line };
    }
    if (reader.startsWith("<!--")) reader.skipPast("-->", "comment");
    else if (reader.startsWith("<![CDATA[")) {
      reader.expect("<![CDATA[");
      text += reader.skipPast("]]>", "CDATA section");
    } else if (reader.startsWith("<?")) reader.skipPast("?>", "processing instruction");
    else if (reader.startsWith("<")) children.push(readElement(reader));
    else text += reader.textUntilTag();
  }
}

export function parseXml(source: string): XmlElement {
  const reader = new Reader(source.replace(/^﻿/, ""));
  skipMisc(reader);
  if (!reader.startsWith("<")) reader.fail("Expected a root element");
  const root = readElement(reader);
  skipMisc(reader);
  if (!reader.done) reader.fail("Unexpected content after the root element");
  return root;
}

function escape(text: string, quote: boolean): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return quote ? escaped.replace(/"/g, "&quot;").replace(/\n/g, "&#10;") : escaped;
}

export type XmlNode = {
  name: string;
  attributes?: [string, string | number | undefined][];
  children?: XmlNode[];
  text?: string;
};

function renderNode(node: XmlNode, depth: number): string {
  const indent = "    ".repeat(depth);
  const attributes = (node.attributes ?? [])
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => ` ${key}="${escape(String(value), true)}"`)
    .join("");
  const open = `${indent}<${node.name}${attributes}`;
  if (node.text !== undefined) return `${open}>${escape(node.text, false)}</${node.name}>`;
  const children = node.children ?? [];
  if (children.length === 0) return `${open}/>`;
  return [
    `${open}>`,
    ...children.map((child) => renderNode(child, depth + 1)),
    `${indent}</${node.name}>`,
  ].join("\n");
}

export function renderXml(root: XmlNode): string {
  return `${renderNode(root, 0)}\n`;
}
