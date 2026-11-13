import assert from "node:assert/strict";
import { test } from "node:test";

import {
  combineZoneShares,
  fatigueDays,
  fitnessDays,
  stressByDay,
  trainingLoad,
  type ZoneShare,
} from "../src/index.ts";
import { zones } from "./ride-reference.ts";

const day = (offset: number) => new Date(Date.UTC(1970, 0, 1 + offset)).toISOString().slice(0, 10);

test("fatigue rises and falls faster than fitness", () => {
  const stress = new Map(Array.from({ length: 7 }, (_, offset) => [day(offset), 100]));
  const load = trainingLoad(stress, day(0), day(20));
  assert.equal(load.length, 21);
  const afterBlock = load[6]!;
  assert.ok(afterBlock.fatigue > afterBlock.fitness);
  assert.ok(afterBlock.form < 0);
  const afterRest = load[20]!;
  assert.ok(afterRest.fatigue < afterBlock.fatigue / 4);
  assert.ok(afterRest.fitness > afterBlock.fitness * 0.6);
  assert.ok(afterRest.form > 0);
});

test("gives one load for each day, starting from no load", () => {
  const load = trainingLoad(new Map([[day(0), 10]]), day(0), day(2));
  assert.deepEqual(
    load.map((entry) => entry.day),
    ["1970-01-01", "1970-01-02", "1970-01-03"],
  );
  assert.equal(load[0]!.fitness, 10 / fitnessDays);
  assert.equal(load[0]!.fatigue, 10 / fatigueDays);
});

test("ignores stress outside the days", () => {
  const load = trainingLoad(
    new Map([
      [day(-1), 100],
      [day(3), 100],
    ]),
    day(0),
    day(2),
  );
  assert.ok(load.every(({ stress, fitness, fatigue }) => stress + fitness + fatigue === 0));
});

test("settles on the daily average", () => {
  const stress = new Map(Array.from({ length: 400 }, (_, offset) => [day(offset), 50]));
  const last = trainingLoad(stress, day(0), day(399)).at(-1)!;
  assert.ok(Math.abs(last.fitness - 50) < 0.1);
  assert.ok(Math.abs(last.form) < 0.1);
});

test("crosses month, year and leap days", () => {
  const load = trainingLoad(new Map(), "2027-12-30", "2028-03-01");
  assert.equal(load.length, 63);
  assert.ok(load.some((entry) => entry.day === "2028-02-29"));
});

test("adds up each day's stress, leaving out activities without a score", () => {
  assert.deepEqual(
    stressByDay([
      { day: "2026-05-01", stress: 100 },
      { day: "2026-05-01", stress: 50 },
      { day: "2026-05-02", stress: null },
      { day: "2026-05-03", stress: 20 },
    ]),
    new Map([
      ["2026-05-01", 150],
      ["2026-05-03", 20],
    ]),
  );
});

test("refuses days that are not calendar days", () => {
  for (const bad of ["2026-02-30", "2026-5-1", "yesterday"]) {
    assert.throws(() => trainingLoad(new Map(), bad, "2026-06-01"), RangeError);
    assert.throws(() => stressByDay([{ day: bad, stress: 1 }]), RangeError);
  }
  assert.throws(() => trainingLoad(new Map(), "1900-01-01", "2026-01-01"), RangeError);
});

test("adds up zone time across activities, even when the FTP moved the zones", () => {
  const before = zones("coggan_6", { ftp: 200 }).zones;
  const after = zones("coggan_6", { ftp: 220 }).zones;
  const first: ZoneShare[] = [
    { zone: before[1]!, seconds: 300, fraction: 0.75 },
    { zone: before[2]!, seconds: 100, fraction: 0.25 },
  ];
  const second: ZoneShare[] = [{ zone: after[1]!, seconds: 600, fraction: 1 }];
  const combined = combineZoneShares([first, second]);
  assert.deepEqual(
    combined.map((share) => [share.zone.name, share.seconds, share.fraction]),
    [
      ["Endurance", 900, 0.9],
      ["Tempo", 100, 0.1],
    ],
  );
  assert.deepEqual(combineZoneShares([]), []);
  assert.deepEqual(combineZoneShares([[], []]), []);
});
