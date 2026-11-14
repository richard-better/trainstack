import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  anchorOf,
  checkInItems,
  dayHeading,
  draftOf,
  historyDays,
  illnessSpans,
  injurySpans,
  isComplete,
  placeCheckIn,
  sameAnswers,
  summaryWords,
  writeOf,
} from "../hosted/apps/account/src/lib/check-in.ts";
import { mockApple } from "./helpers/apple.mjs";
import { migrate, rpcClient, startWorker } from "./helpers/worker.mjs";

let worker;
let runtime;
const apple = mockApple();

before(
  async () => {
    worker = await startWorker({ outboundService: apple.fetch });
    runtime = worker.runtime;
    await migrate(runtime);
  },
  { timeout: 60_000 },
);

after(async () => {
  await worker?.dispose();
});

async function athlete() {
  const { token } = await apple.signIn(runtime, { email: `${crypto.randomUUID()}@example.com` });
  return rpcClient(runtime, { token });
}

const at = (minute) => new Date(Date.UTC(2026, 10, 13, 9, minute));

test("a new check-in starts at normal on every item, and saving it untouched says so", async () => {
  const client = await athlete();
  const draft = draftOf(null);
  assert.deepEqual(
    checkInItems.map((item) => anchorOf(item, draft.ratings[item])),
    ["Normal", "Normal", "Normal", "Normal", "Normal"],
  );
  const written = writeOf(draft, "2026-03-01", at(0));
  const { checkIn } = await client.checkIns.put(written);
  assert.ok(sameAnswers(checkIn, written));
  assert.deepEqual(summaryWords(checkIn), ["All normal"]);
  assert.deepEqual(draftOf(checkIn), draft, "reopening the day shows what was saved");
});

test("what differs from normal, illness and injury are said in the athlete's words", async () => {
  const client = await athlete();
  const draft = {
    ...draftOf(null),
    ratings: { sleep: 2, energy: 3, soreness: 1, stress: 3, mood: 5 },
    illness: { kind: "fever" },
    injury: { area: "lower_leg", training: "none" },
    note: "  Calf tight  ",
  };
  const { checkIn } = await client.checkIns.put(writeOf(draft, "2026-03-01", at(0)));
  assert.equal(checkIn.note, "Calf tight");
  assert.deepEqual(summaryWords(checkIn), [
    "Ill: fever or aching all over",
    "Injured: lower leg or calf, cannot train",
    "Sleep: restless",
    "Soreness: very sore",
    "Mood: very positive",
  ]);
});

test("a check-in with only some items rated says only what was rated, never that the rest was normal", () => {
  const partial = {
    ...writeOf(draftOf(null), "2026-03-01", at(0)),
    ratings: { sleep: 3, energy: null, soreness: 2, stress: null, mood: null },
  };
  assert.deepEqual(summaryWords(partial), ["Soreness: sorer than normal", "Sleep: normal"]);
  assert.deepEqual(summaryWords({ ...partial, ratings: { ...partial.ratings, soreness: null } }), [
    "Sleep: normal",
  ]);
});

test("ill and injured save only once the athlete has said what kind, where and what it allows", () => {
  const ill = { ...draftOf(null), illness: { kind: null } };
  assert.equal(isComplete(ill), false, "turning on ill picks no kind for the athlete");
  assert.equal(isComplete({ ...ill, illness: { kind: "stomach" } }), true);
  const hurt = { ...draftOf(null), injury: { area: null, training: null }, note: "   " };
  assert.equal(isComplete(hurt), false);
  assert.equal(isComplete({ ...hurt, injury: { area: "knee", training: null } }), false);
  const placed = { ...hurt, injury: { area: "knee", training: "reduced" } };
  assert.equal(isComplete(placed), true);
  assert.equal(writeOf(placed, "2026-03-01", at(0)).note, null, "an empty note is no note");
});

test("a check-in another device saved later is what the page shows after saving", async () => {
  const client = await athlete();
  const later = writeOf({ ...draftOf(null), note: "From the phone" }, "2026-03-01", at(5));
  await client.checkIns.put(later);
  const stale = writeOf(draftOf(null), "2026-03-01", at(1));
  const { checkIn } = await client.checkIns.put(stale);
  assert.equal(
    sameAnswers(checkIn, stale),
    false,
    "the page tells the athlete theirs was overruled",
  );
  assert.equal(draftOf(checkIn).note, "From the phone");
});

test("consecutive days ill or injured read as one marked span, and a gap or a change starts another", async () => {
  const client = await athlete();
  const day = (number) => `2026-03-${String(number).padStart(2, "0")}`;
  const ill = (kind) => ({ ...draftOf(null), illness: { kind } });
  const hurt = (area) => ({ ...draftOf(null), injury: { area, training: "reduced" } });
  for (const [number, draft] of [
    [1, ill("respiratory")],
    [2, ill("respiratory")],
    [3, ill("respiratory")],
    [5, ill("respiratory")],
    [6, ill("stomach")],
    [8, hurt("knee")],
    [9, hurt("knee")],
    [10, hurt("ankle")],
  ]) {
    await client.checkIns.put(writeOf(draft, day(number), at(0)));
  }
  const { checkIns } = await client.checkIns.range({ from: day(1), through: day(31) });
  assert.deepEqual(illnessSpans(checkIns), [
    { from: day(1), through: day(3), label: "Cold" },
    { from: day(5), through: day(5), label: "Cold" },
    { from: day(6), through: day(6), label: "Stomach" },
  ]);
  assert.deepEqual(injurySpans(checkIns), [
    { from: day(8), through: day(9), label: "Knee" },
    { from: day(10), through: day(10), label: "Ankle" },
  ]);
});

test("the history lays each check-in beside the training load of its day, every day in the range", async () => {
  const client = await athlete();
  await client.checkIns.put(writeOf(draftOf(null), "2026-03-02", at(0)));
  const { days: load } = await client.training.load({ from: "2026-03-01", through: "2026-03-03" });
  const { checkIns } = await client.checkIns.range({ from: "2026-03-01", through: "2026-03-03" });
  const days = historyDays(
    "2026-03-01",
    "2026-03-03",
    new Map(load.map((entry) => [entry.day, entry.fatigue])),
    checkIns,
  );
  assert.deepEqual(
    days.map((entry) => [entry.day, entry.fatigue, entry.checkIn?.day ?? null]),
    [
      ["2026-03-01", 0, null],
      ["2026-03-02", 0, "2026-03-02"],
      ["2026-03-03", 0, null],
    ],
  );
});

test("a saved or removed check-in takes its place in a range already on screen", () => {
  const one = writeOf(draftOf(null), "2026-03-01", at(0));
  const three = writeOf(draftOf(null), "2026-03-03", at(0));
  const two = writeOf(draftOf(null), "2026-03-02", at(0));
  assert.deepEqual(
    placeCheckIn([one, three], "2026-03-02", two).map((entry) => entry.day),
    ["2026-03-01", "2026-03-02", "2026-03-03"],
  );
  assert.deepEqual(
    placeCheckIn([one, two, three], "2026-03-02", null).map((entry) => entry.day),
    ["2026-03-01", "2026-03-03"],
  );
});

test("the day being checked in is named today, yesterday, or by its date", () => {
  assert.deepEqual(dayHeading("2026-11-14", "2026-11-14"), {
    title: "Today",
    date: "Saturday 14 November",
  });
  assert.equal(dayHeading("2026-11-13", "2026-11-14").title, "Yesterday");
  assert.deepEqual(dayHeading("2026-11-01", "2026-11-14"), {
    title: "Sunday 1 November",
    date: null,
  });
});
