import type { Task } from "graphile-worker";
import type { EventPayloads } from "../types.js";
import { renderWaitlistWelcome } from "@trainstack/prehab-email";
import { sendEmail } from "../../lib/email/send.js";

export const waitlistSignup: Task = async (rawPayload, helpers) => {
  const payload = rawPayload as EventPayloads["waitlist_signup"];
  const { email } = payload;

  const { html, text } = await renderWaitlistWelcome();

  await sendEmail({
    to: email,
    subject: "You're on the Pre waitlist",
    html,
    text,
  });

  helpers.logger.info("Waitlist confirmation email sent", { email });
};
