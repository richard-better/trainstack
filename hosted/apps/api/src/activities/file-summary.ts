import type { ActivityStatisticName } from "@trainstack/contract";

import type { ActivitySummaryError } from "../db/schema";

export class SummaryError extends Error {
  constructor(readonly code: ActivitySummaryError) {
    super(`The activity's file could not be summarised: ${code}`);
  }
}

export type SummaryEvent = {
  type: string;
  startedAt: Date;
  endedAt: Date | null;
  data: Record<string, string | number | boolean>;
};

export type FileSummary = {
  startedAt: Date | undefined;
  utcOffsetSeconds: number | undefined;
  sport: string | undefined;
  indoor: boolean | undefined;
  name: string | undefined;
  statistics: Partial<Record<ActivityStatisticName, number>>;
  events: SummaryEvent[];
};
