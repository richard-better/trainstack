import { FitWriter, fitTime } from "../packages/fit/test/fit-writer.ts";

const DAY_MS = 86_400_000;
const FIT_SPORT = { cycling: 2, running: 1 };
const FIT_SUB_SPORT = { road: 7, indoor_cycling: 6, generic: 0 };

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

const ftpChange = (value) => ({ kind: "threshold", sport: null, threshold: "ftp", value });

function rideBlocks(kind, ftp) {
  const warmUp = [{ seconds: 900, watts: 0.6 * ftp }];
  const coolDown = [{ seconds: 600, watts: 0.5 * ftp }];
  const repeats = (count, on, off) => Array.from({ length: count }, () => [on, off]).flat();
  switch (kind) {
    case "threshold":
      return [
        ...warmUp,
        ...repeats(3, { seconds: 600, watts: 1.0 * ftp }, { seconds: 300, watts: 0.55 * ftp }),
        ...coolDown,
      ];
    case "vo2":
      return [
        ...warmUp,
        ...repeats(5, { seconds: 240, watts: 1.18 * ftp }, { seconds: 240, watts: 0.5 * ftp }),
        { seconds: 20, watts: 2.4 * ftp },
        ...coolDown,
      ];
    case "endurance":
      return [{ seconds: 3600 * 2.5, watts: 0.66 * ftp }];
    case "recovery":
      return [{ seconds: 2700, watts: 0.5 * ftp }];
    default:
      throw new Error(`No ride called ${kind}`);
  }
}

function runBlocks(kind, thresholdSpeed) {
  switch (kind) {
    case "easy":
      return [{ seconds: 2700, speed: 0.78 * thresholdSpeed }];
    case "long":
      return [{ seconds: 5400, speed: 0.8 * thresholdSpeed }];
    case "tempo":
      return [
        { seconds: 600, speed: 0.75 * thresholdSpeed },
        { seconds: 1200, speed: 0.97 * thresholdSpeed },
        { seconds: 600, speed: 0.72 * thresholdSpeed },
      ];
    case "race":
      return [{ seconds: 1260, speed: 1.06 * thresholdSpeed }];
    default:
      throw new Error(`No run called ${kind}`);
  }
}

function heartRateFor(effort, previous) {
  const target = 105 + effort * 68;
  return previous + (target - previous) * 0.02;
}

export function activityFile({ sport, start, blocks, seed, indoor = false, withPower = true }) {
  const next = random(seed);
  const startTime = fitTime(start);
  const writer = new FitWriter()
    .define(0, 0, [
      { number: 0, type: "enum" },
      { number: 1, type: "uint16" },
      { number: 4, type: "uint32" },
    ])
    .data(0, [4, 255, startTime])
    .define(1, 20, [
      { number: 253, type: "uint32" },
      { number: 2, type: "uint16" },
      { number: 3, type: "uint8" },
      { number: 4, type: "uint8" },
      { number: 5, type: "uint32" },
      { number: 6, type: "uint16" },
      { number: 7, type: "uint16" },
    ])
    .define(2, 19, [
      { number: 253, type: "uint32" },
      { number: 2, type: "uint32" },
      { number: 7, type: "uint32" },
      { number: 8, type: "uint32" },
      { number: 9, type: "uint32" },
    ]);
  let second = 0;
  let distance = 0;
  let heartRate = 95;
  const laps = [];
  for (const block of blocks) {
    const lapLength = block.seconds > 1800 ? 1200 : block.seconds;
    let lapStart = second;
    let lapDistance = distance;
    for (let index = 0; index < block.seconds; index++) {
      const hill = indoor ? 0 : Math.sin((second / 900) * Math.PI);
      const altitude = indoor ? 120 : 140 + 40 * hill;
      let speed;
      let power = null;
      let effort;
      if (sport === "cycling") {
        const watts = Math.max(0, block.watts * (1 + (next() - 0.5) * 0.18 + hill * 0.08));
        power = withPower ? Math.round(watts) : null;
        speed = 4 + Math.cbrt(watts) * 1.55 - hill * 1.2;
        effort = block.watts / 250;
      } else {
        speed = block.speed * (1 + (next() - 0.5) * 0.06 - hill * 0.06);
        effort = block.speed / 4;
      }
      heartRate = heartRateFor(effort, heartRate) + (next() - 0.5) * 1.5;
      distance += speed;
      writer.data(1, [
        startTime + second,
        Math.round((altitude + 500) * 5),
        Math.round(heartRate),
        sport === "cycling" ? Math.round(85 + (next() - 0.5) * 8) : Math.round(86 + next() * 4),
        Math.round(distance * 100),
        Math.round(speed * 1000),
        power,
      ]);
      second += 1;
      if (second - lapStart >= lapLength || index === block.seconds - 1) {
        laps.push({ start: lapStart, end: second, distance: distance - lapDistance });
        lapStart = second;
        lapDistance = distance;
      }
    }
  }
  for (const lap of laps) {
    writer.data(2, [
      startTime + lap.end,
      startTime + lap.start,
      (lap.end - lap.start) * 1000,
      (lap.end - lap.start) * 1000,
      Math.round(lap.distance * 100),
    ]);
  }
  writer
    .define(3, 18, [
      { number: 253, type: "uint32" },
      { number: 2, type: "uint32" },
      { number: 5, type: "enum" },
      { number: 6, type: "enum" },
      { number: 7, type: "uint32" },
      { number: 8, type: "uint32" },
      { number: 9, type: "uint32" },
    ])
    .data(3, [
      startTime + second,
      startTime,
      FIT_SPORT[sport],
      sport === "cycling" ? (indoor ? FIT_SUB_SPORT.indoor_cycling : FIT_SUB_SPORT.road) : 0,
      second * 1000,
      second * 1000,
      Math.round(distance * 100),
    ]);
  return writer.file();
}

