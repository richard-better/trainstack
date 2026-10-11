import type { Task } from "graphile-worker";
import type { EventPayloads } from "../types.js";
import { renderAccountReactivated } from "@trainstack/prehab-email";
import { sendEmail } from "../../lib/email/send.js";

export const accountReactivated: Task = async (rawPayload, helpers) => {
  const payload = rawPayload as EventPayloads["account_reactivated"];
  const { email, name } = payload;

  const { html, text } = await renderAccountReactivated({ name });

  await sendEmail({
    to: email,
    subject: "Your Pre account is back",
    html,
    text,
  });

  helpers.logger.info("Account reactivation email sent", { email });
};
