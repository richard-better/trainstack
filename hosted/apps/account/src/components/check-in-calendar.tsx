import { Link } from "@tanstack/react-router";

import { type CheckIn, summaryWords } from "../lib/check-in";

export function CheckInOnDay({ checkIn, today }: { checkIn: CheckIn; today: string }) {
  const words = summaryWords(checkIn).join(". ");
  return (
    <Link
      to="/check-in"
      search={{ day: checkIn.day === today ? undefined : checkIn.day }}
      className="day-check-in"
      title={checkIn.note ? `${words}. ${checkIn.note}` : words}
    >
      <span className="visually-hidden">Check-in: </span>
      {words}
    </Link>
  );
}
