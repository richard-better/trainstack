import { render } from "@react-email/render";
import { jsx } from "react/jsx-runtime";
import { WaitlistWelcome } from "./templates/waitlist-welcome.js";
import {
  AccountDeletionScheduled,
  type AccountDeletionScheduledProps,
} from "./templates/account-deletion-scheduled.js";
import {
  AccountReactivated,
  type AccountReactivatedProps,
} from "./templates/account-reactivated.js";

export { WaitlistWelcome } from "./templates/waitlist-welcome.js";
export { AccountDeletionScheduled } from "./templates/account-deletion-scheduled.js";
export { AccountReactivated } from "./templates/account-reactivated.js";

export async function renderWaitlistWelcome() {
  const element = jsx(WaitlistWelcome, {}) as React.ReactElement;
  const html = await render(element);
  const text = await render(element, { plainText: true });
  return { html, text };
}

export async function renderAccountDeletionScheduled(props: AccountDeletionScheduledProps) {
  const element = jsx(AccountDeletionScheduled, props) as React.ReactElement;
  const html = await render(element);
  const text = await render(element, { plainText: true });
  return { html, text };
}

export async function renderAccountReactivated(props: AccountReactivatedProps) {
  const element = jsx(AccountReactivated, props) as React.ReactElement;
  const html = await render(element);
  const text = await render(element, { plainText: true });
  return { html, text };
}
