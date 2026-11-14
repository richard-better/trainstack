import { createHash } from "node:crypto";

const BLOCK = 512;

const text = (bytes) => new TextDecoder().decode(bytes).replace(/\0.*$/s, "");

function headerOf(block) {
  const stored = parseInt(text(block.subarray(148, 156)).trim(), 8);
  const unsigned = block.reduce(
    (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
    0,
  );
  if (stored !== unsigned) throw new Error(`Bad tar header checksum: ${stored} != ${unsigned}`);
  const name = text(block.subarray(0, 100));
  const prefix = text(block.subarray(345, 500));
  return {
    path: prefix ? `${prefix}/${name}` : name,
    size: parseInt(text(block.subarray(124, 136)), 8),
    modified: new Date(parseInt(text(block.subarray(136, 148)), 8) * 1000),
    type: text(block.subarray(156, 157)),
    magic: text(block.subarray(257, 263)),
  };
}

export async function readTar(body, { keep = () => true } = {}) {
  const entries = [];
  let pending = new Uint8Array(0);
  let current;
  let ended = false;
  const take = (bytes) => {
    const joined = new Uint8Array(pending.byteLength + bytes.byteLength);
    joined.set(pending);
    joined.set(bytes, pending.byteLength);
    pending = joined;
  };
  const drain = () => {
    for (;;) {
      if (ended) return;
      if (!current) {
        if (pending.byteLength < BLOCK) return;
        const block = pending.subarray(0, BLOCK);
        pending = pending.subarray(BLOCK);
        if (block.every((byte) => byte === 0)) {
          ended = true;
          return;
        }
        const header = headerOf(block);
        current = {
          ...header,
          remaining: header.size,
          padding: (BLOCK - (header.size % BLOCK)) % BLOCK,
          hash: createHash("sha256"),
          chunks: keep(header.path) ? [] : undefined,
        };
      }
      if (current.remaining > 0) {
        if (pending.byteLength === 0) return;
        const piece = pending.subarray(0, Math.min(current.remaining, pending.byteLength));
        pending = pending.subarray(piece.byteLength);
        current.remaining -= piece.byteLength;
        current.hash.update(piece);
        current.chunks?.push(Buffer.from(piece));
        if (current.remaining > 0) return;
      }
      if (pending.byteLength < current.padding) return;
      pending = pending.subarray(current.padding);
      const { hash, chunks, remaining: _done, padding: _padding, ...entry } = current;
      entries.push({
        ...entry,
        sha256: hash.digest("hex"),
        ...(chunks ? { bytes: Buffer.concat(chunks) } : {}),
      });
      current = undefined;
    }
  };
  for await (const chunk of body) {
    take(chunk);
    drain();
  }
  if (!ended || current) throw new Error("The archive ended early");
  return entries;
}

export const jsonLines = (entries, folder) =>
  entries
    .filter(({ path }) => path.startsWith(`${folder}/`) && path.endsWith(".jsonl"))
    .sort((a, b) => a.path.localeCompare(b.path))
    .flatMap(({ bytes }) =>
      bytes
        .toString("utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    );
