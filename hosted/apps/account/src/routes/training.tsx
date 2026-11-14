import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { SignedIn } from "../components/session";
import { TrainingPage } from "../components/training-page";
import { bestsPeriodKeys, loadRangeKeys } from "../lib/training";

export const Route = createFileRoute("/training")({
  validateSearch: z.object({
    error: z.string().optional(),
    range: z.enum(loadRangeKeys).default("6m").catch("6m"),
    period: z.enum(bestsPeriodKeys).default("season").catch("season"),
  }),
  ssr: false,
  head: () => ({ meta: [{ title: "Training - Trainstack" }] }),
  component: Training,
});

function Training() {
  const { error, range, period } = Route.useSearch();
  return (
    <SignedIn signInError={error}>
      <TrainingPage range={range} period={period} />
    </SignedIn>
  );
}
