import { readFileSync } from "node:fs";

import { streamActivityFile } from "@trainstack/activity-file";
import { profileOn } from "@trainstack/zones";

import { analysisColumnLimits, analyzeActivity } from "../src/index.ts";
import { history } from "./worker.ts";

const [path, sport] = process.argv.slice(2);
const before = process.resourceUsage().maxRSS;
const began = performance.now();
const activity = streamActivityFile(readFileSync(path!), analysisColumnLimits);
const summary = sport ? { ...activity.summary, sport } : activity.summary;
const analysis = analyzeActivity({ ...activity, summary }, profileOn(history, "2026-10-06"));
console.log(
  JSON.stringify({
    records: activity.records.count,
    milliseconds: performance.now() - began,
    rssGrowthMegabytes: Math.round((process.resourceUsage().maxRSS - before) / 1024),
    maxPowerOverFiveSeconds: analysis.powerCurve[0]?.watts ?? 0,
  }),
);
