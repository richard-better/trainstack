import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { api, migrate, startWorker } from "./helpers/worker.mjs";

const credentials = { STRAVA_CLIENT_ID: "12345", STRAVA_CLIENT_SECRET: "client-secret-value" };
const fit = new Uint8Array([0x0e, 0x20, 0x01, 0x02, 0xff, 0x00, 0x7f]);

let worker;
let runtime;
let db;
/** What the Worker asked Strava for, and how Strava answers. */
let strava;

const tokens = (suffix, expiresAt = 4_102_444_800) => ({
  token_type: "Bearer",
  access_token: `access-${suffix}`,
  refresh_token: `refresh-${suffix}`,
  expires_at: expiresAt,
});

function reset(overrides = {}) {
  strava = {
    requests: [],
    token: (body) =>
      body.grant_type === "refresh_token"
        ? Response.json(tokens(2))
        : Response.json({
            ...tokens(1),
            athlete: { id: 42, firstname: "Ada", lastname: "Rider" },
          }),
    upload: () => Response.json({ id: 7, error: null, activity_id: null }, { status: 201 }),
    status: () => Response.json({ id: 7, error: null, activity_id: 99 }),
    ...overrides,
  };
}

async function stravaServer(request) {
  const url = new URL(request.url);
  const entry = {
    method: request.method,
    path: url.pathname,
    auth: request.headers.get("authorization"),
  };
  if (url.pathname === "/oauth/token") {
    entry.body = Object.fromEntries(new URLSearchParams(await request.text()));
    strava.requests.push(entry);
    return strava.token(entry.body);
  }
  if (url.pathname === "/api/v3/uploads" && request.method === "POST") {
    const form = await request.formData();
    const file = form.get("file");
    entry.form = {
      data_type: form.get("data_type"),
      trainer: form.get("trainer"),
      name: form.get("name"),
      fileName: file.name,
      bytes: [...new Uint8Array(await file.arrayBuffer())],
    };
    strava.requests.push(entry);
    return strava.upload(entry);
  }
  strava.requests.push(entry);
  if (url.pathname.startsWith("/api/v3/uploads/")) return strava.status(entry);
  if (url.pathname === "/oauth/deauthorize") return Response.json({});
  return new Response("unexpected", { status: 500 });
}

before(
  async () => {
    reset();
    worker = await startWorker({ bindings: credentials, outboundService: stravaServer });
    runtime = worker.runtime;
    await migrate(runtime);
    db = await runtime.getD1Database("DB");
  },
  { timeout: 60_000 },
);

// The app-wide limit on code exchanges is shared by every test, so each starts with it unspent.
beforeEach(async () => {
  await db.prepare("DELETE FROM strava_budget WHERE key = 'app:exchange'").run();
});

after(async () => {
  await worker?.dispose();
});

let accounts = 0;
async function signUp() {
  const email = `rider${++accounts}@example.com`;
  const response = await runtime.dispatchFetch(`${api}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://trainstackhq.com" },
    body: JSON.stringify({ name: `Rider ${accounts}`, email, password: "test-password-12345" }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return { email, token: response.headers.get("set-auth-token") };
}

const call = (token, path, init = {}) =>
  runtime.dispatchFetch(`${api}/strava${path}`, {
    redirect: "manual",
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });

/** A verifier the app would keep to itself, and the challenge it sends the API. */
function makeVerifier() {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

const postJson = (token, path, body) =>
  call(token, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** Starts connecting, as the app does, and returns the state Strava would hand back. */
async function start(token, pkce = makeVerifier()) {
  const response = await postJson(token, "/connect", { code_challenge: pkce.challenge });
  assert.equal(response.status, 200, await response.clone().text());
  const { url } = await response.json();
  return { ...pkce, url, state: new URL(url).searchParams.get("state") };
}

const callback = (state, query = "code=the-code&scope=read,activity:write") =>
  call(null, `/callback?state=${encodeURIComponent(state)}&${query}`);

/** Connects Strava the whole way: the page, the callback and the app collecting the result. */
async function connect(token) {
  const link = await start(token);
  const response = await callback(link.state);
  assert.equal(response.status, 302);
  const completed = await postJson(token, "/connect/complete", { code_verifier: link.verifier });
  assert.equal(completed.status, 200, await completed.clone().text());
  return { ...link, response };
}

/** Sends a ride, with the budgets for calls to Strava topped up. */
const upload = async (token, query = "name=Threshold%203x12&fileName=ride.fit") => {
  await db.prepare("DELETE FROM strava_budget").run();
  return call(token, `/uploads?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: fit,
  });
};

