import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import * as z from "zod";

import { LogPage } from "../components/log-page";
import { SignedIn } from "../components/session";

export const Route = createFileRoute("/log/strength")({
  validateSearch: z.object({
    id: z.uuid().optional().catch(undefined),
    error: z.string().optional(),
  }),
  ssr: false,
  head: () => ({ meta: [{ title: "Log strength - Trainstack" }] }),
  component: Log,
});

function Log() {
  const { id, error } = Route.useSearch();
  const navigate = useNavigate();
  useEffect(() => {
    if (!id)
      void navigate({ to: "/log/strength", search: { id: crypto.randomUUID() }, replace: true });
  }, [id, navigate]);
  return <SignedIn signInError={error}>{id && <LogPage sport="strength" id={id} />}</SignedIn>;
}
