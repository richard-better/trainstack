import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { ActivityList } from "../components/activity-list";
import { SignedIn } from "../components/session";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ error: z.string().optional() }),
  ssr: false,
  component: Home,
});

function Home() {
  const { error } = Route.useSearch();
  return (
    <SignedIn signInError={error}>
      <ActivityList />
    </SignedIn>
  );
}
