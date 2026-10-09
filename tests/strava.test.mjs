import assert from "node:assert/strict";
import { after, before, test } from "node:test";
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

async function connect(token) {
  const { url } = await (await call(token, "/connect", { method: "POST" })).json();
  const state = new URL(url).searchParams.get("state");
  const response = await call(
    null,
    `/callback?state=${encodeURIComponent(state)}&code=the-code&scope=read,activity:write`,
  );
  assert.equal(response.status, 302);
  return { url, state, response };
}

const upload = (token, query = "name=Threshold%203x12&fileName=ride.fit") =>
  call(token, `/uploads?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: fit,
  });

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
  const { url } = await (await call(token, "/connect", { method: "POST" })).json();
  const location = new URL(url);
  assert.equal(`${location.origin}${location.pathname}`, "https://www.strava.com/oauth/authorize");
  assert.equal(location.searchParams.get("client_id"), "12345");
  assert.equal(location.searchParams.get("redirect_uri"), `${api}/strava/callback`);
  assert.equal(location.searchParams.get("scope"), "activity:write");
  assert.equal(location.searchParams.get("response_type"), "code");
  assert.ok(!url.includes(credentials.STRAVA_CLIENT_SECRET));
  assert.equal((await call(token, "")).status, 200);
  assert.deepEqual(await (await call(token, "")).json(), { connected: false });
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

test("the callback refuses state it did not sign, and tells the app why a sign-in failed", async () => {
  reset();
  const { token } = await signUp();
  assert.equal(
    (await call(null, "/callback?state=forged&code=c&scope=activity:write")).status,
    400,
  );
  assert.equal((await call(null, "/callback?code=c&scope=activity:write")).status, 400);

  const { url } = await (await call(token, "/connect", { method: "POST" })).json();
  const state = encodeURIComponent(new URL(url).searchParams.get("state"));
  const [body, signature] = decodeURIComponent(state).split(".");
  const forged = `${Buffer.from(JSON.stringify({ user: "someone-else", expires: 4_102_444_800 })).toString("base64url")}.${signature}`;
  assert.equal(
    (await call(null, `/callback?state=${forged}&code=c&scope=activity:write`)).status,
    400,
  );
  assert.ok(body);

  const reason = async (query) =>
    new URL(
      (await call(null, `/callback?state=${state}&${query}`)).headers.get("location"),
    ).searchParams.get("error");
  assert.equal(await reason("error=access_denied"), "access_denied");
  assert.equal(await reason("code=c&scope=read"), "insufficient_scope");
  strava.requests.length = 0;
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
