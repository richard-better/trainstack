import { describe, expect, it, vi } from "vitest";

// `greeting.ts` pulls in persistence + profile-projection (both import `../db`)
// at module load. `buildCoachGreeting` itself is pure, so stub the db module to
// keep this a fast unit test with no Postgres dependency.
vi.mock("../db", () => ({
  db: {},
  threads: {},
  messages: {},
  intakeSummaries: {},
  profileAnswers: {},
  sportProfiles: {},
}));

import { buildCoachGreeting } from "../services/coach/greeting";

describe("buildCoachGreeting", () => {
  it("opens with the user's first name and a question about their first focus area", () => {
    const greeting = buildCoachGreeting({
      name: "Alex Rivera",
      focusAreas: ["lower-back", "knees"],
    });

    expect(greeting).toContain("Hey Alex —");
    // Slugs are rendered as readable labels, not raw enum values.
    expect(greeting).toContain("lower back and knees");
    expect(greeting).not.toContain("lower-back");
    // Drives the conversation: opens on the first flagged region.
    expect(greeting).toContain("Let's start with your lower back");
  });

  it("uses the Oxford-comma list for three or more focus areas", () => {
    const greeting = buildCoachGreeting({
      name: "Sam",
      focusAreas: ["neck", "shoulders", "ankles-calves"],
    });

    expect(greeting).toContain("neck, shoulders, and ankles and calves");
  });

  it("falls back to a catch-all question when no focus areas were flagged", () => {
    const greeting = buildCoachGreeting({ name: "Sam", focusAreas: [] });

    expect(greeting).toContain("Hey Sam —");
    expect(greeting).toContain("anything about your body or training");
    expect(greeting).not.toContain("Let's start with");
  });

  it("drops the name segment gracefully when no name is recorded", () => {
    const greeting = buildCoachGreeting({ name: null, focusAreas: ["hips"] });

    expect(greeting.startsWith("Hey — ")).toBe(true);
  });
});
