import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestionsFor, suggestionWords } from "../hosted/apps/account/src/lib/thresholds.ts";

const suggestion = (overrides) => ({
  id: crypto.randomUUID(),
  sport: null,
  threshold: "ftp",
  value: 268,
  current: null,
  method: "critical_power",
  confidence: "high",
  activityId: "a".repeat(64),
  effortDay: "2026-05-12",
  evidence: [],
  signals: [],
  detectedAt: new Date(),
  ...overrides,
});

test("a suggestion says what it found, from which effort, how sure it is and what is set", () => {
  assert.deepEqual(suggestionWords(suggestion({})), {
    headline: "Your FTP looks like 268 W",
    source: "from your ride on 12 May 2026",
    confidence: "Your efforts agree and look all-out.",
    current: "You have not set it yet.",
  });
  const pace = suggestionWords(
    suggestion({
      sport: "running",
      threshold: "threshold_pace",
      value: 250,
      current: 270,
      confidence: "low",
    }),
  );
  assert.equal(pace.headline, "Your threshold pace for running looks like 4:10 /km");
  assert.equal(pace.source, "from your run on 12 May 2026");
  assert.equal(pace.current, "You have it at 4:30 /km.");
  assert.match(pace.confidence, /^A rough estimate/);
  assert.equal(
    suggestionWords(suggestion({ threshold: "lactate_threshold_heart_rate", value: 172 })).headline,
    "Your lactate threshold heart rate looks like 172 bpm",
  );
  assert.equal(
    suggestionWords(
      suggestion({ threshold: "max_heart_rate", method: "observed_max", confidence: "medium" }),
    ).confidence,
    "It is the highest your heart rate held, so your max is at least this.",
  );
});

test("an activity's missing thresholds pick the suggestions that fill them, for its sport or every sport", () => {
  const ftp = suggestion({});
  const runningPace = suggestion({ sport: "running", threshold: "threshold_pace", value: 250 });
  const cyclingHeartRate = suggestion({
    sport: "cycling",
    threshold: "lactate_threshold_heart_rate",
    value: 170,
  });
  const all = [ftp, runningPace, cyclingHeartRate];
  assert.deepEqual(suggestionsFor(all, ["ftp"], "cycling", []), [ftp]);
  assert.deepEqual(suggestionsFor(all, ["threshold_pace"], "running", ["pace"]), [runningPace]);
  assert.deepEqual(suggestionsFor(all, ["lactate_threshold_heart_rate"], "running", []), []);
  assert.deepEqual(suggestionsFor(all, ["max_heart_rate"], "cycling", []), []);
  assert.deepEqual(
    suggestionsFor(all, ["lactate_threshold_heart_rate"], "cycling", ["heart_rate"]),
    [cyclingHeartRate],
  );
});

test("a default suggestion does not stand in for a sport with its own zones, which it would not fill", () => {
  const ftp = suggestion({});
  assert.deepEqual(suggestionsFor([ftp], ["ftp"], "cycling", ["power"]), []);
  assert.deepEqual(suggestionsFor([ftp], ["ftp"], "cycling", ["heart_rate"]), [ftp]);
});
