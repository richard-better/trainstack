/**
 * Seed local development data: test users + session templates.
 * Run via: bun run db:seed (requires server to be running for user creation)
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { PLACEHOLDER_VIDEO_KEY } from "../services/constants/exercises";
import { getMediaPublicUrl } from "../lib/s3";
import { sessionTemplates } from "./schema";

const SERVER_URL = process.env.BETTER_AUTH_URL || "http://localhost:3002";
const DATABASE_URL = process.env.DATABASE_URL;

// ── Test users (created via HTTP — needs the server running) ──────────────

const TEST_USERS = [
  { name: "Test User 1", email: "test1@trypre.app", password: "12341234" },
  { name: "Test User 2", email: "test2@trypre.app", password: "12341234" },
  { name: "Test User 3", email: "test3@trypre.app", password: "12341234" },
];

async function seedUsers() {
  console.log("\n── Users ──");
  for (const user of TEST_USERS) {
    const res = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(user),
    });

    if (res.ok) {
      console.log(`  Created: ${user.email}`);
    } else {
      const body = await res.json().catch(() => ({}));
      const msg = (body as { message?: string }).message || res.statusText;
      console.log(`  Skipped: ${user.email} (${msg})`);
    }
  }
}

// ── Session templates (inserted via Drizzle) ──────────────────────────────

const SESSION_TEMPLATES = [
  {
    title: "Quick Hip & Core Activation",
    description: "A fast 3-exercise circuit to wake up your hips and core before any workout.",
    category: "Lower Body",
    sportTags: ["running", "cycling", "climbing", "lifting"],
    exercises: {
      title: "Quick Hip & Core Activation",
      estimatedDurationMin: 7,
      reasoningShort: null,
      reasoningLong: null,
      exercises: [
        {
          id: "glute-bridge-double-leg",
          name: "Glute Bridge (Double-Leg)",
          sets: 2,
          reps: 12,
          durationSec: null,
          restSec: 15,
          side: "bilateral" as const,
          formCues: [
            "Drive through heels, squeeze glutes at top",
            "Keep core braced, don't hyperextend lower back",
            "Hold top position for 1 second",
          ],
          videoUrl: getMediaPublicUrl(PLACEHOLDER_VIDEO_KEY),
        },
        {
          id: "dead-bug",
          name: "Dead Bug",
          sets: 2,
          reps: 10,
          durationSec: null,
          restSec: 15,
          side: "bilateral" as const,
          formCues: [
            "Press lower back into floor throughout",
            "Extend opposite arm and leg slowly",
            "Exhale as you extend, inhale as you return",
          ],
          videoUrl: getMediaPublicUrl(PLACEHOLDER_VIDEO_KEY),
        },
        {
          id: "cat-cow",
          name: "Cat-Cow",
          sets: 1,
          reps: null,
          durationSec: 30,
          restSec: 0,
          side: "bilateral" as const,
          formCues: [
            "Inhale as you drop belly, exhale as you round spine",
            "Move through full range of motion",
            "Keep arms straight, wrists under shoulders",
          ],
          videoUrl: getMediaPublicUrl(PLACEHOLDER_VIDEO_KEY),
        },
      ],
    },
    estimatedDurationMin: 7,
    exerciseCount: 3,
    sortOrder: 0,
  },
];

async function seedTemplates() {
  if (!DATABASE_URL) {
    console.log("\n── Session templates ──");
    console.log("  Skipped (DATABASE_URL not set)");
    return;
  }

  const db = drizzle(DATABASE_URL);
  console.log("\n── Session templates ──");
  for (const template of SESSION_TEMPLATES) {
    await db.insert(sessionTemplates).values(template).onConflictDoNothing();
    console.log(`  Seeded: ${template.title}`);
  }
}

// Note: plan templates are NOT seeded — they live in code
// (`services/constants/plan-templates.ts`, code-as-CMS like the exercise
// catalogue) and are served directly by the plans.listTemplates RPC.

// ── Main ──────────────────────────────────────────────────────────────────

async function seed() {
  await seedUsers();
  await seedTemplates();
  console.log("\nDone.");
  process.exit(0);
}

seed();
