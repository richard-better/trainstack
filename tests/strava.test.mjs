import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, mock, test } from "node:test";
import { pathToFileURL } from "node:url";
import { rolldown } from "rolldown";

const api = "https://api.trainstackhq.com";
const state = "abcdefghijklmnopqrstuvwxyz012345";
const verifier = "verifier-that-only-the-app-knows-0123456789-abcdef";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const combined = `${state}.${challenge}`;
const configured = { STRAVA_CLIENT_ID: "12345", STRAVA_CLIENT_SECRET: "client-secret-value" };

let directory;
let stravaRoutes;
/** What the Worker asked Strava for, and how Strava answers. */
let strava;

const fetcher = async (url, init) => {
  strava.requests.push({
    url: String(url),
    body: Object.fromEntries(new URLSearchParams(init.body)),
  });
  return strava.respond();
};

const tokens = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_at: 1_900_000_000,
  athlete: { id: 42, firstname: "Ada", lastname: "Rider" },
};

const call = (env, path, init) => stravaRoutes(env, fetcher).request(`${api}${path}`, init);

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "trainstack-strava-"));
  const bundle = await rolldown({
    input: "hosted/apps/api/src/strava.ts",
    platform: "node",
    resolve: { conditionNames: ["import", "default"] },
  });
  try {
    await bundle.write({
      file: join(directory, "strava.mjs"),
      format: "esm",
      codeSplitting: false,
    });
  } finally {
    await bundle.close();
  }
  ({ stravaRoutes } = await import(pathToFileURL(join(directory, "strava.mjs")).href));
});

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

const reset = (respond = () => Response.json(tokens)) => {
  strava = { requests: [], respond };
};

test("authorize sends the rider to Strava asking only to upload activities", async () => {
  reset();
  const response = await call(configured, `/authorize?state=${state}&code_challenge=${challenge}`);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  assert.equal(`${location.origin}${location.pathname}`, "https://www.strava.com/oauth/authorize");
  assert.equal(location.searchParams.get("client_id"), "12345");
  assert.equal(location.searchParams.get("redirect_uri"), `${api}/strava/callback`);
  assert.equal(location.searchParams.get("response_type"), "code");
  assert.equal(location.searchParams.get("scope"), "activity:write");
  assert.equal(location.searchParams.get("state"), combined);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(!location.toString().includes(configured.STRAVA_CLIENT_SECRET));
});

test("authorize refuses a missing or malformed state, and runs only when configured", async () => {
  reset();
  assert.equal((await call(configured, "/authorize")).status, 400);
  assert.equal((await call(configured, "/authorize?state=short")).status, 400);
  const unconfigured = await call(
    { STRAVA_CLIENT_ID: "", STRAVA_CLIENT_SECRET: "" },
    `/authorize?state=${state}`,
  );
  assert.equal(unconfigured.status, 503);
  assert.deepEqual(await unconfigured.json(), { error: "strava_not_configured" });
});

const redeem = (body) =>
  call(configured, "/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const signIn = async () => {
  reset();
  const response = await call(
    configured,
    `/callback?state=${combined}&code=the-code&scope=read,activity:write`,
  );
  return { response, location: new URL(response.headers.get("location")) };
};

test("callback swaps the code for tokens and hands the app a ticket, not the tokens", async () => {
  const { response, location } = await signIn();
  assert.equal(response.status, 302);
  assert.equal(`${location.protocol}//${location.host}`, "trainstackride://strava");
  assert.deepEqual([...location.searchParams.keys()].sort(), ["state", "ticket"]);
  assert.equal(location.searchParams.get("state"), state);
  assert.deepEqual(strava.requests, [
    {
      url: "https://www.strava.com/oauth/token",
      body: {
        client_id: "12345",
        client_secret: "client-secret-value",
        code: "the-code",
        grant_type: "authorization_code",
      },
    },
  ]);
  // Anything that can read the redirect can read the ticket, so it must hide the tokens.
  const href = response.headers.get("location");
  for (const secret of ["access-1", "refresh-1", "Ada", configured.STRAVA_CLIENT_SECRET]) {
    assert.ok(!href.includes(secret), `${secret} is in the redirect`);
  }
});

