import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { chromium } from "playwright";

import {
  SHOWCASE_WIDTHS,
  framePath,
  showcaseEntries,
} from "../hosted/apps/account/src/showcase/entries.ts";
import { bodyHash } from "../hosted/apps/account/src/showcase/recording.ts";
import { mockApple } from "../tests/helpers/apple.mjs";
import { migrate, rpcClient, startWorker } from "../tests/helpers/worker.mjs";
import {
  activityFile,
  seedCheckIns,
  seedHistory,
  seedLibrary,
  seedLogbook,
  seedPlan,
  tracks,
} from "./dev-history.mjs";

const { values: options } = parseArgs({
  options: {
    screenshots: { type: "boolean", default: false },
    "no-record": { type: "boolean", default: false },
    only: { type: "string" },
    locale: { type: "string", default: "en-GB" },
    "web-port": { type: "string" },
  },
});

const LOCALE = Intl.getCanonicalLocales(options.locale)[0];

const APP = resolve("hosted/apps/account");
const RECORDINGS = join(APP, ".showcase", "recordings");
const SCREENSHOTS = join(APP, ".showcase", "screenshots", LOCALE);
const SERVER = "http://api.showcase.localhost";
const TIME_ZONE = "Europe/Budapest";
const RETRIES_GIVE_UP_MS = 15_000;
const HEIGHTS = { phone: 844, desktop: 900 };
const PIXEL_RATIOS = { phone: 2, desktop: 1 };
const QUIET_MS = 700;
const DAY_MS = 86_400_000;

const ATHLETE = { name: "Réka Molnár", email: "reka@example.com" };
const WORLDS = {
  athlete: { ...ATHLETE, subject: "001234.showcase-athlete", seed: seedAthlete },
  "rough-day": {
    ...ATHLETE,
    email: "reka+rough-day@example.com",
    subject: "001234.showcase-rough-day",
    seed: async (client, at) => {
      const places = await seedAthlete(client, at);
      await client.checkIns.put({
        day: localDay(at),
        ratings: { sleep: 1, energy: 2, soreness: 2, stress: 2, mood: 2 },
        illness: null,
        injury: null,
        note: "Flight landed at 2 am, four hours of sleep",
        updatedAt: at,
      });
      return places;
    },
  },
  newcomer: {
    name: "Bence Tóth",
    email: "bence@example.com",
    subject: "001234.showcase-newcomer",
    seed: async () => null,
  },
  imported: {
    name: "Dóra Szabó",
    email: "dora@example.com",
    subject: "001234.showcase-imported",
    seed: async (client, at) => {
      await client.settings.setTimeZone({ timeZone: TIME_ZONE });
      await seedHistory(client, {
        today: new Date(`${localDay(at)}T03:00:00Z`),
        weeks: 8,
        withSettings: false,
      });
      return null;
    },
  },
};

const localDay = (date) => date.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });

const chosen = options.only ? new Set(options.only.split(",")) : null;
const entries = showcaseEntries.filter((entry) => !chosen || chosen.has(entry.id));

