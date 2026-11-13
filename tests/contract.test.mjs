import assert from "node:assert/strict";
import { test } from "node:test";
import { rolldown } from "rolldown";

test("shared contract bundles for browser clients without server implementations", async () => {
  const bundle = await rolldown({
    input: "packages/contract/src/index.ts",
    platform: "browser",
  });
  try {
    const { output } = await bundle.generate({ format: "esm" });
    const modules = output.flatMap((chunk) =>
      chunk.type === "chunk" ? Object.keys(chunk.modules) : [],
    );
    assert.ok(modules.some((id) => id.includes("/@orpc/contract/")));
    assert.deepEqual(
      modules.filter(
        (id) => /\/@orpc\/(server|openapi|zod)\//.test(id) || id.includes("/hosted/apps/api/"),
      ),
      [],
    );
  } finally {
    await bundle.close();
  }
});

test("every statistic is named <what>_<unit> once, with average_ and max_ spelled out", async () => {
  const { activityStatistics } = await import("../packages/contract/src/index.ts");
  const suffixes = { s: "s", m: "m", kcal: "kcal", "m/s": "mps", bpm: "bpm", rpm: "rpm", W: "w" };
  const names = activityStatistics.map(({ name }) => name);
  assert.equal(new Set(names).size, names.length);
  for (const { name, unit } of activityStatistics) {
    assert.match(name, /^[a-z]+(_[a-z]+)*$/);
    assert.ok(name.endsWith(`_${suffixes[unit]}`), `${name} ends with its unit, ${unit}`);
    assert.doesNotMatch(name, /(^|_)(avg|min|mx|hr)_/);
  }
  assert.deepEqual(names.slice(0, 14), [
    "elapsed_s",
    "timer_s",
    "distance_m",
    "calories_kcal",
    "average_speed_mps",
    "max_speed_mps",
    "average_heart_rate_bpm",
    "max_heart_rate_bpm",
    "average_cadence_rpm",
    "max_cadence_rpm",
    "average_power_w",
    "max_power_w",
    "ascent_m",
    "descent_m",
  ]);
});
