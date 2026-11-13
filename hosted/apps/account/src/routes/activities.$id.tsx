import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { ActivityPage } from "../components/activity-detail";
import { SignedIn } from "../components/session";

export const Route = createFileRoute("/activities/$id")({
  validateSearch: z.object({ error: z.string().optional() }),
  ssr: false,
  head: () => ({ meta: [{ title: "Activity - Trainstack" }] }),
  component: Activity,
});

function Activity() {
  const { id } = Route.useParams();
  const { error } = Route.useSearch();
  return (
    <SignedIn signInError={error}>
      <ActivityPage id={id} />
    </SignedIn>
  );
}
