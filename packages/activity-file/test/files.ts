import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("./files/", import.meta.url);

export const fileNames = readdirSync(directory).toSorted();

export function file(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(name, directory)));
}

export function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function roundedNumbers(value: unknown): unknown {
  if (typeof value === "number") return Math.round(value * 1000) / 1000;
  if (Array.isArray(value)) return value.map(roundedNumbers);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, roundedNumbers(entry)]),
    );
  }
  return value;
}

export function plain(value: unknown): unknown {
  return roundedNumbers(JSON.parse(JSON.stringify(value)));
}
