import { Resend } from "resend";
import { env } from "@trainstack/prehab-env/server";

let resend: Resend | undefined;

function getResend(): Resend {
  if (!resend) {
    resend = new Resend(env.RESEND_API_KEY);
  }
  return resend;
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const FROM = "Pre by TrainStack <hello@updates.trainstackhq.com>";

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const { error } = await getResend().emails.send({
    from: FROM,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
