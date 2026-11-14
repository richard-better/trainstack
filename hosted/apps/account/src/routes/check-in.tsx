import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { CheckInPage } from "../components/check-in-page";
import { SignedIn } from "../components/session";
import { historyRangeKeys } from "../lib/check-in";

export const Route = createFileRoute("/check-in")({
  validateSearch: z.object({
    error: z.string().optional(),
    day: z.iso.date().optional().catch(undefined),
    range: z.enum(historyRangeKeys).default("6w").catch("6w"),
  }),
  ssr: false,
  head: () => ({ meta: [{ title: "Check-in - Trainstack" }] }),
  component: CheckIn,
});

function CheckIn() {
  const { error, day, range } = Route.useSearch();
  return (
    <SignedIn signInError={error}>
      <CheckInPage day={day} range={range} />
    </SignedIn>
  );
}
