const MAX_LINE_OCTETS = 75;
const encoder = new TextEncoder();

export type Property = { name: string; parameters?: string; value: string };

export const text = (value: string) =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");

const twoDigits = (value: number) => String(value).padStart(2, "0");

export const utcDateTime = (instant: Date) =>
  `${instant.getUTCFullYear()}${twoDigits(instant.getUTCMonth() + 1)}${twoDigits(instant.getUTCDate())}T${twoDigits(instant.getUTCHours())}${twoDigits(instant.getUTCMinutes())}${twoDigits(instant.getUTCSeconds())}Z`;

export const date = (day: string) => day.replaceAll("-", "");

export function fold(line: string) {
  const parts: string[] = [];
  let part = "";
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).byteLength;
    if (octets + size > MAX_LINE_OCTETS) {
      parts.push(part);
      part = " ";
      octets = 1;
    }
    part += character;
    octets += size;
  }
  parts.push(part);
  return parts.join("\r\n");
}

const lineOf = ({ name, parameters, value }: Property) =>
  fold(`${name}${parameters ? `;${parameters}` : ""}:${value}`);

export type Component = { name: string; properties: Property[] };

export function calendar(properties: Property[], components: Component[]) {
  const lines = [
    "BEGIN:VCALENDAR",
    ...properties.map(lineOf),
    ...components.flatMap(({ name, properties }) => [
      `BEGIN:${name}`,
      ...properties.map(lineOf),
      `END:${name}`,
    ]),
    "END:VCALENDAR",
  ];
  return `${lines.join("\r\n")}\r\n`;
}
