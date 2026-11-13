import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type DatedChange,
  listedSports,
  metricSettings,
  missingThresholds,
  profileOn,
  type SettingChange,
  usesDefault,
  zoneMetricsFor,
  zonesFor,
} from "../src/index.ts";

const ftp = (value: number | null, sport: string | null = null): SettingChange => ({
  kind: "threshold",
  sport,
  threshold: "ftp",
  value,
});
const listed = (sport: string, isListed = true): SettingChange => ({
  kind: "sport",
  sport,
  listed: isListed,
});
const on = (day: string, ...changes: SettingChange[]): DatedChange[] =>
  changes.map((change) => ({ day, change }));

const ftpOn = (history: DatedChange[], day: string | null, sport: string | null = null) =>
  metricSettings(profileOn(history, day), "power", sport)?.thresholds.ftp;

describe("history agrees with Ride's ZoneHistoryTests", () => {
  test("uses the zones in effect on each day", () => {
    const history = [...on("2026-03-01", ftp(200)), ...on("2026-06-01", ftp(220))];
    assert.equal(ftpOn(history, "2026-05-31"), 200);
    assert.equal(ftpOn(history, "2026-06-01"), 220);
    assert.equal(ftpOn(history, "2026-09-01"), 220);
    assert.equal(ftpOn(history, null), 220);
  });

  test("uses the earliest zones before the first change", () => {
    const history = [...on("2026-03-01", ftp(200)), ...on("2026-06-01", ftp(220))];
    assert.equal(ftpOn(history, "2026-01-01"), 200);
  });

  test("before the first change, skips earlier days on which nothing took effect", () => {
    const history = [
      ...on("2026-02-01", ftp(300, "running")),
      ...on("2026-03-01", ftp(200)),
      ...on("2026-06-01", ftp(220)),
    ];
    assert.equal(ftpOn(history, "2026-01-01"), 200);
  });

  test("carries a past change forward until the next one", () => {
    const history = [
      ...on("2026-03-01", ftp(200)),
      ...on("2026-09-01", {
        kind: "threshold",
        sport: null,
        threshold: "max_heart_rate",
        value: 190,
      }),
      ...on("2026-08-01", ftp(230)),
    ];
    assert.equal(ftpOn(history, "2026-07-31"), 200);
    assert.equal(ftpOn(history, "2026-09-02"), 230);
  });

  test("a cleared threshold stays cleared until set again", () => {
    const history = [
      ...on("2026-03-01", ftp(200)),
      ...on("2026-04-01", ftp(null)),
      ...on("2026-05-01", ftp(210)),
    ];
    assert.equal(ftpOn(history, "2026-04-15"), undefined);
    assert.equal(ftpOn(history, "2026-05-15"), 210);
  });

  test("lets a sport keep its own zones", () => {
    const history = [...on("2026-03-01", ftp(250), listed("running"))];
    let profile = profileOn(history, null);
    assert.deepEqual(listedSports(profile), ["running"]);
    assert.ok(usesDefault(profile, "power", "running"));
    assert.equal(ftpOn(history, null, "running"), 250);

    history.push(
      ...on(
        "2026-04-01",
        { kind: "own_zones", sport: "running", metric: "power", own: true },
        ftp(300, "running"),
      ),
    );
    profile = profileOn(history, null);
    assert.ok(!usesDefault(profile, "power", "running"));
    assert.equal(ftpOn(history, null, "running"), 300);
    assert.equal(ftpOn(history, null), 250);
    assert.equal(zonesFor(profile, "power", "running")?.limits[0], 167);
    assert.equal(zonesFor(profile, "power", "cycling")?.limits[0], 139);
    assert.equal(zonesFor(profile, "power", null)?.limits[0], 139);

    history.push(...on("2026-05-01", listed("running", false)));
    profile = profileOn(history, null);
    assert.deepEqual(listedSports(profile), []);
    assert.equal(ftpOn(history, null, "running"), 250);
  });

  test("a listed running starts with pace zones that need a threshold pace", () => {
    const profile = profileOn(on("2026-03-01", listed("running")), null);
    const pace = metricSettings(profile, "pace", "running");
    assert.ok(pace);
    assert.deepEqual(missingThresholds(pace), ["threshold_pace"]);
  });

  test("pace has no default zones", () => {
    const profile = profileOn(on("2026-03-01", listed("running")), null);
    assert.equal(metricSettings(profile, "pace", null), null);
    assert.ok(!usesDefault(profile, "pace", "running"));
  });

  test("a change to a sport that uses default does nothing", () => {
    const history = [
      ...on("2026-03-01", ftp(250), listed("running")),
      ...on("2026-03-02", ftp(300, "running")),
    ];
    assert.equal(ftpOn(history, null, "running"), 250);
  });

  test("a sport's own zones start as a copy of default", () => {
    const history = [
      ...on("2026-03-01", ftp(250), listed("running")),
      ...on("2026-04-01", { kind: "own_zones", sport: "running", metric: "power", own: true }),
    ];
    const profile = profileOn(history, null);
    assert.ok(!usesDefault(profile, "power", "running"));
    assert.equal(ftpOn(history, null, "running"), 250);
  });

  test("lists sports in their usual order", () => {
    const profile = profileOn(on("2026-03-01", listed("swimming"), listed("running")), null);
    assert.deepEqual(listedSports(profile), ["running", "swimming"]);
  });
});

describe("history on the server", () => {
  test("applies a day's changes in the same order whatever order they arrive in", () => {
    const changes = on(
      "2026-03-01",
      ftp(300, "running"),
      { kind: "own_zones", sport: "running", metric: "power", own: true },
      ftp(250),
      listed("running"),
    );
    const forwards = profileOn(changes, null);
    assert.deepEqual(profileOn(changes.toReversed(), null), forwards);
    assert.equal(metricSettings(forwards, "power", "running")?.thresholds.ftp, 300);
    assert.equal(metricSettings(forwards, "power", null)?.thresholds.ftp, 250);
  });

  test("critical swim speed is the threshold pace of swimming, per 100 m", () => {
    const history = on("2026-03-01", listed("swimming"), {
      kind: "threshold",
      sport: "swimming",
      threshold: "threshold_pace",
      value: 95,
    });
    const css = zonesFor(profileOn(history, null), "pace", "swimming");
    assert.equal(css?.model, "critical_swim_speed");
    assert.deepEqual(css?.limits, [106, 101, 96, 91]);
  });

  test("an unknown sport uses the default heart rate and power zones", () => {
    const profile = profileOn(on("2026-03-01", ftp(250)), null);
    assert.deepEqual(zoneMetricsFor(profile, "padel"), ["heart_rate", "power"]);
    assert.equal(zonesFor(profile, "power", "padel")?.limits[0], 139);
    assert.deepEqual(zoneMetricsFor(profile, "swimming"), ["heart_rate", "pace"]);
  });

  test("weight is dated like any other setting", () => {
    const history = [
      ...on("2026-03-01", { kind: "weight", kg: 72 }),
      ...on("2026-06-01", { kind: "weight", kg: 70.5 }),
    ];
    assert.equal(profileOn(history, "2026-04-01").weightKg, 72);
    assert.equal(profileOn(history, null).weightKg, 70.5);
  });
});