test("every route but Strava's callback needs the rider to be signed in", async () => {
  for (const [path, method] of [
    ["/connect", "POST"],
    ["", "GET"],
    ["", "DELETE"],
    ["/uploads", "POST"],
    ["/uploads/7", "GET"],
  ]) {
    const response = await call(null, path, { method });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
  assert.equal((await call("not-a-session", "", { method: "GET" })).status, 401);
});

test("connecting sends the rider to Strava for upload permission only, tied to their account", async () => {
  reset();
  const { token } = await signUp();
  const { url } = await start(token);
  const location = new URL(url);
  assert.equal(`${location.origin}${location.pathname}`, "https://www.strava.com/oauth/authorize");
  assert.equal(location.searchParams.get("client_id"), "12345");
  assert.equal(location.searchParams.get("redirect_uri"), `${api}/strava/callback`);
  assert.equal(location.searchParams.get("scope"), "activity:write");
  assert.equal(location.searchParams.get("response_type"), "code");
  assert.ok(!url.includes(credentials.STRAVA_CLIENT_SECRET));
  assert.deepEqual(await (await call(token, "")).json(), { connected: false });
  for (const body of [{}, { code_challenge: "short" }, { code_challenge: "$".repeat(43) }]) {
    assert.equal((await postJson(token, "/connect", body)).status, 400);
  }
});

test("the callback connects Strava to the rider who started, and keeps the tokens encrypted", async () => {
  reset();
  const { email, token } = await signUp();
  const { response } = await connect(token);

  assert.equal(response.headers.get("location"), "trainstackride://strava?connected=1");
  assert.deepEqual(strava.requests[0].body, {
    client_id: "12345",
    client_secret: "client-secret-value",
    code: "the-code",
    grant_type: "authorization_code",
  });
  assert.deepEqual(await (await call(token, "")).json(), {
    connected: true,
    athleteName: "Ada Rider",
  });

  const row = await db
    .prepare(
      'SELECT s.* FROM strava_connection s JOIN "user" u ON u.id = s.user_id WHERE u.email = ?',
    )
    .bind(email)
    .first();
  assert.equal(row.athlete_id, 42);
  for (const column of ["access_token", "refresh_token"]) {
    assert.ok(!row[column].includes("access-1") && !row[column].includes("refresh-1"));
    assert.match(row[column], /^[A-Za-z0-9_-]{30,}$/);
  }
  assert.equal(row.expires_at, 4_102_444_800);
});

test("the callback alone connects nothing: the app that started has to collect the result", async () => {
  reset();
  const owner = await signUp();
  const other = await signUp();
  const link = await start(owner.token);
  assert.equal((await callback(link.state)).status, 302);
  assert.deepEqual(await (await call(owner.token, "")).json(), { connected: false });

  const wrong = makeVerifier();
  assert.equal(
    (await postJson(owner.token, "/connect/complete", { code_verifier: wrong.verifier })).status,
    400,
  );
  assert.equal(
    (await postJson(other.token, "/connect/complete", { code_verifier: link.verifier })).status,
    400,
  );
  assert.equal(
    (await postJson(owner.token, "/connect/complete", { code_verifier: "short" })).status,
    400,
  );
  assert.equal(
    (await postJson(null, "/connect/complete", { code_verifier: link.verifier })).status,
    401,
  );
  assert.deepEqual(await (await call(owner.token, "")).json(), { connected: false });

  const completed = await postJson(owner.token, "/connect/complete", {
    code_verifier: link.verifier,
  });
  assert.deepEqual(await completed.json(), { connected: true, athleteName: "Ada Rider" });
  assert.deepEqual(await (await call(owner.token, "")).json(), {
    connected: true,
    athleteName: "Ada Rider",
  });
  // The link is used up.
  assert.equal(
    (await postJson(owner.token, "/connect/complete", { code_verifier: link.verifier })).status,
    400,
  );
});

test("someone who gets hold of a rider's state cannot link their own Strava to that account", async () => {
  reset();
  const victim = await signUp();
  const link = await start(victim.token);

  // The attacker reaches the callback first, with a code from their own Strava.
  reset({
    token: () =>
      Response.json({ ...tokens("attacker"), athlete: { id: 666, firstname: "Mallory" } }),
  });
  assert.equal((await callback(link.state)).status, 302);
  const attackerVerifier = makeVerifier();
  assert.equal(
    (
      await postJson(victim.token, "/connect/complete", {
        code_verifier: attackerVerifier.verifier,
      })
    ).status,
    400,
  );

  // The rider's own sign-in then fails rather than quietly connecting Mallory's Strava.
  reset();
  const error = new URL((await callback(link.state)).headers.get("location")).searchParams.get(
    "error",
  );
  assert.equal(error, "exchange_failed");
  assert.deepEqual(await (await call(victim.token, "")).json(), { connected: false });
});

test("the callback refuses state it did not sign, and tells the app why a sign-in failed", async () => {
  reset();
  const { token } = await signUp();
  assert.equal((await callback("forged")).status, 400);
  assert.equal((await call(null, "/callback?code=c&scope=activity:write")).status, 400);

  const link = await start(token);
  const [, signature] = link.state.split(".");
  const forged = `${Buffer.from(JSON.stringify({ link: "someone-else", expires: 4_102_444_800 })).toString("base64url")}.${signature}`;
  assert.equal((await callback(forged)).status, 400);

  // Each sign-in gets one try, so every outcome needs a sign-in of its own.
  const reason = async (query) => {
    const { state } = await start(token);
    const response = await callback(state, query);
    return new URL(response.headers.get("location")).searchParams.get("error");
  };
  assert.equal(await reason("error=access_denied"), "access_denied");
  assert.equal(await reason("code=c&scope=read"), "insufficient_scope");
  reset({ token: () => new Response("{}", { status: 400 }) });
  assert.equal(await reason("code=bad&scope=activity:write"), "exchange_failed");
  assert.deepEqual(await (await call(token, "")).json(), { connected: false });
});

test("a ride goes to Strava with the rider's token, and the app can ask how it is getting on", async () => {
  reset();
  const { token } = await signUp();
  await connect(token);
  strava.requests.length = 0;

  const started = await upload(token);
  assert.equal(started.status, 202);
  assert.deepEqual(await started.json(), { id: 7, status: "processing" });
  const sent = strava.requests[0];
  assert.equal(sent.auth, "Bearer access-1");
  assert.deepEqual(sent.form, {
    data_type: "fit",
    trainer: "1",
    name: "Threshold 3x12",
    fileName: "ride.fit",
    bytes: [...fit],
  });

  const status = await call(token, "/uploads/7");
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { id: 7, status: "ready", activityId: 99 });
  assert.equal(strava.requests[1].auth, "Bearer access-1");
});

