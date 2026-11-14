const BLOCK = 512;
const NAME_BYTES = 100;
const PREFIX_BYTES = 155;
const LARGEST_OCTAL_SIZE = 0o77777777777;

export const endOfArchive = new Uint8Array(BLOCK * 2);

export function paddingAfter(size: number) {
  return new Uint8Array((BLOCK - (size % BLOCK)) % BLOCK);
}

export function fileHeader(path: string, size: number, modified: Date) {
  if (!/^[\x20-\x7e]+$/.test(path))
    throw new Error(`An archive path must be printable ASCII: ${path}`);
  if (!Number.isSafeInteger(size) || size < 0 || size > LARGEST_OCTAL_SIZE) {
    throw new Error(`A file of ${size} bytes does not fit a tar header`);
  }
  const { prefix, name } = splitPath(path);
  const header = new Uint8Array(BLOCK);
  const put = (offset: number, text: string) => header.set(new TextEncoder().encode(text), offset);
  const octal = (offset: number, width: number, value: number) =>
    put(offset, `${value.toString(8).padStart(width - 1, "0")}\0`);

  put(0, name);
  octal(100, 8, 0o644);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, size);
  octal(136, 12, Math.floor(modified.getTime() / 1000));
  put(148, "        ");
  put(156, "0");
  put(257, "ustar\0");
  put(263, "00");
  put(345, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  put(148, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function splitPath(path: string) {
  if (path.length <= NAME_BYTES) return { prefix: "", name: path };
  const cut = path.lastIndexOf("/", PREFIX_BYTES);
  const prefix = path.slice(0, cut);
  const name = path.slice(cut + 1);
  if (cut <= 0 || name.length > NAME_BYTES || name.length === 0) {
    throw new Error(`The archive path is too long for a tar header: ${path}`);
  }
  return { prefix, name };
}
