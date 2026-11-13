import { decodeActivityFile } from "@trainstack/activity-file";
import { type DatedChange, profileOn } from "@trainstack/zones";

import { analyzeActivity, statisticsOf } from "../src/index.ts";

export const history: DatedChange[] = [
  { day: "2026-01-01", change: { kind: "threshold", sport: null, threshold: "ftp", value: 200 } },
];

export const statisticsOfFile = (bytes: ArrayBuffer | Uint8Array) =>
  statisticsOf(analyzeActivity(decodeActivityFile(bytes), profileOn(history, "2026-10-06")));

export default {
  async fetch(request: Request) {
    return Response.json(statisticsOfFile(await request.arrayBuffer()));
  },
};
