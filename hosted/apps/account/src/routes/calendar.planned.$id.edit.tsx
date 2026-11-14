import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { PlannedEditPage } from "../components/planned-page";
import { SignedIn } from "../components/session";

export const Route = createFileRoute("/calendar/planned/$id/edit")({
  validateSearch: z.object({ error: z.string().optional() }),
  ssr: false,
  head: () => ({ meta: [{ title: "Edit planned workout - Trainstack" }] }),
  component: EditPlanned,
});

function EditPlanned() {
  const { id } = Route.useParams();
  const { error } = Route.useSearch();
  return (
    <SignedIn signInError={error}>
      <PlannedEditPage id={id} />
    </SignedIn>
  );
}
