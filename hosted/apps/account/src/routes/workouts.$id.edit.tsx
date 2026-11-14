import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { SignedIn } from "../components/session";
import { EditWorkoutPage } from "../components/workout-editor";

export const Route = createFileRoute("/workouts/$id/edit")({
  validateSearch: z.object({ error: z.string().optional() }),
  ssr: false,
  head: () => ({ meta: [{ title: "Edit workout - Trainstack" }] }),
  component: EditWorkout,
});

function EditWorkout() {
  const { id } = Route.useParams();
  const { error } = Route.useSearch();
  return (
    <SignedIn signInError={error}>
      <EditWorkoutPage id={id} />
    </SignedIn>
  );
}