function freePort() {
  return new Promise((done, failed) => {
    const probe = createServer();
    probe.once("error", failed);
    probe.listen(0, "localhost", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

const webPort = Number(options["web-port"] ?? (await freePort()));
const WEB = `http://localhost:${webPort}`;

async function seedAthlete(client, at) {
  await client.settings.setTimeZone({ timeZone: TIME_ZONE });
  const { workouts, list } = await seedLibrary(client);
  await seedHistory(client, { today: new Date(`${localDay(at)}T03:00:00Z`) });
  await seedPlan(client, { today: at });
  await seedCheckIns(client, { today: at });
  await seedLogbook(client, { today: at });
  return { workout: workouts[0].id, list: list.id };
}

async function analyseEverything(runtime, client) {
  const worker = await runtime.getWorker();
  for (let run = 0; run < 100; run++) {
    await worker.scheduled({ cron: "* * * * *" });
    const { activities } = await client.activities.list({ limit: 200 });
    if (!activities.some((activity) => activity.analysisDue)) {
      for (let more = 0; more < 5; more++) await worker.scheduled({ cron: "* * * * *" });
      return;
    }
  }
  throw new Error("Activities are still waiting for analysis after 100 scheduled runs");
}

function required(value, what) {
  if (!value) throw new Error(`The seeded world has no ${what}`);
  return value;
}

async function placesOf(client, at, seeded) {
  const { activities } = await client.activities.list({ limit: 200, onePerWorkout: true });
  const named = (name) => activities.find((activity) => activity.name === name)?.id;
  const latest = (test) => activities.find(test);
  const today = localDay(at);
  const from = localDay(new Date(at.getTime() - 28 * DAY_MS));
  const through = localDay(new Date(at.getTime() + 14 * DAY_MS));
  const { days } = await client.calendar.range({ from, through });
  const planned = days.flatMap((day) => day.planned);
  const indoor = new Set(activities.filter((activity) => activity.indoor).map(({ id }) => id));
  const done = planned.findLast(
    (item) =>
      item.state === "completed" &&
      item.compliance !== null &&
      indoor.has(item.pairing?.activityId),
  );
  const strength = latest((activity) => activity.sport === "strength");
  const bouldering = latest((activity) => activity.sport === "bouldering");
  return {
    ...seeded,
    outdoorRide: required(named("Coffee ride to Zsámbék"), "coffee ride"),
    indoorRide: required(done?.pairing?.activityId, "indoor ride paired with a planned workout"),
    tempoRun: required(named("Tempo run"), "tempo run"),
    gpsGapRun: required(named("Easy run, GPS lost on the island"), "run with a GPS gap"),
    duplicateRide: required(
      latest((activity) => activity.duplicates.length > 0)?.id,
      "activity recorded twice",
    ),
    strength: required(strength?.id, "strength session"),
    strengthSession: required(strength?.logged?.sessionId, "logged strength session"),
    bouldering: required(bouldering?.id, "bouldering session"),
    boulderingSession: required(bouldering?.logged?.sessionId, "logged bouldering session"),
    plannedDone: required(done?.id, "completed planned workout"),
    plannedMissed: required(
      planned.findLast((item) => item.state === "missed")?.id,
      "missed planned workout",
    ),
    plannedSkipped: required(
      planned.findLast((item) => item.state === "skipped")?.id,
      "skipped planned workout",
    ),
    plannedAhead: required(
      planned.find(
        (item) => item.state === "planned" && item.day > today && item.content.kind === "workout",
      )?.id,
      "planned workout ahead",
    ),
  };
}

async function uploadFiles(at) {
  const directory = await mkdtemp(join(tmpdir(), "trainstack-showcase-uploads-"));
  const morning = new Date(`${localDay(new Date(at.getTime() - DAY_MS))}T05:40:00Z`);
  const ride = activityFile({
    sport: "cycling",
    start: morning.toISOString(),
    blocks: [{ seconds: 3600, watts: 170 }],
    seed: 7,
    track: tracks.budaHills(),
  });
  await writeFile(join(directory, "morning-ride.fit"), ride);
  await writeFile(
    join(directory, "SampleRide.fit"),
    await readFile("apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit"),
  );
  await writeFile(join(directory, "notes.txt"), "Legs felt heavy on the climbs.\n");
  return directory;
}

async function startWebApp() {
  const web = spawn(
    "bun",
    ["run", "--cwd", APP, "dev:bare", "--port", String(webPort), "--strictPort"],
    {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, VITE_SERVER_URL: SERVER },
      detached: true,
    },
  );
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      process.kill(-web.pid);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  process.on("exit", stop);
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      if ((await fetch(`${WEB}/__dev/showcase`)).ok) return stop;
    } catch {}
    await new Promise((wait) => setTimeout(wait, 250));
  }
  stop();
  throw new Error(`The web app did not start on ${WEB}`);
}

async function quiet(page, busy = () => 0) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  let quietSince = Date.now();
  for (let waited = 0; waited < 20_000 && Date.now() - quietSince < QUIET_MS; waited += 50) {
    if (busy() > 0) quietSince = Date.now();
    await page.waitForTimeout(50);
  }
}