test("an upload Strava turns down says why, including a ride it already has", async () => {
  reset({
    upload: () =>
      Response.json(
        { id: 8, error: "ride.fit duplicate of activity 4321", activity_id: null },
        { status: 201 },
      ),
    status: () => Response.json({ id: 9, error: "The file is empty.", activity_id: null }),
  });
  const { token } = await signUp();
  await connect(token);
  const duplicate = await upload(token);
  assert.deepEqual(await duplicate.json(), {
    id: 8,
    status: "error",
    error: "ride.fit duplicate of activity 4321",
    duplicateOf: 4321,
  });
  assert.deepEqual(await (await call(token, "/uploads/9")).json(), {
    id: 9,
    status: "error",
    error: "The file is empty.",
  });
});

test("an upload is checked before Strava sees it", async () => {
  reset();
  const { token } = await signUp();
  await connect(token);
  strava.requests.length = 0;
  assert.equal(
    (await call(token, "/uploads", { method: "POST", body: new Uint8Array() })).status,
    400,
  );
  assert.equal(
    (await call(token, "/uploads", { method: "POST", body: new Uint8Array(10 * 1024 * 1024 + 1) }))
      .status,
    413,
  );
  assert.equal((await call(token, "/uploads/nope")).status, 400);
  assert.deepEqual(strava.requests, []);
});

