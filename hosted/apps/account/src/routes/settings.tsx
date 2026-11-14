import { createFileRoute } from "@tanstack/react-router";
import { zoneMetrics } from "@trainstack/zones";
import * as z from "zod";

import { SignedIn } from "../components/session";
import { SettingsPage } from "../components/settings-page";

export const Route = createFileRoute("/settings")({
  validateSearch: z.object({
    error: z.string().optional(),
    sport: z.string().optional().catch(undefined),
    metric: z.enum(zoneMetrics).optional().catch(undefined),
    delete: z.boolean().optional().catch(undefined),
  }),
  ssr: false,
  head: () => ({ meta: [{ title: "Settings - Trainstack" }] }),
  component: Settings,
});

function Settings() {
  const { error, sport, metric, delete: confirmDeleting } = Route.useSearch();
  return (
    <SignedIn signInError={error}>
      <SettingsPage sport={sport} metric={metric} confirmDeleting={confirmDeleting} />
    </SignedIn>
  );
}
