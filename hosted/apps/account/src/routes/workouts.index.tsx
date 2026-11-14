import { createFileRoute } from "@tanstack/react-router";
import { focusSchema, sportSchema } from "@trainstack/workout";
import * as z from "zod";

import { SignedIn } from "../components/session";
import { WorkoutLibrary } from "../components/workout-library";

export const Route = createFileRoute("/workouts/")({
  validateSearch: z.object({
    error: z.string().optional(),
    in: z.enum(["mine", "builtin"]).optional().catch(undefined),
    q: z.string().optional().catch(undefined),
    sport: sportSchema.optional().catch(undefined),
    focus: focusSchema.optional().catch(undefined),
    length: z.enum(["short", "medium", "long"]).optional().catch(undefined),
    sort: z.enum(["updated", "name", "duration", "library"]).optional().catch(undefined),
  }),
  ssr: false,
  head: () => ({ meta: [{ title: "Workouts - Trainstack" }] }),
  component: Workouts,
});

function Workouts() {
  const { error, ...search } = Route.useSearch();
  return (
    <SignedIn signInError={error}>
      <WorkoutLibrary search={search} />
    </SignedIn>
  );
}