test("only the app holding the verifier can redeem a ticket for the tokens", async () => {
  const { location } = await signIn();
  const ticket = location.searchParams.get("ticket");
  strava.requests.length = 0;

  const redeemed = await redeem({ ticket, code_verifier: verifier });
  assert.equal(redeemed.status, 200);
  assert.deepEqual(await redeemed.json(), {
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_at: 1_900_000_000,
    athlete_name: "Ada Rider",
  });
  assert.deepEqual(strava.requests, []);

  // Another app that read the redirect has the ticket but not the verifier.
  const wrong = await redeem({ ticket, code_verifier: "w".repeat(43) });
  assert.equal(wrong.status, 400);
  assert.deepEqual(await wrong.json(), { error: "invalid_ticket" });

  const tampered = ticket.slice(0, -2) + (ticket.endsWith("AA") ? "BB" : "AA");
  assert.equal((await redeem({ ticket: tampered, code_verifier: verifier })).status, 400);
  assert.equal((await redeem({ ticket: "garbage", code_verifier: verifier })).status, 400);
});

test("a ticket stops working after five minutes", async () => {
  const { location } = await signIn();
  const ticket = location.searchParams.get("ticket");
  const now = Date.now();
  const clock = mock.method(Date, "now", () => now + 299_000);
  try {
    assert.equal((await redeem({ ticket, code_verifier: verifier })).status, 200);
    clock.mock.mockImplementation(() => now + 301_000);
    assert.equal((await redeem({ ticket, code_verifier: verifier })).status, 400);
  } finally {
    clock.mock.restore();
  }
});

test("redeem rejects a bad request, and a ticket sealed under another secret", async () => {
  const { location } = await signIn();
  const ticket = location.searchParams.get("ticket");
  for (const body of ["not json", {}, { ticket }, { ticket, code_verifier: "short" }]) {
    assert.equal((await redeem(body)).status, 400);
  }
  const other = await call(
    { ...configured, STRAVA_CLIENT_SECRET: "a-different-secret" },
    "/redeem",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, code_verifier: verifier }),
    },
  );
  assert.equal(other.status, 400);
  const unconfigured = await call({}, "/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket, code_verifier: verifier }),
  });
  assert.equal(unconfigured.status, 503);
});

test("callback tells the app why a sign-in did not finish, without calling Strava", async () => {
  reset();
  const denied = await call(configured, `/callback?state=${combined}&error=access_denied`);
  assert.equal(new URL(denied.headers.get("location")).searchParams.get("error"), "access_denied");

  const narrow = await call(configured, `/callback?state=${combined}&code=c&scope=read`);
  assert.equal(
    new URL(narrow.headers.get("location")).searchParams.get("error"),
    "insufficient_scope",
  );

  const unconfigured = await call({}, `/callback?state=${combined}&code=c&scope=activity:write`);
  assert.equal(
    new URL(unconfigured.headers.get("location")).searchParams.get("error"),
    "strava_not_configured",
  );

  const forged = await call(configured, "/callback?state=x&code=c&scope=activity:write");
  assert.equal(forged.status, 400);
  const unbound = await call(configured, `/callback?state=${state}&code=c&scope=activity:write`);
  assert.equal(unbound.status, 400);
  assert.deepEqual(strava.requests, []);

  reset(() => new Response("{}", { status: 400 }));
  const rejected = await call(
    configured,
    `/callback?state=${combined}&code=bad&scope=activity:write`,
  );
  const params = new URL(rejected.headers.get("location")).searchParams;
  assert.equal(params.get("error"), "exchange_failed");
  assert.equal(params.get("state"), state);
  assert.equal(params.get("access_token"), null);
});

const refresh = (env, body) =>
  call(env, "/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("refresh returns new tokens and keeps the client secret to itself", async () => {
  reset();
  const response = await refresh(configured, { refresh_token: "refresh-0" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_at: 1_900_000_000,
  });
  assert.deepEqual(strava.requests[0].body, {
    client_id: "12345",
    client_secret: "client-secret-value",
    refresh_token: "refresh-0",
    grant_type: "refresh_token",
  });
});

test("refresh tells a revoked token from Strava being down", async () => {
  reset(() => new Response("{}", { status: 401 }));
  const revoked = await refresh(configured, { refresh_token: "gone" });
  assert.equal(revoked.status, 401);
  assert.deepEqual(await revoked.json(), { error: "invalid_refresh_token" });

  reset(() => new Response("{}", { status: 503 }));
  const down = await refresh(configured, { refresh_token: "fine" });
  assert.equal(down.status, 502);
  assert.deepEqual(await down.json(), { error: "strava_unavailable" });
});

test("refresh rejects a bad request before calling Strava", async () => {
  reset();
  for (const body of [
    "not json",
    {},
    { refresh_token: 5 },
    { refresh_token: "" },
    { refresh_token: "x".repeat(300) },
  ]) {
    assert.equal((await refresh(configured, body)).status, 400);
  }
  assert.equal((await refresh({}, { refresh_token: "a" })).status, 503);
  assert.deepEqual(strava.requests, []);
});
