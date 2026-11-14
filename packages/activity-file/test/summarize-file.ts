import { readFileSync } from "node:fs";

import { decodeActivityFile, streamActivityFile, summarizeActivityFile } from "../src/index.ts";

const [path, mode] = process.argv.slice(2);
const bytes = new Uint8Array(readFileSync(path!));
const before = process.resourceUsage().maxRSS;
const week = { untilSeconds: 7 * 24 * 60 * 60, maxRecords: 7 * 24 * 60 * 60 + 1 };
const streamed = mode === "streams" ? streamActivityFile(bytes, week) : undefined;
const decoded =
  streamed ?? (mode === "full" ? decodeActivityFile(bytes) : summarizeActivityFile(bytes));
console.log(
  JSON.stringify({
    format: decoded.format,
    summary: decoded.summary,
    streamedRecords: streamed?.records.count,
    maxRssKilobytes: process.resourceUsage().maxRSS,
    rssBeforeKilobytes: before,
  }),
);
