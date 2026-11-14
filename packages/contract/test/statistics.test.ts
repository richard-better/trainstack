import assert from "node:assert/strict";
import { test } from "node:test";

import { analysisStatistics as analysedNames } from "../../analysis/src/index.ts";
import { type AnalysisStatisticName, analysisStatistics } from "../src/statistics.ts";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const bestNames = [
  "best_power_5s_w",
  "best_power_15s_w",
  "best_power_30s_w",
  "best_power_60s_w",
  "best_power_300s_w",
  "best_power_600s_w",
  "best_power_1200s_w",
  "best_power_1800s_w",
  "best_power_3600s_w",
  "best_time_400m_s",
  "best_time_1km_s",
  "best_time_mile_s",
  "best_time_5km_s",
  "best_time_10km_s",
  "best_time_half_marathon_s",
  "best_time_marathon_s",
] as const;

const bestNamesAreExact: Same<
  Extract<AnalysisStatisticName, `best_${string}`>,
  (typeof bestNames)[number]
> = true;
const anyBestPowerIsNotAName: Same<"best_power_7s_w" & AnalysisStatisticName, never> = true;

test("the best power and best time names are exact types, not templates", () => {
  assert.equal(bestNamesAreExact, true);
  assert.equal(anyBestPowerIsNotAName, true);
  assert.deepEqual(
    analysisStatistics.map(({ name }) => name).filter((name) => name.startsWith("best_")),
    [...bestNames],
  );
});

test("the contract names every statistic the analysis writes", () => {
  assert.deepEqual(
    analysisStatistics.map(({ name }) => name),
    analysedNames.map(({ name }) => name),
  );
});
