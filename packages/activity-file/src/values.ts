const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d{1,3})?$/;
const timePattern =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?([Zz]|[+-]\d{2}(?::?\d{2})?)?$/;

export function parseNumber(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (!numberPattern.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

export function parseMeasure(text: string | undefined): number | undefined {
  const value = parseNumber(text);
  return value === undefined || value < 0 ? undefined : value;
}

export function parseLatitude(text: string | undefined): number | undefined {
  const value = parseNumber(text);
  return value === undefined || Math.abs(value) > 90 ? undefined : value;
}

export function parseLongitude(text: string | undefined): number | undefined {
  const value = parseNumber(text);
  return value === undefined || Math.abs(value) > 180 ? undefined : value;
}

function offsetMinutes(zone: string | undefined): number {
  if (zone === undefined || zone === "Z" || zone === "z") return 0;
  const sign = zone.startsWith("-") ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || "0"));
}

export function parseTime(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const match = timePattern.exec(text.trim());
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const parts = [year, month, day, hour, minute, second].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const [y, mo, d, h, mi, s] = parts;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return undefined;
  const milliseconds = fraction === undefined ? 0 : Math.round(Number(`0.${fraction}`) * 1000);
  const time = Date.UTC(y, mo - 1, d, h, mi, s) + milliseconds - offsetMinutes(zone) * 60_000;
  return Number.isFinite(time) ? time : undefined;
}