async function act(page, steps, files) {
  for (const step of steps ?? []) {
    if ("click" in step) await page.getByRole("button", { name: step.click }).first().click();
    else if ("fill" in step) {
      for (const [label, text] of Object.entries(step.fill)) {
        await page.getByLabel(label, { exact: true }).fill(text);
      }
    } else {
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles(step.upload.map((name) => join(files, name)));
    }
  }
}

async function record(browser) {
  const apple = mockApple();
  const worker = await startWorker({
    bindings: {
      NODE_ENV: "development",
      BETTER_AUTH_URL: SERVER,
      WEB_APP_ORIGIN: WEB,
      APPLE_SIGN_IN_KEY_ID: "LOCALKEY01",
      APPLE_SIGN_IN_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "P-256" })
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString(),
    },
    outboundService: (request) => apple.fetch(request),
  });
  try {
    await migrate(worker.runtime);
    const at = new Date();
    const files = await uploadFiles(at);
    await mkdir(RECORDINGS, { recursive: true });
    for (const [world, { seed, ...identity }] of Object.entries(WORLDS)) {
      const worldEntries = showcaseEntries
        .filter((entry) => entry.world === world)
        .toSorted((one, other) => Number(Boolean(one.steps)) - Number(Boolean(other.steps)));
      const { token } = await apple.signIn(worker.runtime, identity);
      const client = rpcClient(worker.runtime, { token });
      const seeded = await seed(client, at);
      await analyseEverything(worker.runtime, client);
      const places = seeded ? await placesOf(client, at, seeded) : null;
      const recording = { world, at: at.toISOString(), entries: {} };
      const context = await browser.newContext({
        timezoneId: TIME_ZONE,
        locale: LOCALE,
        viewport: { width: SHOWCASE_WIDTHS.desktop, height: HEIGHTS.desktop },
      });
      await context.clock.setFixedTime(at);
      let exchanges = [];
      let inFlight = 0;
      await context.route(`${SERVER}/**`, async (route) => {
        inFlight += 1;
        try {
          const request = route.request();
          const headers = { ...(await request.allHeaders()), authorization: `Bearer ${token}` };
          const body = request.postDataBuffer() ?? undefined;
          const response = await worker.runtime.dispatchFetch(request.url(), {
            method: request.method(),
            headers,
            body,
          });
          const bytes = Buffer.from(await response.arrayBuffer());
          const contentType = response.headers.get("content-type");
          if (request.method() !== "OPTIONS") {
            const url = new URL(request.url());
            exchanges.push({
              method: request.method(),
              path: `${url.pathname}${url.search}`,
              bodyHash: await bodyHash(body ?? new Uint8Array(), headers["content-type"] ?? null),
              status: response.status,
              contentType,
              response: /json|text/.test(contentType ?? "")
                ? { text: bytes.toString("utf8") }
                : { base64: bytes.toString("base64") },
            });
          }
          await route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: bytes,
          });
        } finally {
          inFlight -= 1;
        }
      });
      const page = await context.newPage();
      for (const entry of worldEntries) {
        if (entry.network && entry.network !== "answers") {
          recording.entries[entry.id] = { path: entry.path(places), exchanges: [] };
          continue;
        }
        exchanges = [];
        const path = entry.path(places);
        console.log(`Recording ${entry.id} at ${path}`);
        await page.goto(`${WEB}${path}`);
        await quiet(page, () => inFlight);
        await act(page, entry.steps, files);
        await quiet(page, () => inFlight);
        recording.entries[entry.id] = { path, exchanges };
      }
      await context.close();
      await writeFile(join(RECORDINGS, `${world}.json`), JSON.stringify(recording));
    }
    return files;
  } finally {
    await worker.dispose();
  }
}

