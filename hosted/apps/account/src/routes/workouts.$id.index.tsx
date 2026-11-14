import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { SignedIn } from "../components/session";
import { OwnWorkoutPage } from "../components/workout-page";

export const Route = createFileRoute("/workouts/$id/")({
  validateSearch: z.object({ error: z.string().optional() }),
  ssr: false,
  head: () => ({ meta: [{ title: "Workout - Trainstack" }] }),
  component: Workout,
});

function Workout() {
  const { id } = Route.useParams();
  const { error } = Route.useSearch();
  return (
    <SignedIn signInError={error}>
      <OwnWorkoutPage id={id} />
    </SignedIn>
  );
}
