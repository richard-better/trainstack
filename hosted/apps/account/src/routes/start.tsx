import { createFileRoute } from "@tanstack/react-router";

import { StartPage } from "../components/getting-started";
import { SignedIn } from "../components/session";

export const Route = createFileRoute("/start")({
  ssr: false,
  head: () => ({ meta: [{ title: "Getting started - Trainstack" }] }),
  component: Start,
});

function Start() {
  return (
    <SignedIn>
      <StartPage />
    </SignedIn>
  );
}