async function readRecording(world) {
  try {
    return JSON.parse(await readFile(join(RECORDINGS, `${world}.json`), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function screenshot(browser, files) {
  await mkdir(SCREENSHOTS, { recursive: true });
  for (const name of await readdir(SCREENSHOTS)) {
    if (name.endsWith(".png") && (!chosen || [...chosen].some((id) => name.includes(`-${id}-`)))) {
      await rm(join(SCREENSHOTS, name));
    }
  }
  const recordings = new Map();
  const problems = [];
  const taken = [];
  for (const [width, pixels] of Object.entries(SHOWCASE_WIDTHS)) {
    const context = await browser.newContext({
      timezoneId: TIME_ZONE,
      locale: LOCALE,
      viewport: { width: pixels, height: HEIGHTS[width] },
      deviceScaleFactor: PIXEL_RATIOS[width],
      isMobile: width === "phone",
      hasTouch: width === "phone",
    });
    await context.route(`${SERVER}/**`, (route) => {
      problems.push(`A request reached the network: ${route.request().url()}`);
      return route.abort();
    });
    for (const entry of entries) {
      if (!recordings.has(entry.world))
        recordings.set(entry.world, await readRecording(entry.world));
      const recording = recordings.get(entry.world);
      if (!recording) throw new Error(`Nothing is recorded for ${entry.world}`);
      const page = await context.newPage();
      page.on("console", (message) => {
        if (
          entry.route === "__root__" &&
          message.text().includes("the server responded with a status of 404")
        )
          return;
        if (message.type() === "warning" && message.text().includes("could not be loaded"))
          problems.push(`${entry.id} at ${width}: ${message.text()}`);
        if (message.type() === "error") problems.push(`${entry.id} at ${width}: ${message.text()}`);
      });
      page.on("pageerror", (error) => problems.push(`${entry.id} at ${width}: ${error.message}`));
      const recorded = recording.entries[entry.id];
      if (!recorded) throw new Error(`${entry.id} is not recorded. Record again`);
      await page.goto(`${WEB}${framePath(entry, recorded.path)}`);
      if (entry.network === "fails") {
        await page.getByRole("alert").first().waitFor({ timeout: RETRIES_GIVE_UP_MS });
      }
      await quiet(page);
      await act(page, entry.steps, files);
      await quiet(page);
      const number = String(showcaseEntries.indexOf(entry) + 1).padStart(2, "0");
      const file = join(SCREENSHOTS, `${number}-${entry.id}-${width}.png`);
      const dialogOpen = (await page.locator("dialog[open]").count()) > 0;
      await page.screenshot({ path: file, fullPage: !dialogOpen });
      taken.push(file);
      console.log(`Took ${file}`);
      await page.close();
    }
    await context.close();
  }
  return { taken, problems };
}

const stopWebApp = await startWebApp();
const browser = await chromium.launch();
let files;
try {
  files = options["no-record"]
    ? await uploadFiles(new Date((await readRecording("athlete")).at))
    : await record(browser);
  if (options.screenshots) {
    const { taken, problems } = await screenshot(browser, files);
    console.log(`\n${taken.length} screenshots in ${SCREENSHOTS}`);
    if (problems.length > 0) {
      console.error(`\nThe showcase pages reported problems:\n${problems.join("\n")}`);
      process.exitCode = 1;
    }
  }
} finally {
  await browser.close();
  if (files) await rm(files, { recursive: true, force: true });
}

if (options.screenshots) {
  stopWebApp();
} else {
  console.log(`\nThe showcase is on ${WEB}/__dev/showcase. Stop it with Ctrl-C.`);
  const stop = () => {
    stopWebApp();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
