import type { Task } from "graphile-worker";
import type { EventPayloads } from "../types.js";
import { renderAccountDeletionScheduled } from "@trainstack/prehab-email";
import { sendEmail } from "../../lib/email/send.js";

export const accountDeletionScheduled: Task = async (rawPayload, helpers) => {
  const payload = rawPayload as EventPayloads["account_deletion_scheduled"];
  const { email, name, deletionDate } = payload;

  const formattedDate = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(deletionDate));

  const { html, text } = await renderAccountDeletionScheduled({
    name,
    deletionDate: formattedDate,
  });

  await sendEmail({
    to: email,
    subject: "Your Pre account is scheduled for deletion",
    html,
    text,
  });

  helpers.logger.info("Account deletion-scheduled email sent", { email, deletionDate });
};
