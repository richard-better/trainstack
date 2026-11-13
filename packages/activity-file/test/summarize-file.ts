import { readFileSync } from "node:fs";

import { decodeActivityFile, summarizeActivityFile } from "../src/index.ts";

const [path, mode] = process.argv.slice(2);
const bytes = new Uint8Array(readFileSync(path!));
const before = process.resourceUsage().maxRSS;
const decoded = mode === "full" ? decodeActivityFile(bytes) : summarizeActivityFile(bytes);
console.log(
  JSON.stringify({
    format: decoded.format,
    summary: decoded.summary,
    maxRssKilobytes: process.resourceUsage().maxRSS,
    rssBeforeKilobytes: before,
  }),
);
