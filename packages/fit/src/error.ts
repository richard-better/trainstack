export type FitDecodeErrorCode =
  | "notAFitFile"
  | "truncated"
  | "badChecksum"
  | "malformed"
  | "noActivity"
  | "noWorkout"
  | "tooLarge";

const messages: Record<FitDecodeErrorCode, string> = {
  notAFitFile: "The data is not a FIT file.",
  truncated: "The FIT file ends before its data does.",
  badChecksum: "The FIT file's checksum does not match its contents.",
  malformed: "The FIT file's messages do not follow the FIT protocol.",
  noActivity: "The FIT file has no sessions and no records.",
  noWorkout: "The FIT file is not a workout file, or it has no workout steps.",
  tooLarge: "The FIT file has more laps, sessions or workout steps than it can have.",
};

export class FitDecodeError extends Error {
  readonly code: FitDecodeErrorCode;

  constructor(code: FitDecodeErrorCode) {
    super(messages[code]);
    this.name = "FitDecodeError";
    this.code = code;
  }
}
