import { readFileSync } from "node:fs";

import { ActivityFileError, streamActivityFile } from "../src/index.ts";

const bytes = new Uint8Array(readFileSync(process.argv[2]!));
const before = process.resourceUsage().maxRSS;
const week = { untilSeconds: 7 * 24 * 60 * 60, maxRecords: 7 * 24 * 60 * 60 + 1 };
let code: string | undefined;
try {
  streamActivityFile(bytes, week);
} catch (error) {
  if (!(error instanceof ActivityFileError)) throw error;
  code = error.code;
}
console.log(
  JSON.stringify({
    code,
    rssGrowthMegabytes: Math.round((process.resourceUsage().maxRSS - before) / 1024),
  }),
);
