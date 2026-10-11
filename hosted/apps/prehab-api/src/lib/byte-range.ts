/** One RFC 9110 byte range. Multipart ranges are deliberately rejected. */
export function byteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || size <= 0 || (!match[1] && !match[2])) return null;
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null;
  if (!match[1]) return last > 0 ? { start: Math.max(0, size - last), end: size - 1 } : null;
  const end = match[2] ? Math.min(last, size - 1) : size - 1;
  return first < size && first <= end ? { start: first, end } : null;
}