const dayIso = (time) => new Date(time).toISOString().slice(0, 10);

export function trainingHistory({ today = new Date(), weeks = 30 } = {}) {
  const thisMonday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const mondayOffset = (new Date(thisMonday).getUTCDay() + 6) % 7;
  const firstMonday = thisMonday - mondayOffset * DAY_MS - weeks * 7 * DAY_MS;
  const ftpRaisedWeek = Math.floor(weeks * 0.6);
  const paceSetWeek = 4;
  const illness = new Set([Math.floor(weeks * 0.45)]);
  const activities = [];
  for (let week = 0; week <= weeks; week++) {
    if (illness.has(week)) continue;
    const recoveryWeek = week % 4 === 3;
    const riderFtp = week >= ftpRaisedWeek ? 262 : 240;
    const thresholdSpeed = 1000 / (week >= ftpRaisedWeek ? 262 : 275);
    const monday = firstMonday + week * 7 * DAY_MS;
    const plan = recoveryWeek
      ? [
          [1, "cycling", "recovery", "Recovery spin", true],
          [3, "running", "easy", "Easy run"],
          [5, "cycling", "endurance", "Saturday long ride"],
        ]
      : [
          [1, "cycling", week % 2 === 0 ? "threshold" : "vo2", null, true],
          [2, "running", "easy", "Easy run"],
          [3, "running", "tempo", "Tempo run"],
          [5, "cycling", "endurance", "Saturday long ride"],
          [
            6,
            "running",
            week === weeks - 6 ? "race" : "long",
            week === weeks - 6 ? "Parkrun PB attempt" : "Long run",
          ],
        ];
    for (const [offset, sport, kind, name, indoor = false] of plan) {
      const time = monday + offset * DAY_MS + (sport === "running" ? 6.5 : 17.5) * 3600_000;
      if (time > today.getTime() - 3600_000 * 3) continue;
      activities.push({
        sport,
        kind,
        indoor,
        name:
          name ?? (kind === "threshold" ? "Threshold intervals, 3 × 10 min" : "VO2 max, 5 × 4 min"),
        start: new Date(time).toISOString(),
        blocks: sport === "cycling" ? rideBlocks(kind, riderFtp) : runBlocks(kind, thresholdSpeed),
        seed: week * 10 + offset,
      });
    }
  }
  const settings = [
    { day: dayIso(firstMonday - 7 * DAY_MS), change: ftpChange(240) },
    { day: dayIso(firstMonday + ftpRaisedWeek * 7 * DAY_MS), change: ftpChange(262) },
    {
      day: dayIso(firstMonday - 7 * DAY_MS),
      change: {
        kind: "threshold",
        sport: null,
        threshold: "lactate_threshold_heart_rate",
        value: 170,
      },
    },
    {
      day: dayIso(firstMonday - 7 * DAY_MS),
      change: { kind: "threshold", sport: null, threshold: "max_heart_rate", value: 190 },
    },
    {
      day: dayIso(firstMonday - 7 * DAY_MS),
      change: { kind: "threshold", sport: null, threshold: "resting_heart_rate", value: 48 },
    },
    {
      day: dayIso(firstMonday + paceSetWeek * 7 * DAY_MS),
      change: { kind: "sport", sport: "running", listed: true },
    },
    {
      day: dayIso(firstMonday + paceSetWeek * 7 * DAY_MS),
      change: { kind: "threshold", sport: "running", threshold: "threshold_pace", value: 275 },
    },
    {
      day: dayIso(firstMonday + ftpRaisedWeek * 7 * DAY_MS),
      change: { kind: "threshold", sport: "running", threshold: "threshold_pace", value: 262 },
    },
  ];
  const duplicate = activities.findLast((activity) => activity.kind === "endurance");
  return { activities, settings, duplicate };
}

export async function seedHistory(client, { today = new Date(), weeks } = {}) {
  const { activities, settings, duplicate } = trainingHistory({ today, weeks });
  let clock = Date.now() - settings.length * 1000;
  await client.settings.write({
    writes: settings.map(({ day, change }) => ({
      day,
      change,
      updatedAt: new Date((clock += 1000)),
    })),
  });
  for (const activity of activities) {
    const bytes = activityFile(activity);
    await client.activities.upload({
      file: new File([bytes], `${activity.start.slice(0, 10)}-${activity.kind}.fit`),
      source: "trainstack",
      name: activity.name,
    });
  }
  if (duplicate) {
    const bytes = activityFile({ ...duplicate, seed: duplicate.seed + 1 });
    await client.activities.upload({
      file: new File([bytes], "strava-copy.fit"),
      source: "strava",
      name: duplicate.name,
    });
  }
  return activities.length + (duplicate ? 1 : 0);
}
