export type FitDecodeErrorCode =
  | "notAFitFile"
  | "truncated"
  | "badChecksum"
  | "malformed"
  | "noActivity";

const messages: Record<FitDecodeErrorCode, string> = {
  notAFitFile: "The data is not a FIT file.",
  truncated: "The FIT file ends before its data does.",
  badChecksum: "The FIT file's checksum does not match its contents.",
  malformed: "The FIT file's messages do not follow the FIT protocol.",
  noActivity: "The FIT file has no sessions and no records.",
};

export class FitDecodeError extends Error {
  readonly code: FitDecodeErrorCode;

  constructor(code: FitDecodeErrorCode) {
    super(messages[code]);
    this.name = "FitDecodeError";
    this.code = code;
  }
}