test("an access token about to run out is refreshed first, and the new one kept", async () => {
  reset();
  const { email, token } = await signUp();
  await connect(token);
  await db
    .prepare(
      'UPDATE strava_connection SET expires_at = ? WHERE user_id = (SELECT id FROM "user" WHERE email = ?)',
    )
    .bind(Math.floor(Date.now() / 1000) + 10, email)
    .run();
  strava.requests.length = 0;

  assert.equal((await upload(token)).status, 202);
  assert.deepEqual(
    strava.requests.map((r) => r.path),
    ["/oauth/token", "/api/v3/uploads"],
  );
  assert.equal(strava.requests[0].body.grant_type, "refresh_token");
  assert.equal(strava.requests[0].body.refresh_token, "refresh-1");
  assert.equal(strava.requests[1].auth, "Bearer access-2");

  strava.requests.length = 0;
  assert.equal((await upload(token)).status, 202);
  assert.deepEqual(
    strava.requests.map((r) => r.path),
    ["/api/v3/uploads"],
  );
  assert.equal(strava.requests[0].auth, "Bearer access-2");
  assert.deepEqual(await (await call(token, "")).json(), {
    connected: true,
    athleteName: "Ada Rider",
  });
});

test("a token Strava turns down is refreshed once and the upload tried again", async () => {
  let first = true;
  reset({
    upload: () => {
      if (first) {
        first = false;
        return new Response("{}", { status: 401 });
      }
      return Response.json({ id: 7, error: null, activity_id: null }, { status: 201 });
    },
  });
  const { token } = await signUp();
  await connect(token);
  strava.requests.length = 0;
  assert.equal((await upload(token)).status, 202);
  assert.deepEqual(
    strava.requests.map((r) => r.path),
    ["/api/v3/uploads", "/oauth/token", "/api/v3/uploads"],
  );
  assert.equal(strava.requests[2].auth, "Bearer access-2");
});

test("a rider who revoked Ride in Strava is disconnected, not retried", async () => {
  reset({
    upload: () => new Response("{}", { status: 401 }),
    token: (body) =>
      body.grant_type === "refresh_token"
        ? new Response("{}", { status: 400 })
        : Response.json({ ...tokens(1), athlete: { id: 42, firstname: "Ada" } }),
  });
  const { token } = await signUp();
  await connect(token);
  const response = await upload(token);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "not_connected" });
  assert.deepEqual(await (await call(token, "")).json(), { connected: false });
});

test("Strava being busy or down is reported as such", async () => {
  reset({ upload: () => new Response("{}", { status: 429 }) });
  const { token } = await signUp();
  await connect(token);
  const limited = await upload(token);
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { error: "rate_limited" });

  reset({ upload: () => new Response("{}", { status: 503 }) });
  const down = await upload(token);
  assert.equal(down.status, 502);
  assert.deepEqual(await down.json(), { error: "strava_unavailable" });
});

test("riders cannot see or use each other's Strava", async () => {
  reset();
  const owner = await signUp();
  const other = await signUp();
  await connect(owner.token);
  strava.requests.length = 0;
  assert.deepEqual(await (await call(other.token, "")).json(), { connected: false });
  const response = await upload(other.token);
  assert.equal(response.status, 409);
  assert.deepEqual(strava.requests, []);
});

