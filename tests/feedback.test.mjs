import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { api, migrate, startWorker } from "./helpers/worker.mjs";
import { mockApple } from "./helpers/apple.mjs";

const GITHUB_TOKEN = "github-token-value";

let worker;
let runtime;
let db;
/** What the Worker asked GitHub for, and how GitHub answers. */
let github;
const appleAuth = mockApple();

function reset(answer = (number) => Response.json(issue(number), { status: 201 })) {
  github = { requests: [], answer };
}

const issue = (number) => ({
  number,
  html_url: `https://github.com/richard-better/trainstack/issues/${number}`,
});

async function githubServer(request) {
  const entry = {
    method: request.method,
    url: request.url,
    auth: request.headers.get("authorization"),
    userAgent: request.headers.get("user-agent"),
    body: await request.json(),
  };
  github.requests.push(entry);
  return github.answer(100 + github.requests.length, entry);
}

before(
  async () => {
    reset();
    worker = await startWorker({
      bindings: { GITHUB_FEEDBACK_TOKEN: GITHUB_TOKEN },
      outboundService: (request) =>
        new URL(request.url).origin === "https://appleid.apple.com"
          ? appleAuth.fetch(request)
          : githubServer(request),
    });
    runtime = worker.runtime;
    await migrate(runtime);
    db = await runtime.getD1Database("DB");
  },
  { timeout: 60_000 },
);

beforeEach(async () => {
  reset();
  await db.prepare("DELETE FROM feedback").run();
});

after(async () => {
  await worker?.dispose();
});

const send = (token, body, headers = {}) =>
  runtime.dispatchFetch(`${api}/feedback`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const context = {
  app: "Ride 0.4 (57)",
  system: "iOS 27.1",
  device: "iPhone18,1",
  screen: "History",
};

test("signed-in feedback becomes a GitHub issue that does not say who sent it", async () => {
  const rider = await appleAuth.signIn(runtime, { email: "ada@example.com" });
  const response = await send(rider.token, {
    message: "Show the FTP line on the ride chart\n\nIt would help pacing.",
    context,
  });
  assert.equal(response.status, 201, await response.clone().text());
  assert.deepEqual(await response.json(), {
    number: 101,
    url: "https://github.com/richard-better/trainstack/issues/101",
  });

  assert.equal(github.requests.length, 1);
  const [request] = github.requests;
  assert.equal(request.method, "POST");
  assert.equal(request.url, "https://api.github.com/repos/richard-better/trainstack/issues");
  assert.equal(request.auth, `Bearer ${GITHUB_TOKEN}`);
  assert.ok(request.userAgent);
  assert.equal(request.body.title, "Feedback: Show the FTP line on the ride chart");
  assert.equal(
    request.body.body,
    [
      "Show the FTP line on the ride chart",
      "",
      "It would help pacing.",
      "",
      "---",
      "",
      "- App: Ride 0.4 (57)",
      "- System: iOS 27.1",
      "- Device: iPhone18,1",
      "- Screen: History",
      "",
      "_Sent from Send Feedback in TrainStack Ride._",
    ].join("\n"),
  );
  for (const secret of ["ada@example.com", "Test Rider", rider.user.id]) {
    assert.ok(!JSON.stringify(request.body).includes(secret), secret);
  }

  const row = await db.prepare("SELECT user_id, issue_number FROM feedback").first();
  assert.deepEqual({ ...row }, { user_id: rider.user.id, issue_number: 101 });
});

test("feedback needs a bearer token, not a cookie", async () => {
  const rider = await appleAuth.signIn(runtime);
  assert.equal((await send(null, { message: "Hi" })).status, 401);
  assert.equal((await send("not-a-session", { message: "Hi" })).status, 401);
  const crossSite = await send(
    null,
    { message: "Spam" },
    { Cookie: rider.cookie, Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
  );
  assert.equal(crossSite.status, 401);
  assert.deepEqual(github.requests, []);
});

test("only Apple accounts can send feedback", async () => {
  const rider = await appleAuth.signIn(runtime);
  await db
    .prepare("UPDATE account SET provider_id = 'credential' WHERE user_id = ?")
    .bind(rider.user.id)
    .run();
  const response = await send(rider.token, { message: "Hi" });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "apple_account_required" });
  assert.deepEqual(github.requests, []);
});

test("feedback must have words, and not too many", async () => {
  const { token } = await appleAuth.signIn(runtime);
  for (const body of [
    "not json",
    {},
    { message: "   \n " },
    { message: "x".repeat(5001) },
    { message: "Hi", context: { screen: "x".repeat(101) } },
  ]) {
    const response = await send(token, body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.deepEqual(github.requests, []);
});

test("a rider's words cannot notify people or format the context", async () => {
  const { token } = await appleAuth.signIn(runtime);
  const long = "Make the workout library searchable by name, zone, duration and stress score";
  const response = await send(token, {
    message: `${long}\n@richard-better please look, cc @octocat. Mail me@example.com`,
    context: { screen: "History](https://evil.example)\n- App: fake" },
  });
  assert.equal(response.status, 201);
  const { title, body } = github.requests[0].body;
  assert.equal(title, `Feedback: ${long.slice(0, 71).trimEnd()}…`);
  assert.ok(!/@[\w-]/.test(body), body);
  assert.ok(body.includes("@​richard-better please look"));
  const contextLines = body
    .split("---\n")[1]
    .split("\n")
    .filter((line) => line.startsWith("- "));
  assert.deepEqual(contextLines, ["- Screen: History(https://evil.example)- App: fake"]);
});

test("a rider can send ten pieces of feedback a day", async () => {
  const { token } = await appleAuth.signIn(runtime);
  const responses = await Promise.all(
    Array.from({ length: 12 }, (_, i) => send(token, { message: `Idea ${i}` })),
  );
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [...Array(10).fill(201), 429, 429]);
  assert.equal(github.requests.length, 10);

  // Another rider has their own allowance.
  const other = await appleAuth.signIn(runtime);
  assert.equal((await send(other.token, { message: "Mine" })).status, 201);

  // Yesterday's feedback no longer counts.
  await db.prepare("UPDATE feedback SET created_at = created_at - 86401").run();
  assert.equal((await send(token, { message: "Next day" })).status, 201);
});

test("when GitHub fails the rider is told and it does not count against them", async () => {
  const { token } = await appleAuth.signIn(runtime);
  reset(() => Response.json({ message: "Bad credentials" }, { status: 401 }));
  const response = await send(token, { message: "Hi" });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "github_unavailable" });
  assert.equal((await db.prepare("SELECT count(*) AS n FROM feedback").first()).n, 0);
});

test("deleting the account forgets which feedback it sent", async () => {
  const rider = await appleAuth.signIn(runtime);
  assert.equal((await send(rider.token, { message: "Hi" })).status, 201);
  const deleted = await runtime.dispatchFetch(`${api}/api/auth/delete-user`, {
    method: "POST",
    headers: { Authorization: `Bearer ${rider.token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(deleted.status, 200, await deleted.clone().text());
  assert.equal((await db.prepare("SELECT count(*) AS n FROM feedback").first()).n, 0);
});

test("without a GitHub token feedback says it is not set up", async () => {
  const unconfigured = await startWorker({
    outboundService: (request) => appleAuth.fetch(request),
  });
  try {
    await migrate(unconfigured.runtime);
    const { token } = await appleAuth.signIn(unconfigured.runtime);
    const response = await unconfigured.runtime.dispatchFetch(`${api}/feedback`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hi" }),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "feedback_not_configured" });
  } finally {
    await unconfigured.dispose();
  }
});
