import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import * as z from "zod";

import { authClient } from "../auth";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ error: z.string().optional() }),
  ssr: false,
  component: Home,
  pendingComponent: Page,
});

function Home() {
  const { data: session, isPending, error: sessionError } = authClient.useSession();
  const { error: signInError } = Route.useSearch();

  if (isPending) return <Page />;
  if (sessionError) {
    return (
      <Page>
        <p role="alert" className="notice">
          Trainstack is not reachable right now. Reload the page to try again.
        </p>
      </Page>
    );
  }
  if (!session) return <SignedOut signInError={signInError} />;
  return <SignedIn name={session.user.name} email={session.user.email} />;
}

function Page({ children }: { children?: ReactNode }) {
  return (
    <main className="page">
      <header className="brand">
        <img src="/trainstack-logo.svg" alt="" width={24} height={24} />
        Trainstack
      </header>
      <section className="card" aria-live="polite">
        {children}
      </section>
    </main>
  );
}

function SignedOut({ signInError }: { signInError?: string }) {
  const navigate = useNavigate({ from: "/" });
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signIn() {
    setStarting(true);
    setFailed(false);
    await navigate({ search: {}, replace: true });
    const here = `${window.location.origin}/`;
    const { error } = await authClient.signIn.social({
      provider: "apple",
      callbackURL: here,
      errorCallbackURL: here,
    });
    if (error) {
      setStarting(false);
      setFailed(true);
    }
  }

  return (
    <Page>
      <h1>Sign in to Trainstack</h1>
      <p className="lede">Use the Apple ID you sign in to Ride with to reach the same account.</p>
      {(signInError || failed) && (
        <p role="alert" className="notice">
          {signInError === "user_cancelled_authorize"
            ? "Sign in was cancelled."
            : "Sign in did not finish. Try again."}
        </p>
      )}
      <button type="button" className="apple" onClick={signIn} disabled={starting}>
        <AppleLogo />
        {starting ? "Opening Apple…" : "Sign in with Apple"}
      </button>
    </Page>
  );
}

function SignedIn({ name, email }: { name: string; email: string }) {
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut();
    setSigningOut(false);
  }

  return (
    <Page>
      <p className="eyebrow">Signed in</p>
      <h1>{name || "Welcome back"}</h1>
      {email && <p className="lede">{email}</p>}
      <button type="button" className="secondary" onClick={signOut} disabled={signingOut}>
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </Page>
  );
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 814 1000" width="16" height="19" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"
      />
    </svg>
  );
}
