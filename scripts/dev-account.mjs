import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { parseArgs } from "node:util";

import { mockApple } from "../tests/helpers/apple.mjs";
import { migrate, rpcClient, startWorker } from "../tests/helpers/worker.mjs";

const { values: options } = parseArgs({
  options: { empty: { type: "boolean", default: false }, "api-only": { type: "boolean" } },
});

const API = "http://localhost:3000";
const WEB = "http://localhost:3001";
const APPLE = "http://localhost:3002";
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
const { runtime } = worker;
await migrate(runtime);

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
  started.url = started.url.replace("https://appleid.apple.com", APPLE);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(started), { status: response.status, headers });
}

const apiServer = createServer(async (req, res) => {
  try {
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
});

const attribute = (value) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

function hiddenFields(form) {
  return [...form]
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${attribute(value)}">`)
    .join("");
}

const appleStandIn = createServer((req, res) => {
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
});

await Promise.all([
  new Promise((resolve) => apiServer.listen(3000, resolve)),
  new Promise((resolve) => appleStandIn.listen(3002, resolve)),
]);

if (!options.empty) {
  const { token } = await apple.signIn(runtime, ATHLETE);
  const ride = rpcClient(runtime, { token });
  for (const path of SEEDED_RIDES) {
    const file = new File([await readFile(path)], path.split("/").at(-1));
    await ride.activities.upload({ file, source: "trainstack" });
  }
}

const web = options["api-only"]
  ? null
  : spawn("bun", ["run", "--cwd", "hosted/apps/account", "dev:bare"], { stdio: "inherit" });

async function stop() {
  web?.kill();
  apiServer.close();
  appleStandIn.close();
  await worker.dispose();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
web?.on("exit", stop);

console.log(`
API on ${API}, with Apple played by ${APPLE}.
${options.empty ? "No activities are seeded." : `${SEEDED_RIDES.length} rides from apps/ride are seeded.`}
${web ? `Open ${WEB} and sign in with Apple to reach ${ATHLETE.email}.` : "The web app is not started."}
Everything lives in memory and is gone when this stops.
`);
