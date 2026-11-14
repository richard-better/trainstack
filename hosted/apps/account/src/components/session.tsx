import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { queryClient, uploads } from "../api";
import { authClient } from "../auth";
import { HELP_SITE } from "../lib/help";
import { forgetLogDrafts } from "../lib/logbook";
import { calendarWrites } from "./calendar-data";
import { HelpLink } from "./help-link";

import { TimeZoneFromBrowser } from "./time-zone";

type SignedInUser = { name: string; email: string };

export function SignedIn({
  signInError,
  accountDeleted,
  children,
}: {
  signInError?: string;
  accountDeleted?: boolean;
  children: ReactNode;
}) {
  const { data: session, isPending, error } = authClient.useSession();

  if (isPending) return <Gate busy />;
  if (error) {
    return (
      <Gate>
        <p role="alert" className="notice">
          Trainstack is not reachable right now. Reload the page to try again.
        </p>
      </Gate>
    );
  }
  if (!session) return <SignIn signInError={signInError} accountDeleted={accountDeleted} />;
  const user = { name: session.user.name, email: session.user.email };
  return (
    <div className="app">
      <TimeZoneFromBrowser />
      <AppHeader user={user} />
      {children}
    </div>
  );
}

function AppHeader({ user }: { user: SignedInUser }) {
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    calendarWrites.clear();
    forgetLogDrafts();
    await authClient.signOut();
    uploads.clear();
    queryClient.clear();
    setSigningOut(false);
  }

  return (
    <header className="app-header">
      <Link to="/" className="brand">
        <img src="/trainstack-logo.svg" alt="" width={24} height={24} />
        <span className="brand-name">Trainstack</span>
      </Link>
      <nav aria-label="Main" className="main-nav">
        <Link to="/" className="nav-link" activeOptions={{ exact: true }}>
          Today
        </Link>
        <Link to="/activities" className="nav-link">
          Activities
        </Link>
        <Link to="/training" className="nav-link">
          Training
        </Link>
        <Link to="/calendar" search={{ view: "month" }} className="nav-link">
          Calendar
        </Link>
        <Link to="/workouts" className="nav-link">
          Workouts
        </Link>
        <Link to="/settings" className="nav-link">
          Settings
        </Link>
        <a href={HELP_SITE} className="nav-link" target="_blank" rel="noreferrer">
          Help
        </a>
      </nav>
      <div className="account">
        <span className="account-name" title={user.email}>
          {user.name || user.email}
        </span>
        <button type="button" className="quiet" onClick={signOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </header>
  );
}

function Gate({ busy, children }: { busy?: boolean; children?: ReactNode }) {
  return (
    <main className="gate">
      <header className="brand">
        <img src="/trainstack-logo.svg" alt="" width={24} height={24} />
        Trainstack
      </header>
      <section className="card" aria-live="polite" aria-busy={busy}>
        {children}
      </section>
    </main>
  );
}

function SignIn({
  signInError,
  accountDeleted,
}: {
  signInError?: string;
  accountDeleted?: boolean;
}) {
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signIn() {
    setStarting(true);
    setFailed(false);
    const here = new URL(window.location.href);
    here.searchParams.delete("error");
    here.searchParams.delete("deleted");
    window.history.replaceState(null, "", here);
    const { error } = await authClient.signIn.social({
      provider: "apple",
      callbackURL: here.href,
      errorCallbackURL: here.href,
    });
    if (error) {
      setStarting(false);
      setFailed(true);
    }
  }

  return (
    <Gate>
      {accountDeleted && (
        <p role="status" className="lede account-deleted">
          Your account and everything in it is deleted.
        </p>
      )}
      <h1>Sign in to Trainstack</h1>
      <p className="lede">
        Use the Apple ID you sign in to Ride with to reach the same account.{" "}
        <HelpLink topic="getting-started">Getting started</HelpLink>
      </p>
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
    </Gate>
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
