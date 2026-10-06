import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: AccountHome,
});

function AccountHome() {
  return (
    <main>
      <h1>Trainstack Account</h1>
    </main>
  );
}
