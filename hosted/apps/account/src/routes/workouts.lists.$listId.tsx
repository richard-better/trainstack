import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { SignedIn } from "../components/session";
import { ListPage } from "../components/workout-lists";

export const Route = createFileRoute("/workouts/lists/$listId")({
  validateSearch: z.object({ error: z.string().optional() }),
  ssr: false,
  head: () => ({ meta: [{ title: "Workout list - Trainstack" }] }),
  component: WorkoutList,
});

function WorkoutList() {
  const { listId } = Route.useParams();
  const { error } = Route.useSearch();
  return (
    <SignedIn signInError={error}>
      <ListPage listId={listId} />
    </SignedIn>
  );
}
