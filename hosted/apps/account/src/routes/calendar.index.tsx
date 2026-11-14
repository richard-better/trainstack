import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { CalendarPage } from "../components/calendar-page";
import { SignedIn } from "../components/session";
import { calendarViews } from "../lib/calendar";

export const Route = createFileRoute("/calendar/")({
  validateSearch: z.object({
    error: z.string().optional(),
    view: z.enum(calendarViews).default("month").catch("month"),
    at: z.string().max(10).optional().catch(undefined),
  }),
  ssr: false,
  head: () => ({ meta: [{ title: "Calendar - Trainstack" }] }),
  component: Calendar,
});

function Calendar() {
  const { error, view, at } = Route.useSearch();
  return (
    <SignedIn signInError={error}>
      <CalendarPage view={view} at={at} />
    </SignedIn>
  );
}
