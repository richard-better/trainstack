import { Link } from "@tanstack/react-router";

import { summaryWords } from "../lib/check-in";
import { todayIn } from "../lib/time-zone";
import { useCheckInOn } from "./check-in-data";
import { useAthleteSettings } from "./time-zone";

export function CheckInPrompt() {
  const settings = useAthleteSettings();
  const today = todayIn(settings.data?.timeZone ?? null);
  const held = useCheckInOn(today, { enabled: !settings.isPending });
  if (held.checkIn === undefined) return null;
  if (held.checkIn === null) {
    return (
      <aside className="check-in-prompt" aria-label="Today's check-in">
        <p className="check-in-prompt-text">
          <span className="check-in-prompt-title">How do you feel today?</span>
          <span className="muted">Sleep, energy, soreness, stress and mood, in a few taps.</span>
        </p>
        <Link to="/check-in" className="primary link-button compact">
          Check in
        </Link>
      </aside>
    );
  }
  return (
    <aside className="check-in-prompt done" aria-label="Today's check-in">
      <p className="check-in-prompt-text">
        <span className="check-in-prompt-title">Checked in today</span>
        <span className="muted">{summaryWords(held.checkIn).join(". ")}</span>
      </p>
      <Link to="/check-in" className="quiet link-button compact">
        Edit
      </Link>
    </aside>
  );
}
