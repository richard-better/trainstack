import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { parseArgs } from "node:util";

import { mockApple } from "../tests/helpers/apple.mjs";
import { seedHistory } from "./dev-history.mjs";
import { migrate, rpcClient, startWorker } from "../tests/helpers/worker.mjs";

const { values: options } = parseArgs({
  options: {
    empty: { type: "boolean", default: false },
    history: { type: "boolean", default: false },
    "api-only": { type: "boolean" },
    "api-port": { type: "string", default: process.env.TRAINSTACK_API_PORT },
    "web-port": { type: "string", default: process.env.TRAINSTACK_WEB_PORT },
    "apple-port": { type: "string", default: process.env.TRAINSTACK_APPLE_PORT },
  },
});

const ANY_FREE_PORT = 0;
const LOCAL_STORAGE_DUMP = "/__local/storage";
const EVERY_WAY_LOCALHOST_IS_REACHED = ["127.0.0.1", "::1", "::"];

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

async function isFree(port) {
  for (const host of EVERY_WAY_LOCALHOST_IS_REACHED) {
    const probe = createServer();
    try {
      await listen(probe, port, host);
    } catch (error) {
      if (error.code === "EADDRINUSE") return false;
      if (error.code !== "EADDRNOTAVAIL" && error.code !== "EAFNOSUPPORT") throw error;
    } finally {
      await new Promise((resolve) => probe.close(() => resolve()));
    }
  }
  return true;
}

async function portFor(chosen, preferred) {
  if (chosen) return Number(chosen);
  if (await isFree(preferred)) return preferred;
  for (;;) {
    const probe = createServer();
    const port = await listen(probe, ANY_FREE_PORT);
    await new Promise((resolve) => probe.close(resolve));
    if (await isFree(port)) return port;
  }
}

let runtime;
let migrated = false;
const apiServer = createServer((req, res) => handleApi(req, res));
const appleStandIn = createServer((req, res) => handleApple(req, res));
const ONLY_THIS_MACHINE = "localhost";
const apiPort = await listen(
  apiServer,
  await portFor(options["api-port"], 3000),
  ONLY_THIS_MACHINE,
);
const applePort = await listen(
  appleStandIn,
  await portFor(options["apple-port"], 3002),
  ONLY_THIS_MACHINE,
);
const webPort = await portFor(options["web-port"], 3001);
const API = `http://localhost:${apiPort}`;
const APPLE = `http://localhost:${applePort}`;
const WEB = `http://localhost:${webPort}`;
const ATHLETE = { email: "athlete@example.com", subject: "001234.local-athlete" };
const SEEDED_RIDES = [
  "apps/ride/RideKit/Sources/RideData/Resources/SampleRide.fit",
  "apps/ride/RideKit/Tests/RideCoreTests/Traces/trainer-and-strap.fit",
];

const apple = mockApple();
const worker = await startWorker({
  bindings: {
    NODE_ENV: "development",
    BETTER_AUTH_URL: API,
    WEB_APP_ORIGIN: WEB,
    APPLE_SIGN_IN_KEY_ID: "LOCALKEY01",
    APPLE_SIGN_IN_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "P-256" })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString(),
  },
  outboundService: (request) => apple.fetch(request),
});
runtime = worker.runtime;
await migrate(runtime);
migrated = true;

async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

async function reply(response, res) {
  const headers = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function towardsTheStandIn(response) {
  const started = await response.json();
  if (typeof started.url === "string") {
    started.url = started.url.replace("https://appleid.apple.com", APPLE);
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(started), { status: response.status, headers });
}

async function everythingStored() {
  const db = await runtime.getD1Database("DB");
  const tables = {};
  const names = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    )
    .all();
  for (const { name } of names.results) {
    tables[name] = (await db.prepare(`SELECT * FROM "${name}"`).all()).results;
  }
  const files = [];
  const bucket = await runtime.getR2Bucket("ACTIVITY_FILES");
  let cursor;
  do {
    const page = await bucket.list({ cursor });
    files.push(...page.objects.map(({ key, size }) => ({ key, size })));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { tables, files };
}

async function handleApi(req, res) {
  try {
    if (!migrated) return res.writeHead(503).end("The API is still starting.");
    if (req.method === "GET" && req.url === LOCAL_STORAGE_DUMP) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(await everythingStored(), null, 2));
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    const isAppleCallback = req.method === "POST" && req.url === "/api/auth/callback/apple";
    if (isAppleCallback) headers.set("origin", "https://appleid.apple.com");
    const response = await runtime.dispatchFetch(`${API}${req.url}`, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : await bodyOf(req),
      redirect: "manual",
    });
    const startsAppleSignIn = req.method === "POST" && req.url === "/api/auth/sign-in/social";
    await reply(
      startsAppleSignIn && response.ok ? await towardsTheStandIn(response) : response,
      res,
    );
  } catch (error) {
    console.error(error);
    res.writeHead(500).end(String(error));
  }
}

