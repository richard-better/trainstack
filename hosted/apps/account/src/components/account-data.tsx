import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { authClient } from "../auth";
import { type Deletion, deleteAccount, exportUrl } from "../lib/account";

const serverUrl = import.meta.env.VITE_SERVER_URL;

export function AccountData({ confirmDeleting }: { confirmDeleting?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [outcome, setOutcome] = useState<Deletion | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!confirmDeleting) return;
    dialog.current?.showModal();
    void navigate({
      to: "/settings",
      search: (search) => ({ ...search, delete: undefined }),
      replace: true,
    });
  }, [confirmDeleting, navigate]);

  async function remove() {
    setDeleting(true);
    setOutcome(null);
    const result = await deleteAccount(() => authClient.deleteUser());
    if (result === "deleted") {
      window.location.replace("/?deleted=true");
      return;
    }
    setOutcome(result);
    setDeleting(false);
  }

  async function signInAgain() {
    setSigningIn(true);
    const back = new URL("/settings?delete=true", window.location.href).href;
    const { error } = await authClient.signIn.social({
      provider: "apple",
      callbackURL: back,
      errorCallbackURL: back,
    });
    if (error) {
      setSigningIn(false);
      setOutcome("failed");
    }
  }

  return (
    <section aria-labelledby="account-data-title" className="settings-section account-data">
      <h2 id="account-data-title" className="section-title">
        Your data
      </h2>
      <div className="setting-row">
        <div className="setting-text">
          <p className="setting-name">Export your data</p>
          <p className="setting-help">
            One archive with the original file of every activity, and your activities, settings with
            their history, workouts and account as documented JSON.
          </p>
        </div>
        <a className="link-button secondary compact" href={exportUrl(serverUrl)} download>
          Download
        </a>
      </div>
      <div className="setting-row">
        <div className="setting-text">
          <p className="setting-name">Delete account</p>
          <p className="setting-help">Deletes your account and everything in it, for good.</p>
        </div>
        <button
          type="button"
          className="secondary compact danger"
          onClick={() => dialog.current?.showModal()}
        >
          Delete account…
        </button>
      </div>
      <dialog
        ref={dialog}
        className="confirm delete-account"
        aria-labelledby="delete-account-title"
        onClose={() => setOutcome(null)}
      >
        <h2 id="delete-account-title">Delete your account?</h2>
        <p className="lede">
          This deletes your Trainstack account and everything in it, right away. It cannot be
          undone.
        </p>
        <ul className="deleted-things">
          <li>Every activity, with its original file, statistics and laps</li>
          <li>Your weight, thresholds and zones, with their history</li>
          <li>Your workouts and workout lists</li>
          <li>Your Strava connection. Strava is told Trainstack no longer has access.</li>
          <li>Your Sign in with Apple link, and every device signed in</li>
        </ul>
        <p className="lede">
          Activities already on Strava stay there, and Ride keeps the rides on your devices.
          Download your data first to keep a copy of the rest.
        </p>
        {outcome === "sign_in_again" && (
          <div role="alert" className="sign-in-again">
            <p className="notice">
              To delete your account, sign in again first. It shows it is you at this computer.
            </p>
            <button type="button" className="secondary" onClick={signInAgain} disabled={signingIn}>
              {signingIn ? "Opening Apple…" : "Sign in again"}
            </button>
          </div>
        )}
        {outcome === "failed" && (
          <p role="alert" className="notice">
            Your account was not deleted. Try again.
          </p>
        )}
        <div className="confirm-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => dialog.current?.close()}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="destructive"
            onClick={remove}
            disabled={deleting || outcome === "sign_in_again"}
          >
            {deleting ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </dialog>
    </section>
  );
}