test("disconnecting tells Strava and forgets the tokens", async () => {
  reset();
  const { token } = await signUp();
  await connect(token);
  strava.requests.length = 0;
  assert.equal((await call(token, "", { method: "DELETE" })).status, 204);
  assert.deepEqual(
    strava.requests.map((r) => [r.path, r.auth]),
    [["/oauth/deauthorize", "Bearer access-1"]],
  );
  assert.deepEqual(await (await call(token, "")).json(), { connected: false });
  assert.equal((await call(token, "", { method: "DELETE" })).status, 204);
  assert.equal((await upload(token)).status, 409);
});

test("deleting the account deletes the Strava connection with it", async () => {
  reset();
  const { email, token } = await signUp();
  await connect(token);
  const count = async () =>
    (await db.prepare("SELECT count(*) AS n FROM strava_connection").first()).n;
  const before = await count();
  const deleted = await runtime.dispatchFetch(`${api}/api/auth/delete-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password: "test-password-12345" }),
  });
  assert.equal(deleted.status, 200, await deleted.clone().text());
  assert.equal(await count(), before - 1);
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM "user" WHERE email = ?').bind(email).first()).n,
    0,
  );
});

/** Sets how much of a budget has been used in the current window. */
const setUsed = (key, used) =>
  db
    .prepare(
      "INSERT INTO strava_budget (key, window_start, used) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, used = excluded.used",
    )
    .bind(key, Math.floor(Date.now() / 1000), used)
    .run();

const expireToken = (email) =>
  db
    .prepare(
      'UPDATE strava_connection SET expires_at = ? WHERE user_id = (SELECT id FROM "user" WHERE email = ?)',
    )
    .bind(Math.floor(Date.now() / 1000) + 10, email)
    .run();

test("an athlete can cause only so many calls to Strava, however fast they ask", async () => {
  reset();
  const { token } = await signUp();
  await connect(token);
  await db.prepare("DELETE FROM strava_budget").run();
  strava.requests.length = 0;

  const answers = await Promise.all(Array.from({ length: 40 }, () => call(token, "/uploads/7")));
  const statuses = answers.map((answer) => answer.status);
  assert.equal(statuses.filter((status) => status === 200).length, 30);
  assert.equal(statuses.filter((status) => status === 429).length, 10);
  assert.equal(strava.requests.length, 30);

  // Uploads draw on the same share, and a rider who is out of it is told before the ride is read.
  const refused = await call(token, "/uploads?name=Ride", { method: "POST", body: fit });
  assert.equal(refused.status, 429);
  assert.deepEqual(await refused.json(), { error: "rate_limited" });
  assert.equal(strava.requests.length, 30);

  // The window opens again after fifteen minutes.
  await db.prepare("UPDATE strava_budget SET window_start = window_start - 901").run();
  assert.equal((await call(token, "/uploads/7")).status, 200);
});

test("every request to Strava counts, including the refresh and the retry behind a call", async () => {
  reset();
  const { email, token } = await signUp();
  await connect(token);

  // Two calls left: the refresh and the upload fit.
  await expireToken(email);
  await setUsed("athlete:42", 28);
  strava.requests.length = 0;
  assert.equal((await upload(token, "name=Ride")).status, 202);
  assert.deepEqual(
    strava.requests.map((r) => r.path),
    ["/oauth/token", "/api/v3/uploads"],
  );

  // One call left: the refresh is made, and the upload it was for is not.
  await expireToken(email);
  await db.prepare("DELETE FROM strava_budget").run();
  await setUsed("athlete:42", 29);
  strava.requests.length = 0;
  const refused = await call(token, "/uploads?name=Ride", { method: "POST", body: fit });
  assert.equal(refused.status, 429);
  assert.deepEqual(
    strava.requests.map((r) => r.path),
    ["/oauth/token"],
  );

  // A token Strava turns down costs the call, the refresh and the retry.
  let first = true;
  reset({
    upload: () => {
      if (first) {
        first = false;
        return new Response("{}", { status: 401 });
      }
      return Response.json({ id: 7, error: null, activity_id: null }, { status: 201 });
    },
  });
  await db.prepare("DELETE FROM strava_budget").run();
  await setUsed("athlete:42", 28);
  const retried = await call(token, "/uploads?name=Ride", { method: "POST", body: fit });
  assert.equal(retried.status, 429);
  assert.deepEqual(
    strava.requests.map((r) => r.path),
    ["/api/v3/uploads", "/oauth/token"],
  );
});

test("the budget belongs to the Strava athlete, not to the account, and an athlete has one account", async () => {
  reset();
  const first = await signUp();
  const second = await signUp();
  await connect(first.token);
  await setUsed("athlete:42", 30);

  // The same athlete connecting a second account moves the connection and keeps the budget.
  await connect(second.token);
  assert.deepEqual(await (await call(first.token, "")).json(), { connected: false });
  assert.deepEqual(await (await call(second.token, "")).json(), {
    connected: true,
    athleteName: "Ada Rider",
  });
  strava.requests.length = 0;
  assert.equal((await call(second.token, "/uploads/7")).status, 429);
  assert.deepEqual(strava.requests, []);

  // Disconnecting and connecting again does not start afresh either.
  assert.equal((await call(second.token, "", { method: "DELETE" })).status, 204);
  await connect(second.token);
  assert.equal((await call(second.token, "/uploads/7")).status, 429);
});

test("a sign-in gets one try with Strava, however the callback is reached", async () => {
  reset({ token: () => new Response("{}", { status: 400 }) });
  const { token } = await signUp();
  const link = await start(token);
  const bad = await callback(link.state, "code=garbage&scope=activity:write");
  assert.equal(new URL(bad.headers.get("location")).searchParams.get("error"), "exchange_failed");
  assert.equal(strava.requests.length, 1);

  // The state cannot be used to try another code, good or bad.
  reset();
  assert.equal((await callback(link.state, "code=another&scope=activity:write")).status, 400);
  assert.equal((await callback(link.state, "error=access_denied")).status, 400);
  assert.deepEqual(strava.requests, []);

  // A rider who backs out has used their try too.
  const second = await start(token);
  await callback(second.state, "error=access_denied");
  assert.equal((await callback(second.state, "code=c&scope=activity:write")).status, 400);
});

test("starting to connect, and the code exchanges that follow, are limited", async () => {
  reset();
  const { token } = await signUp();
  for (let attempt = 0; attempt < 10; attempt++) await start(token);
  const eleventh = await postJson(token, "/connect", { code_challenge: makeVerifier().challenge });
  assert.equal(eleventh.status, 429);
  assert.deepEqual(await eleventh.json(), { error: "rate_limited" });

  // Whoever makes the attempts, the app as a whole makes only so many exchanges with Strava.
  const other = await signUp();
  await setUsed("app:exchange", 60);
  const link = await start(other.token);
  strava.requests.length = 0;
  const refused = await callback(link.state);
  assert.equal(
    new URL(refused.headers.get("location")).searchParams.get("error"),
    "exchange_failed",
  );
  assert.deepEqual(strava.requests, []);
});

test("a ride is never read past the size limit, even when it does not say how long it is", async () => {
  reset();
  const { token } = await signUp();
  await connect(token);
  await db.prepare("DELETE FROM strava_budget").run();
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (sent >= 64) return controller.close();
      sent++;
      controller.enqueue(chunk);
    },
  });
  const response = await call(token, "/uploads?name=Ride", {
    method: "POST",
    body,
    duplex: "half",
  });
  assert.equal(response.status, 413);
  assert.ok(sent < 64, `${sent} MB were read`);
  assert.deepEqual(
    strava.requests.filter((r) => r.path.startsWith("/api")),
    [],
  );
});
