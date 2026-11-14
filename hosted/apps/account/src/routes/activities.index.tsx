import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { ActivityList } from "../components/activity-list";
import { SignedIn } from "../components/session";

export const Route = createFileRoute("/activities/")({
  validateSearch: z.object({ error: z.string().optional() }),
  ssr: false,
  head: () => ({ meta: [{ title: "Activities - Trainstack" }] }),
  component: Activities,
});

function Activities() {
  const { error } = Route.useSearch();
  return (
    <SignedIn signInError={error}>
      <ActivityList />
    </SignedIn>
  );
}
