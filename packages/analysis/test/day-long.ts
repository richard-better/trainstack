import { profileOn, type SettingChange } from "@trainstack/zones";

import { type AnalysisRecord, analyzeActivity } from "../src/index.ts";

const day = 24 * 60 * 60;
const changes: SettingChange[] = [
  { kind: "sport", sport: "running", listed: true },
  { kind: "threshold", sport: "running", threshold: "threshold_pace", value: 300 },
  { kind: "threshold", sport: null, threshold: "ftp", value: 250 },
  { kind: "threshold", sport: null, threshold: "max_heart_rate", value: 190 },
  { kind: "threshold", sport: null, threshold: "resting_heart_rate", value: 50 },
  { kind: "threshold", sport: null, threshold: "lactate_threshold_heart_rate", value: 165 },
];
const profile = profileOn(
  changes.map((change) => ({ day: "2026-01-01", change })),
  null,
);
const start = new Date("2026-05-01T00:00:00Z");

const records: AnalysisRecord[] = [];
let distance = 0;
for (let second = 0; second <= day; second++) {
  const speed = 2.5 + Math.sin(second / 600);
  distance += speed;
  records.push({
    elapsedSeconds: second,
    power: 150 + ((second * 7919) % 200),
    heartRate: 120 + ((second * 31) % 50),
    speedMetresPerSecond: speed,
    distanceMetres: distance,
    altitudeMetres: 200 + 100 * Math.sin(distance / 2000),
  });
}
const laps = Array.from({ length: 24 * 4 }, (_, index) => ({
  startTime: new Date(start.getTime() + index * 900_000),
  elapsedSeconds: 900,
}));

globalThis.gc?.();
const before = process.memoryUsage();
const cpuBefore = process.cpuUsage();
const analysis = analyzeActivity(
  {
    summary: { startTime: start, sport: "running", subSport: undefined, elapsedSeconds: day },
    records,
    laps,
  },
  profile,
);
const cpu = process.cpuUsage(cpuBefore);
const cpuMilliseconds = (cpu.user + cpu.system) / 1000;
const after = process.memoryUsage();
console.log(
  JSON.stringify({
    records: records.length,
    cpuMilliseconds,
    recordsHeapBytes: before.heapUsed,
    typedArrayBytes: after.arrayBuffers - before.arrayBuffers,
    load: analysis.load,
    efforts: analysis.bestEfforts.length,
    laps: analysis.laps.length,
  }),
);