const attribute = (value) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

function hiddenFields(form) {
  return [...form]
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${attribute(value)}">`)
    .join("");
}

function handleApple(req, res) {
  const url = new URL(req.url, APPLE);
  if (url.pathname !== "/auth/authorize") return res.writeHead(404).end();
  const { form, redirectURI } = apple.authorize(
    `https://appleid.apple.com${url.pathname}${url.search}`,
    { ...ATHLETE, name: "Local Athlete" },
  );
  const cancel = new URLSearchParams({
    state: form.get("state"),
    error: "user_cancelled_authorize",
  });
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<meta name="viewport" content="width=device-width">
<title>Apple stand-in</title>
<body style="font-family: system-ui; padding: 24px; max-width: 420px">
<h1>Apple stand-in</h1>
<p>This local page plays Apple's part in signing in. Continue to sign in as ${ATHLETE.email}.</p>
<form method="post" action="${attribute(redirectURI)}">${hiddenFields(form)}<button id="continue" autofocus>Continue</button></form>
<form method="post" action="${attribute(redirectURI)}">${hiddenFields(cancel)}<button id="cancel">Cancel</button></form>`);
}

if (!options.empty) {
  const { token } = await apple.signIn(runtime, ATHLETE);
  const ride = rpcClient(runtime, { token });
  for (const path of SEEDED_RIDES) {
    const file = new File([await readFile(path)], path.split("/").at(-1));
    await ride.activities.upload({ file, source: "trainstack" });
  }
  const now = new Date();
  const copies = [];
  for (const id of ["threshold-classic-60", "vo2-max-booster", "long-endurance-90"]) {
    copies.push(await ride.builtinWorkouts.copy({ id, as: crypto.randomUUID(), updatedAt: now }));
  }
  const list = await ride.workoutLists.put({
    id: crypto.randomUUID(),
    name: "This week",
    updatedAt: now,
  });
  let after = null;
  for (const copy of copies) {
    await ride.workoutLists.place({ id: list.id, workoutId: copy.id, after, updatedAt: now });
    after = copy.id;
  }
  if (options.history) await seedHistory(ride);
}

const ANALYSIS_EVERY_MS = 20_000;
async function analyse() {
  try {
    await (await runtime.getWorker()).scheduled({ cron: "* * * * *" });
  } catch (error) {
    console.error(error);
  }
}
await analyse();
const analysis = setInterval(analyse, ANALYSIS_EVERY_MS);

const web = options["api-only"]
  ? null
  : spawn(
      "bun",
      [
        "run",
        "--cwd",
        "hosted/apps/account",
        "dev:bare",
        "--port",
        String(webPort),
        "--strictPort",
      ],
      { stdio: "inherit", env: { ...process.env, VITE_SERVER_URL: API }, detached: true },
    );

let webAppStopped = false;

function stopTheWebApp() {
  if (!web || webAppStopped) return;
  webAppStopped = true;
  try {
    process.kill(-web.pid);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function stop() {
  clearInterval(analysis);
  stopTheWebApp();
  apiServer.close();
  appleStandIn.close();
  await worker.dispose();
  process.exit(0);
}
process.on("exit", stopTheWebApp);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
web?.on("exit", stop);

console.log(`
API on ${API}, with Apple played by ${APPLE}. ${API}${LOCAL_STORAGE_DUMP} shows everything in D1 and R2.
${options.empty ? "Nothing is seeded." : `${SEEDED_RIDES.length} rides from apps/ride, three workouts and a list are seeded${options.history ? ", with 30 weeks of rides and runs before today" : ""}.`}
Activities are analysed every ${ANALYSIS_EVERY_MS / 1000} seconds, as the deployed API's cron does every minute.
${web ? `Open ${WEB} and sign in with Apple to reach ${ATHLETE.email}.` : `The web app is not started. Start it on ${WEB}, the origin the API trusts, with VITE_SERVER_URL=${API}.`}
Everything lives in memory and is gone when this stops.
`);
