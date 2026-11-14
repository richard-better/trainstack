import { createFileRoute } from "@tanstack/react-router";
import { sportSchema } from "@trainstack/workout";
import * as z from "zod";

import { SignedIn } from "../components/session";
import { NewWorkoutPage } from "../components/workout-editor";

export const Route = createFileRoute("/workouts/new")({
  validateSearch: z.object({
    error: z.string().optional(),
    sport: sportSchema.optional().catch(undefined),
  }),
  ssr: false,
  head: () => ({ meta: [{ title: "New workout - Trainstack" }] }),
  component: NewWorkout,
});

function NewWorkout() {
  const { error, sport } = Route.useSearch();
  return (
    <SignedIn signInError={error}>
      <NewWorkoutPage sport={sport ?? "cycling"} />
    </SignedIn>
  );
}
