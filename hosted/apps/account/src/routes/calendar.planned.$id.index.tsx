import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { PlannedPage } from "../components/planned-page";
import { SignedIn } from "../components/session";

export const Route = createFileRoute("/calendar/planned/$id/")({
  validateSearch: z.object({ error: z.string().optional() }),
  ssr: false,
  head: () => ({ meta: [{ title: "Planned workout - Trainstack" }] }),
  component: Planned,
});

function Planned() {
  const { id } = Route.useParams();
  const { error } = Route.useSearch();
  return (
    <SignedIn signInError={error}>
      <PlannedPage id={id} />
    </SignedIn>
  );
}
