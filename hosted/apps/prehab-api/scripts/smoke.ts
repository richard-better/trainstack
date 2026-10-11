import assert from "node:assert/strict";

// Exercises the real local HTTP API, Postgres migrations, authentication and media.
const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3002";
assert(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "Smoke tests require a local server",
);
const response = await fetch(`${base}/api/auth/sign-in/email`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: process.env.CORS_ORIGIN ?? "http://localhost:4322",
  },
  body: JSON.stringify({ email: "test3@trypre.app", password: "12341234" }),
});
assert.equal(response.status, 200, "Run db:seed first");
const { token } = (await response.json()) as { token: string };
async function rpc(path: string, input = {}) {
  const response = await fetch(`${base}/rpc/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ json: input }),
  });
  const body = (await response.json()) as { json: any };
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.json;
}
const answers = {
  welcome: {},
  demographics: { name: "Local smoke fixture", dateOfBirth: "1992-04-12", gender: "female" },
  sports: ["running"],
  "sport-time": { running: "3-5" },
  goals: ["improve-mobility"],
  "focus-areas": ["hips"],
  equipment: ["yoga-mat"],
  "daily-time": "10",
  "preferred-time": "18:00",
  notifications: { optedIn: false },
  disclaimer: {},
};
for (const [questionId, value] of Object.entries(answers))
  await rpc("sportProfile/savePartial", { questionId, version: 1, status: "answered", value });
assert.equal((await rpc("sportProfile/resumePoint")).questionId, null);
const exercises = (await rpc("exercises/list")).exercises;
assert(exercises.length > 20);
const template = (await rpc("sessionTemplates/list")).templates[0];
assert(template, "Run db:seed first");
const day = new Date().toLocaleDateString("en-CA");
const session = await rpc("sessionTemplates/start", { templateId: template.id, sessionDate: day });
const detail = await rpc("sessions/getById", { id: session.id });
assert(detail.exercises.length > 0);
await rpc("sessions/skipExercise", { sessionId: session.id, exerciseIndex: 0 });
await rpc("sessions/updateProgress", { sessionId: session.id, dropOffExerciseIndex: 0 });
const resumed = await rpc("sessions/getById", { id: session.id });
assert.deepEqual(resumed.skippedExercises, [0]);
assert.equal(resumed.dropOffExerciseIndex, 0);
await rpc("checkIn/save", { date: day, readiness: "normal", note: "Local migration smoke test" });
const completed = await rpc("sessionTemplates/start", {
  templateId: template.id,
  sessionDate: day,
});
await rpc("sessions/updateProgress", {
  sessionId: completed.id,
  dropOffExerciseIndex: detail.exercises.length - 1,
});
await rpc("sessions/complete", {
  sessionId: completed.id,
  feedbackRating: "good",
  feedbackTags: [],
  feedbackComment: "Local completion verification",
});
assert((await rpc("sessions/getById", { id: completed.id })).completedAt);
const media = await fetch(detail.exercises[0].videoUrl, { headers: { Range: "bytes=0-1" } });
assert.equal(media.status, 206, "Import local media first");
assert.equal((await media.arrayBuffer()).byteLength, 2);
const invalid = await fetch(detail.exercises[0].videoUrl, { headers: { Range: "bytes=2-1" } });
assert.equal(invalid.status, 416);
console.log(
  `Passed: onboarding, ${exercises.length} exercises, session start/resume/completion, check-in, AVPlayer ranges.`,
);
