import type { ReactNode } from "react";

import { type HelpTopic, helpUrl } from "../lib/help";

export function HelpLink({ topic, children }: { topic: HelpTopic; children: ReactNode }) {
  return (
    <a className="text-link help-link" href={helpUrl(topic)} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
