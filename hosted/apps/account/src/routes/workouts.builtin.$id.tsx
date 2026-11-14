import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { SignedIn } from "../components/session";
import { BuiltinWorkoutPage } from "../components/workout-page";

export const Route = createFileRoute("/workouts/builtin/$id")({
  validateSearch: z.object({ error: z.string().optional() }),
  ssr: false,
  head: () => ({ meta: [{ title: "Built-in workout - Trainstack" }] }),
  component: BuiltinWorkout,
});

function BuiltinWorkout() {
  const { id } = Route.useParams();
  const { error } = Route.useSearch();
  return (
    <SignedIn signInError={error}>
      <BuiltinWorkoutPage id={id} />
    </SignedIn>
  );
}
